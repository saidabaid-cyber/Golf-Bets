import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

export const GOLFAPI_STAGE_ID = 'puebla-source-20261007';
export const GOLFAPI_REQUEST_LIMIT = 10;
export const GOLFAPI_ORIGIN = 'https://golfapi.io/api/v2.3/';
const SEARCH_KEYS = new Set(['name', 'state', 'city', 'country', 'lat', 'lng', 'measureUnit', 'timestampUpdated', 'page']);
const hash = value => createHash('sha256').update(value).digest('hex');

export function documentedRequest(endpoint, parameters = {}) {
  if (!/^(clubs|courses)(\/[0-9]+)?$/.test(endpoint) && !/^coordinates\/[0-9]+$/.test(endpoint)) throw Error('GOLFAPI_UNDOCUMENTED_ENDPOINT');
  const keys = endpoint.includes('/') ? (endpoint.startsWith('courses/') ? new Set(['measureUnit']) : new Set()) : SEARCH_KEYS;
  const url = new URL(endpoint, GOLFAPI_ORIGIN);
  for (const [key, value] of Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))) {
    if (!keys.has(key) || typeof value !== 'string' || !value.trim() || value.length > 160) throw Error('GOLFAPI_INVALID_PARAMETER');
    if (key === 'page' && !/^[1-9][0-9]*$/.test(value)) throw Error('GOLFAPI_INVALID_PAGE');
    if (key === 'measureUnit' && !(endpoint.includes('/') ? ['m', 'yd'] : ['km', 'mi', 'yd', 'm']).includes(value)) throw Error('GOLFAPI_INVALID_UNIT');
    url.searchParams.set(key, value);
  }
  if (!endpoint.includes('/') && !['name', 'state', 'city'].some(key => url.searchParams.has(key))) throw Error('GOLFAPI_BOUNDED_SEARCH_REQUIRED');
  return { endpoint, parameters: Object.fromEntries(url.searchParams), url: url.toString(), requestKey: hash(url.toString()) };
}

async function atomicWrite(filename, value) {
  const temporary = filename + '.' + randomUUID() + '.tmp';
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, filename);
}

async function jsonFile(filename) { return JSON.parse(await fs.readFile(filename, 'utf8')); }
function validateLedger(ledger) {
  if (ledger.schemaVersion !== 1 || ledger.stageId !== GOLFAPI_STAGE_ID || ledger.requestLimit !== GOLFAPI_REQUEST_LIMIT || !Array.isArray(ledger.attempts) || ledger.attempts.length > 10) throw Error('GOLFAPI_LEDGER_INVALID');
  ledger.attempts.forEach((attempt, index) => { if (attempt.sequence !== index + 1) throw Error('GOLFAPI_LEDGER_INVALID'); });
  return ledger;
}

/** One durable stage, independent of script invocations; never resets a ledger. */
export class GolfApiFileStore {
  constructor(root, io = {}) {
    if (!root || !path.isAbsolute(root)) throw Error('GOLFAPI_DURABLE_STORE_REQUIRED');
    this.root = path.resolve(root);
    this.write = io.atomicWrite ?? atomicWrite;
  }
  async initialize() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const release = await this.lock();
    try {
      const entries = await fs.readdir(this.root);
      if (entries.includes('ledger.json')) return await this.ledger();
      if (entries.some(name => name !== '.lock')) throw Error('GOLFAPI_EXISTING_STORE_WITHOUT_LEDGER');
      const ledger = { schemaVersion: 1, stageId: GOLFAPI_STAGE_ID, requestLimit: 10, createdAt: new Date().toISOString(), halted: null, attempts: [] };
      await this.write(path.join(this.root, 'ledger.json'), JSON.stringify(ledger, null, 2));
      return ledger;
    } finally { await release(); }
  }
  async lock() {
    try {
      const file = await fs.open(path.join(this.root, '.lock'), 'wx', 0o600);
      await file.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      await file.sync(); await file.close();
      return () => fs.unlink(path.join(this.root, '.lock'));
    } catch (error) {
      if (error.code === 'EEXIST') throw Error('GOLFAPI_STORE_BUSY_NO_REQUEST');
      throw error;
    }
  }
  async ledger() { return validateLedger(await jsonFile(path.join(this.root, 'ledger.json'))); }
  async cached(request) {
    const ledger = await this.ledger();
    const attempt = ledger.attempts.find(row => row.requestKey === request.requestKey && row.state === 'SAVED');
    if (!attempt) return null;
    const response = await jsonFile(path.join(this.root, attempt.responseFile));
    if (response.requestKey !== request.requestKey || hash(response.bodyText) !== response.bodySha256) throw Error('GOLFAPI_RESPONSE_INTEGRITY_FAILURE');
    return response;
  }
  async request(request, { apiKey, reason, networkEnabled = false, transport = globalThis.fetch, runtime = process.env } = {}) {
    const release = await this.lock();
    try {
      const saved = await this.cached(request);
      if (saved) return { response: saved, cached: true };
      const ledger = await this.ledger();
      if (ledger.halted || ledger.attempts.some(row => row.state !== 'SAVED')) throw Error('GOLFAPI_HALTED_REVIEW_REQUIRED');
      if (ledger.attempts.length >= GOLFAPI_REQUEST_LIMIT) throw Error('GOLFAPI_REQUEST_BUDGET_EXHAUSTED');
      if (!networkEnabled || runtime.CI || runtime.NODE_TEST_CONTEXT || runtime.NODE_ENV === 'test') throw Error('GOLFAPI_NETWORK_DISABLED');
      if (!apiKey || typeof reason !== 'string' || !reason.trim()) throw Error('GOLFAPI_KEY_AND_REASON_REQUIRED');
      // Verify the supplied URL anew; callers cannot redirect credentials elsewhere.
      const checked = documentedRequest(request.endpoint, request.parameters);
      if (checked.url !== request.url || checked.requestKey !== request.requestKey) throw Error('GOLFAPI_REQUEST_INVALID');
      const attempt = { sequence: ledger.attempts.length + 1, endpoint: request.endpoint, parameters: request.parameters, requestKey: request.requestKey, reason: reason.replaceAll(apiKey, '[REDACTED]'), startedAt: new Date().toISOString(), state: 'RESERVED' };
      ledger.attempts.push(attempt);
      // The reservation is durable BEFORE contacting GolfAPI. Interrupted writes
      // consume one slot and halt; they are never retried/refunded automatically.
      await this.write(path.join(this.root, 'ledger.json'), JSON.stringify(ledger, null, 2));
      let response;
      try {
        const fetched = await transport(request.url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
        const bodyText = (await fetched.text()).replaceAll(apiKey, '[REDACTED]');
        response = { schemaVersion: 1, provider: 'GOLFAPI', apiVersion: '2.3', requestKey: request.requestKey, endpoint: request.endpoint, parameters: request.parameters, fetchedAt: new Date().toISOString(), httpStatus: fetched.status, contentType: fetched.headers.get('content-type'), bodyText, bodySha256: hash(bodyText) };
        attempt.responseFile = `response-${String(attempt.sequence).padStart(2, '0')}-${request.requestKey.slice(0, 16)}.json`;
        // Preserve COMPLETE response text before parsing/normalizing it. No auth
        // header, cookies, request credentials or secret-bearing URL is retained.
        await this.write(path.join(this.root, attempt.responseFile), JSON.stringify(response, null, 2));
        attempt.state = 'SAVED'; attempt.httpStatus = response.httpStatus;
        if (response.httpStatus < 200 || response.httpStatus >= 300) ledger.halted = `HTTP_${response.httpStatus}`;
        try {
          const body = JSON.parse(bodyText);
          const quota = body.apiRequestsLeft === undefined ? null : Number(body.apiRequestsLeft);
          attempt.providerRequestsLeft = Number.isFinite(quota) ? quota : null;
          if (quota !== null && Number.isFinite(quota) && quota <= 0) ledger.halted = 'PROVIDER_QUOTA_EXHAUSTED';
        } catch { ledger.halted = 'NON_JSON_RESPONSE'; }
        await this.write(path.join(this.root, 'ledger.json'), JSON.stringify(ledger, null, 2));
      } catch {
        // Retain RESERVED if storage fails: every future request fails closed.
        ledger.halted = 'TRANSPORT_OR_RESPONSE_PERSISTENCE_FAILURE';
        try { await this.write(path.join(this.root, 'ledger.json'), JSON.stringify(ledger, null, 2)); } catch { /* reservation already persists */ }
        throw Error('GOLFAPI_TRANSPORT_OR_PERSISTENCE_FAILURE_NO_RETRY');
      }
      return { response, cached: false };
    } finally { await release(); }
  }
  async putNormalized(courseId, bundle) {
    if (!/^[0-9]+$/.test(courseId)) throw Error('GOLFAPI_COURSE_ID_INVALID');
    await this.write(path.join(this.root, `normalized-${courseId}.json`), JSON.stringify(bundle, null, 2));
  }
  async readNormalized(courseId) {
    if (!/^[0-9]+$/.test(courseId)) throw Error('GOLFAPI_COURSE_ID_INVALID');
    const snapshot = await jsonFile(path.join(this.root, `normalized-${courseId}.json`));
    if (snapshot.schemaVersion !== 1 || snapshot.provider !== 'GOLFAPI' || snapshot.externalCourseId !== courseId) throw Error('GOLFAPI_SAVED_SNAPSHOT_INVALID');
    return snapshot;
  }
}

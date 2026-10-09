import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GolfApiFileStore, documentedRequest } from '../lib/golfapi/controlled-store.mjs';

async function fixture(t, io) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'golfapi-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new GolfApiFileStore(root, io); await store.initialize(); return { root, store };
}
const successful = () => new Response(JSON.stringify({ apiRequestsLeft: '24.9', clubs: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const options = transport => ({ apiKey: 'synthetic-test-secret', reason: 'Synthetic test, no real network', networkEnabled: true, runtime: {}, transport });

test('only documented endpoints, bounded filters and parameters; no credential URLs', () => {
  const a = documentedRequest('clubs', { state: 'puebla', page: '1' });
  const b = documentedRequest('clubs', { page: '1', state: 'puebla' });
  assert.equal(a.requestKey, b.requestKey); assert.equal(a.url, 'https://golfapi.io/api/v2.3/clubs?page=1&state=puebla');
  for (const endpoint of ['https://example.invalid/clubs', 'coordinates', 'courses/../clubs', 'courses/abc']) assert.throws(() => documentedRequest(endpoint));
  assert.throws(() => documentedRequest('clubs', { country: 'mexico' }));
  assert.throws(() => documentedRequest('clubs', { state: 'puebla', key: 'secret' }));
  assert.throws(() => documentedRequest('coordinates/1', { page: '2' }));
  assert.throws(() => documentedRequest('clubs', { name: 'test', page: '0' }));
});

test('durable response and ledger survive restart; offline repeated reads call nothing', async t => {
  const { root, store } = await fixture(t); let calls = 0;
  const request = documentedRequest('clubs', { state: 'puebla' });
  await store.request(request, options(async () => { calls++; return successful(); }));
  const restarted = new GolfApiFileStore(root); await restarted.initialize();
  const cached = await restarted.request(request); assert.equal(cached.cached, true);
  assert.equal(JSON.parse(cached.response.bodyText).apiRequestsLeft, '24.9');
  assert.equal((await restarted.ledger()).attempts.length, 1); assert.equal(calls, 1);
  assert.equal((await readFile(path.join(root, 'ledger.json'), 'utf8')).includes('synthetic-test-secret'), false);
});

test('ten requests is an immutable cumulative cap across new store instances', async t => {
  const { root, store } = await fixture(t); let calls = 0;
  for (let index = 1; index <= 10; index++) await store.request(documentedRequest(`courses/${index}`), options(async () => { calls++; return successful(); }));
  await assert.rejects(() => new GolfApiFileStore(root).request(documentedRequest('courses/11'), options(async () => { calls++; return successful(); })), /BUDGET_EXHAUSTED/);
  assert.equal(calls, 10); assert.equal((await store.initialize()).attempts.length, 10);
});

test('concurrent identical requests cannot spend twice', async t => {
  const { store } = await fixture(t); let calls = 0;
  const request = documentedRequest('courses/1');
  const results = await Promise.allSettled([store.request(request, options(async () => { calls++; return successful(); })), store.request(request, options(async () => { calls++; return successful(); }))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(calls, 1); assert.equal((await store.request(request)).cached, true);
});

test('network opt-in and build/CI/test guards fail before reserving a request', async t => {
  const { store } = await fixture(t); let calls = 0;
  const request = documentedRequest('courses/1');
  const transport = async () => { calls++; return successful(); };
  await assert.rejects(() => store.request(request, { ...options(transport), networkEnabled: false }), /NETWORK_DISABLED/);
  for (const runtime of [{ CI: 'true' }, { NODE_TEST_CONTEXT: 'child-v8' }, { NODE_ENV: 'test' }]) await assert.rejects(() => store.request(request, { ...options(transport), runtime }), /NETWORK_DISABLED/);
  assert.equal(calls, 0); assert.equal((await store.ledger()).attempts.length, 0);
});

test('authentication/permission/quota errors are saved and halt new requests without retry', async t => {
  for (const status of [401, 403, 429]) {
    const { store } = await fixture(t); let calls = 0;
    await store.request(documentedRequest('courses/1'), options(async () => { calls++; return new Response('{"error":"test"}', { status }); }));
    const cached = await store.request(documentedRequest('courses/1')); assert.equal(cached.response.httpStatus, status);
    await assert.rejects(() => store.request(documentedRequest('courses/2'), options(async () => { calls++; return successful(); })), /HALTED/);
    assert.equal(calls, 1);
  }
});

test('redirect is not followed and no credentials are stored, even if echoed', async t => {
  const { root, store } = await fixture(t);
  const result = await store.request(documentedRequest('courses/1'), options(async (url, init) => {
    assert.equal(init.redirect, 'manual'); assert.equal(init.headers.Authorization, 'Bearer synthetic-test-secret');
    return new Response('{"echo":"synthetic-test-secret"}', { status: 302, headers: { Location: 'https://example.invalid' } });
  }));
  assert.equal(result.response.bodyText.includes('synthetic-test-secret'), false);
  const attempt = (await store.ledger()).attempts[0];
  assert.equal((await readFile(path.join(root, attempt.responseFile), 'utf8')).includes('synthetic-test-secret'), false);
  assert.equal((await store.ledger()).halted, 'HTTP_302');
});

test('failed response persistence stops further requests; reservation still counts', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'golfapi-test-failure-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new GolfApiFileStore(root, { atomicWrite: async (filename, value) => {
    if (path.basename(filename).startsWith('response-')) throw Error('disk failure');
    await writeFile(filename, value);
  } });
  await store.initialize(); let calls = 0;
  await assert.rejects(() => store.request(documentedRequest('courses/1'), options(async () => { calls++; return successful(); })), /PERSISTENCE_FAILURE/);
  await assert.rejects(() => new GolfApiFileStore(root).request(documentedRequest('courses/2'), options(async () => { calls++; return successful(); })), /HALTED/);
  assert.equal(calls, 1); assert.equal((await store.ledger()).attempts.length, 1);
});

test('transport timeout/error is counted and persisted; no automatic retry', async t => {
  const { store } = await fixture(t); let calls = 0;
  await assert.rejects(() => store.request(documentedRequest('courses/1'), options(async () => { calls++; throw Error('timeout'); })), /NO_RETRY/);
  assert.equal((await store.ledger()).attempts.length, 1);
  await assert.rejects(() => store.request(documentedRequest('courses/1'), options(async () => { calls++; return successful(); })), /HALTED/);
  assert.equal(calls, 1);
});

test('tampered saved response and broken ledger never trigger a network repair', async t => {
  const { root, store } = await fixture(t);
  await store.request(documentedRequest('courses/1'), options(async () => successful()));
  const row = (await store.ledger()).attempts[0]; const filename = path.join(root, row.responseFile);
  const saved = JSON.parse(await readFile(filename, 'utf8')); saved.bodyText = '{}'; await writeFile(filename, JSON.stringify(saved));
  await assert.rejects(() => store.cached(documentedRequest('courses/1')), /INTEGRITY_FAILURE/);
  await writeFile(path.join(root, 'ledger.json'), '{}'); await assert.rejects(() => store.initialize(), /LEDGER_INVALID/);
});
test('saved normalized identity validated and path traversal rejected without network', async t => {
  const { store } = await fixture(t);
  await store.putNormalized('00100', { schemaVersion: 1, provider: 'GOLFAPI', externalCourseId: '00100', synthetic: true });
  assert.equal((await store.readNormalized('00100')).synthetic, true);
  await assert.rejects(() => store.readNormalized('../00100'), /COURSE_ID_INVALID/);
  await store.putNormalized('00200', { schemaVersion: 1, provider: 'GOLFAPI', externalCourseId: '00100' });
  await assert.rejects(() => store.readNormalized('00200'), /SAVED_SNAPSHOT_INVALID/);
});

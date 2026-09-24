import { createHash, createSign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { RETENTION_LIMITS, planRetention } from './retention.mjs';

const DRIVE_API = 'https://www.googleapis.com';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_FOLDER_NAME = 'The Backyard - Backups';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FILE_FIELDS = 'id,name,mimeType,size,parents,trashed,appProperties,driveId,capabilities(canAddChildren,canListChildren)';
const SHARED_DRIVE_FIELDS = 'id,name,kind,hidden,capabilities(canAddChildren,canListChildren)';
const REQUEST_TIMEOUT_MS = 120000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_CHUNK_GRANULARITY = 256 * 1024;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const UPLOAD_MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const UPLOAD_MAX_RETRIES = 4;
const MANAGED_PACKAGE_RE = /^The-Backyard-Backup-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const DRIVE_DIAGNOSTIC_PHASES = new Set([
  'NOT_STARTED', 'ROOT_DISCOVERY', 'SESSION_CREATE', 'CHUNK_UPLOAD', 'STATUS_QUERY', 'FINALIZE', 'COMPLETE',
]);
const DRIVE_DIAGNOSTIC_HTTP = new Set(['NOT_AVAILABLE', 'NETWORK_ERROR']);
const DRIVE_DIAGNOSTIC_FLAGS = new Set(['UNKNOWN', 'YES', 'NO']);
const DRIVE_DIAGNOSTIC_KINDS = new Set(['UNKNOWN', 'PACKAGE', 'CHECKSUM', 'FILE']);

export function safeDriveDiagnostic(value = {}) {
  const httpStatus = Number.isInteger(value?.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599
    ? value.httpStatus
    : DRIVE_DIAGNOSTIC_HTTP.has(value?.httpStatus) ? value.httpStatus : 'NOT_AVAILABLE';
  const safeInteger = (candidate) => Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0;
  return Object.freeze({
    phase: DRIVE_DIAGNOSTIC_PHASES.has(value?.phase) ? value.phase : 'NOT_STARTED',
    httpStatus,
    retryAttempt: safeInteger(value?.retryAttempt),
    offset: safeInteger(value?.offset),
    totalBytes: safeInteger(value?.totalBytes),
    chunkBytes: safeInteger(value?.chunkBytes),
    sharedDriveDetected: DRIVE_DIAGNOSTIC_FLAGS.has(value?.sharedDriveDetected) ? value.sharedDriveDetected : 'UNKNOWN',
    canAddChildren: DRIVE_DIAGNOSTIC_FLAGS.has(value?.canAddChildren) ? value.canAddChildren : 'UNKNOWN',
    fileKind: DRIVE_DIAGNOSTIC_KINDS.has(value?.fileKind) ? value.fileKind : 'UNKNOWN',
  });
}

export class DriveError extends Error {
  constructor(code, driveDiagnostic) {
    super(code);
    this.code = code;
    if (driveDiagnostic) this.driveDiagnostic = safeDriveDiagnostic(driveDiagnostic);
  }
}

function base64url(value) { return Buffer.from(value).toString('base64url'); }
function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(value); }
function validName(value) { return typeof value === 'string' && value.length > 0 && value.length <= 180 && !/[\x00-\x1f/\\]/.test(value); }
function timeoutSignal(milliseconds = REQUEST_TIMEOUT_MS) { return AbortSignal.timeout(milliseconds); }
function sleep(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function isRetryableStatus(status) { return status === 408 || status === 429 || (status >= 500 && status <= 599); }
function acceptsUploadStatus(status) { return status === 200 || status === 201 || status === 308 || isRetryableStatus(status); }
function validManagedPackageName(value) { return typeof value === 'string' && MANAGED_PACKAGE_RE.test(value); }

function assertPackageInfo(packageInfo) {
  if (!packageInfo || !validManagedPackageName(packageInfo.packageName) ||
      packageInfo.checksumName !== `${packageInfo.packageName}.sha256` ||
      typeof packageInfo.packagePath !== 'string' || basename(packageInfo.packagePath) !== packageInfo.packageName ||
      typeof packageInfo.checksumPath !== 'string' || basename(packageInfo.checksumPath) !== packageInfo.checksumName ||
      !Number.isSafeInteger(packageInfo.bytes) || packageInfo.bytes <= 0 || !SHA256_RE.test(packageInfo.sha256 || '')) {
    throw new DriveError('GDRIVE_PACKAGE_INFO_INVALID');
  }
}

async function validatePackageInfo(packageInfo) {
  assertPackageInfo(packageInfo);
  let packageStat, checksumStat, checksumText;
  try {
    [packageStat, checksumStat, checksumText] = await Promise.all([
      stat(packageInfo.packagePath), stat(packageInfo.checksumPath), readFile(packageInfo.checksumPath, 'utf8'),
    ]);
  } catch { throw new DriveError('GDRIVE_PACKAGE_INFO_INVALID'); }
  if (!packageStat.isFile() || packageStat.size !== packageInfo.bytes || !checksumStat.isFile() || checksumStat.size > 2048 ||
      checksumText !== `${packageInfo.sha256}  ${packageInfo.packageName}\n`) {
    throw new DriveError('GDRIVE_PACKAGE_INFO_INVALID');
  }
  const hash = createHash('sha256'); let bytes = 0;
  try {
    for await (const chunk of createReadStream(packageInfo.packagePath)) { hash.update(chunk); bytes += chunk.length; }
  } catch { throw new DriveError('GDRIVE_PACKAGE_INFO_INVALID'); }
  if (bytes !== packageInfo.bytes || hash.digest('hex') !== packageInfo.sha256) throw new DriveError('GDRIVE_PACKAGE_INFO_INVALID');
}

function hasProperties(file, expected) {
  const actual = file?.appProperties;
  return actual && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function nextUploadOffset(response, totalBytes) {
  const range = response.headers.get('range');
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  const offset = match ? Number(match[1]) + 1 : Number.NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > totalBytes) throw new DriveError('GDRIVE_UPLOAD_RANGE_INVALID');
  return offset;
}

async function discardResponseBody(response) {
  if (!response?.body) return;
  try { await response.body.cancel(); }
  catch { throw new DriveError('GDRIVE_RESPONSE_DISCARD_FAILED'); }
}

async function readUploadChunk(path, start, end) {
  const length = end - start + 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || length <= 0) {
    throw new DriveError('GDRIVE_UPLOAD_RANGE_INVALID');
  }
  let handle;
  try {
    handle = await open(path, 'r');
    const chunk = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(chunk, offset, length - offset, start + offset);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0) throw new DriveError('GDRIVE_UPLOAD_FILE_READ_FAILED');
      offset += bytesRead;
    }
    return chunk;
  } catch (error) {
    if (error instanceof DriveError) throw error;
    throw new DriveError('GDRIVE_UPLOAD_FILE_READ_FAILED');
  } finally {
    if (handle) {
      try { await handle.close(); } catch { /* the upload remains fail-closed through later size and hash verification */ }
    }
  }
}

function parseCredentials(credentialsJson) {
  if (typeof credentialsJson !== 'string' || Buffer.byteLength(credentialsJson) > 65536) {
    throw new DriveError('GDRIVE_CREDENTIALS_INVALID');
  }
  let credentials;
  try { credentials = JSON.parse(credentialsJson); }
  catch { throw new DriveError('GDRIVE_CREDENTIALS_INVALID'); }
  if (credentials?.type !== 'service_account' || !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(credentials.client_email || '') ||
      typeof credentials.private_key !== 'string' || !credentials.private_key || credentials.token_uri !== TOKEN_ENDPOINT) {
    throw new DriveError('GDRIVE_CREDENTIALS_INVALID');
  }
  return credentials;
}

function defaultSigner(unsigned, privateKey) {
  const signer = createSign('RSA-SHA256'); signer.update(unsigned); signer.end(); return signer.sign(privateKey);
}

export async function serviceAccountAccessToken(credentialsJson, { transport = fetch, signer = defaultSigner, now = Date.now } = {}) {
  const credentials = parseCredentials(credentialsJson), issued = Math.floor(now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  if (credentials.private_key_id) header.kid = credentials.private_key_id;
  const claims = { iss: credentials.client_email, scope: DRIVE_SCOPE, aud: TOKEN_ENDPOINT, iat: issued, exp: issued + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  let signature;
  try { signature = signer(unsigned, credentials.private_key).toString('base64url'); }
  catch { throw new DriveError('GDRIVE_CREDENTIALS_INVALID'); }
  const response = await transport(TOKEN_ENDPOINT, {
    method: 'POST', redirect: 'error', signal: timeoutSignal(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!response.ok) throw new DriveError('GDRIVE_TOKEN_REQUEST_FAILED');
  let body;
  try { body = await response.json(); } catch { throw new DriveError('GDRIVE_TOKEN_RESPONSE_INVALID'); }
  if (typeof body.access_token !== 'string' || !body.access_token) throw new DriveError('GDRIVE_TOKEN_RESPONSE_INVALID');
  return body.access_token;
}

function escapeQuery(value) { return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

export class GoogleDriveClient {
  constructor(accessToken, transport = fetch, {
    uploadChunkBytes = UPLOAD_CHUNK_BYTES,
    uploadMaxRetries = UPLOAD_MAX_RETRIES,
    uploadTimeoutMs = UPLOAD_TIMEOUT_MS,
    wait = sleep,
    onDiagnostic = () => {},
  } = {}) {
    if (!accessToken) throw new DriveError('GDRIVE_TOKEN_MISSING');
    if (!Number.isSafeInteger(uploadChunkBytes) || uploadChunkBytes <= 0 || uploadChunkBytes > UPLOAD_MAX_CHUNK_BYTES ||
        uploadChunkBytes % UPLOAD_CHUNK_GRANULARITY !== 0 ||
        !Number.isSafeInteger(uploadMaxRetries) || uploadMaxRetries < 0 || uploadMaxRetries > 10 ||
        !Number.isSafeInteger(uploadTimeoutMs) || uploadTimeoutMs < REQUEST_TIMEOUT_MS ||
        typeof wait !== 'function' || typeof onDiagnostic !== 'function') {
      throw new DriveError('GDRIVE_UPLOAD_OPTIONS_INVALID');
    }
    this.accessToken = accessToken; this.transport = transport;
    this.uploadChunkBytes = uploadChunkBytes; this.uploadMaxRetries = uploadMaxRetries;
    this.uploadTimeoutMs = uploadTimeoutMs; this.wait = wait; this.onDiagnostic = onDiagnostic;
    this.sharedDriveId = undefined; this.driveDiagnostic = safeDriveDiagnostic();
  }

  recordDiagnostic(next = {}) {
    this.driveDiagnostic = safeDriveDiagnostic({ ...this.driveDiagnostic, ...next });
    try { this.onDiagnostic(this.driveDiagnostic); } catch { /* diagnostics must never interrupt backup execution */ }
    return this.driveDiagnostic;
  }

  failure(code, next = {}) {
    return new DriveError(code, this.recordDiagnostic(next));
  }

  async fetch(url, init = {}, { acceptStatus, redirect = 'error' } = {}) {
    const parsed = new URL(url);
    if (parsed.origin !== DRIVE_API) throw this.failure('GDRIVE_CROSS_ORIGIN_BLOCKED');
    if (redirect !== 'error' && redirect !== 'manual') throw this.failure('GDRIVE_REDIRECT_MODE_INVALID');
    const headers = new Headers(init.headers || {});
    headers.delete('authorization');
    headers.set('authorization', `Bearer ${this.accessToken}`);
    let response;
    try {
      response = await this.transport(parsed, {
        ...init, redirect, signal: init.signal || timeoutSignal(), headers,
      });
    } catch {
      throw this.failure('GDRIVE_REQUEST_FAILED', { httpStatus: 'NETWORK_ERROR' });
    }
    this.recordDiagnostic({ httpStatus: response.status });
    if (!response.ok && !(typeof acceptStatus === 'function' && acceptStatus(response.status))) {
      throw this.failure(`GDRIVE_HTTP_${response.status}`, { httpStatus: response.status });
    }
    return response;
  }

  async retryUploadRequest(request, {
    exhaustedCode = 'GDRIVE_UPLOAD_RETRIES_EXHAUSTED',
    phase = 'STATUS_QUERY', offset = 0, totalBytes = 0, chunkBytes = 0, fileKind = 'UNKNOWN',
  } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      this.recordDiagnostic({ phase, retryAttempt: attempt, offset, totalBytes, chunkBytes, fileKind });
      let response;
      try { response = await request(); }
      catch (error) {
        if (!(error instanceof DriveError) || error.code !== 'GDRIVE_REQUEST_FAILED') throw error;
      }
      if (response && !isRetryableStatus(response.status)) return response;
      await discardResponseBody(response);
      if (attempt >= this.uploadMaxRetries) throw this.failure(exhaustedCode, {
        phase, retryAttempt: attempt, offset, totalBytes, chunkBytes, fileKind,
        httpStatus: response?.status || 'NETWORK_ERROR',
      });
      await this.wait(Math.min(1000 * (2 ** attempt), 8000));
    }
  }

  async queryUploadStatus(session, totalBytes, {
    exhaustedCode = 'GDRIVE_UPLOAD_STATUS_RETRIES_EXHAUSTED', phase = 'STATUS_QUERY',
    offset = 0, fileKind = 'UNKNOWN',
  } = {}) {
    try {
      return await this.retryUploadRequest(() => this.fetch(session, {
        method: 'PUT', signal: timeoutSignal(this.uploadTimeoutMs),
        headers: { 'content-length': '0', 'content-range': `bytes */${totalBytes}` },
      }, { acceptStatus: acceptsUploadStatus, redirect: 'manual' }), {
        exhaustedCode, phase, offset, totalBytes, chunkBytes: 0, fileKind,
      });
    } catch (error) {
      if (error instanceof DriveError && /^GDRIVE_HTTP_\d{3}$/.test(error.code)) {
        throw this.failure(`GDRIVE_${fileKind}_STATUS_FAILED`, {
          phase, httpStatus: error.driveDiagnostic?.httpStatus, offset, totalBytes, fileKind,
        });
      }
      throw error;
    }
  }

  async uploadResult(response, expectedName, expectedBytes) {
    let uploaded;
    try { uploaded = await response.json(); } catch { throw this.failure('GDRIVE_UPLOAD_RESPONSE_INVALID'); }
    if (!validId(uploaded?.id) || uploaded.name !== expectedName || uploaded.trashed !== false || Number(uploaded.size) !== expectedBytes) {
      throw this.failure('GDRIVE_UPLOAD_RESPONSE_INVALID');
    }
    return uploaded;
  }

  async json(path, { method = 'GET', query = {}, body } = {}) {
    const url = new URL(path, DRIVE_API);
    if (!url.pathname.startsWith('/drive/v3/')) throw new DriveError('GDRIVE_PATH_BLOCKED');
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    const response = await this.fetch(url, {
      method, headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    try { return await response.json(); } catch { throw new DriveError('GDRIVE_RESPONSE_INVALID'); }
  }

  async getFile(id) {
    if (!validId(id)) throw new DriveError('GDRIVE_ID_INVALID');
    return this.json(`/drive/v3/files/${encodeURIComponent(id)}`, { query: { fields: FILE_FIELDS, supportsAllDrives: true } });
  }

  async getSharedDrive(id) {
    if (!validId(id)) throw new DriveError('GDRIVE_ID_INVALID');
    const url = new URL(`/drive/v3/drives/${encodeURIComponent(id)}`, DRIVE_API);
    url.searchParams.set('fields', SHARED_DRIVE_FIELDS);
    const response = await this.fetch(url, {}, { acceptStatus: status => status === 404 });
    if (response.status === 404) {
      try { await response.body?.cancel(); } catch { /* discard provider details */ }
      return null;
    }
    try { return await response.json(); } catch { throw new DriveError('GDRIVE_RESPONSE_INVALID'); }
  }

  async getBackupRoot(id) {
    this.recordDiagnostic({ phase: 'ROOT_DISCOVERY', httpStatus: 'NOT_AVAILABLE', retryAttempt: 0 });
    const sharedDrive = await this.getSharedDrive(id);
    if (sharedDrive) {
      const canAddChildren = sharedDrive.capabilities?.canAddChildren === true ? 'YES' : 'NO';
      this.recordDiagnostic({ sharedDriveDetected: 'YES', canAddChildren });
      if (sharedDrive.id !== id || sharedDrive.name !== ROOT_FOLDER_NAME || sharedDrive.kind !== 'drive#drive' ||
          sharedDrive.capabilities?.canAddChildren !== true || sharedDrive.capabilities?.canListChildren !== true) {
        throw this.failure('GDRIVE_ROOT_FOLDER_NOT_ACCESSIBLE');
      }
      this.sharedDriveId = id;
      return { id, name: sharedDrive.name, mimeType: FOLDER_MIME, trashed: false, driveId: id };
    }
    const folder = await this.getFile(id);
    const sharedDriveDetected = validId(folder?.driveId) ? 'YES' : 'NO';
    const canAddChildren = folder?.capabilities?.canAddChildren === true ? 'YES' : 'NO';
    this.recordDiagnostic({ sharedDriveDetected, canAddChildren });
    if (folder.id !== id || folder.name !== ROOT_FOLDER_NAME || folder.mimeType !== FOLDER_MIME || folder.trashed !== false ||
        (folder.driveId !== undefined && !validId(folder.driveId)) || folder.capabilities?.canAddChildren !== true ||
        folder.capabilities?.canListChildren !== true) {
      throw this.failure('GDRIVE_ROOT_FOLDER_NOT_ACCESSIBLE');
    }
    this.sharedDriveId = folder.driveId;
    return folder;
  }

  async listChildren(parentId, name) {
    if (!validId(parentId) || (name !== undefined && !validName(name))) throw new DriveError('GDRIVE_LIST_INPUT_INVALID');
    const files = []; let pageToken;
    do {
      const clauses = [`'${escapeQuery(parentId)}' in parents`, 'trashed = false'];
      if (name !== undefined) clauses.push(`name = '${escapeQuery(name)}'`);
      const result = await this.json('/drive/v3/files', { query: {
        q: clauses.join(' and '), spaces: 'drive', pageSize: 1000, pageToken,
        fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`, supportsAllDrives: true, includeItemsFromAllDrives: true,
        ...(this.sharedDriveId ? { corpora: 'drive', driveId: this.sharedDriveId } : {}),
      } });
      if (result.incompleteSearch === true) throw new DriveError('GDRIVE_INCOMPLETE_SEARCH');
      if (!Array.isArray(result.files)) throw new DriveError('GDRIVE_LIST_RESPONSE_INVALID');
      files.push(...result.files); pageToken = result.nextPageToken;
      if (files.length > 100000) throw new DriveError('GDRIVE_LIST_LIMIT');
    } while (pageToken);
    return files;
  }

  async ensureFolder(parentId, name) {
    const matches = await this.listChildren(parentId, name);
    if (matches.length > 1) throw new DriveError('GDRIVE_DUPLICATE_FOLDER');
    if (matches.length === 1) {
      if (!validId(matches[0].id) || matches[0].mimeType !== FOLDER_MIME || matches[0].trashed !== false ||
          !matches[0].parents?.includes(parentId)) throw new DriveError('GDRIVE_FOLDER_NAME_CONFLICT');
      return matches[0];
    }
    const created = await this.json('/drive/v3/files', { method: 'POST', query: { fields: FILE_FIELDS, supportsAllDrives: true }, body: { name, mimeType: FOLDER_MIME, parents: [parentId] } });
    if (!validId(created?.id) || created.name !== name || created.mimeType !== FOLDER_MIME || created.trashed !== false ||
        !created.parents?.includes(parentId)) throw new DriveError('GDRIVE_FOLDER_RESPONSE_INVALID');
    return created;
  }

  async uploadFile(parentId, path, name, mimeType, appProperties) {
    if (!validId(parentId) || !validName(name)) throw new DriveError('GDRIVE_UPLOAD_INPUT_INVALID');
    if ((await this.listChildren(parentId, name)).length) throw new DriveError('GDRIVE_DESTINATION_EXISTS');
    const info = await stat(path);
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size <= 0) throw new DriveError('GDRIVE_UPLOAD_FILE_INVALID');
    const initUrl = new URL('/upload/drive/v3/files', DRIVE_API);
    initUrl.searchParams.set('uploadType', 'resumable'); initUrl.searchParams.set('supportsAllDrives', 'true'); initUrl.searchParams.set('fields', FILE_FIELDS);
    const diagnosticKind = appProperties?.kind === 'package' ? 'PACKAGE' : appProperties?.kind === 'checksum' ? 'CHECKSUM' : 'FILE';
    let initialized;
    try {
      initialized = await this.retryUploadRequest(() => this.fetch(initUrl, {
        method: 'POST', headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': mimeType, 'x-upload-content-length': String(info.size),
        },
        body: JSON.stringify({ name, mimeType, parents: [parentId], appProperties }),
      }, { acceptStatus: status => isRetryableStatus(status) }), {
        exhaustedCode: `GDRIVE_${diagnosticKind}_INIT_RETRIES_EXHAUSTED`,
        phase: 'SESSION_CREATE', totalBytes: info.size, fileKind: diagnosticKind,
      });
    } catch (error) {
      if (error instanceof DriveError && /^GDRIVE_HTTP_\d{3}$/.test(error.code)) {
        throw this.failure(`GDRIVE_${diagnosticKind}_INIT_FAILED`, {
          phase: 'SESSION_CREATE', httpStatus: error.driveDiagnostic?.httpStatus,
          totalBytes: info.size, fileKind: diagnosticKind,
        });
      }
      throw error;
    }
    const location = initialized.headers.get('location');
    await discardResponseBody(initialized);
    if (!location) throw this.failure('GDRIVE_UPLOAD_SESSION_MISSING', { phase: 'SESSION_CREATE' });
    let session;
    try {
      if (Buffer.byteLength(location) > 8192) throw new Error('invalid');
      session = new URL(location);
    } catch { throw this.failure('GDRIVE_UPLOAD_SESSION_INVALID', { phase: 'SESSION_CREATE' }); }
    const uploadIds = session.searchParams.getAll('upload_id');
    if (session.origin !== DRIVE_API || session.pathname !== '/upload/drive/v3/files' ||
        session.username || session.password || session.hash || uploadIds.length !== 1 ||
        !uploadIds[0] || uploadIds[0].length > 4096) {
      throw this.failure('GDRIVE_UPLOAD_SESSION_INVALID', { phase: 'SESSION_CREATE' });
    }

    let offset = 0, failuresAtOffset = 0, chunkOffset = -1, chunkEnd = -1, chunkBody;
    const finish = async (response, retryAttempt, chunkBytes = 0) => {
      const finalRetryAttempt = Math.max(retryAttempt, this.driveDiagnostic.retryAttempt);
      this.recordDiagnostic({
        phase: 'FINALIZE', httpStatus: response.status, retryAttempt: finalRetryAttempt,
        offset: info.size, totalBytes: info.size, chunkBytes, fileKind: diagnosticKind,
      });
      const uploaded = await this.uploadResult(response, name, info.size);
      this.recordDiagnostic({
        phase: 'COMPLETE', httpStatus: response.status, retryAttempt: finalRetryAttempt,
        offset: info.size, totalBytes: info.size, chunkBytes: 0, fileKind: diagnosticKind,
      });
      return uploaded;
    };
    const responseOffset = (response) => {
      try { return nextUploadOffset(response, info.size); }
      catch (error) {
        if (error instanceof DriveError) throw this.failure(error.code);
        throw error;
      }
    };

    while (true) {
      if (offset === info.size) {
        for (let finalAttempt = 0; ; finalAttempt += 1) {
          const completed = await this.queryUploadStatus(session, info.size, {
            exhaustedCode: `GDRIVE_${diagnosticKind}_STATUS_RETRIES_EXHAUSTED`,
            phase: 'FINALIZE', offset, fileKind: diagnosticKind,
          });
          if (completed.status === 200 || completed.status === 201) return finish(completed, finalAttempt);
          if (completed.status !== 308) throw this.failure('GDRIVE_UPLOAD_FINALIZE_FAILED', {
            phase: 'FINALIZE', httpStatus: completed.status, retryAttempt: finalAttempt,
            offset, totalBytes: info.size, fileKind: diagnosticKind,
          });
          const confirmedOffset = responseOffset(completed);
          await discardResponseBody(completed);
          if (confirmedOffset !== offset) throw this.failure('GDRIVE_UPLOAD_RANGE_INVALID', {
            phase: 'FINALIZE', httpStatus: 308, retryAttempt: finalAttempt,
            offset, totalBytes: info.size, fileKind: diagnosticKind,
          });
          if (finalAttempt >= this.uploadMaxRetries) throw this.failure('GDRIVE_UPLOAD_FINALIZE_FAILED', {
            phase: 'FINALIZE', httpStatus: 308, retryAttempt: finalAttempt,
            offset, totalBytes: info.size, fileKind: diagnosticKind,
          });
          await this.wait(Math.min(1000 * (2 ** finalAttempt), 8000));
        }
      }

      const end = Math.min(offset + this.uploadChunkBytes, info.size) - 1;
      if (chunkOffset !== offset || chunkEnd !== end) {
        chunkBody = await readUploadChunk(path, offset, end);
        chunkOffset = offset; chunkEnd = end;
      }
      const chunkBytes = end - offset + 1;
      this.recordDiagnostic({
        phase: 'CHUNK_UPLOAD', httpStatus: 'NOT_AVAILABLE', retryAttempt: failuresAtOffset,
        offset, totalBytes: info.size, chunkBytes, fileKind: diagnosticKind,
      });
      let response, failedHttpStatus = 'NETWORK_ERROR';
      try {
        response = await this.fetch(session, {
          method: 'PUT', signal: timeoutSignal(this.uploadTimeoutMs),
          headers: {
            'content-type': mimeType,
            'content-length': String(chunkBytes),
            'content-range': `bytes ${offset}-${end}/${info.size}`,
          },
          body: chunkBody,
        }, { acceptStatus: acceptsUploadStatus, redirect: 'manual' });
      } catch (error) {
        if (!(error instanceof DriveError) || error.code !== 'GDRIVE_REQUEST_FAILED') throw error;
        response = undefined;
      }

      if (!response || isRetryableStatus(response.status)) {
        if (response) failedHttpStatus = response.status;
        await discardResponseBody(response);
        failuresAtOffset += 1;
        if (failuresAtOffset <= this.uploadMaxRetries) {
          await this.wait(Math.min(1000 * (2 ** (failuresAtOffset - 1)), 8000));
        }
        const status = await this.queryUploadStatus(session, info.size, {
          exhaustedCode: `GDRIVE_${diagnosticKind}_STATUS_RETRIES_EXHAUSTED`,
          phase: 'STATUS_QUERY', offset, fileKind: diagnosticKind,
        });
        if (status.status === 200 || status.status === 201) return finish(status, failuresAtOffset - 1, chunkBytes);
        if (status.status !== 308) throw this.failure(`GDRIVE_${diagnosticKind}_STATUS_FAILED`, {
          phase: 'STATUS_QUERY', httpStatus: status.status, retryAttempt: failuresAtOffset - 1,
          offset, totalBytes: info.size, fileKind: diagnosticKind,
        });
        const confirmedOffset = responseOffset(status);
        await discardResponseBody(status);
        if (confirmedOffset < offset || confirmedOffset > end + 1) throw this.failure('GDRIVE_UPLOAD_RANGE_INVALID', {
          phase: 'STATUS_QUERY', httpStatus: 308, retryAttempt: failuresAtOffset - 1,
          offset, totalBytes: info.size, fileKind: diagnosticKind,
        });
        if (confirmedOffset > offset) {
          offset = confirmedOffset; failuresAtOffset = 0;
          continue;
        }
        if (failuresAtOffset > this.uploadMaxRetries) throw this.failure(`GDRIVE_${diagnosticKind}_CHUNK_RETRIES_EXHAUSTED`, {
          phase: 'CHUNK_UPLOAD', httpStatus: failedHttpStatus, retryAttempt: failuresAtOffset - 1,
          offset, totalBytes: info.size, chunkBytes, fileKind: diagnosticKind,
        });
        continue;
      }

      if (response.status === 200 || response.status === 201) return finish(response, failuresAtOffset, chunkBytes);
      if (response.status !== 308) throw this.failure(`GDRIVE_HTTP_${response.status}`, {
        phase: 'CHUNK_UPLOAD', httpStatus: response.status, retryAttempt: failuresAtOffset,
        offset, totalBytes: info.size, chunkBytes, fileKind: diagnosticKind,
      });
      const nextOffset = responseOffset(response);
      await discardResponseBody(response);
      if (nextOffset < offset || nextOffset > end + 1) throw this.failure('GDRIVE_UPLOAD_RANGE_INVALID', {
        phase: 'CHUNK_UPLOAD', httpStatus: 308, retryAttempt: failuresAtOffset,
        offset, totalBytes: info.size, chunkBytes, fileKind: diagnosticKind,
      });
      if (nextOffset === offset) {
        failuresAtOffset += 1;
        if (failuresAtOffset > this.uploadMaxRetries) throw this.failure('GDRIVE_UPLOAD_OFFSET_STALLED', {
          phase: 'CHUNK_UPLOAD', httpStatus: 308, retryAttempt: failuresAtOffset - 1,
          offset, totalBytes: info.size, chunkBytes, fileKind: diagnosticKind,
        });
        await this.wait(Math.min(1000 * (2 ** (failuresAtOffset - 1)), 8000));
      } else {
        offset = nextOffset; failuresAtOffset = 0;
      }
    }
  }

  async copyFile(id, parentId, name, appProperties) {
    if (!validId(id) || !validId(parentId) || !validName(name)) throw new DriveError('GDRIVE_COPY_INPUT_INVALID');
    if ((await this.listChildren(parentId, name)).length) throw new DriveError('GDRIVE_DESTINATION_EXISTS');
    return this.json(`/drive/v3/files/${encodeURIComponent(id)}/copy`, {
      method: 'POST', query: { fields: FILE_FIELDS, supportsAllDrives: true }, body: { name, parents: [parentId], appProperties },
    });
  }

  async updateProperties(id, appProperties) {
    return this.json(`/drive/v3/files/${encodeURIComponent(id)}`, {
      method: 'PATCH', query: { fields: FILE_FIELDS, supportsAllDrives: true }, body: { appProperties },
    });
  }

  async trashFile(id) {
    return this.json(`/drive/v3/files/${encodeURIComponent(id)}`, {
      method: 'PATCH', query: { fields: 'id,trashed', supportsAllDrives: true }, body: { trashed: true },
    });
  }

  async download(id) {
    if (!validId(id)) throw new DriveError('GDRIVE_ID_INVALID');
    const url = new URL(`/drive/v3/files/${encodeURIComponent(id)}`, DRIVE_API);
    url.searchParams.set('alt', 'media'); url.searchParams.set('supportsAllDrives', 'true');
    return this.fetch(url, { signal: timeoutSignal(this.uploadTimeoutMs) });
  }

  async downloadText(id) {
    const response = await this.download(id), text = await response.text();
    if (Buffer.byteLength(text) > 2048) throw new DriveError('GDRIVE_CHECKSUM_TOO_LARGE');
    return text;
  }

  async downloadHash(id) {
    const response = await this.download(id);
    if (!response.body) throw new DriveError('GDRIVE_DOWNLOAD_EMPTY');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of response.body) { const buffer = Buffer.from(chunk); hash.update(buffer); bytes += buffer.length; }
    return { bytes, sha256: hash.digest('hex') };
  }
}

function pairProperties(packageInfo, tier, createdAt) {
  const common = {
    app: 'the-backyard-backup', schema: '1', tier, backupName: packageInfo.packageName,
    backupTimestamp: createdAt, sha256: packageInfo.sha256, verified: 'false',
  };
  return { package: { ...common, kind: 'package' }, checksum: { ...common, kind: 'checksum' } };
}

async function uploadPair(client, folderId, packageInfo, tier, createdAt) {
  const properties = pairProperties(packageInfo, tier, createdAt);
  const packageFile = await client.uploadFile(folderId, packageInfo.packagePath, packageInfo.packageName, 'application/gzip', properties.package);
  const checksumFile = await client.uploadFile(folderId, packageInfo.checksumPath, packageInfo.checksumName, 'text/plain', properties.checksum);
  return { packageFile, checksumFile, folderId, tier, properties };
}

async function copyPair(client, source, folderId, packageInfo, tier, createdAt) {
  const properties = pairProperties(packageInfo, tier, createdAt);
  const packageFile = await client.copyFile(source.packageFile.id, folderId, packageInfo.packageName, properties.package);
  const checksumFile = await client.copyFile(source.checksumFile.id, folderId, packageInfo.checksumName, properties.checksum);
  return { packageFile, checksumFile, folderId, tier, properties };
}

async function verifyPair(client, pair, packageInfo, fullDownload) {
  const packageFile = await client.getFile(pair.packageFile.id), checksumFile = await client.getFile(pair.checksumFile.id);
  const checksumSize = (await stat(packageInfo.checksumPath)).size;
  if (packageFile.name !== packageInfo.packageName || checksumFile.name !== packageInfo.checksumName ||
      !packageFile.parents?.includes(pair.folderId) || !checksumFile.parents?.includes(pair.folderId) ||
      packageFile.trashed !== false || checksumFile.trashed !== false ||
      Number(packageFile.size) !== packageInfo.bytes || Number(checksumFile.size) !== checksumSize ||
      !hasProperties(packageFile, pair.properties.package) || !hasProperties(checksumFile, pair.properties.checksum)) {
    throw new DriveError('GDRIVE_REMOTE_SIZE_MISMATCH');
  }
  const expectedSidecar = `${packageInfo.sha256}  ${packageInfo.packageName}\n`;
  if (await client.downloadText(checksumFile.id) !== expectedSidecar) throw new DriveError('GDRIVE_REMOTE_CHECKSUM_SIDECAR_MISMATCH');
  if (fullDownload) {
    const downloaded = await client.downloadHash(packageFile.id);
    if (downloaded.bytes !== packageInfo.bytes || downloaded.sha256 !== packageInfo.sha256) throw new DriveError('GDRIVE_REMOTE_PACKAGE_CHECKSUM_MISMATCH');
  }
  pair.packageFile = await client.updateProperties(packageFile.id, { ...pair.properties.package, verified: 'true' });
  pair.checksumFile = await client.updateProperties(checksumFile.id, { ...pair.properties.checksum, verified: 'true' });
  if (pair.packageFile.trashed !== false || pair.checksumFile.trashed !== false ||
      !hasProperties(pair.packageFile, { ...pair.properties.package, verified: 'true' }) ||
      !hasProperties(pair.checksumFile, { ...pair.properties.checksum, verified: 'true' })) {
    throw new DriveError('GDRIVE_REMOTE_VERIFICATION_STATE_INVALID');
  }
  return pair;
}

async function collectVerifiedPairs(client, tierFolderId, tier) {
  const entries = [];
  for (const folder of (await client.listChildren(tierFolderId)).filter(file => file.mimeType === FOLDER_MIME && file.trashed === false)) {
    const files = await client.listChildren(folder.id), groups = new Map();
    for (const file of files) {
      const properties = file.appProperties || {};
      if (properties.app !== 'the-backyard-backup') continue;
      const name = properties.backupName, kind = properties.kind;
      const expectedFileName = kind === 'package' ? name : kind === 'checksum' ? `${name}.sha256` : undefined;
      if (properties.schema !== '1' || properties.tier !== tier || !validManagedPackageName(name) ||
          expectedFileName !== file.name || file.trashed !== false || !validId(file.id) ||
          !file.parents?.includes(folder.id) || properties.verified !== 'true' ||
          !SHA256_RE.test(properties.sha256 || '') || !Number.isFinite(Date.parse(properties.backupTimestamp))) {
        throw new DriveError('GDRIVE_MANAGED_FILE_INVALID');
      }
      if (!groups.has(name)) groups.set(name, {});
      if (groups.get(name)[kind]) throw new DriveError('GDRIVE_DUPLICATE_MANAGED_PAIR');
      groups.get(name)[kind] = file;
    }
    for (const [name, pair] of groups) {
      const packageProperties = pair.package?.appProperties || {}, checksumProperties = pair.checksum?.appProperties || {};
      if (pair.package && pair.checksum && packageProperties.verified === 'true' && checksumProperties.verified === 'true' &&
          packageProperties.sha256 === checksumProperties.sha256 &&
          packageProperties.backupTimestamp === checksumProperties.backupTimestamp &&
          pair.package.name === name && pair.checksum.name === `${name}.sha256`) {
        entries.push({ name, checksumName: pair.checksum.name, packageId: pair.package.id, checksumId: pair.checksum.id,
          createdAt: packageProperties.backupTimestamp, verified: true });
      }
    }
  }
  return entries;
}

async function applyRetention(client, tierFolders, retentionApply) {
  const names = [];
  for (const [tier, folder] of Object.entries(tierFolders)) {
    const plan = planRetention(await collectVerifiedPairs(client, folder.id, tier), RETENTION_LIMITS[tier]);
    for (const candidate of plan.candidates) {
      names.push(`${tier}/${candidate.name}`);
      if (retentionApply) { await client.trashFile(candidate.packageId); await client.trashFile(candidate.checksumId); }
    }
  }
  return names;
}

export async function publishToGoogleDrive({
  credentialsJson, rootFolderId, packageInfo, now = new Date(), retentionApply = false,
  transport = fetch, signer, client, onDiagnostic = () => {},
}) {
  if (!validId(rootFolderId)) throw new DriveError('GDRIVE_ROOT_FOLDER_ID_INVALID');
  await validatePackageInfo(packageInfo);
  const emitDiagnostic = (diagnostic) => {
    const safe = safeDriveDiagnostic(diagnostic);
    try { onDiagnostic(safe); } catch { /* diagnostics must never interrupt backup execution */ }
    return safe;
  };
  let drive;
  try {
    drive = client || new GoogleDriveClient(
      await serviceAccountAccessToken(credentialsJson, { transport, signer }),
      transport,
      { onDiagnostic: emitDiagnostic },
    );
    await drive.getBackupRoot(rootFolderId);
    const tierFolders = {};
    for (const tier of Object.keys(RETENTION_LIMITS)) tierFolders[tier] = await drive.ensureFolder(rootFolderId, tier);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const month = date.slice(0, 7), weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', weekday: 'short' }).format(now);
    const createdAt = now.toISOString();
    const dailyFolder = await drive.ensureFolder(tierFolders.daily.id, date);
    // A daily backup is not publishable until the remote package has been
    // downloaded and independently hashed, in addition to checking its sidecar.
    const dailyPair = await verifyPair(drive, await uploadPair(drive, dailyFolder.id, packageInfo, 'daily', createdAt), packageInfo, true);
    let weekly = 'NOT_DUE', monthly = 'NOT_DUE';
    if (weekday === 'Sun') {
      const folder = await drive.ensureFolder(tierFolders.weekly.id, date);
      await verifyPair(drive, await copyPair(drive, dailyPair, folder.id, packageInfo, 'weekly', createdAt), packageInfo, true);
      weekly = 'PASS';
    }
    if (date.endsWith('-01')) {
      const folder = await drive.ensureFolder(tierFolders.monthly.id, month);
      await verifyPair(drive, await copyPair(drive, dailyPair, folder.id, packageInfo, 'monthly', createdAt), packageInfo, false);
      monthly = 'PASS';
    }
    const retentionCandidates = await applyRetention(drive, tierFolders, retentionApply);
    const result = { daily: 'PASS', weekly, monthly, retention: retentionApply ? 'APPLY' : 'DRY_RUN', retentionCandidates };
    if (drive.driveDiagnostic) result.driveDiagnostic = emitDiagnostic(drive.driveDiagnostic);
    return result;
  } catch (error) {
    const diagnostic = error?.driveDiagnostic || drive?.driveDiagnostic;
    if (diagnostic) {
      const safe = emitDiagnostic(diagnostic);
      if (error instanceof DriveError) error.driveDiagnostic = safe;
    }
    throw error;
  }
}

export const googleDriveInternals = Object.freeze({ FOLDER_MIME, ROOT_FOLDER_NAME, DRIVE_SCOPE, TOKEN_ENDPOINT, FILE_FIELDS, basename });

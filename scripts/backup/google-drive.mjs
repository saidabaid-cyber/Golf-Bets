import { createHash, createSign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { RETENTION_LIMITS, planRetention } from './retention.mjs';

const DRIVE_API = 'https://www.googleapis.com';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_FOLDER_NAME = 'The Backyard - Backups';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FILE_FIELDS = 'id,name,mimeType,size,parents,trashed,appProperties';
const REQUEST_TIMEOUT_MS = 120000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_CHUNK_GRANULARITY = 256 * 1024;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const UPLOAD_MAX_RETRIES = 4;
const MANAGED_PACKAGE_RE = /^The-Backyard-Backup-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export class DriveError extends Error {
  constructor(code) { super(code); this.code = code; }
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
  } = {}) {
    if (!accessToken) throw new DriveError('GDRIVE_TOKEN_MISSING');
    if (!Number.isSafeInteger(uploadChunkBytes) || uploadChunkBytes <= 0 || uploadChunkBytes % UPLOAD_CHUNK_GRANULARITY !== 0 ||
        !Number.isSafeInteger(uploadMaxRetries) || uploadMaxRetries < 0 || uploadMaxRetries > 10 ||
        !Number.isSafeInteger(uploadTimeoutMs) || uploadTimeoutMs < REQUEST_TIMEOUT_MS || typeof wait !== 'function') {
      throw new DriveError('GDRIVE_UPLOAD_OPTIONS_INVALID');
    }
    this.accessToken = accessToken; this.transport = transport;
    this.uploadChunkBytes = uploadChunkBytes; this.uploadMaxRetries = uploadMaxRetries;
    this.uploadTimeoutMs = uploadTimeoutMs; this.wait = wait;
  }

  async fetch(url, init = {}, { acceptStatus } = {}) {
    const parsed = new URL(url);
    if (parsed.origin !== DRIVE_API) throw new DriveError('GDRIVE_CROSS_ORIGIN_BLOCKED');
    const headers = new Headers(init.headers || {});
    headers.delete('authorization');
    headers.set('authorization', `Bearer ${this.accessToken}`);
    let response;
    try {
      response = await this.transport(parsed, {
        ...init, redirect: 'error', signal: init.signal || timeoutSignal(), headers,
      });
    } catch {
      throw new DriveError('GDRIVE_REQUEST_FAILED');
    }
    if (!response.ok && !(typeof acceptStatus === 'function' && acceptStatus(response.status))) {
      throw new DriveError(`GDRIVE_HTTP_${response.status}`);
    }
    return response;
  }

  async retryUploadRequest(request) {
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try { response = await request(); }
      catch (error) {
        if (!(error instanceof DriveError) || error.code !== 'GDRIVE_REQUEST_FAILED') throw error;
      }
      if (response && !isRetryableStatus(response.status)) return response;
      if (response?.body) {
        try { await response.body.cancel(); } catch { /* discard retry response without exposing its body */ }
      }
      if (attempt >= this.uploadMaxRetries) throw new DriveError('GDRIVE_UPLOAD_RETRIES_EXHAUSTED');
      await this.wait(Math.min(1000 * (2 ** attempt), 8000));
    }
  }

  async queryUploadStatus(session, totalBytes) {
    return this.retryUploadRequest(() => this.fetch(session, {
      method: 'PUT', signal: timeoutSignal(this.uploadTimeoutMs),
      headers: { 'content-length': '0', 'content-range': `bytes */${totalBytes}` },
    }, { acceptStatus: acceptsUploadStatus }));
  }

  async uploadResult(response, expectedName, expectedBytes) {
    let uploaded;
    try { uploaded = await response.json(); } catch { throw new DriveError('GDRIVE_UPLOAD_RESPONSE_INVALID'); }
    if (!validId(uploaded?.id) || uploaded.name !== expectedName || uploaded.trashed !== false || Number(uploaded.size) !== expectedBytes) {
      throw new DriveError('GDRIVE_UPLOAD_RESPONSE_INVALID');
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

  async listChildren(parentId, name) {
    if (!validId(parentId) || (name !== undefined && !validName(name))) throw new DriveError('GDRIVE_LIST_INPUT_INVALID');
    const files = []; let pageToken;
    do {
      const clauses = [`'${escapeQuery(parentId)}' in parents`, 'trashed = false'];
      if (name !== undefined) clauses.push(`name = '${escapeQuery(name)}'`);
      const result = await this.json('/drive/v3/files', { query: {
        q: clauses.join(' and '), spaces: 'drive', pageSize: 1000, pageToken,
        fields: `nextPageToken,files(${FILE_FIELDS})`, supportsAllDrives: true, includeItemsFromAllDrives: true,
      } });
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
    const initialized = await this.retryUploadRequest(() => this.fetch(initUrl, {
      method: 'POST', headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': mimeType, 'x-upload-content-length': String(info.size),
      },
      body: JSON.stringify({ name, mimeType, parents: [parentId], appProperties }),
    }, { acceptStatus: status => isRetryableStatus(status) }));
    const location = initialized.headers.get('location');
    if (!location) throw new DriveError('GDRIVE_UPLOAD_SESSION_MISSING');
    const session = new URL(location);
    if (session.origin !== DRIVE_API || session.pathname !== '/upload/drive/v3/files') throw new DriveError('GDRIVE_UPLOAD_SESSION_INVALID');

    let offset = 0, failuresAtOffset = 0;
    while (offset < info.size) {
      const end = Math.min(offset + this.uploadChunkBytes, info.size) - 1;
      let response;
      try {
        response = await this.fetch(session, {
          method: 'PUT', duplex: 'half', signal: timeoutSignal(this.uploadTimeoutMs),
          headers: {
            'content-type': mimeType,
            'content-length': String(end - offset + 1),
            'content-range': `bytes ${offset}-${end}/${info.size}`,
          },
          body: createReadStream(path, { start: offset, end }),
        }, { acceptStatus: acceptsUploadStatus });
      } catch (error) {
        if (!(error instanceof DriveError) || error.code !== 'GDRIVE_REQUEST_FAILED') throw error;
        response = undefined;
      }

      if (!response || isRetryableStatus(response.status)) {
        if (failuresAtOffset >= this.uploadMaxRetries) throw new DriveError('GDRIVE_UPLOAD_RETRIES_EXHAUSTED');
        await this.wait(Math.min(1000 * (2 ** failuresAtOffset), 8000));
        failuresAtOffset += 1;
        response = await this.queryUploadStatus(session, info.size);
      }

      if (response.status === 200 || response.status === 201) return this.uploadResult(response, name, info.size);
      if (response.status !== 308) throw new DriveError(`GDRIVE_HTTP_${response.status}`);
      const nextOffset = nextUploadOffset(response, info.size);
      if (nextOffset < offset) throw new DriveError('GDRIVE_UPLOAD_RANGE_INVALID');
      if (nextOffset === offset) {
        if (failuresAtOffset >= this.uploadMaxRetries) throw new DriveError('GDRIVE_UPLOAD_RETRIES_EXHAUSTED');
        await this.wait(Math.min(1000 * (2 ** failuresAtOffset), 8000));
        failuresAtOffset += 1;
      } else {
        offset = nextOffset; failuresAtOffset = 0;
      }
    }

    const completed = await this.queryUploadStatus(session, info.size);
    if (completed.status === 200 || completed.status === 201) return this.uploadResult(completed, name, info.size);
    throw new DriveError('GDRIVE_UPLOAD_NOT_FINALIZED');
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
  transport = fetch, signer, client,
}) {
  if (!validId(rootFolderId)) throw new DriveError('GDRIVE_ROOT_FOLDER_ID_INVALID');
  await validatePackageInfo(packageInfo);
  const drive = client || new GoogleDriveClient(await serviceAccountAccessToken(credentialsJson, { transport, signer }), transport);
  const root = await drive.getFile(rootFolderId);
  if (root.name !== ROOT_FOLDER_NAME || root.mimeType !== FOLDER_MIME || root.trashed !== false) {
    throw new DriveError('GDRIVE_ROOT_FOLDER_NOT_ACCESSIBLE');
  }
  const tierFolders = {};
  for (const tier of Object.keys(RETENTION_LIMITS)) tierFolders[tier] = await drive.ensureFolder(rootFolderId, tier);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const month = date.slice(0, 7), weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', weekday: 'short' }).format(now);
  const createdAt = now.toISOString();
  const dailyFolder = await drive.ensureFolder(tierFolders.daily.id, date);
  const dailyPair = await verifyPair(drive, await uploadPair(drive, dailyFolder.id, packageInfo, 'daily', createdAt), packageInfo, false);
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
  return { daily: 'PASS', weekly, monthly, retention: retentionApply ? 'APPLY' : 'DRY_RUN', retentionCandidates };
}

export const googleDriveInternals = Object.freeze({ FOLDER_MIME, ROOT_FOLDER_NAME, DRIVE_SCOPE, TOKEN_ENDPOINT, FILE_FIELDS, basename });

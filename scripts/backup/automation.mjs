import { appendFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, hashFile, runBackup, verifyBackup } from './core.mjs';
import { scanTracked } from './security-scan.mjs';
import { publishToGoogleDrive } from './google-drive.mjs';
export { RETENTION_LIMITS, planRetention } from './retention.mjs';

export const AUTOMATION_TIME_ZONE = 'America/Mexico_City';
export const OWNER_BACKUP_CONFIG = Object.freeze({
  BACKUP_SOURCE: 'owner',
  BACKUP_EXPECTED_REF: 'zhqmlpljloumldaczcfp',
  BACKUP_PGHOST: 'aws-0-us-east-1.pooler.supabase.com',
  BACKUP_PGPORT: '5432',
  BACKUP_PGUSER: 'postgres.zhqmlpljloumldaczcfp',
  BACKUP_PGDATABASE: 'postgres',
  BACKUP_STORAGE_URL: 'https://zhqmlpljloumldaczcfp.supabase.co',
});
const REQUIRED_SECRETS = ['BACKUP_PGPASSWORD', 'BACKUP_STORAGE_KEY', 'BACKUP_ENCRYPTION_KEY', 'GDRIVE_SERVICE_ACCOUNT_JSON'];
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,80}$/;

export class AutomationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function safeErrorCode(error) {
  const code = error?.code || error?.message;
  return typeof code === 'string' && SAFE_CODE.test(code) ? code : 'AUTOMATED_BACKUP_FAILED';
}

export function validateAutomationEnvironment(env = process.env) {
  for (const [name, expected] of Object.entries(OWNER_BACKUP_CONFIG)) {
    if (env[name] !== expected) throw new AutomationError('OWNER_BACKUP_CONFIG_NOT_AUTHORIZED');
  }
  for (const name of REQUIRED_SECRETS) if (!env[name]) throw new AutomationError(`MISSING_${name}`);
  if (!env.GDRIVE_BACKUP_ROOT_FOLDER_ID) throw new AutomationError('MISSING_GDRIVE_BACKUP_ROOT_FOLDER_ID');
  const retention = env.BACKUP_RETENTION_APPLY || 'false';
  if (!['false', 'true'].includes(retention)) throw new AutomationError('INVALID_BACKUP_RETENTION_APPLY');
  return { retentionApply: retention === 'true' };
}

export function mexicoDateParts(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: AUTOMATION_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'short',
  }).formatToParts(value).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    month: `${parts.year}-${parts.month}`,
    time: `${parts.hour}${parts.minute}${parts.second}`,
    isSunday: parts.weekday === 'Sun',
    isMonthStart: parts.day === '01',
  };
}

export function portableNames(value = new Date()) {
  const parts = mexicoDateParts(value);
  const packageName = `The-Backyard-Backup-${parts.date}-${parts.time}.tar.gz`;
  return { ...parts, packageName, checksumName: `${packageName}.sha256` };
}

export function driveTargetsForDate(value = new Date()) {
  const parts = mexicoDateParts(value);
  const targets = [{ tier: 'daily', bucket: parts.date }];
  if (parts.isSunday) targets.push({ tier: 'weekly', bucket: parts.date });
  if (parts.isMonthStart) targets.push({ tier: 'monthly', bucket: parts.month });
  return targets;
}

export function assertPublishable(backup, verification) {
  const manifest = backup?.manifest;
  for (const component of ['source', 'database', 'storage']) {
    if (manifest?.components?.[component]?.state !== 'PASS') throw new AutomationError(`${component.toUpperCase()}_NOT_PASS`);
  }
  if (!manifest.databaseBackup || !manifest.schemaBackup || !manifest.storageBackup) throw new AutomationError('BACKUP_INCOMPLETE');
  if (manifest.encryption !== 'AES-256-GCM / BYDR1; key NEVER stored here') throw new AutomationError('ENCRYPTION_NOT_CONFIRMED');
  const protectedFiles = manifest.files.filter(file => /^(database|storage)\//.test(file.path));
  if (!protectedFiles.length || protectedFiles.some(file => !file.encrypted)) throw new AutomationError('ENCRYPTION_NOT_CONFIRMED');
  if (verification?.integrity !== 'PASS') throw new AutomationError('VERIFICATION_NOT_PASS');
  if (verification.recoveryComplete !== true) throw new AutomationError('RECOVERY_NOT_COMPLETE');
  if (verification.gitCommit !== manifest.gitCommit) throw new AutomationError('VERIFICATION_GIT_MISMATCH');
  return { source: 'PASS', database: 'PASS', storage: 'PASS', encryption: 'PASS', verification: 'PASS', recoveryComplete: true };
}

async function mustNotExist(path) {
  try { await lstat(path); throw new AutomationError('PORTABLE_PACKAGE_ALREADY_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function validatePortableChecksum(packagePath, checksumPath) {
  const name = basename(packagePath), expectedLine = await readFile(checksumPath, 'utf8');
  const match = /^([a-f0-9]{64})  ([^\r\n]+)\r?\n$/.exec(expectedLine);
  if (!match || match[2] !== name) throw new AutomationError('PORTABLE_CHECKSUM_INVALID');
  const actual = await hashFile(packagePath);
  if (actual.sha256 !== match[1]) throw new AutomationError('PORTABLE_CHECKSUM_MISMATCH');
  return actual;
}

export async function createPortablePackage(snapshotDirectory, outputDirectory, value = new Date(), runCommand = command) {
  const snapshot = await realpath(snapshotDirectory), names = portableNames(value), output = resolve(outputDirectory);
  await mkdir(output, { recursive: true, mode: 0o700 });
  if (await realpath(output) !== output) throw new AutomationError('PORTABLE_OUTPUT_SYMLINK_NOT_ALLOWED');
  const packagePath = resolve(output, names.packageName), checksumPath = resolve(output, names.checksumName);
  const packageRelative = relative(snapshot, packagePath);
  if (packageRelative === '' || (!isAbsolute(packageRelative) && packageRelative !== '..' && !packageRelative.startsWith(`..${sep}`))) {
    throw new AutomationError('PORTABLE_PACKAGE_INSIDE_SNAPSHOT');
  }
  await mustNotExist(packagePath); await mustNotExist(checksumPath);
  const leaf = basename(snapshot), parent = dirname(snapshot);
  await runCommand('tar', ['-czf', packagePath, '-C', parent, '--', leaf], { timeout: 30 * 60 * 1000 });
  await runCommand('tar', ['-tzf', packagePath, '--', `${leaf}/metadata/manifest.json`], { timeout: 30 * 60 * 1000 });
  const hashed = await hashFile(packagePath);
  await writeFile(checksumPath, `${hashed.sha256}  ${names.packageName}\n`, { flag: 'wx', mode: 0o600 });
  await validatePortableChecksum(packagePath, checksumPath);
  return { ...names, packagePath, checksumPath, bytes: hashed.bytes, sha256: hashed.sha256 };
}

export function initialReport(value = new Date()) {
  return {
    date: mexicoDateParts(value).date,
    gitSha: 'NOT_RUN', source: 'NOT_RUN', database: 'NOT_RUN', storage: 'NOT_RUN',
    encryption: 'NOT_RUN', verification: 'NOT_RUN', recoveryComplete: false,
    package: 'NOT_CREATED', packageSize: 0, sha256: 'NOT_GENERATED',
    daily: 'NOT_RUN', weekly: 'NOT_DUE', monthly: 'NOT_DUE', retention: 'DRY_RUN',
    retentionCandidates: [], durationSeconds: 0, failure: null,
  };
}

export function renderStepSummary(report) {
  const candidates = report.retentionCandidates.length ? report.retentionCandidates.map(name => `- ${name}`).join('\n') : '- None';
  return `# THE BACKYARD — AUTOMATED BACKUP REPORT

Date: ${report.date}
Git SHA: ${report.gitSha}
Source: ${report.source}
Database: ${report.database}
Storage: ${report.storage}
Encryption: ${report.encryption}
Verification: ${report.verification}
recoveryComplete: ${report.recoveryComplete}
Package: ${report.package}
Package size: ${report.packageSize}
SHA-256: ${report.sha256}
Drive daily upload: ${report.daily}
Drive weekly upload: ${report.weekly}
Drive monthly upload: ${report.monthly}
Retention mode: ${report.retention}
Duration: ${report.durationSeconds}s
Failure: ${report.failure || 'NONE'}

Retention candidates:
${candidates}
`;
}

export async function writeStepSummary(report, path = process.env.GITHUB_STEP_SUMMARY) {
  if (path) await appendFile(path, renderStepSummary(report), { encoding: 'utf8' });
}

export async function writeGithubOutputs(packageInfo, path = process.env.GITHUB_OUTPUT) {
  if (!path) return;
  for (const value of [packageInfo.packagePath, packageInfo.checksumPath]) if (/\r|\n/.test(value)) throw new AutomationError('UNSAFE_GITHUB_OUTPUT');
  await appendFile(path, `package_path=${packageInfo.packagePath}\nchecksum_path=${packageInfo.checksumPath}\n`, { encoding: 'utf8' });
}

export async function executeAutomatedBackup({
  repo = fileURLToPath(new URL('../../', import.meta.url)), env = process.env, now = new Date(),
  dependencies = {},
} = {}) {
  const started = Date.now(), report = initialReport(now);
  const deps = {
    scanTracked, runBackup, verifyBackup, createPortablePackage, publishToGoogleDrive,
    writeGithubOutputs, ...dependencies,
  };
  try {
    const { retentionApply } = validateAutomationEnvironment(env);
    report.retention = retentionApply ? 'APPLY' : 'DRY_RUN';
    const scan = await deps.scanTracked(repo, { history: true });
    if (scan.state !== 'PASS') throw new AutomationError('SOURCE_SECURITY_SCAN_NOT_PASS');
    const backup = await deps.runBackup({ repo, env });
    report.gitSha = backup.manifest.gitCommit;
    report.source = backup.manifest.components.source?.state || 'FAIL';
    report.database = backup.manifest.components.database?.state || 'FAIL';
    report.storage = backup.manifest.components.storage?.state || 'FAIL';
    const verification = await deps.verifyBackup(backup.directory, env);
    Object.assign(report, assertPublishable(backup, verification));
    const packageDirectory = resolve(env.RUNNER_TEMP || env.BACKUP_ROOT || dirname(backup.directory), 'the-backyard-packages');
    const packageInfo = await deps.createPortablePackage(backup.directory, packageDirectory, now);
    report.package = packageInfo.packageName; report.packageSize = packageInfo.bytes; report.sha256 = packageInfo.sha256;
    const drive = await deps.publishToGoogleDrive({
      credentialsJson: env.GDRIVE_SERVICE_ACCOUNT_JSON,
      rootFolderId: env.GDRIVE_BACKUP_ROOT_FOLDER_ID,
      packageInfo, now, retentionApply,
    });
    report.daily = drive.daily; report.weekly = drive.weekly; report.monthly = drive.monthly;
    report.retentionCandidates = drive.retentionCandidates;
    await deps.writeGithubOutputs(packageInfo);
    report.durationSeconds = Math.max(0, Math.round((Date.now() - started) / 1000));
    return { report, backup, verification, packageInfo, drive };
  } catch (error) {
    report.failure = safeErrorCode(error);
    report.durationSeconds = Math.max(0, Math.round((Date.now() - started) / 1000));
    const failure = new AutomationError(report.failure); failure.report = report; throw failure;
  }
}

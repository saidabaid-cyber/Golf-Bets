import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';

const MAGIC = Buffer.from('BYDR1');
export function encryptionKey(env = process.env) {
  const text = env.BACKUP_ENCRYPTION_KEY || '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) throw new Error('ENCRYPTION_KEY_REQUIRED');
  const key = Buffer.from(text, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY_INVALID');
  return key;
}
export async function encrypt(source, target, key) {
  const iv = randomBytes(12);
  const file = await open(target, 'wx', 0o600);
  await file.write(Buffer.concat([MAGIC, iv]));
  await file.close();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  await pipeline(source, cipher, createWriteStream(target, { flags: 'a', mode: 0o600 }));
  await appendFile(target, cipher.getAuthTag());
}
export async function decrypt(source, destination, key) {
  const info = await stat(source);
  if (info.size < 33) throw new Error('ENCRYPTED_FILE_TRUNCATED');
  const file = await open(source, 'r');
  const header = Buffer.alloc(17), tag = Buffer.alloc(16);
  try { await file.read(header, 0, 17, 0); await file.read(tag, 0, 16, info.size - 16); }
  finally { await file.close(); }
  if (!header.subarray(0, 5).equals(MAGIC)) throw new Error('ENCRYPTED_FORMAT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(5));
  decipher.setAAD(MAGIC); decipher.setAuthTag(tag);
  const input = info.size === 33 ? Readable.from([]) : createReadStream(source, { start: 17, end: info.size - 17 });
  await pipeline(input, decipher, destination);
}
export async function verifyEncrypted(path, key) {
  let bytes = 0;
  await decrypt(path, new Writable({ write(chunk, _, done) { bytes += chunk.length; done(); } }), key);
  return bytes;
}

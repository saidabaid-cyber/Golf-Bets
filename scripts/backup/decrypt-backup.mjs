import { decryptBackup } from './core.mjs';
try {
  if(process.argv.length!==4) console.log('Usage: node scripts/backup/decrypt-backup.mjs <backup-directory> <NEW-private-directory>. Requires BACKUP_ENCRYPTION_KEY and BACKUP_DECRYPT_ACK=PRIVATE_LOCAL_DIRECTORY. No server writes.');
  else console.log(JSON.stringify(await decryptBackup(process.argv[2],process.argv[3])));
} catch {console.error('DECRYPT_ABORTED. Target must be new; verify key and snapshot. No overwrite or server write performed.');process.exitCode=1;}

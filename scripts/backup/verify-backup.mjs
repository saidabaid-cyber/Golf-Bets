import { verifyBackup } from './core.mjs';
try {
  if (process.argv.length!==3 || process.argv[2]==='--help') console.log('Usage: npm run backup:verify -- <backup-directory>. Checks manifest, all hashes, encryption authentication, Git bundle and complete Storage index. Exit 2 = integral but incomplete backup.');
  else {const result=await verifyBackup(process.argv[2]);console.log(JSON.stringify(result,null,2));process.exitCode=result.recoveryComplete?0:2;}
} catch {console.error('BACKUP_VERIFICATION_FAILED. Wrong key, modified/incomplete artifact, missing tool, or invalid manifest. No secrets printed.');process.exitCode=1;}

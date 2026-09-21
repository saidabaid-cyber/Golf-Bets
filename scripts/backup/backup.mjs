import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runBackup } from './core.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
try {
  if (args.includes('--help')) console.log('backup [--only=source|schema|database|storage]. Environment only; never deploys, restores, deletes, or contacts Production. See docs/disaster-recovery/README.md. Exit 0 complete, 2 incomplete, 1 failed.');
  else {
    if (args.some(a => !/^--only=(source|schema|database|storage)$/.test(a)) || args.length > 1) throw Error('INVALID_ARGUMENTS');
    const result = await runBackup({ repo:resolve(repo), only:args[0]?.split('=')[1] });
    console.log(JSON.stringify({directory:result.directory,gitCommit:result.manifest.gitCommit,components:result.manifest.components},null,2));
    process.exitCode = Object.values(result.manifest.components).some(c=>c.state==='FAIL') ? 1 : Object.values(result.manifest.components).some(c=>c.state!=='PASS') ? 2 : 0;
  }
} catch { console.error('BACKUP_ABORTED. See recovery documentation; no credential diagnostics emitted.'); process.exitCode=1; }

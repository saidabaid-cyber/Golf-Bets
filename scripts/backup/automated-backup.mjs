import { executeAutomatedBackup, formatDriveDiagnostic, initialReport, safeErrorCode, writeStepSummary } from './automation.mjs';

let report = initialReport();
try {
  const result = await executeAutomatedBackup();
  report = result.report;
  console.log('AUTOMATED_BACKUP_PASS');
} catch (error) {
  report = error.report || report;
  console.error(`AUTOMATED_BACKUP_FAIL:${safeErrorCode(error)}`);
  process.exitCode = 1;
}

console.log(`GDRIVE_DIAGNOSTIC:${formatDriveDiagnostic(report.driveDiagnostic)}`);

try { await writeStepSummary(report); }
catch { console.error('AUTOMATED_BACKUP_SUMMARY_FAILED'); process.exitCode = 1; }

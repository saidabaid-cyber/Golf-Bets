import { executeAutomatedBackup, formatDriveDiagnostic, formatSecurityScanDiagnostic, initialReport, safeErrorCode, writeStepSummary } from './automation.mjs';

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
console.log(`SECURITY_SCAN_DIAGNOSTIC:${formatSecurityScanDiagnostic(report.securityDiagnostic)}`);

try { await writeStepSummary(report); }
catch { console.error('AUTOMATED_BACKUP_SUMMARY_FAILED'); process.exitCode = 1; }

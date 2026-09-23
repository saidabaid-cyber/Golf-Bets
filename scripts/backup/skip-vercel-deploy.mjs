const BACKUP_ONLY_NO_DEPLOY_MARKER = '[backup-only:no-deploy]';

// Vercel treats exit 0 as an ignored build and exit 1 as a normal build.
// The marker is added only to reviewed backup-infrastructure merge commits.
const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || '';
const commitRef = process.env.VERCEL_GIT_COMMIT_REF || '';
const reviewedBackupMerge = commitRef === 'main' && commitMessage.includes(BACKUP_ONLY_NO_DEPLOY_MARKER);
process.exit(reviewedBackupMerge ? 0 : 1);

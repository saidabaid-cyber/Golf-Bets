# The Backyard disaster recovery

**Status: `NOT_ACTIVE_PENDING_OWNER_SETUP`**

The repository contains the backup and off-site automation, but it is not considered active until the owner completes the external setup and approves a controlled first run. Nothing in this directory proves that a production backup or restore has already succeeded.

## What is included

- A PostgreSQL backup guarded by an explicit read-only transaction preflight, plus an operation-allowlisted Supabase Storage backup.
- Encrypted database and Storage artifacts plus source metadata.
- Local verification and a portable `tar.gz` package with a SHA-256 sidecar.
- A GitHub Actions workflow with schedule `0 9 * * *` and manual `workflow_dispatch`.
- Upload to an owner-controlled Google Drive root through a dedicated service account.
- Retention planning with dry-run as the default.

The scheduled expression is evaluated by GitHub in UTC. Daily, weekly, and monthly classification is calculated using the `America/Mexico_City` calendar.

## Safety boundaries

- PostgreSQL access starts with an explicit `BEGIN TRANSACTION READ ONLY` preflight and performs dump reads only.
- Supabase Storage is listed and downloaded only. The automation does not upload, replace, or delete source Storage objects.
- The automation does not modify Auth, run migrations, restore data, deploy the application, or write application data.
- Google Drive and GitHub artifacts are backup destinations, so a successful run creates files there.
- Database and Storage payloads are encrypted before publication. The outer `tar.gz`, source files, and manifest are not necessarily encrypted, so they must contain no secrets. Secret values must never be committed, printed, placed in summaries, or attached as artifacts.
- `BACKUP_RETENTION_APPLY` must remain `false` during activation. Any future destructive retention run requires a separate owner review and approval.

## Owner activation sequence

1. Review the pinned project identifiers and safety assumptions in the workflow and scripts.
2. Create a dedicated Google service account and a dedicated Drive root folder with narrowly limited access.
3. Add the required GitHub Actions secrets and repository variables.
4. Keep retention in dry-run mode.
5. Ensure no scheduled run can start before setup is complete.
6. After the approved change is merged, run one controlled `workflow_dispatch` with `main` selected. The job blocks every other ref.
7. Accept the run only if all backup gates pass, `recoveryComplete` is `true`, the package and checksum exist in the expected Drive daily folder, and logs contain no secret values.
8. Observe and approve the next scheduled run before changing the operational status in a separate review.

Detailed instructions are in:

- [Automated backups](./AUTOMATED_BACKUPS.md)
- [GitHub secrets setup](./GITHUB_SECRETS_SETUP.md)
- [Google Drive service-account setup](./GOOGLE_DRIVE_SERVICE_ACCOUNT_SETUP.md)
- [Retention policy](./RETENTION_POLICY.md)
- [Automated backup runbook](./AUTOMATED_BACKUP_RUNBOOK.md)
- [Environment variables](./ENVIRONMENT_VARIABLES.md)
- [Backup verification](./BACKUP_VERIFICATION.md)

## Local commands

Use only an approved environment with the required tools and credentials:

```text
pnpm run backup
pnpm run backup:verify -- <snapshot-path>
pnpm run backup:automated
```

The automated command includes backup, verification, packaging, Drive publication, and retention planning. Do not use it merely to test configuration: it writes backup output to the configured destinations after its publish gate passes.

# The Backyard disaster recovery

**Status: `BACKUP_OBSERVED_RESTORE_DRILL_PENDING`**

The automation is active on the repository default branch. Read-only GitHub evidence observed workflow `365582254` and successful scheduled run `35979285016` for source SHA `2c15c9a02f36643244a7b0a420aa2ade570f2a10`. Artifact `10798973211` was 24,437,675 bytes and was scheduled to expire on 2026-10-01. This proves that one guarded backup run produced its workflow artifact; it does **not** prove an independent full restore drill, current Drive custody, or measured RPO/RTO.

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

## Owner verification and restore-drill sequence

1. Revalidate the pinned project identifiers, branch guard, secret scopes and Drive root without exposing values.
2. Keep retention in dry-run mode unless a separate legal/owner review authorizes destructive retention.
3. Inspect the successful scheduled run, artifact and expected Drive package/checksum pair; a green workflow alone is not a restore.
4. Copy an authorized package and decryption key through separate custody channels into a disposable target.
5. Restore DB/Auth/Storage/application there and run the complete synthetic two-user/browser verification.
6. Record actual RPO/RTO and destroy the disposable target under an approved retention process.

Detailed instructions are in:

- [Automated backups](./AUTOMATED_BACKUPS.md)
- [GitHub secrets setup](./GITHUB_SECRETS_SETUP.md)
- [Google Drive service-account setup](./GOOGLE_DRIVE_SERVICE_ACCOUNT_SETUP.md)
- [Retention policy](./RETENTION_POLICY.md)
- [Automated backup runbook](./AUTOMATED_BACKUP_RUNBOOK.md)
- [Environment variables](./ENVIRONMENT_VARIABLES.md)
- [Backup verification](./BACKUP_VERIFICATION.md)

Provider-independent recovery material recovered from the hardened DR line:

- [Architecture](./ARCHITECTURE.md)
- [Full restore from zero](./FULL_RESTORE_FROM_ZERO.md)
- [Supabase recovery](./SUPABASE_RECOVERY.md)
- [Storage recovery](./STORAGE_RECOVERY.md)
- [Auth recovery](./AUTH_RECOVERY.md)
- [Vercel recovery](./VERCEL_RECOVERY.md)
- [DNS recovery](./DNS_RECOVERY.md)
- [GitHub recovery](./GITHUB_RECOVERY.md)
- [Migration to a new provider](./MIGRATION_TO_NEW_PROVIDER.md)
- [System inventory](./SYSTEM_INVENTORY.md)
- [Dependencies](./DEPENDENCIES.md)
- [Backup policy](./BACKUP_POLICY.md)

The recovered QA metadata is historical evidence, not proof that a current
restore drill has passed. Current activation and restore status must be recorded
separately after an owner-approved controlled run.

## Local commands

Use only an approved environment with the required tools and credentials:

```text
pnpm run backup
pnpm run backup:verify -- <snapshot-path>
pnpm run backup:automated
```

The automated command includes backup, verification, packaging, Drive publication, and retention planning. Do not use it merely to test configuration: it writes backup output to the configured destinations after its publish gate passes.

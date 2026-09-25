# Backup environment variables

**Status: `BACKUP_OBSERVED_RESTORE_DRILL_PENDING`**

This document lists names and ownership only. Never copy secret values into documentation, commits, logs, workflow summaries, issue comments, or artifacts.

## GitHub Actions secrets

| Name | Purpose | Handling |
| --- | --- | --- |
| `BACKUP_PGPASSWORD` | Authenticates the exact owner Session Pooler connection. | Store only as an Actions secret. It is not a dedicated/read-only credential; safety comes from the explicit read-only preflight and dump-only commands. |
| `BACKUP_STORAGE_KEY` | Authenticates server-side Storage requests. | Store only as an Actions secret. The key's provider scope is not claimed to be read-only; the backup code allowlists bucket listing, object listing, and object download only. Never expose it to browser code. |
| `BACKUP_ENCRYPTION_KEY` | Encrypts the database dump and downloaded Storage payloads. | Store only as an Actions secret and keep a separately controlled recovery copy. It does not encrypt the outer `tar.gz`, source files, or manifest. |
| `GDRIVE_SERVICE_ACCOUNT_JSON` | Contains the dedicated Google service-account credential. | Store the complete JSON only as an Actions secret. Never create a repository file from it. |

`BACKUP_ENCRYPTION_KEY` must represent 32 cryptographically random bytes encoded as base64. Losing the independent recovery copy makes the encrypted database and Storage payloads unusable.

## GitHub Actions variables

| Name | Required setting | Purpose |
| --- | --- | --- |
| `GDRIVE_BACKUP_ROOT_FOLDER_ID` | The identifier of the dedicated owner-approved Drive root. | Constrains where the automation starts its folder hierarchy. It is configuration, not a credential. |
| `BACKUP_RETENTION_APPLY` | `false` during activation and by default. | Produces a retention plan without trashing remote files. |

Do not set `BACKUP_RETENTION_APPLY` to `true` as part of initial activation. That change requires a separate owner-approved retention procedure.

## Fixed workflow configuration

The workflow supplies the following non-secret settings from reviewed, pinned configuration:

- `BACKUP_SOURCE`
- `BACKUP_EXPECTED_REF`
- `BACKUP_PGHOST`
- `BACKUP_PGPORT`
- `BACKUP_PGUSER`
- `BACKUP_PGDATABASE`
- `BACKUP_PGSSLROOTCERT`
- `BACKUP_STORAGE_URL`
- `BACKUP_ROOT`

The owner must compare the pinned identifiers with the intended production project before activation. Do not override them ad hoc in a manual run.

## Manual backup environment

Local owner-run commands use the same backup variables:

- Public or identifier configuration: `BACKUP_SOURCE`, `BACKUP_EXPECTED_REF`, `BACKUP_PGHOST`, `BACKUP_PGPORT`, `BACKUP_PGUSER`, `BACKUP_PGDATABASE`, `BACKUP_PGSSLROOTCERT`, `BACKUP_STORAGE_URL`.
- Secrets: `BACKUP_PGPASSWORD`, `BACKUP_STORAGE_KEY`, `BACKUP_ENCRYPTION_KEY`.
- Optional output location: `BACKUP_ROOT`.
- Restore-only acknowledgement: `BACKUP_DECRYPT_ACK`. It is not needed for backup or verification and must not be set casually.

The scripts do not rely on silently loading a local `.env` file. Supply variables through the approved runtime or secret manager.

## Validation rules

- All required names must be present before a backup begins.
- Values are validated against the owner allowlist where applicable.
- The owner Session Pooler connection must pass the explicit `BEGIN TRANSACTION READ ONLY` preflight before the dump-only commands run. The password itself is not described as read-only.
- Storage source access is constrained by the implemented operation allowlist, not by a promise that the server-side key has a narrow provider scope.
- The Drive credential must identify a service account, and the root folder must be accessible to that account.
- Errors and summaries must identify only safe field names or error codes, never submitted values.

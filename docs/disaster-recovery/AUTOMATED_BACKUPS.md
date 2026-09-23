# Automated off-site backups

**Status: `NOT_ACTIVE_PENDING_OWNER_SETUP`**

The automation is present in the repository, but it is not operationally active until the owner completes external configuration and accepts a controlled manual run.

## Trigger and timing

The GitHub Actions workflow supports:

- Schedule: `0 9 * * *`
- Manual start: `workflow_dispatch`

GitHub evaluates the cron expression in UTC and may start scheduled jobs later during high load. The backup code uses the `America/Mexico_City` calendar to decide whether a successful daily backup also belongs in the weekly or monthly tier.

The first run must be a controlled `workflow_dispatch` after the approved change is merged, with `main` selected. The job is guarded by `github.ref == 'refs/heads/main'`, so any other ref is skipped. Do not rely on the schedule until the `main` run is reviewed and accepted.

## Pipeline

One automated run performs these stages in order:

1. Checks out the intended source with read-only repository credentials.
2. Installs pinned runtime and PostgreSQL client dependencies.
3. Validates the pinned owner configuration, required secret names, Drive root, and retention mode.
4. Scans relevant source history for prohibited secret material.
5. Starts the backup, including the explicit PostgreSQL read-only transaction preflight.
6. Captures source metadata, the encrypted database backup, and encrypted Storage objects.
7. Verifies the snapshot and requires all publication gates to pass.
8. Builds one portable `tar.gz` package and its SHA-256 sidecar. The database and Storage payloads inside are encrypted; the archive itself, source files, and manifest are not claimed to be encrypted.
9. Publishes the verified pair to the dedicated Drive root.
10. Produces a retention plan. With `BACKUP_RETENTION_APPLY=false`, no Drive file is trashed.
11. Uploads the portable pair as a short-lived GitHub Actions artifact.

The workflow uses a concurrency group and does not cancel an in-progress backup when another trigger arrives.

## Publication gate

Drive upload is allowed only when Source, Database, Storage, Encryption, and Verification are all `PASS`, `recoveryComplete` is `true`, and the recorded Git SHA matches the checkout. A failed or incomplete gate stops publication.

## Destination layout

The service account works beneath one owner-approved Drive root and creates tier folders for:

- `daily`: every successful published run.
- `weekly`: a verified promotion when the Mexico City calendar day is Sunday.
- `monthly`: a verified promotion when the Mexico City calendar day is the first of the month.

Names must be unique. Existing ambiguous or duplicate names cause failure rather than overwrite.

## Expected writes and prohibited writes

A successful run is expected to create Drive folders and a package containing encrypted database/Storage payloads plus source and manifest metadata. The same package and checksum become a GitHub Actions artifact. It may also attach verification metadata to Drive files.

It must not write to the application database, source Supabase Storage, Auth, migrations, source code, deployments, or restore targets. Retention remains non-mutating while `BACKUP_RETENTION_APPLY` is `false`.

## Activation criteria

The owner may review a later status change only after:

1. GitHub secrets and variables are configured without exposing values.
2. The service account has access only to the dedicated Drive root required for the backup.
3. After the approved merge, a controlled `workflow_dispatch` from `main` completes and all verification evidence is reviewed.
4. The package and checksum are visible in the expected destination.
5. Logs and summaries are confirmed secret-free.
6. The next scheduled run is observed successfully.

Until then, the status remains `NOT_ACTIVE_PENDING_OWNER_SETUP`.

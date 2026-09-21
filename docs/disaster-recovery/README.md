# The Backyard — disaster recovery
Audited 2026-09-21. Initial application commit: `dbf30b080c8e76d3e56bab5c311a60e7ac65d897`.
Work branch: `infra/disaster-recovery`; based on fetched `phase2/course-catalog-feedback`. No deployment or database mutation is part of this work.

## Start here

1. Read [SYSTEM_INVENTORY](SYSTEM_INVENTORY.md), especially the remote-only objects.
2. For an incident, follow [FULL_RESTORE_FROM_ZERO](FULL_RESTORE_FROM_ZERO.md).
3. For an ordinary snapshot, follow [BACKUP_POLICY](BACKUP_POLICY.md).
4. Verify independently using [BACKUP_VERIFICATION](BACKUP_VERIFICATION.md).

## Commands

Run from the repository root with Node 24 and Git available:

```sh
npm run backup
npm run backup:source
npm run backup:schema
npm run backup:database
npm run backup:storage
npm run backup:verify -- /absolute/path/to/snapshot
npm run backup:security
npm run backup:security -- --history
```

The existing dependency lock is **pnpm-lock.yaml**; install with `pnpm install --frozen-lockfile`. npm here is only a script launcher, not an instruction to regenerate dependencies.

No script reads an application .env automatically. Inject the dedicated BACKUP_* variables from a password manager into the process environment; see [ENVIRONMENT_VARIABLES](ENVIRONMENT_VARIABLES.md). A missing credential blocks only that component: Git still runs. Exit codes: 0 all requested/full components successful, 2 incomplete (including deliberately source-only snapshots), 1 failure. Inspect component states, not just file existence.

Default output is an ignored `backups/<UTC-time>-<random-id>/` folder. Previous snapshots are never overwritten or deleted. DB and Storage content (including private filenames) are encrypted with AES-256-GCM before disk writes. Store the encryption key separately in an owner-controlled password manager; losing it makes these backups unrecoverable. Git source/history is NOT encrypted by default and must pass the secret scan before copying externally.

## Scope and limits

Sources allowed by code are explicitly separate:

- `BACKUP_SOURCE=local`: localhost PostgreSQL only, no remote Storage.
- `BACKUP_SOURCE=qa` plus `BACKUP_EXPECTED_REF=bymeopxkxapfizeeqeyb`: existing isolated QA source.
- `BACKUP_SOURCE=owner` plus `BACKUP_EXPECTED_REF=zhqmlpljloumldaczcfp`: owner-authorized **read-only backup** of this exact project, not arbitrary Production access.

Owner PostgreSQL is pinned to `db.zhqmlpljloumldaczcfp.supabase.co:5432`, database/user `postgres`; owner Storage is pinned to `https://zhqmlpljloumldaczcfp.supabase.co`. No free-form allowlist override exists. The owner Session Pooler hostname has not been independently verified and is **not enabled**: do not guess a shared pooler cluster or reuse the QA pooler. The verified direct endpoint works where IPv6/direct connectivity is available. Supporting an IPv4-only owner connection requires obtaining the exact Session Pooler hostname from that project's Connect panel and reviewing a pinned allowlist update.

All PostgreSQL tools receive forced `default_transaction_read_only=on` and `transaction_read_only=on`; `psql -X` must confirm both with SHOW before the database/schema export and again before roles export. Inherited libpq overrides are removed. The SHOW preflight is a separate connection; exporter connections receive the same locked startup options. No restore, source mutation, migration or deployment is performed. This allowlist change does **not** mean a real owner backup has been executed or verified.

A Git bundle, tests and docs do not prove a database/Auth/Storage restore. The current execution evidence is in [BACKUP_VERIFICATION](BACKUP_VERIFICATION.md). No full recovery certification until a disposable target is restored and the application is exercised against it.

Configuration secrets, OAuth consoles, DNS zone, off-device copies and a recovery drill require owner-controlled access. None are silently considered backed up. No dependency on Codex or OpenAI is needed to read these docs, execute backups or run deterministic golf calculations.

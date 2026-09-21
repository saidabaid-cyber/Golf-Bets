# Backup verification and execution evidence

## Levels of evidence

1. **Artifact integrity:** manifest valid, every declared file exists, SHA-256/byte size match, no undeclared files/symlinks/path traversal, encrypted files authenticate with the separate key.
2. **Payload completeness:** source bundle/HEAD archive/refs, DB archive/schema/data/roles and Storage bucket/object index plus every object payload. SQL must have PostgreSQL headers/schema definitions; custom archive must have PGDMP signature. Missing components are not PASS.
3. **Actual restore:** independent Git clone/fsck; pg_restore inspection and full database restore; Storage upload/readback/ownership checks; Auth/session/API/browser flow on the restored application.
4. **Disaster readiness:** verified off-device copy, key/provider-account custody, licensed originals and measured complete recovery drill.

Levels 1–2 do not prove levels 3–4. The verifier's recoveryComplete field means complete available payload flags with a clean source worktree, **not a successfully restored application**; restoreDrill remains PENDING_INTERACTIVE_QA until separately executed.

## Run verification

```sh
npm run backup:verify -- /absolute/snapshot
```

Supply the key through BACKUP_ENCRYPTION_KEY if any .enc files exist. Exit 2 is intentional for a valid but partial snapshot. Missing/wrong key, corruption, invalid manifest, incomplete listing or missing local Git utility produces failure, not success. Do not print provider error bodies to debug; use a protected operator session.

For a PostgreSQL dump, after verified decryption:
```sh
pg_restore --list /private/new-staging/database/full.dump
```

A recognizable header is only structural validation; restore to a disposable target and run queries before trusting recoverability. Checksums in a manifest detect accidental corruption, not a malicious party replacing both files and manifest. Store the manifest/directory digest separately in protected custody or sign it with an independently managed signing key. Signing/key distribution is not configured automatically.

## Automated regressions

19 initial recovery tests cover:
- Real streaming encryption/decryption, wrong key, tampering/truncation, zero-byte Storage content, no overwrite.
- QA-only DB/Storage guards, process-only credentials and read-only PG option.
- Recursive/paginated Storage listing beyond 1000 objects, encrypted real file bytes with a synthetic transport, stable-list detection.
- Missing-access continuation, fresh snapshot paths and independent Git clone/fsck.
- Served-path prevention, false-completeness claims, unlisted/missing artifacts and path traversal.
- Explicit local decryption acknowledgment and no overwrites.
- Secret pattern classification without matched-value output.
- SQL/archive signature/definition validation.
- Empty-only .env.example and inventory/documentation coverage.
- Gitignore protects private artifacts but not migrations or .env.example.

No Storage mock is claimed as a live remote restoration.

## Read-only external evidence — 2026-09-21

- QA ref bymeopxkxapfizeeqeyb: PostgreSQL 17.6, 38 ledger entries, schema/table/policy/function/trigger counts and three bucket configurations read back. No user rows exported and no database writes.
- Two remote Edge sources recovered as inert text for audit/custody; no function execution or deployment.
- Vercel project settings readback: nextjs, Node 24.x, root directory, framework default install/build/output.
- Initial tracked/history high-confidence secret scan: **3,827 files/objects, zero findings**. This is pattern coverage, not proof that every possible credential format is absent.
- Final command results and source snapshot evidence are recorded below after the final quality gate.

## Remaining recovery blockers

| Component | State | Exact missing capability |
|---|---|---|
| Live DB dump and restore | BLOCKED_EXTERNAL | PostgreSQL 17 client tools and dedicated QA DB connection/password + independent encryption key injection |
| Live Storage export/restore | BLOCKED_EXTERNAL | Dedicated QA Storage server credential + independent encryption key custody; new target authorization for upload drill |
| Migration-only equivalence | PENDING_CONTROLLED_DB_APPLY | Definition reconciliation and clean-target replay; 38 remote ledger entries vs 30 repo migrations |
| Complete new-target app drill | PENDING_INTERACTIVE_QA | New isolated stack, verified OAuth/OTP user interaction after payload restoration |
| Independent off-device recovery | BLOCKED_EXTERNAL | Owner-chosen approved storage destination and separate key custody; no new service connected |
| External configuration | BLOCKED_EXTERNAL | Auth/SMTP/OAuth/signing/Vault recovery material, authoritative DNS zone/account access and hosting scopes in protected owner custody |

No backups of Production, no migration apply, no Storage writes, no emails or deployments were executed by this task.

## Incident acceptance

Record snapshot ID, commit, source ref, source-data cutoff, component states, verified file count, decrypt/check results, actual restored row/object counts, RLS tests, device checks, copy location and operator. Never include credentials or raw private data in the report. Repeat verification after copying media and after every tooling change. Keep failed snapshots; scripts do not erase them.


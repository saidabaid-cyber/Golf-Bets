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

20 recovery tests cover:
- Real streaming encryption/decryption, wrong key, tampering/truncation, zero-byte Storage content, no overwrite.
- QA-only DB/Storage guards, process-only credentials and read-only PG option.
- Recursive/paginated Storage listing beyond 1000 objects, encrypted real file bytes with a synthetic transport, stable-list detection.
- Missing-access continuation, fresh snapshot paths and independent Git clone/fsck.
- Served-path prevention, false-completeness claims, unlisted/missing artifacts and path traversal.
- Explicit local decryption acknowledgment, no overwrites, and rejection of plaintext output inside served/source directories (including misleading dot-prefix paths).
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


## Executed repository backup drill — 2026-09-21

Implementation snapshot commit: `9bafd498122981a8c44b51e4f1657adc6f88f7b0`.

- First snapshot: `backups/2026-09-21T14-08-21-969Z-a2466c46`.
- Second snapshot: `backups/2026-09-21T14-09-08-430Z-e4b2dabe`.
- Both: source PASS, 55 refs, clean worktree; DB/Storage BLOCKED_EXTERNAL with explicit missing-variable codes. Master and verifier exit **2**, deliberately incomplete.
- Both source manifests/hash checks and independent empty-repository bundle verification PASS.
- Actual mirror restored from first bundle into ignored `restore-private/dr-git-first.git`; `git fsck --full` exit 0; recovered branch SHA exactly matches snapshot. No GitHub network used for restore.
- Second snapshot did not overwrite the first; both remain locally available.
- Three verified source payloads: HEAD.tar (14,141,440 bytes), refs.txt (4,638), repository.bundle (5,803,183).
- Bundle SHA-256: `19dbeb05adf15b086d9865d4dccca5cf4ef4239273a974f5c401b3b74c387bd9`.
- Tracked-file rescan after adding recovery files: 884 relevant text files, 0 findings. Initial reachable-history scan: 3,827, 0 findings. Only categories/paths would be printed on a match.
- Existing .env.local has no server credential and is NOT bound to the authorized QA ref; it was not used for backup. No approved PostgreSQL connection or encryption key is present. Scripts correctly refuse implicit application-environment credential discovery.
- Local quality gate: 2,152 application tests + 20 recovery tests; 0 failures / 0 skips. TypeScript noEmit PASS, ESLint PASS (0 warnings after cleanup), Next 16.3.3 production-mode build PASS. Local npm executable was not on PATH; commands were run through the installed npm 11.6.0 CLI with Node 24.19.0, preserving package scripts.
- Subsequent documentation/security-only commits require a fresh final snapshot; identify its SHA/path from its own manifest, never relabel an older archive as the final commit.
- No live database restore, object download/upload, external backup copy, Auth login or deployment is claimed by these results.

Overall: source recovery demonstrated; full disaster recovery remains **PARTIAL** pending the explicitly listed external custody/access and clean-target drill.

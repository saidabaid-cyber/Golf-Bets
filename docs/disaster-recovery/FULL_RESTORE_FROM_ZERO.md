# Full restore from zero

Scenario: Codex is unavailable, GitHub cannot be reached, and the former Vercel/Supabase accounts are lost. Work on a **new isolated recovery environment**, not Production or the only remaining live source. This runbook has not yet passed an end-to-end live DB/Auth/Storage restore; missing access is explicit in BACKUP_VERIFICATION.

## Before starting: identify the recovery set

Obtain independent Git bundle + encrypted DB/schema/data/roles + encrypted Storage files/index + manifest + encryption key in separate custody + provider configuration/ownership records + licensed private originals if needed. If any required component is missing, stop declaring a full recovery: restore only demonstrably available capabilities.

Freeze writes on the future restored instance until integrity checks pass. Preserve original snapshots read-only, document incident timestamp and desired RPO. Do not discard the old browser/PWA profile: unsynced edits may exist only there. Do not run untrusted restored SQL with privileged credentials before inspecting source/provenance.

## Ordered recovery

### 1. Obtain source without the old Git provider

Run bundle verification and mirror/worktree restore in GITHUB_RECOVERY. Compare commit and branch to manifest, run git fsck --full, and preserve all refs. Use the backup's code, not today's moving default branch. Review security scan findings before redistributing history.

### 2. Install dependencies

Install Node 24 and a compatible pnpm (audit: 11.19.0), then:
```sh
pnpm install --frozen-lockfile
```
Keep the lock intact. For registry outage use a previously prepared verified offline store; the Git bundle alone is not a package registry mirror. Install PostgreSQL 17-compatible pg_dump/pg_restore/pg_dumpall/psql for inspection and restoration.

### 3. Provision a new database/backend

Choose a new managed Supabase project or compatible self-hosted Supabase stack. Plain PostgreSQL additionally requires Auth/REST/Storage adapters (see MIGRATION_TO_NEW_PROVIDER). Confirm new ref/host, empty application state and owner authorization in the incident record. Never point restoration credentials at bymeopxkxapfizeeqeyb, the shared project or a live user database. Existing backup source allowlists are not authorization for restore writes.

### 4. Reconstruct schema/migrations without duplication

Decrypt to a new private staging path, inspect pg_restore --list and roles/schema SQL. Apply the platform-managed baseline first. Then select ONE path:
- Restore the reviewed schema from the same full snapshot as data, including remote-only objects; do not also replay the 30 app migrations.
- Or build an empty app schema from ordered migrations after reconciling the six remote-only ledger subjects and earlier differently named variants. This migration-only path is currently PENDING_CONTROLLED_DB_APPLY, not certified equivalent.

Save chosen TOC/definition checksums and roles/extension decisions. Reconcile ledger semantically; do not mark applied dates simply to suppress migration warnings. Definitions of RLS/functions/triggers/grants are part of the schema, not optional postprocessing.

### 5. Restore data and constraints

Follow SUPABASE_RECOVERY for the chosen platform. On the new target only, use fail-on-error transactional restoration where supported. Restore canonical Auth UUIDs and linked application data from the same snapshot, sequences and constraints. Do not merge by email, regenerate user IDs, silently drop policies or rewrite frozen round snapshots. If restoration fails, stop and diagnose on that disposable target; never modify the original backup or source database.

### 6. Restore Storage

Follow STORAGE_RECOVERY: bucket configuration, original keys, object bytes, private policies and ownership/attachment references. A SQL storage.objects row does not create the file. Verify re-downloaded byte hashes and private access. Do not automatically redeploy remote-only site publishing functions with verify_jwt=false; preserve exports for manual security review.

### 7. Configure Auth

Recover signup/OTP/session policies and templates from the approved snapshot. Restore user/identity linkage and custom triggers. A new signing-key/project setup may require every user to sign in again. Missing Vault/column encryption root keys cannot be repaired by inventing replacement plaintext. Do not accept terms/AI consents for users during recovery.

### 8. Configure OAuth

Google Cloud owner restores/reissues the authorized OAuth client settings. Add the exact new Supabase callback from the target dashboard. Supabase app redirect allowlist must include the exact new app origin /auth/callback. Retain PKCE single exchange and origin continuity. Configure Apple only when the actual developer/provider credentials and approval exist.

### 9. Configure email

Supabase Auth SMTP is separate from group/feedback API mailer. Verify sender domain and provider credentials in private consoles. Keep all emails disabled or pointed at approved synthetic mail infrastructure during the drill; do not send to real users. Feedback DB acceptance must still work without notification mail. Real OTP/delivery testing requires an authorized human test recipient.

### 10. Load environment variables

Use ENVIRONMENT_VARIABLES and the values-only-in-vault rule. Set the new Supabase public URL/public key at build time, admin key server-only, and reviewed availability flags. Do not use the old QA ref to bypass new-target safeguards: any new recovery environment support requires a reviewed change to hard-coded isolation checks and corresponding tests. Leave unavailable AI/Rules/Apple/external providers disabled. Never copy production secrets into a Preview incident exercise.

### 11. Start locally

```sh
pnpm run dev
```
Point only to the restored isolated services. Confirm ordinary login/home/manual rounds are not dependent on optional AI consent availability. Use synthetic identities and private data. Do not change UX/business rules to make recovery pass.

### 12. Execute tests

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm run lint
```
Read existing DB/QA runner guards before invocation: some runners create/delete synthetic fixtures and are not safe read-only inventory tools. The current runners are bound to known QA; use a separately reviewed target adaptation for a new recovery project, not a production override.

Verify on the restored stack: user A/B isolation, shared history attribution, account mapping, equipment, catalogs/provenance, feedback/attachments, round drafts/resume/history, score-only/total-score, reset rules and snapshots. Account deletion rehearsal requires its own disposable fixtures, never restored real users.

### 13. Production-mode build locally

```sh
pnpm run build
pnpm run start
```
“Production-mode build” is local compilation, NOT a Production deployment. Confirm HTTP/API behavior and public build variables. Use the new isolated DB, not old live services.

### 14. Deploy an isolated Preview

Create/link the new authorized hosting project explicitly. Follow VERCEL_RECOVERY or a compatible Node hosting runbook. Confirm deployment SHA equals the restored commit plus any reviewed infrastructure-only recovery fix. Disable accidental auto-deploy/production promotion and preserve an immutable Preview URL.

### 15. Domain cutover — only future explicit permission

Follow DNS_RECOVERY using owner-exported zone and exact provider targets. Preserve email verification records. Do not point app.thebackyard.com.mx or beta.thebackyard.com.mx at a drill. Actual cutover requires the owner's release decision, verified backups and rollback route.

### 16. Verify and hand over

Run browser/API/DB checks against one immutable restored deployment, then independent device testing. Observe logs for unexpected 5xx, duplicate callbacks, stale cloud acknowledgments and privacy failures. Record evidence/limitations per component, recovery duration, data cutoff and operator. Keep original snapshots and a fresh restored snapshot in independent custody.

## Final release checklist

- [ ] Git mirror/bundle restores without GitHub; SHA/refs and fsck verified.
- [ ] Frozen dependencies and Node runtime rebuild without Codex.
- [ ] DB/schema/data/roles manifest verified; restore succeeds on new target.
- [ ] Auth UUIDs, identities, app ownership, sequences, constraints and custom triggers intact.
- [ ] No unresolved schema/ledger divergence ignored.
- [ ] Storage bytes, bucket privacy, owner metadata and signed access verified.
- [ ] Encryption/signing/provider keys available independently; no secrets in repository.
- [ ] Source catalogs and reviewed supplements match restored DB; history snapshots unchanged.
- [ ] Real authorized OAuth/OTP flow tested by human; no accidental real emails during drill.
- [ ] Synthetic two-user RLS and cloud persistence pass.
- [ ] Manual/score-only/total-score/shared rounds work without new financial calculations.
- [ ] Feedback persists without mailer; private attachments are isolated.
- [ ] Local tests, lint, typecheck and build pass; no app functionality was changed by backup tooling.
- [ ] Browser/PWA offline/resume and iPhone interaction validated by actual device when available.
- [ ] Immutable deployment SHA proven; DNS cutover separately approved.
- [ ] Off-device snapshot re-verified; owner has custody of runbook and decryption key.

Until the live database/Storage/Auth recovery drill passes, the system is **prepared but not certified fully recoverable**. A source-only backup must never be described as complete disaster recovery.

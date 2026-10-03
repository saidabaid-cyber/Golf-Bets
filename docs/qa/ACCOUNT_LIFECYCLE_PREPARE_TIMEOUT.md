# Account lifecycle — prepare timeout, controlled fix

Historical report of the first pruning fix. That fix was subsequently authorized
and applied (remote ledger 20261003040627); its one authorized retry still timed
out. The current diagnosis and new NOT-APPLIED correction are documented in
[ACCOUNT_LIFECYCLE_NIGHT_ROOT_CAUSE.md](ACCOUNT_LIFECYCLE_NIGHT_ROOT_CAUSE.md).

## Observed failure

The QA PLAYER `saidabaid+playerqa@gmail.com` submitted deletion from the current
authenticated Preview on 2026-10-03 at 03:38:45 UTC. The server returned HTTP 503
at stage `prepare`, PostgreSQL code `57014` (statement timeout). The existing job
is `6a9f3478-1483-4af5-a407-bc63794b60cc`, policy `delete_golf_data`, stage
`requested`; account state is `closing`. Auth removal and completion have **not**
been confirmed. Do not create another request or reset lifecycle state.

The scoped account has 74 `cloud_record_versions` rows. PostgreSQL logs identify
the update of `previous_snapshot` inside `account_lifecycle_prepare`, its
`account_scrub_deleted_snapshot` trigger, and recursive calls to
`account_scrub_json_uuid` / `account_deleted_identity_token`. The recursive UUID
scrubber processes every golf-data subtree and repeatedly computes replacement
tokens even when those branches contain no relevant identity. The existing 8 s
SQL deadline cancels the transaction. This is a performance failure, not a legal
block or missing server credential. Storage is an earlier saga stage and may
already have removed this QA account's private image; completion is not claimed.

## Exact change prepared

Migration: `20261003035013_account_lifecycle_skip_unrelated_json_branches.sql`.

Only replaces `private.account_scrub_json_uuid(jsonb,uuid,text)`. It returns a
subtree unchanged when its case-normalized JSON contains neither the target UUID
nor the existing container-specific tombstone. Branches containing either still
use the original redaction, key replacement and collision checks. Marker-only
redaction remains in the separate, unchanged document pipeline.

- No table, view, trigger, RLS, Auth, role, timeout or retention-policy change.
- No automatic lifecycle execution, data backfill, purge or cleanup.
- Expected application-data rows changed by installation: **0**.
- Function signature, immutable/strict/invoker security and grants unchanged.
- No project refs, users, secrets or QA fixtures in the migration SQL.
- Current DEV and Preview callers keep the same contract.
- The existing request must be resumed through the normal UI/server flow only
  after controlled application is authorized and verified.

The proposed target is DEV Supabase `bymeopxkxapfizeeqeyb`, which this QA Preview
already uses. A new database function replacement affects that shared DEV DB;
the existing authorization for Preview-only fixtures does not authorize applying
it. Production and the separate QA project are not targets.

## Local verification

`node --test scripts/account-lifecycle-json-pruning.test.mjs`: **7/7 PASS**.
Executes the old and proposed definitions in PostgreSQL/WASM and compares actual
JSONB output. Includes nested raw/uppercase UUIDs, composite keys, tombstones,
collision rejection, provenance-only references, marker-only PII, idempotence,
unrelated values, scores/putts, and function privileges.

Benchmark: 74 synthetic snapshots, 23,901 bytes each, UUID-scrubbing phase:
42,688 ms before vs 2,695 ms after (15.84x). These are local WASM measurements,
not a guarantee of remote timings. No real snapshot contents were exported.

`node scripts/test-account-lifecycle-db.mjs`: **PASS**. Full selected migration
graph and real lifecycle SQL, including 74 synthetic shared historical versions
and the actual trigger path. Preparation completed in 6,946 ms locally. Versions,
scores and surviving participant names remain intact; deleted participant PII
and identifiers are removed. Permission, stale-write, retry, collision and
unknown-FK fail-closed assertions pass. The fixture harness now uses the existing
promotion manifest to exclude retained QA-only/rejected migration originals and
uses a live authorized fixture for post-deletion Admin writes.

Typecheck, lint and build: **PASS**. Full app suite: **4101/4105**, exactly the
four previously documented failures; zero new test failures. Existing script
suite: **117/117 PASS**. The new SQL regression suite is additional.

## Controlled application / recovery gate

Not executed. After explicit approval:

1. Reconfirm the exact DEV DB target and current function definition/grants.
2. Apply only this versioned function replacement and verify its definition,
   privileges and ledger entry. Do not execute cleanup or lifecycle from SQL.
3. Resume only the already submitted QA account request through its normal
   authenticated Preview UI; verify completion, session invalidation, audit and
   read-back. Do not change ADMIN/SUPER_ADMIN roles or delete other accounts.
4. Confirm DEV still has its existing deployment and health; no alias movement.

Function rollback is reviewable: restore **only the function definition and
revoke statement** from the `account_scrub_json_uuid` block in
`20260927045252_account_delete_round_player_tombstones.sql`. Do not apply that
entire historical migration because it includes a backfill. No DB rollback or
account-state reset is performed automatically.

## Runtime / device status

Real account deletion remains **FAIL / PENDING_CONTROLLED_DB_APPLY** until the
same request completes in the Preview. Session invalidation, deleted-account
login and final fixture cleanup remain unverified. This newly observed 503 is
reported separately from the four pre-existing test failures.

Physical Safari/Android QA remains **PENDING_DEVICE_QA**. The Preview's app code
is at `6bfedb8b4550119092fe8d077c89ac329fd4ae92`; the prepared function-only change
does not replace those UI fixes. DEV health remains HTTP 200, build SHA
`b2cdbe4f1a0cbe5326a13db951b299f1969e270f`. No alias, merge, remote schema,
Auth/SMTP, credential, role or separate QA-project change was made in this phase.

# Account lifecycle — night root cause / prepared correction

**Real request: FAIL / PENDING_CONTROLLED_DB_APPLY.**
**Prepared correction: READY_FOR_CONTROLLED_DB_APPLY.**

No remote lifecycle call, delete retry, migration, data write, Auth/SMTP/role
change or alias movement occurred during this diagnosis.

## Observed failure

DEV database: bymeopxkxapfizeeqeyb.
Excluded QA account: saidabaid+playerqa@gmail.com.
Existing request: 6a9f3478-1483-4af5-a407-bc63794b60cc.

The earlier pruning migration
20261003035013_account_lifecycle_skip_unrelated_json_branches.sql was authorized
and applied as remote ledger version 20261003040627. The only authorized retry
failed at 2026-10-03 04:08:27.778 UTC, HTTP503 / SQLSTATE57014.

The actual PostgreSQL log identifies this complete cancellation context:

```text
SQL function account_replace_deleted_identity_text, statement 1
select count(*)<>count(distinct
  private.account_replace_deleted_identity_text(key,target_user,container_namespace))
from jsonb_each(value)
account_scrub_json_uuid line 63; recursive line 105
account_anonymize_json_document
account_scrub_deleted_snapshot line 29
update public.cloud_record_versions
set previous_snapshot=private.anonymize_account_json(previous_snapshot,$1)
where previous_snapshot::text like $2
account_lifecycle_prepare line 307
```

Read-only revalidation: stage requested, status closing; Auth and profile still
exist. Session invalidation and final cleanup remain incomplete. No retry was
made. The timeout is technical, not a disabled flag, missing credential or
legal-retention decision. Storage removal is an earlier saga stage and may
already have processed a private QA image.

## ROOT CAUSE / WHY TIMEOUT

Three cumulative costs occur inside one atomic preparation transaction:

1. The key-collision aggregate calls a SQL helper for EVERY JSON key. The helper
   performs two regex replacements and invokes the namespace SHA256-token
   function THREE times, even for keys such as par/score. The output loop calls
   it again. Each recursive UUID helper also computes its own token.
   These SQL functions have a security search_path setting and are not normally
   inlined. Pruning UUID-free branches did not remove this repeated work.
2. Every stale-snapshot trigger compares its JSON with the historical lifecycle
   ledger: 239 jobs currently, including 223 completed delete-data, 15
   retain-history and one requested closing. Both ILIKE branches repeatedly
   serialize and case-compare the complete JSON per state and column.
   Cost grows with historical accounts as well as snapshot count/size.
3. The general anonymizer and marker-only pass rebuild unrelated course, tee
   and hole trees. Preparation calls the general pass; its trigger runs the
   full document pipeline again. The previous fix pruned only the UUID pass.

This is CPU/string/recursive work. Collision keys are ephemeral JSON object
keys, not a relational key lookup missing a B-tree. The 265-row version scan
itself is small. Adding an index or increasing the timeout would not address
the demonstrated repeated work.

## TABLES / ROWS / QUERY PLAN

Only aggregated sizes, plans and definitions were retrieved, never snapshot
contents, lease tokens, credentials or Auth secrets.

- cloud_record_versions: 265 current rows; 73 contain the target raw UUID.
  Earlier 74 counted ownership/history rows. Matching JSON text: 517,059 bytes
  total, range 5,144–9,265 bytes. All-version mean 8,777, maximum 17,770.
- Approximate live counts: rounds117, bet configs/results22 each, groups25,
  equipment profiles13, admin audit171.
- Matching-version SELECT: Seq Scan265, returns73, removes192;
  41.019ms, 757 shared hits, zero shared reads/writes. Request lookup uses
  account_lifecycle_jobs_pkey.
- Old trigger-candidate predicate, one selected snapshot: nested loop239 states,
  238 removed by join filter, jobs_user_id_key lookup; 124.121ms total including
  ~39ms document selection. Residual identity comparison ~85ms.
- Equivalent proposed predicate with one materialized lowercase text:
  71.540ms total, including 69.064ms selection CTE; residual ~2.5ms.
  These are separate safe read-only samples. Namespace was a fixed synthetic
  round namespace for this predicate comparison; canonical resolution was
  audited separately and remains unchanged.
- 717 old/new predicate comparisons (three real stored documents x239 states):
  **zero mismatches**, no writes.
- No blocked sessions when inspected. Historical lock absence is not claimed.
- pg_stat_statements.track=top; track_functions=none. Nested DEV timings cannot
  be recovered from these counters without instrumentation changes, not made.
  Completed prepare RPCs:239 calls, mean100.39ms, max7415.96ms. Failed attempts
  are not faithfully represented by those completed-statement totals.
- authenticator/authenticated statement_timeout8s; SQL diagnostic session120s.
  Neither setting was changed. No destructive EXPLAIN ANALYZE was run.

| Step | Function / exact block | Tables / rows | Index / expected cost | Observed cost / problem | Proposed fix |
|---|---|---|---|---|---|
| Lease | prepare FOR UPDATE; lifecycle_context_actor | jobs, one request | jobs_pkey, one-row lock | not cancellation frame | unchanged |
| Ownership/history | prepare private/shared joins; FK inventory | rounds, participants, social links, tournaments, courses | owner/player/participant indexes, selective joins and metadata | graph tested locally; no remote DML timed | unchanged |
| Namespace | account_json_container_namespace | rounds~117, one lookup/version | owner indexes; coalesce(local_id,local_round_id) may scan small table | not cancellation frame | unchanged |
| Snapshot selection | prepare previous_snapshot::text LIKE UUID | versions265 /73 | seq scan; owner index cannot find embedded UUID |41.019ms read-only | unchanged |
| Candidate identity | account_scrub_deleted_snapshot ILIKE UUID OR token | state/jobs239 | repeated conversion and string scan per state |~85ms residual/document | lowercase once; position; hash only if deleted- prefix occurs |
| Collision/UUID | count/distinct replacement keys; recursive scrub | score/putt/player JSON maps | aggregate on ephemeral keys; no useful relational index | 74 x 101-key local aggregate 1,144ms→39ms | cached token, native regex, same pre-recursion collision gate |
| Subject/provenance | anonymize_account_json | course/hole/player trees | traversal with inherited local-player aliases | 74 docs 3,704ms→653ms | skip only if neither UUID nor ANY inherited raw/JSON-encoded local key occurs |
| Marker-only PII | account_scrub_marked_deleted_json | JSON subtree | boolean/string identityDeleted search | 74 docs 2,465ms→254ms | skip branches lacking either accepted marker |
| Combined document | account_anonymize_json_document | unchanged three-pass pipeline | repeated traversal | 74 docs 10,099ms→1,565ms | optimize internals, same data policy |
| Final integrity | prepare remaining FKs; rekey/reconcile | Auth FKs, round references, storage manifests | existing relational indexes | actual full graph assertions pass | unchanged |

## Full chain audited

prepare validates job/lease/context, classifies private vs shared historical
data, applies existing ownership policy, reconciles Admin/catalog provenance and
hashes, processes 21 JSON columns selected by information_schema, checks unknown
Auth FKs/remaining references and advances the existing job.

Snapshot trigger -> canonical namespace -> marker-only PII -> eligible deleted
identities -> account_anonymize_json_document -> general anonymizer -> UUID/key
scrubber -> marked-PII pass. The round-only path also calls
account_reconcile_deleted_round_snapshot -> account_rekey_round_references:
players, group snapshot players, participants, live operations/activity/shots,
handicap and other round-scoped JSON projections. Their ownership, collision and
canonical mapping logic remains unchanged.

Storage enumeration/rehome/removal precedes prepare; Auth ban/signout/removal/
completion follows it. Those stages are not the recorded timeout frame and were
not rerun. Preparation remains atomic; its failure rolls back its own changes,
not necessarily earlier external-storage saga operations.

## MIGRATION PREPARED — NOT APPLIED

**20261003070508_account_lifecycle_bound_snapshot_identity_work.sql**

Creates one private immutable/strict worker:
account_scrub_json_uuid_with_token(jsonb,uuid,text,text).

Replaces five private functions: account_replace_deleted_identity_text,
account_scrub_json_uuid, account_scrub_deleted_snapshot, anonymize_account_json,
account_scrub_marked_deleted_json. Existing signatures, strictness where
applicable, empty search_path, invoker/definer properties and restricted grants
remain unchanged.

- One namespace token per document, passed through recursion.
- Same case-insensitive UUID/tombstone transform; 23505 collisions detected
  BEFORE recursion; no silent duplicate-key overwrite.
- General pruning includes inherited aliases, empty IDs, Unicode and JSON-escaped
  quotes/backslashes/control characters. A final synthetic regression exposed
  a false negative in the prepared raw-text alias gate; checking its encoded
  JSON string too repairs it. This candidate was never installed remotely.
- Marker pruning recognizes the existing boolean and case-insensitive string
  true contracts. Subject/provenance boundaries and marker-only PII stay.
- Surviving players, scores, putts, history, namespaces and retry stay.
- No application UPDATE/backfill/cleanup/purge/lifecycle invocation on install.
  Expected application rows changed: **0**.
- No tables, columns, indexes, triggers, policies, roles, Auth, timeout or
  retention changes; no IDs/secrets/project refs/fixtures in migration.
- Repeated installation tested; no new public RPC; anon/PLAYER cannot execute
  the private helpers. Old deployment and Preview keep the same API.
- Read-only remote ledger confirms this candidate is NOT installed.

Rollback preparation: restore only the five old function definitions/revokes.
Do not apply the entire historical tombstone migration, which has a backfill.
The new private worker can remain unused; nothing is rolled back automatically.

## BENCHMARK — synthetic local PostgreSQL/WASM

Full graph baseline/candidate use the SAME synthetic database. Baseline changes
and temporary function definitions are rolled back before candidate execution.
Production SHA256 is represented by the existing deterministic fixture digest.
Queries depend on each series row so constant folding cannot falsely represent
one immutable evaluation as74 calls. Earlier constant-folded samples discarded.

| Measurement | Before | After |
|---|---:|---:|
| Small UUID pass, 1 version / 1,636 bytes | 19ms | 6ms |
| Medium UUID pass, 20 versions / 8,280 bytes each | 964ms | 171ms |
| Historical UUID pass, 74 versions / 22,329 bytes each | 3,808ms | 661ms |
| Actual collision aggregate, 74 objects x 101 keys | 1,144ms | 39ms |
| General anonymizer, 74 docs | 3,704ms | 653ms |
| Marker pass, 74 docs | 2,465ms | 254ms |
| Full document pipeline, 74 docs | 10,099ms | 1,565ms |
| Full prepare, 74 versions + 243 lifecycle states | 27,210ms | 1,734ms |

Final measurements above were run without other test runners in parallel.
These are actual local measurements, **not a remote 1.734-second guarantee**.
Earlier intermediate candidate without the two remaining pass optimizations
was33599→9075ms and is not the final migration.

## TESTS / RISKS / NEXT SAFE ACTION

New PostgreSQL suite9/9PASS; full isolated lifecycle migration graph PASS,
including baseline/candidate equality,243 states, relational reconciliation,
private/shared protection, scores/putts, leases/retries, stale-JWT RLS,
ambiguous namespace/FK failures, storage, same-email fresh start and audit.

Typecheck/lint/build PASS. App suite4107/4111, exactly four historical failures,
zero new. Existing scripts117/117PASS. Separate SQL suites for consent,
onboarding, privacy, social, invitations, group ownership, statistics, feedback
PASS. No remote Auth/Storage/delete completion is claimed.

Growth remains proportional to relevant versions and historical-state matching;
the correction removes repeated conversion/hashing/irrelevant recursion, not all
possible future scale limits. Remote latency and Auth completion require later
controlled validation. No legal policy changed. Optional retain-history/recovery
approval is separate; it is not the explanation of this timeout.

Next safe action: after NEW explicit controlled approval, revalidate DB target,
recent recoverable backup, definitions/grants and ledger; apply ONLY this
migration. Resume ONLY the already submitted QA request via its normal recovery
flow. Never manually reset closing or call destructive SQL. Verify lifecycle/
Auth/session/storage/audit/shared-history/stale writes and login after completion.
If timeout persists or another effect occurs, stop and diagnose.

READY_FOR_CONTROLLED_DB_APPLY

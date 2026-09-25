# The Backyard — canonical migration ledger — 2026-09-24

## Scope and safety statement

This ledger records the migration state discovered while consolidating `integration/backyard-current`. It is an evidence ledger, not an authorization to execute SQL.

- Canonical repository inventory: **51 migration files** under `supabase/migrations/`.
- Four reviewed migrations were applied in this consolidation cycle, only to isolated QA: GHIN/provider foundation (`20260924233419`), the Feedback lifecycle guard (`20260925010316`), transactional legal-evidence ingest (`20260925012322`) and Polla Realtime raw-table hardening (`20260925012920`). They were applied individually through the managed migration path after local review; no historical migration was replayed.
- No Production database, Production Auth setting, Production Storage object, Production DNS record, or real user row was written.
- Applied-state classifications combine repository closeouts, the read-only recovery inventory dated 2026-09-21, and live read-only Supabase CLI observations performed during consolidation.
- A matching purpose or historical name does **not** establish byte-for-byte equivalence. Before any controlled apply, compare the target ledger and live object definitions on an isolated Preview database.
- Never use `supabase db push --include-all`, migration repair, timestamp rewriting, or manual ledger inserts merely to make local and remote counts agree.

Status vocabulary used here:

- `DOCUMENTED_APPLIED_SHARED_PRODUCTION`: repository evidence says the logical migration was already applied to the shared/owner environment used at that time. This was not revalidated live in this cycle.
- `DOCUMENTED_APPLIED_QA_ONLY`: the read-only QA inventory records the logical migration in QA project `bymeopxkxapfizeeqeyb`; there is no evidence here that it was applied to Production.
- `APPLIED_QA_EXACT`: a later live `supabase migration list` observation showed the exact local version number on isolated QA branch ref `bymeopxkxapfizeeqeyb`. This proves ledger presence only; it does not by itself prove checksum/DDL equivalence, RLS behavior, or successful application in this consolidation cycle.
- `APPLIED_QA_EQUIVALENT`: live `supabase_migrations.schema_migrations.statements` plus live objects proved the canonical behavior present under a different historical version/name; the canonical timestamp must not be replayed or manufactured in the remote ledger.
- `APPLIED_QA_THIS_CYCLE`: the migration was proven absent, dependencies were checked live, and the exact canonical SQL was applied only to isolated QA during this consolidation.
- `PENDING_CONTROLLED_DB_APPLY`: present in canonical source but no accepted evidence of an apply to the intended isolated canonical Preview database.
- `REMOTE_ONLY_RECOVERY_DEPENDENCY`: present in a historical remote ledger or inventory without a corresponding canonical standalone migration file.
- `SUPERSEDED_DO_NOT_APPLY`: historical branch migration whose behavior is replaced or unsafe against the canonical schema.

## Environment evidence

| Environment | Evidence | Last evidenced ledger state | Interpretation |
|---|---|---|---|
| Shared/owner environment, historically treated as Production | `docs/FINAL_CLOSEOUT_STATUS.md` and prior closeouts | 13 remote entries through `20260908195537 legal_evidence_events_append_only` | Logical foundation through legal evidence was documented as applied. Exact local-file checksums were not established. |
| QA | Historical `docs/disaster-recovery/QA_METADATA_2026-09-21.json`, plus live ledger/object/RLS observations | Supabase branch `phase2-full-platform-qa`, ref `bymeopxkxapfizeeqeyb`, `ACTIVE_HEALTHY`, `with_data=false`; **58** remote migration records after four controlled QA-only applies | The branch is isolated from Production. Ledger/object/RLS evidence is recorded below; `ACTIVE_HEALTHY` and `with_data=false` alone do not certify runtime behavior or imply a Production data clone. |
| Canonical Preview after consolidation | Live catalog/ledger reconciliation plus four controlled QA-only applies | Historical candidates were reconciled first; GHIN, two lifecycle/legal guards and Polla publication hardening were then applied under the exact remote identities recorded below | No canonical migration remains unapplied semantically on this QA branch. Ledger timestamp divergence still forbids blind `db push` or repair. |
| Production during consolidation | Explicitly out of scope | No writes | Production remained untouched. |

The QA metadata recorded PostgreSQL 17.6, **104/104 `public` tables with RLS enabled**, 310 public policies, 45 public functions, and 84 public triggers. This is historical evidence for the 2026-09-21 QA state only. It does **not** certify the later Admin, GHIN, environment-separation, or canonical legal migrations.

### Later live reconciliation evidence

After the initial document audit, the consolidation performed targeted reconciliation against the isolated QA branch and four controlled writes, identified explicitly below:

- `supabase branches list --project-ref zhqml...` identified isolated branch `phase2-full-platform-qa`, ref `bymeopxkxapfizeeqeyb`, state `ACTIVE_HEALTHY`, with `with_data=false`.
- `supabase migration list --project-ref byme...` showed exact local/remote versions `20260917070829`, `20260917081443`, `20260917092620`, `20260917134241`, `20260917140234`, `20260920185147`, `20260921002925`, `20260921013129`, `20260922001638`, and all 12 Admin versions from `20260922132057` through `20260922163818`.
- Direct read-only inspection of `supabase_migrations.schema_migrations` resolved the initially ambiguous entries without repairing the ledger: `202609230001 profile_username_availability` contains the canonical function body and grants; `20260923051051 owner_course_catalog_player_read` contains the canonical player-read function; and `20260924140818 20260924010936_admin_data_environment_separation` contains the Admin/QA separation migration. Live columns, constraints, guards, RPCs, classification audit rows and zero unsafe non-operational publications corroborated the Admin result.
- Remote `20260908195537 legal_evidence_events_append_only` exposes the historical statements. Live columns, checks, grants, owner-read policy and the append-only table match the recovered canonical behavior; the newer canonical file changes only recovery framing/comment wording and must not be replayed merely to align timestamps.
- The GHIN provider tables were confirmed absent while every dependency was present with the expected identity/type. The exact canonical file `20260924010000_ghin_provider_foundation.sql` was then applied only to isolated QA through the managed migration path as remote `20260924233419 ghin_provider_foundation_canonical_20260924`.
- `20260924235900_feedback_requests_account_lifecycle_guard.sql` was applied only to QA as `20260925010316 feedback_requests_account_lifecycle_guard_canonical_20260924`; it adds the same restrictive account lifecycle boundary to the pre-existing Feedback table.
- `20260924235930_legal_evidence_transactional_ingest.sql` was applied only to QA as `20260925012322 legal_evidence_transactional_ingest_canonical_20260924`; live readback proved `SECURITY INVOKER`, empty pinned `search_path`, no `anon`/`authenticated` execute and `service_role` execute.
- `20260924235945_polla_realtime_raw_table_hardening.sql` was applied only to QA as `20260925012920 polla_realtime_raw_table_hardening_canonical_20260924`; live readback proved zero raw score/group publications and exactly one sanitized leaderboard-event publication.
- A final ledger read counted **58 remote migration records** on QA. The historical divergence is preserved; this count is evidence, not a reason to synthesize local files or repair timestamps.
- `supabase db push --dry-run --skip-vault` aborted before writing because 32 remote versions were absent locally. Its suggestion to use migration repair or `db pull` is diagnostic only. No repair, blind pull, `--include-all`, or apply will be executed from that suggestion.

### Managed Auth configuration on isolated QA

This is configuration evidence, not a SQL migration. The consolidation changed only Auth URL settings on branch ref `bymeopxkxapfizeeqeyb`:

- `site_url`: `https://dev.thebackyard.com.mx`.
- Additional redirect URLs: `https://dev.thebackyard.com.mx/auth/callback`, `http://localhost:3000/auth/callback`, and `http://127.0.0.1:3000/auth/callback`.
- Ten historical Vercel Preview callback URLs were removed from this QA allow-list.
- Google remained enabled and its client identity was not changed. SMTP, Twilio, Storage, database settings and Production Auth were not changed.

A post-change config diff showed no remaining difference for the two intended properties. This does not prove an end-to-end Google login; the interactive callback/session check remains pending on the fixed domain.

## Canonical 51-file ledger

| # | Canonical migration | Remote ledger evidence | Status | Primary dependency / ordering note |
|---:|---|---|---|---|
| 1 | `202609010001_golf_bets_v3.sql` | `20260903085631 202609010001_golf_bets_v3` | `DOCUMENTED_APPLIED_SHARED_PRODUCTION` | Foundational golf, rounds, scoring and betting schema; first application migration. |
| 2 | `202609010002_backyard_accounts_legal.sql` | `20260903085657 202609010002_backyard_accounts_legal` | `DOCUMENTED_APPLIED_SHARED_PRODUCTION` | Depends on Auth and the foundational schema; creates account/legal foundations used by later consent work. |
| 3 | `202609020001_cloud_sync_polla_hardening.sql` | `20260903085750 202609020001_cloud_sync_polla_hardening` | `DOCUMENTED_APPLIED_SHARED_PRODUCTION` | Depends on round/account foundations; introduces cloud projections, private scorecard storage policy and Polla hardening. |
| 4 | `202609030001_function_privileges.sql` | `20260903085916 202609030003_function_privilege_hardening` and `20260903132304 function_privileges_repo_reconciliation` | `DOCUMENTED_APPLIED_SHARED_PRODUCTION` | Privilege reconciliation for functions created by earlier migrations. One local file corresponds to two historical remote steps; do not infer checksum equality. |
| 5 | `20260904013601_repair_cloud_profiles_and_permissions.sql` | `20260904132050 repair_cloud_profiles_and_permissions` | `DOCUMENTED_APPLIED_SHARED_PRODUCTION` | Depends on profiles/cloud tables and prior privilege hardening. |
| 6 | `20260904104145_rules_ai_rate_limit.sql` | `20260904132120 rules_ai_rate_limit` | `DOCUMENTED_APPLIED_SHARED_PRODUCTION` | Server-only Rules AI limiter; depends on the base database and server-key execution model. |
| 7 | `20260905060434_add_express_betting_consent.sql` | `20260906061613 allow_users_update_own_legal_acceptances` and `20260906061910 allow_specific_legal_consent_types` | `DOCUMENTED_APPLIED_SHARED_PRODUCTION` | Depends on `legal_documents`/acceptance structures from migration 2. One local migration maps to two historical remote entries. |
| 8 | `20260906193435_equipment_ball_fitting.sql` | `20260916191229 equipment_ball_fitting` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on accounts/profiles; foundation for equipment, ball catalog, private fitting and owner aggregate. |
| 9 | `20260906211937_golf_profile_course_architecture.sql` | `20260916191238 golf_profile_course_architecture` | `DOCUMENTED_APPLIED_QA_ONLY` | Course, tee, profile and golf architecture required by later catalog, GPS and GHIN work. |
| 10 | `20260908134650_ai_processing_consents.sql` | `20260916191245 ai_processing_consents` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on account/legal foundation; dedicated consent boundary for AI processing. |
| 11 | `202609100001_phase2_social_groups_memberships.sql` | `20260916191302 phase2_social_groups_memberships` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on profiles/account lifecycle; social and group foundation. |
| 12 | `202609100002_phase2_course_handicap_gps.sql` | `20260916191308 phase2_course_handicap_gps` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on migration 9; course, handicap and GPS extension. |
| 13 | `202609100003_phase2_live_rounds_notifications.sql` | `20260916191316 phase2_live_rounds_notifications` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on rounds, social/groups and course architecture. |
| 14 | `202609100004_phase2_shots_analytics.sql` | `20260916191328 phase2_shots_analytics` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on live rounds and course/hole identities. |
| 15 | `20260913175810_group_round_presets.sql` | `20260916191336 group_round_presets` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on social groups and round setup. |
| 16 | `20260913205122_user_statistics_reset.sql` | `20260916191401 user_statistics_reset` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on owner statistics/history structures. |
| 17 | `20260915114707_user_statistics_reset_idempotency.sql` | `20260916191425 user_statistics_reset_idempotency` | `DOCUMENTED_APPLIED_QA_ONLY` | Must follow migration 16; adds idempotency to reset behavior. |
| 18 | `20260915183026_social_activity_v3.sql` | `20260916191433 social_activity_v3` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on migrations 11 and 13. |
| 19 | `20260915203125_account_lifecycle_preview.sql` | `20260916191446 account_lifecycle_preview` | `DOCUMENTED_APPLIED_QA_ONLY` | Extends account lifecycle and provides `private.account_subject_active`, required later by social search and GHIN. |
| 20 | `20260915203550_social_service_privileges.sql` | `20260916191518 social_service_privileges` | `DOCUMENTED_APPLIED_QA_ONLY` | Privilege repair for social services; follows social foundations. |
| 21 | `20260916020557_ai_consent_onboarding_decisions.sql` | `20260916191525 ai_consent_onboarding_decisions` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on migrations 10 and 19. |
| 22 | `20260916084954_profile_visibility_public_friends.sql` | `20260916191532 profile_visibility_public_friends` | `DOCUMENTED_APPLIED_QA_ONLY` | Depends on profiles/social foundation; visibility boundary used by later user search. |
| 23 | `20260917070829_group_owner_returning_read.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on groups and account lifecycle. Ledger presence does not replace RLS verification. |
| 24 | `20260917081443_group_email_invitations.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on group memberships and profile identities. |
| 25 | `20260917092620_profile_progress_social_connections.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on profiles and social graph. |
| 26 | `20260917134241_confirmed_round_history_read.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on round history and account lifecycle. |
| 27 | `20260917140234_confirmed_participant_index_append.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Must follow confirmed round history support. |
| 28 | `20260920185147_course_catalog_feedback.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on course architecture; foundation for course requests/feedback. |
| 29 | `20260921002925_feedback_internal_requests.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Extends migration 28 with internal workflow and privacy boundaries. |
| 30 | `20260921013129_feedback_attachment_lifecycle.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Must follow migration 29; private attachment lifecycle. |
| 31 | `20260922001638_owner_user_search_normalization.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on profiles, social profiles, friendships and `private.account_subject_active`. Contains a data projection/backfill; exact ledger presence does not prove resulting row correctness. |
| 32 | `20260922132057_admin_control_center_v1.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Admin foundation. Depends on Auth plus existing course/equipment/feedback/catalog structures. Its canonical RLS test passed in the final remote 17/17 QA run. |
| 33 | `20260922132140_admin_publication_workflows_v1.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on Admin tables/functions from migration 32. |
| 34 | `20260922132904_admin_policy_indexes_v1.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on migrations 32–33; policy and index follow-up. |
| 35 | `20260922140635_admin_temporary_hole_runtime.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on Admin course configuration tables; changes runtime-hole constraints and publication guards. |
| 36 | `20260922143348_admin_scheduled_publications.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on prior Admin publication RPCs and `pgcrypto` digest support. |
| 37 | `20260922143611_admin_revision_privacy.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on Admin revision ledger and scoped authorization. |
| 38 | `20260922143732_admin_publish_guard_reset.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Must follow publication workflow/scheduling; narrows the transaction-local publish guard. |
| 39 | `20260922143905_admin_configuration_publish_qualification.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on Admin course configurations, holes, evidence and publication flow. |
| 40 | `20260922145015_admin_advisor_followup.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on the complete preceding Admin chain; policy/index advisor follow-up. |
| 41 | `20260922150533_admin_export_expansion.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on Admin revisions/configuration tables and scoped RLS. |
| 42 | `20260922151308_admin_publish_payload_validation.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Depends on Admin publication workflow and canonical catalog payload contracts. |
| 43 | `20260922163818_admin_player_safe_projections.sql` | Exact remote version observed live on isolated QA | `APPLIED_QA_EXACT` | Final player-safe projection layer. Exact ledger presence does not yet certify player-safe runtime behavior. |
| 44 | `20260922230000_owner_course_catalog_player_read.sql` | Remote `20260923051051 owner_course_catalog_player_read`; stored statements and live function/ACL match | `APPLIED_QA_EQUIVALENT` | Do not replay the local timestamp. The authenticated/service-role RPC exists with the canonical owner-catalog filters. |
| 45 | `202609230001_profile_username_availability.sql` | Remote `202609230001 profile_username_availability`; stored statements and live function/ACL match | `APPLIED_QA_EXACT` | Depends on `profiles`, `social_profiles` and Auth identity. No repair or reapply is needed. |
| 46 | `20260924010000_ghin_provider_foundation.sql` | Applied this cycle as remote `20260924233419 ghin_provider_foundation_canonical_20260924` | `APPLIED_QA_THIS_CYCLE` — **Preview-only** | Dependencies were verified live first. Transactional RLS passed; the three tables remained empty. It stores mappings/snapshots only and does not activate GHIN or score posting. |
| 47 | `20260924010936_admin_data_environment_separation.sql` | Remote `20260924140818 20260924010936_admin_data_environment_separation`; stored statements plus live objects/data safeguards verified | `APPLIED_QA_EQUIVALENT` | The QA target already has all five columns/checks, three publish guards, filtered RPCs, 24 classification audits and zero unsafe non-operational publications. Do not replay. |
| 48 | `20260924220041_legal_evidence_events_canonical.sql` | Historical remote `20260908195537 legal_evidence_events_append_only`; statements and live append-only object contract verified | `APPLIED_QA_EQUIVALENT` | The canonical recovery file preserves this behavior under a new filename; replay would only manufacture ledger alignment/comment wording. Runtime/API QA remains separate. |
| 49 | `20260924235900_feedback_requests_account_lifecycle_guard.sql` | Applied this cycle as remote `20260925010316 feedback_requests_account_lifecycle_guard_canonical_20260924` | `APPLIED_QA_THIS_CYCLE` — **Preview-only** | Depends on Feedback v2 plus `private.account_data_access_allowed()`. Adds a restrictive lifecycle policy without deleting the 13 existing QA/internal requests. |
| 50 | `20260924235930_legal_evidence_transactional_ingest.sql` | Applied this cycle as remote `20260925012322 legal_evidence_transactional_ingest_canonical_20260924` | `APPLIED_QA_THIS_CYCLE` — **Preview-only** | Depends on migration 48. Adds service-only transactional ingest, serialized semantic deduplication, transition preservation and a DB rate limit. |
| 51 | `20260924235945_polla_realtime_raw_table_hardening.sql` | Applied this cycle as remote `20260925012920 polla_realtime_raw_table_hardening_canonical_20260924` | `APPLIED_QA_THIS_CYCLE` — **Preview-only** | Removes raw Polla scores/groups from Realtime while preserving the sanitized revision signal consumed by the current app. |

Count check: 7 `DOCUMENTED_APPLIED_SHARED_PRODUCTION` + 15 `DOCUMENTED_APPLIED_QA_ONLY` + 22 `APPLIED_QA_EXACT` + 3 `APPLIED_QA_EQUIVALENT` + 4 `APPLIED_QA_THIS_CYCLE` = **51 canonical migration files**.

## Remote-only recovery dependencies

The 2026-09-21 QA inventory contained six historical entries without a one-to-one standalone migration filename in the then-current repository. Two additional entries were later observed and reconciled as proven semantic counterparts, so the table contains eight rows in total:

| Remote version | Remote name | Environment evidence | Recovery treatment |
|---|---|---|---|
| `20260904112153` | `marketing_waitlist` | Shared/owner and inherited by QA | Preserve in logical/full backups. Do not invent DDL from the name. |
| `20260904134101` | `temporary_http_extension_for_site_healthcheck` | Shared/owner and inherited by QA | Inspect extension/object definitions on an authorized disposable restore target. |
| `20260904134306` | `public_marketing_site_bucket` | Shared/owner and inherited by QA | Preserve Storage bucket metadata and bytes independently; a DB migration alone is insufficient. |
| `20260908195537` | `legal_evidence_events_append_only` | Shared/owner and inherited by QA | Historical legal migration discussed separately below. Do not assume it equals the old or new local SQL byte-for-byte. |
| `20260918122331` | `equipment_research_private_staging` | QA only | Preserve as QA/internal recovery evidence; never expose private/synthetic staging to players. |
| `20260918122608` | `equipment_research_private_ingest` | QA only | Preserve as QA/internal recovery evidence; do not rerun ingest blindly on restored history. |
| `20260923051051` | `owner_course_catalog_player_read` | Isolated QA; full stored statements inspected live | Proven semantic counterpart of local `20260922230000`; preserve the historical version and do not replay/repair it. |
| `20260924140818` | `20260924010936_admin_data_environment_separation` | Isolated QA; full stored statements and resulting objects/data inspected live | Proven semantic counterpart of local `20260924010936`; preserve the historical version and do not replay/repair it. |

The first six historical objects remain part of disaster-recovery scope and have not been definition-reconciled from standalone local migration files. A full logical snapshot may preserve them; a migration-only rebuild cannot claim completeness until their actual definitions are reconciled. The last two rows have already been reconciled semantically and must not be replayed merely to align filenames.

## Legal evidence reconciliation

There are three identifiers for one historical intent, and they must not be collapsed into a false applied-state claim:

1. `20260908173547_legal_evidence_events_append_only.sql` exists on historical branch `legal-app-v6-v2-hotfix` at `c3c320cc95ade217a5cf446aefba511192e5543f`. It is not one of the 51 canonical files.
2. Historical Shared/QA ledgers record remote version `20260908195537`, name `legal_evidence_events_append_only`. Repository evidence links it by purpose, but no checksum or byte-equivalence proof was captured.
3. Canonical recovery file `20260924220041_legal_evidence_events_canonical.sql` restores the required append-only evidence model with defensive/idempotent DDL and the currently published legal versions/hashes.

Therefore:

- The remote `20260908195537` evidence does **not** mark canonical `20260924220041` as an exact/byte-identical apply or justify adding the canonical timestamp to the remote ledger.
- On isolated QA, live comparison of stored statements, columns, constraints, indexes, grants, policies, comments and row count established the recovered behavior already present. The canonical filename is therefore `APPLIED_QA_EQUIVALENT`, not a request to replay SQL.
- On another environment, perform the same comparison before deciding whether the recovery file is needed. Never infer equivalence from the name alone.
- Do not apply it to Production during consolidation and do not repair the Production ledger to the canonical timestamp.

## Historical and abandoned branch migrations

| Historical migration | Source | Classification | Reason |
|---|---|---|---|
| `20260908173547_legal_evidence_events_append_only.sql` | `legal-app-v6-v2-hotfix` `c3c320c` | `SUPERSEDED` as canonical filename; retain as reconciliation evidence | Its intent is represented by remote entry `20260908195537` and canonical recovery migration `20260924220041`. Never apply both blindly. |
| `20260906210425_production_hardening_v1.sql` | `production-hardening` commit `185696c` | `SUPERSEDED_DO_NOT_APPLY` | Replaces profile policies/grants using an obsolete `profiles.role='admin'` model and stale writable-column assumptions. Modern Admin memberships, scoped authorization and aggregate analytics supersede it. Health/app-version behavior may be ported separately without this SQL. |
| `202609230002_owner_feedback_requests.sql` | `phase2/full-platform` commit `a168f3d` | `SUPERSEDED_DO_NOT_APPLY` | Conflicts with the broader canonical feedback chain `20260920185147`, `20260921002925`, and `20260921013129`; it would reintroduce narrower/older policy assumptions. |

## Timestamp and dependency hazards

- The canonical directory has unique, sortable filenames, but early local timestamps differ materially from applied remote versions. Ordering by filename does not prove that a target has the same definitions.
- The live dry-run found **32 remote versions absent locally** and aborted without writing. Targeted statement/object reconciliation resolved the product migrations described above, but the historical ledger remains divergent; this is not a reason to run repair, blind `db pull`, or `--include-all`.
- Exact QA ledger matches for owner search and the full Admin chain establish presence, so they are no longer classified as pending apply. The final remote canonical RLS run passed **17/17**, including Feedback, legal transactional ingest and Polla publication/lifecycle contracts. Advisor findings and runtime readbacks remain separate gates.
- Local `202609230001` and remote `202609230001` were initially unpaired by the CLI; direct inspection later proved the name, stored statements, live function and ACL match.
- `20260922230000`, `20260924010936`, and `20260924220041` have proven QA equivalents under historical versions. `20260924010000` was the only absent recovered product foundation and was applied as remote `20260924233419` after dependency checks; three later local files are explicit hardenings created by the final security review, not previously missing branch migrations.
- The function privilege migration maps to two remote historical steps; express betting consent also maps to two. Treat these as logical reconciliation, not a request to replay them.
- The Admin migrations form one ordered unit from `20260922132057` through `20260922163818`. Skipping an intermediate file can leave functions, policies, guards or projections inconsistent.
- `20260924010000_ghin_provider_foundation.sql` and Admin separation have different dependency families. Admin separation already existed; GHIN was applied independently only after its own dependencies were verified.
- `20260924010936_admin_data_environment_separation.sql` can classify existing rows and depends on an already functional Admin authorization/audit chain; it must not be applied before the Admin foundation.
- The recovered legal-table migration `20260924220041` is an equivalence mapping; the later `20260924235930` is a distinct incremental ingest hardening and was applied under its own remote identity. The final local file sorts Polla Realtime hardening last. Never conflate filename order with historical ledger equivalence.
- Managed Supabase Auth, Storage, Realtime, Vault, `pg_net`, `http`, `pg_trgm`, `pgcrypto`, platform roles and Storage bytes are not recreated safely by concatenating application SQL. Rebuild and restore plans must handle them explicitly.

## Controlled Preview sequence and residual gates

Steps 1–5 were completed for the isolated QA branch; the remaining verification state is recorded explicitly rather than inferred from migration presence.

1. Use the isolated Preview branch `phase2-full-platform-qa` / `bymeopxkxapfizeeqeyb`, after independently rechecking its identity at execution time; never substitute the Production ref.
2. Before the controlled GHIN apply, the ledger had 32 remote-only-from-local versions. Those historical versions remain preserved, and the QA-only GHIN apply added remote identity `20260924233419` for local migration `20260924010000`; this is an intentional timestamp mapping, not an additional missing behavior. The five product candidates were reconciled individually before any apply.
3. Username, owner catalog, Admin separation and legal evidence were proven already present under their remote identities and were not replayed.
4. The initial recovery apply plan contained one actually missing product foundation: GHIN/provider.
5. That exact additive SQL was applied only to QA as remote `20260924233419`. A subsequent security review produced and separately applied three incremental QA-only hardenings: Feedback lifecycle `20260925010316`, legal ingest `20260925012322` and Polla Realtime `20260925012920`. GHIN and Polla live remain feature-disabled; all GHIN provider tables are empty.
6. SQL/RLS tests were run transactionally against `bymeopxkxapfizeeqeyb`. All **17/17 files passed**, including legal lifecycle/RPC, Feedback A/B/RPC/Storage and Polla owner/lifecycle/publication contracts. Every test rolled back; the post-run readback found 0 fixed synthetic Auth, Feedback, legal, Polla, lifecycle or Storage fixtures. The Feedback table still contains 13 pre-existing QA/internal requests; “0 fixtures” means the runner left no test rows, not that this internal table is empty.
7. Schema, ledger, grants, policies, functions, triggers and advisors were re-read. The Supabase security advisor currently reports 23 findings: 17 `WARN` and 6 `INFO`; each still requires remediation or an evidence-backed disposition.
8. The exact Preview ref, all four remote apply identities, RLS outcome and transactional rollback evidence are recorded here. No checksum claim is made where the managed API did not expose one; rollback left **0 fixed runner fixtures**, 13 pre-existing Feedback QA/internal requests remained, and the three GHIN provider tables remain empty.
9. Keep every GHIN live flag off until separate authorized interactive QA succeeds. Score posting remains prohibited.
10. Do not promote or replay any migration against Production without separate explicit authorization and a reviewed Production-specific plan.

## RLS acceptance state

- Historical QA foundation through feedback lifecycle: evidence exists, including the historical 104/104 RLS snapshot.
- Current canonical runner on isolated QA: **17 of 17 files passed transactionally**. This includes Admin, GHIN provider mapping, legal ingest/lifecycle, Feedback grants/policies/RPC/Storage and Polla owner/publication/lifecycle isolation.
- Canonical legal evidence: PASS includes the service-only transactional RPC, lifecycle guard needed for a fresh rebuild and archived-account rejection check.
- Security advisor: **23 findings total — 17 `WARN`, 6 `INFO`**. They remain open for individual remediation or evidence-backed disposition.
- Transaction rollback: **0 fixed runner fixtures** remained; 13 pre-existing Feedback QA/internal requests were preserved and GHIN mapping/snapshot tables remained empty.
- Production RLS after consolidation: not queried and not changed.

No canonical migration remains semantically unapplied on QA, so `PENDING_CONTROLLED_DB_APPLY` is not the residual QA status. The remote migration/RLS gate is **17/17**; the database portion is still **not a global product PASS** until the 23 security-advisor findings, 125 performance findings and runtime readbacks are triaged. Production had zero writes.

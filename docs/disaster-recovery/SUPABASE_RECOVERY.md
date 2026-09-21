# Supabase database recovery

## What is verified, and what is not

Read-only QA identity: **bymeopxkxapfizeeqeyb**, PostgreSQL 17.6. Schema/ledger metadata was read through the project-scoped connector, without selecting application user rows or invoking write functions. Production/shared was not queried.

Local repository contains 30 migration files; QA ledger contains 38 entries. The following is an **order/name reconciliation**, not a byte-for-byte semantic equivalence claim. Earlier deployed versions were named/timestamped differently. Never run migration repair merely to make the numbers agree.

| Order | Repository migration | QA ledger entry linked by name/purpose |
|---|---|---|
| 1 | `202609010001_golf_bets_v3.sql` | `20260903085631` |
| 2 | `202609010002_backyard_accounts_legal.sql` | `20260903085657` |
| 3 | `202609020001_cloud_sync_polla_hardening.sql` | `20260903085750` |
| 4 | `202609030001_function_privileges.sql` | `20260903085916`, `20260903132304` |
| 5 | `20260904013601_repair_cloud_profiles_and_permissions.sql` | `20260904132050` |
| 6 | `20260904104145_rules_ai_rate_limit.sql` | `20260904132120` |
| 7 | `20260905060434_add_express_betting_consent.sql` | `20260906061613`, `20260906061910` |
| 8 | `20260906193435_equipment_ball_fitting.sql` | `20260916191229` |
| 9 | `20260906211937_golf_profile_course_architecture.sql` | `20260916191238` |
| 10 | `20260908134650_ai_processing_consents.sql` | `20260916191245` |
| 11 | `202609100001_phase2_social_groups_memberships.sql` | `20260916191302` |
| 12 | `202609100002_phase2_course_handicap_gps.sql` | `20260916191308` |
| 13 | `202609100003_phase2_live_rounds_notifications.sql` | `20260916191316` |
| 14 | `202609100004_phase2_shots_analytics.sql` | `20260916191328` |
| 15 | `20260913175810_group_round_presets.sql` | `20260916191336` |
| 16 | `20260913205122_user_statistics_reset.sql` | `20260916191401` |
| 17 | `20260915114707_user_statistics_reset_idempotency.sql` | `20260916191425` |
| 18 | `20260915183026_social_activity_v3.sql` | `20260916191433` |
| 19 | `20260915203125_account_lifecycle_preview.sql` | `20260916191446` |
| 20 | `20260915203550_social_service_privileges.sql` | `20260916191518` |
| 21 | `20260916020557_ai_consent_onboarding_decisions.sql` | `20260916191525` |
| 22 | `20260916084954_profile_visibility_public_friends.sql` | `20260916191532` |
| 23 | `20260917070829_group_owner_returning_read.sql` | `20260917070829` |
| 24 | `20260917081443_group_email_invitations.sql` | `20260917081443` |
| 25 | `20260917092620_profile_progress_social_connections.sql` | `20260917092620` |
| 26 | `20260917134241_confirmed_round_history_read.sql` | `20260917134241` |
| 27 | `20260917140234_confirmed_participant_index_append.sql` | `20260917140234` |
| 28 | `20260920185147_course_catalog_feedback.sql` | `20260920185147` |
| 29 | `20260921002925_feedback_internal_requests.sql` | `20260921002925` |
| 30 | `20260921013129_feedback_attachment_lifecycle.sql` | `20260921013129` |

Remote entries without a corresponding standalone migration filename:
- `20260904112153` — marketing_waitlist
- `20260904134101` — temporary_http_extension_for_site_healthcheck
- `20260904134306` — public_marketing_site_bucket
- `20260908195537` — legal_evidence_events_append_only
- `20260918122331` — equipment_research_private_staging
- `20260918122608` — equipment_research_private_ingest

These are real recovery dependencies/auxiliary objects, not an instruction to change production. Their exact DDL is not reconstructable from filenames alone. Preserve the whole logical schema/data snapshot. Reconciliation of definitions or a clean migration-only rebuild remains **PENDING_CONTROLLED_DB_APPLY** on a disposable authorized target. No migration or data changes were executed here.

## Schema dependencies

Foundational golf/account/cloud migrations precede equipment/golf profile; consent precedes later onboarding decisions; social/group foundations precede presets/activity/confirmed participant history; catalog and feedback foundation precede internal feedback/attachment lifecycle. Functions/triggers/policies and grants must be restored with their definitions, not just table rows.

Managed auth/storage/realtime schemas and roles are created by compatible Supabase services, not the first application migration. Custom Auth triggers require review alongside app schema. Existing RLS is part of recovery correctness: public had 104/104 tables RLS-enabled and 310 policies. Extensions listed in QA_METADATA must be available or individually reconciled. pg_net/http/Vault dependencies do not exist automatically on plain PostgreSQL.

The migration series contains replacements/privilege changes; not every file is safe to apply twice. Use a ledger/checksummed migration process on a fresh target. Do not concatenate SQL onto an existing restored database or blindly use db push across mismatched ledger dates.

## Generate a backup — no database writes

Install official PostgreSQL 17-compatible clients. Load the explicitly authorized source's connection information into BACKUP_* env vars. QA supports its exact direct endpoint only. The owner source is separately pinned to ref `zhqmlpljloumldaczcfp` and permits either direct `db.zhqmlpljloumldaczcfp.supabase.co` + user `postgres`, or Session Pooler `aws-0-us-east-1.pooler.supabase.com` + user `postgres.zhqmlpljloumldaczcfp`; both require port 5432 and database `postgres`. No other pooler, project ref or user is accepted.

Before connecting, the script validates source/ref/host/user/database/port and removes inherited libpq routing/options. It requires encryption and forces both read-only PostgreSQL startup settings for all commands. Separate psql preflights must return on for SHOW default_transaction_read_only and SHOW transaction_read_only, before the database/schema dump and again before the roles dump; otherwise export aborts. pg_restore only renders the already encrypted archive into encrypted SQL via stdout (`--file=-`), never connects to a restore target. No source DDL, writes, Auth/Storage changes or migrations occur. The new owner allowlist is preparation only, not evidence of a live owner backup.

```sh
npm run backup:database
npm run backup:verify -- /private/snapshot
```

Files (encrypted at rest):
- database/full.dump.enc — pg_dump custom archive; one consistent logical database snapshot.
- database/schema.sql.enc — schema extracted from the same archive.
- database/data.sql.enc — data extracted from the same archive.
- database/roles.sql.enc — roles without role passwords; review platform-managed roles before restoration.
- metadata/manifest.json — source ref, commit, counts/status, hashes and tool version.

Schema-only command: `npm run backup:schema`; it is deliberately an incomplete data recovery artifact. Full pg_dump is not filtered to public: Auth, private, Storage metadata and migration ledger are included **only if the supplied role can read them**. A denied schema causes failure; do not use selective exclusions to claim completeness. DB backups contain PII/password hashes and are never committed.

Vault root/column-encryption keys, platform JWT signing material, provider SMTP/OAuth settings and Storage bytes are NOT recovered just by a raw logical dump. [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups) explains the platform boundary; obtain recovery keys separately without printing them.

## Restore paths — a new isolated target only

There is no auto-restore-to-remote script. This task does not authorize a live DB reset. Decrypt to a NEW private local directory with the explicit acknowledgment (see ENVIRONMENT_VARIABLES).

Inspect first, without any connection:
```sh
pg_restore --list /private/restore/database/full.dump
```

### Plain empty PostgreSQL / compatible self-hosted stack

A developer must first provision compatible roles/extensions/Auth services. Review roles.sql and managed-schema entries in the TOC. On a **new empty disposable target**, after approving the restore plan, PostgreSQL supports:

```sh
pg_restore --exit-on-error --single-transaction --no-owner --dbname=restored_backyard /private/restore/database/full.dump
```

Connection identity/password belong in controlled process environment, not the command. This illustrative target name must be verified as the new local/recovery database, never the source. Do not add --clean. Restoration may require reviewed role/extension adjustments; failure is not permission to drop existing schemas or ignore errors.

### New managed Supabase project

A managed target already has auth/storage system objects; blanket restore of a full archive can conflict. Use the current [Supabase new-project restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) and a reviewed TOC, preserving custom triggers/policies/grants and app data while avoiding duplicate managed baseline objects. Save the reviewed TOC/commands with the incident record. Do not combine a schema restore and all 30 migrations over the same objects. The migration-only route is acceptable only after the remote-only differences above are resolved and verified on an empty target.

Restore app/auth UUID-linked data in one consistent snapshot; restore sequences, FK constraints, policies/triggers and privileges. Never disable RLS globally to pass QA. Reconcile migration ledger by actual definitions/checksums, not count alone. Logical rollback is abandoning the failed disposable target and restoring a fresh one—not deleting or changing the source.

## Catalogs/seeds

Reviewed data under data/ and source IDs/provenance belong in the source snapshot. Existing tools include import-owner-course-catalog.mjs, update-reviewed-course-locations.mjs, import-equipment-source.mjs and import-equipment-master-2010-2026.mjs. The owner course import validates source counts and rating-category ambiguity; location updates reject conflicting coordinates. Supplements and research staging must be recovered, not fabricated.

These imports have their own QA-only guards and some are file generators. Inspect --help/source before use; **do not rerun imports onto restored history** or replace existing verified data. Historical course/tee/equipment snapshots must remain immutable. Restoring the DB snapshot avoids confusing the original 752-card import with subsequently verified supplements.

## Post-restore evidence

Read back schema/ledger/counts and compare with snapshot metadata; FK validation, sequences, functions, indexes, grants, public+private RLS, auth UUID mapping, private Storage ownership, catalog source IDs and frozen historical snapshots. Then use synthetic two-user API/browser QA on the restored stack. SQL success alone does not prove auth/email/Storage behavior. Actual DB dump + restore remains BLOCKED_EXTERNAL until client utilities and dedicated credential/key injection are available; a fresh target drill needs controlled authorization.

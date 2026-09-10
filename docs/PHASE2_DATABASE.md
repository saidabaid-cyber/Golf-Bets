# Phase 2 database plan

## Existing data reused

Phase 2 keeps the existing `profiles`, `rounds_cloud`, cloud-sync payloads, equipment/catalog tables, AI consent ledger and Rules AI limiter. It does not create a second score or betting engine, and it does not rewrite historical round payloads.

## Additive schema files and execution order

An isolated Preview branch cloned from the current shared project must receive these previously unapplied Phase 1 foundations first:

1. `20260906193435_equipment_ball_fitting.sql`
2. `20260906211937_golf_profile_course_architecture.sql`
3. `20260908134650_ai_processing_consents.sql`

Then apply Phase 2 in order:

4. `202609100001_phase2_social_groups_memberships.sql`
   - Social profiles, friend requests/friendships/blocks/recent players.
   - Minimal authenticated username discovery; direct HCP/club profile reads require self or accepted friendship.
   - Groups, memberships, deterministic memories, group/round invites and verified guest claims.
   - Membership assignments, usage counters and explicit admin identities.
5. `202609100002_phase2_course_handicap_gps.sql`
   - Per-player course/tee preferences and immutable Course Handicap snapshots.
6. `202609100003_phase2_live_rounds_notifications.sql`
   - Round participants, immutable operation IDs, private activity and notification preferences/events.
7. `202609100004_phase2_shots_analytics.sql`
   - Optional private shots with club snapshots and privacy-minimized usage events.
   - Explicit-admin aggregate metrics RPC.

Each file has an RLS contract test under `supabase/tests`; `phase2_multiuser_authorization_rls.sql` additionally exercises USER_A, USER_B and ADMIN_TEST behavior in a rolled-back transaction. Anonymous access is denied. Policies derive identity from `auth.uid()`, not request metadata. Invite tokens are stored only as SHA-256 hashes. Guest claims require a signed invitation or administrative review; similarity of name, username or HCP is never sufficient. Run all eight files with `npm run test:rls:preview`; the runner requires distinct Preview/Production refs and rejects a shared target.

## Apply status and release path

- Current status: `PENDING_CONTROLLED_DB_APPLY`.
- None of the three Phase 1 foundations or four Phase 2 migrations was applied by this work.
- Before apply, identify an isolated Preview Supabase project, review all migrations in order, run the paired RLS tests, then execute authenticated negative tests with two non-admin users and one explicit admin.
- If Preview shares Production, do not apply these files as part of a Preview deployment. Provision an isolated project or schedule a separately approved, backed-up, forward-only apply.
- Rollback is forward-fix. The application flags can disable Phase 2 modules without dropping tables or historical data.
- The current shared project records older migrations with server-generated versions that do not match the repository filename timestamps. Do not use `db push --include-all` against a cloned branch. Apply only the seven files above through a migration-recording operation and verify the ledger after every file.

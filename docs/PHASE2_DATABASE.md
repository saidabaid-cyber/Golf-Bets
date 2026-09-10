# Phase 2 database plan

## Existing data reused

Phase 2 keeps the existing `profiles`, `rounds_cloud`, cloud-sync payloads, equipment/catalog tables, AI consent ledger and Rules AI limiter. It does not create a second score or betting engine, and it does not rewrite historical round payloads.

## Additive schema files

1. `202609100001_phase2_social_groups_memberships.sql`
   - Social profiles, friend requests/friendships/blocks/recent players.
   - Minimal authenticated username discovery; direct HCP/club profile reads require self or accepted friendship.
   - Groups, memberships, deterministic memories, group/round invites and verified guest claims.
   - Membership assignments, usage counters and explicit admin identities.
2. `202609100002_phase2_course_handicap_gps.sql`
   - Per-player course/tee preferences and immutable Course Handicap snapshots.
3. `202609100003_phase2_live_rounds_notifications.sql`
   - Round participants, immutable operation IDs, private activity and notification preferences/events.
4. `202609100004_phase2_shots_analytics.sql`
   - Optional private shots with club snapshots and privacy-minimized usage events.
   - Explicit-admin aggregate metrics RPC.

Each file has an RLS contract test under `supabase/tests`. Anonymous access is denied. Policies derive identity from `auth.uid()`, not request metadata. Invite tokens are stored only as SHA-256 hashes. Guest claims require a signed invitation or administrative review; similarity of name, username or HCP is never sufficient.

## Apply status and release path

- Current status: `PENDING_CONTROLLED_DB_APPLY`.
- None of the four Phase 2 migrations was applied by this work.
- Before apply, identify an isolated Preview Supabase project, review all migrations in order, run the paired RLS tests, then execute authenticated negative tests with two non-admin users and one explicit admin.
- If Preview shares Production, do not apply these files as part of a Preview deployment. Provision an isolated project or schedule a separately approved, backed-up, forward-only apply.
- Rollback is forward-fix. The application flags can disable Phase 2 modules without dropping tables or historical data.

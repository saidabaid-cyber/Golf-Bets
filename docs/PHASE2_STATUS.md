# Phase 2 resumable status

Last updated: 2026-09-10 (America/Mexico_City)

| Stage | Branch / SHA | Status | Verification | Next action |
| --- | --- | --- | --- | --- |
| Baseline | `fix/phase1-final-unblock-beta` / `5c278d7d27bcf68883108341503eaff6cf95fe24` | PASS | 1,313 tests, lint and build pass | Freeze Phase 1 references |
| Freeze Phase 1 | `phase2/full-platform` / `5c278d7d27bcf68883108341503eaff6cf95fe24` | PASS | `phase1-final` and `archive/phase1-final` created locally at the exact baseline | Commit architecture/baseline docs |
| Phase 2A | `phase2/full-platform` / `58842c9` | PASS | 1,322 tests and lint pass; social/group/invite domains, Preview UI, memberships and flags implemented | Phase 2B |
| Phase 2B | `phase2/full-platform` / `97c768b` | PASS | 1,329 tests and lint pass; provider search, tee precedence, Course Handicap snapshots, GPS targets/fallbacks, map/export/device boundaries | Phase 2C |
| Phase 2C | `phase2/full-platform` / `27106fb` | PASS | 1,337 tests and lint pass; participant permissions, provider-neutral realtime, idempotent offline queue, cell conflicts, canonical provisional scoreboard, activity and notification foundations | Phase 2D |
| Phase 2D | `phase2/full-platform` | PENDING | Not started | Shots, stats, AI insights, benefits and admin analytics |
| Transversal QA | `phase2/full-platform` | PENDING | Not started | Full product flow and permission checks |
| Full quality gate | `phase2/full-platform` | PENDING | Not started | Full tests, lint and build |
| Preview deploy | `phase2/full-platform` | PENDING | Not started | Push and wait for READY |
| Runtime QA | `phase2/full-platform` | PENDING | Not started | Browser/API/data/UI verification |

## Migration ledger

- `202609100001_phase2_social_groups_memberships.sql` created with RLS, grants, indexes and secure hashed-invite storage.
- `phase2_social_groups_rls.sql` created.
- `202609100002_phase2_course_handicap_gps.sql` and `phase2_course_handicap_rls.sql` created for player/course tee preferences and immutable Course Handicap snapshots.
- `202609100003_phase2_live_rounds_notifications.sql` and `phase2_live_rounds_rls.sql` created for private participants, immutable operations, activity and notification preferences/events.
- Applied: no. Status: `PENDING_CONTROLLED_DB_APPLY` until an isolated Preview Supabase project is confirmed.

## Feature flag ledger

The central registry contains 17 flags. Internal Phase 2 features default on only outside Production; score export, push, wearable and rangefinder default off until their external dependencies are verified.

## External blockers known at baseline

- GolfAPI credentials/license: not present or verified.
- GHIN authorized API: not present; scraping is prohibited.
- Push delivery provider/VAPID configuration: not verified.
- Wearable and rangefinder SDKs: not provided.

These dependencies do not block local contracts, adapters, fixtures, feature flags or tests.

## Resume point

Begin Phase 2D from commit `27106fb`: add optional shot tracking, club-distance thresholds, stats/trends, structured AI insights/live questions and admin aggregate analytics.

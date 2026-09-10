# Phase 1 + Phase 2 final technical closeout

Last updated: 2026-09-10 (America/Mexico_City)

## Resume checkpoint

- Branch: `phase2/full-platform`
- Closeout start SHA: `59132620c603369d9ad0cbacc91d0882c9374578`
- Phase 1 frozen SHA: `5c278d7d27bcf68883108341503eaff6cf95fe24`
- Frozen references: annotated tag `phase1-final` and remote branch `archive/phase1-final` both peel/resolve to the frozen SHA.
- Baseline: 1,367 npm tests passed, 0 failed, 0 skipped; lint passed; production build passed with 28 generated routes.
- Current code SHA before the final documentation commit: `a3766b0`.
- Current stage: independent security/quality and local runtime closeout completed. Next action is the final Preview push/runtime pass; the database stage remains gated on isolated-branch approval.

## Real Supabase audit

| Item | Verified state |
| --- | --- |
| Organization | `wrogzsycxchwakaglbpm` (`saidabaid-cyber's Org`) |
| Shared project | `zhqmlpljloumldaczcfp` (`The Backyard`, `us-east-1`) |
| Health | `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.166 |
| Development branches | None |
| Preview deployment database | The public Preview bundle references the same shared project ref |
| Existing auth users | 11 |
| Existing application data | Present: profiles, players, courses and rounds/scores |
| Equipment/Profile Phase 1 schema | Not applied |
| AI processing consent schema | Not applied |
| Phase 2 schema | Not applied |
| Shared project touched by closeout | No; read-only audit only |

The only available project is shared with existing users/data. It is therefore not a safe target for closeout migrations or destructive/multiuser QA.

Supabase reported a persistent development branch cost of **USD 0.01344/hour** on 2026-09-10. Creating it requires explicit economic approval. Until that approval, the database gate is `PENDING_CONTROLLED_DB_APPLY`; no QA users are created and no DDL is applied to `zhqmlpljloumldaczcfp`.

## Migration execution plan

Create a data-less isolated development branch from `zhqmlpljloumldaczcfp`, record its distinct project ref, and verify that all inherited shared-project migrations are present. Then use Supabase's migration operation so every apply is recorded in the branch migration ledger, in this order:

1. `20260906193435_equipment_ball_fitting.sql`
2. `20260906211937_golf_profile_course_architecture.sql`
3. `20260908134650_ai_processing_consents.sql`
4. `202609100001_phase2_social_groups_memberships.sql`
5. `202609100002_phase2_course_handicap_gps.sql`
6. `202609100003_phase2_live_rounds_notifications.sql`
7. `202609100004_phase2_shots_analytics.sql`

The branch inherits the 13 migrations already recorded on the shared project. Do not replay the older repository migrations with `db push --include-all`: their local filename timestamps differ from the recorded remote versions and blindly replaying them is unsafe. Apply only the seven audited files above, one at a time, then list the branch migration ledger after each apply.

Post-apply gates:

1. Query actual tables, columns, constraints, indexes, RLS enablement, policies, grants and routines.
2. Create Preview-only `USER_A`, `USER_B` and `ADMIN_TEST`; set admin authority through server-controlled `app_metadata`/`app_admins`, never client-controlled metadata.
3. Run `npm run test:rls:preview` with distinct Preview and Production refs. The runner executes seven schema/RLS contracts plus the behavioral multiuser authorization contract, refuses an identical/shared target and does not print the connection secret.
4. Execute authenticated positive and negative multiuser tests for profile/equipment, discovery, friendships, groups, invites, guest claims, rounds, live operations, shots, usage counters and admin aggregates.
5. Point only the `phase2/full-platform` Vercel Preview environment at the isolated project and redeploy. Do not change Production environment variables.

## Current shared migration ledger

The shared project currently records 13 migrations through `20260908195537_legal_evidence_events_append_only`. It does not record any of the seven closeout migrations listed above.

## Current security observations

- RLS is enabled on the existing `polla_join_attempts` and `rules_ai_rate_limits` tables without client policies; they are intended server-only surfaces.
- `is_polla_admin` is an existing `SECURITY DEFINER` helper used by delegated-admin RLS and is executable by authenticated users; no change was made during this audit.
- Leaked-password protection is disabled in the shared Auth configuration. Enabling it is a Production policy decision and was not changed.
- Existing Polla policies trigger performance-advisor warnings for overlapping permissive policies and unused indexes. They were not modified on the shared project.
- Phase 2 membership normalization now fails closed to `FREE` unless `PRO` or `BETA_PRO` is explicitly assigned. The database migration still assigns `BETA_PRO` explicitly to Preview testers as designed.

## Verification matrix

| Gate | Status | Evidence / next action |
| --- | --- | --- |
| Repository baseline | PASS | 1,367/1,367 tests, lint and build |
| Final repository gate | PASS | 1,370/1,370 tests, 0 failed/skipped; lint and build passed |
| Equipment provider | PASS | 1,277 clubs, 310 balls and 474 shafts; required current/historical searches and zero-overlap pagination passed locally |
| Ball Fit engine/API | PASS | Complete 71-candidate universe evaluated; Top 3 returned; no partial ranking |
| PWA public assets | PASS | Manifest, service worker, offline page, 192/512 icons and Apple icon returned HTTP 200 |
| 390/430 px public shell | PASS | No horizontal expansion, browser errors or automated WCAG violations; physical iPhone remains separately gated |
| Phase 1 frozen refs | PASS | Tag and archive resolve to frozen SHA |
| Shared Supabase audit | PASS | Live read-only project, branch, migration, table and advisor queries |
| Isolated Preview database | PENDING_CONTROLLED_DB_APPLY | Approve USD 0.01344/hour branch creation |
| Seven database migrations | PENDING_CONTROLLED_DB_APPLY | Apply only after isolated ref is verified |
| SQL/RLS suite | PENDING_CONTROLLED_DB_APPLY | Eight-file fail-closed runner is versioned |
| Real multiuser DB QA | PENDING_CONTROLLED_DB_APPLY | Requires isolated schema and Preview test users |
| Google OAuth | PENDING_INTERACTIVE_QA | Requires human Google session on final Preview |
| Physical iPhone/PWA | PENDING_DEVICE_QA | Browser emulation is not a physical-device test |
| GolfAPI | BLOCKED_EXTERNAL | Requires licensed credentials |
| GHIN | BLOCKED_EXTERNAL | Requires authorized official API access; no scraping |
| Push delivery | BLOCKED_EXTERNAL | Requires approved provider/VAPID configuration |
| Wearable | BLOCKED_EXTERNAL | Requires a supported SDK/device agreement |
| Rangefinder | BLOCKED_EXTERNAL | Requires a supported SDK/device agreement |
| Phase 2 privacy scope | LEGAL_REVIEW_REQUIRED | Social graph, groups/invites, geolocation/shot coordinates, notification tokens, analytics, guest linking and AI insights |

## Exact next action after approval

Supabase → organization `wrogzsycxchwakaglbpm` → project `The Backyard` → Branching → create a persistent development branch named `The Backyard Preview` → approve USD 0.01344/hour → provide/record the new branch project ref. Do not seed Production user data into the branch.

Then resume at **Migration execution plan, step 1**. Do not promote to Beta or Production. The post-legal-gate product flow and Google OAuth remain human-interactive checks; never accept age, arbitration or data-processing declarations on a user's behalf just to traverse the gate.

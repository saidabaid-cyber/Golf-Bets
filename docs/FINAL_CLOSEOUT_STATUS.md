# Phase 1 + Phase 2 final technical closeout

Last updated: 2026-09-10 (America/Mexico_City)

## Resume checkpoint

- Branch: `phase2/full-platform`
- Closeout start SHA: `59132620c603369d9ad0cbacc91d0882c9374578`
- Phase 1 frozen SHA: `5c278d7d27bcf68883108341503eaff6cf95fe24`
- Frozen references: annotated tag `phase1-final` and remote branch `archive/phase1-final` both peel/resolve to the frozen SHA.
- Baseline: 1,367 npm tests passed, 0 failed, 0 skipped; lint passed; production build passed with 28 generated routes.
- Verified code SHA before this status update: `1dc3ea1c76d6ce4a8e3d4cc8dd5f410e59b2a2f5`.
- Current stage: independent security/quality and Preview runtime closeout completed. The database stage remains gated on isolated-branch approval; post-consent account flows remain human-interactive.

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
| Final repository gate | PASS | 1,371/1,371 tests, 0 failed/skipped; lint and build passed after the stable-ID pagination fix |
| Equipment provider | PASS | Preview API exhaustively returned 1,276/1,276 unique clubs, 310/310 balls and 474/474 shafts; required current/historical searches passed. Two sourced SM11 rows shared one stable ID and are now merged field-by-field instead of making cursor pagination ambiguous. |
| Ball Fit engine/API | PASS | Complete 71-candidate universe evaluated; Top 3 returned; no partial ranking |
| PWA public assets | PASS | Manifest, service worker, offline page, 192/512 icons and Apple icon returned HTTP 200 |
| 390/430 px public shell | PASS | No horizontal expansion, browser errors or console errors; semantic interactive snapshot is intact. Physical iPhone remains separately gated. |
| Vercel code Preview | PASS | GitHub deployment `6379963652`; immutable URL `https://golf-bets-g93tm5rny-saha8.vercel.app`; SHA `1dc3ea1c76d6ce4a8e3d4cc8dd5f410e59b2a2f5`; completed successfully. Branch alias and immutable API response hashes match. |
| Preview AI status | PASS | Round Setup, Card AI, Launch Monitor AI, Insights and Live Question all report `enabled=true`, `configured=true`, `state=ready`; Phase 2 AI flags are enabled. |
| Card AI real POST | PASS | Synthetic no-PII PNG: HTTP 200, 2 players, 18 cells and 9 pars extracted through vision/Structured Output. |
| Launch Monitor real POST | PASS | Two synthetic no-PII images: HTTP 200 and 2 structured shots. |
| AI Insights / live question real POST | PASS | Synthetic aggregates and deterministic facts each returned HTTP 200 with validated structured output. |
| Round Setup requested real POST | PENDING_INTERACTIVE_QA | The automated execution environment rejected sending the requested names and game amounts to an external AI provider. GET readiness and all local structured/canonical tests pass; execute this exact user-authorized payload interactively from the Preview. |
| Preview HTTP runtime | PASS | Home, Legal V6/V2, simplified privacy, feature registry, catalogs, course search, PWA assets and AI routes returned expected statuses; negative contracts returned 400/401/403/404/422 with no unexpected 5xx. |
| Private Vercel Runtime Logs | BLOCKED_EXTERNAL | No Vercel CLI session/token is available on this machine. Public GitHub/Vercel deployment metadata and HTTP runtime are verified, but the private log stream cannot be queried. |
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

For private Vercel log verification: Vercel → Team `saha8` → Project `golf-bets` → Deployment for SHA `1dc3ea1c76d6ce4a8e3d4cc8dd5f410e59b2a2f5` → Runtime Logs, or authenticate the CLI with a project-scoped read token and run `vercel logs https://golf-bets-g93tm5rny-saha8.vercel.app --level error --since 1h`.

## Priority UX correction — 2026-09-10

- Starting SHA: `e141fce206a3b81f758d189a609af032f86ae2f0`.
- Guided Mi Bolsa flow now separates category, brand, model, manufacturer shaft options, specifications and review; Ball and Shaft selection use the same anchored, server-paginated interaction and retain manual fallbacks.
- A reusable accessible anchored search now serves profile club, round course, equipment and social discovery. Results stay attached to the active input and do not load a complete catalog client-side.
- Onboarding keeps one Quick/Complete decision, starts group names blank and explains Private versus Invite-only. Invite-link UI is deliberately disabled until the isolated Preview DB can enforce hashed tokens, identity, expiry and revocation.
- Linked/profile players receive immutable WHS Course Handicap snapshots from Index, tee, slope, rating and par; Guest/manual HCP remains manual. Missing verified tee inputs never produce an invented handicap.
- Group bet templates retain decimal amounts, HCP rounding, Foursome modes/segments/presses and existing Personal editors; no Phase 1 engine arithmetic changed.
- Account deletion now requires an explicit all-data checkbox plus `ELIMINAR` and describes server-confirmed deletion versus referential anonymization.
- Existing native emoji avatar, visible disabled GHIN action, unconfirmed score/putt controls, Ball Fit exit and modal close behavior were re-audited rather than duplicated.

Final local gate at code SHA `ecae2d790e67131db4b15788b5cb40dc5fd8cad7`: 1,379/1,379 npm tests passed, 0 failed/skipped; lint passed; Next production build passed with 28 pages. Local HTTP checks returned paginated TaylorMade drivers, Ventus shafts, Pro V1 2025 balls and La Vista courses. Browser automation at 390 and 430 CSS pixels found no horizontal expansion or JavaScript errors on the public shell.

Remaining gates are intentionally separate: `PENDING_CONTROLLED_DB_APPLY` for authenticated cloud deletion, group invitations and persistence; `PENDING_INTERACTIVE_QA` for post-consent tap-through; `PENDING_DEVICE_QA` for physical iPhone keyboard/safe-area behavior; `BLOCKED_EXTERNAL` for official GHIN and private Vercel logs. Shared Supabase was not written.

The resulting branch Preview at `https://golf-bets-git-phase2-full-platform-saha8.vercel.app` returned HTTP 200. Its public bundles contain the new playing-HCP, group-privacy and account-deletion behavior; catalog, course and AI readiness endpoints passed. Browser automation on the deployed alias repeated the 390/430 px no-overflow check with no page or console errors. No custom domain was changed.

## Delivered Home and owner pending list — 2026-09-11

- Starting SHA: `a68b1b1a21af7d756c4cb479f7fce1002795bb96`.
- The delivered ZIP was validated at SHA-256 `F686C63E5FDA3A3476970274038DD032C8CCD766CFC170AC5C858165371B478A`. Its expected Home blob matched the branch before applying the three declared app files.
- Home is integrated in commit `9a6ca04`: one context-aware primary action, active-round priority, no empty metrics/activity/duplicate first-round prompt and all existing navigation contracts preserved.
- Equipment pickers now obtain brand facets over the complete catalog rather than inferring them from the first 50 models. Historical items are included from the first screen, and missing handedness is treated as unknown instead of impossible.
- Catalog media accepts only explicit HTTPS URLs with optional source/license metadata. Current licensed-image coverage is zero, so clean fallbacks are used and E04 is `BLOCKED_EXTERNAL` pending a licensed image manifest.
- Linked-player Course Handicap snapshots now freeze when play starts; Guest/manual HCP remains unchanged.
- Wizard/modal steps reset their own scroll, avoid keyboard focus jumps and restore the opening context. Eleven dialog-bearing components were audited for an explicit close action.
- Detailed acceptance evidence and remaining gates are maintained in `docs/OWNER_QA_CHECKLIST.md`.
- Local quality gate after the closeout implementation: 1,391/1,391 npm tests passed with no failures or skips; lint passed; Next 16.3.3 production build passed with 28 generated pages.

### Delivered Home Preview evidence

- Preview deployment: GitHub `6388079614`, environment `Preview`, production flag `false`, SHA `8a023491d0624b71329b9c11c98ea75aa8177afb`.
- Immutable URL: `https://golf-bets-9y6y7g80q-saha8.vercel.app`.
- Browser QA: isolated synthetic guest contexts for new account, active setup and completed history at 390 and 430 CSS px. All six states hydrated, matched their context CTA, had no horizontal overflow and produced no console errors.
- Runtime contracts: 910D3, Stealth 2 Plus, Nike Vapor Fly, Pro V1 2025, VENTUS Blue VeloCore+ and PING Alta CB searches returned results from `backyard-equipment-seed`; the Driver facet returned 13 brands; La Vista returned five internal course/tee matches; Round Setup and Card AI reported `enabled=true`, `configured=true`, `state=ready`.
- Reproducible command: `node scripts/qa-home-browser.mjs <immutable-preview-url> <artifact-directory>`.
- Screenshots are stored outside the repository in the requested evidence workspace as `home-preview-{390,430}.png`, `home-preview-active-{390,430}.png` and `home-preview-history-{390,430}.png`.

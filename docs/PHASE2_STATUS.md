# Phase 2 resumable status

Last updated: 2026-09-10 (America/Mexico_City)

| Stage | Branch / SHA | Status | Verification | Next action |
| --- | --- | --- | --- | --- |
| Baseline | `fix/phase1-final-unblock-beta` / `5c278d7d27bcf68883108341503eaff6cf95fe24` | PASS | 1,313 tests, lint and build pass | Freeze Phase 1 references |
| Freeze Phase 1 | `phase2/full-platform` / `5c278d7d27bcf68883108341503eaff6cf95fe24` | PASS | `phase1-final` and `archive/phase1-final` created locally at the exact baseline | Commit architecture/baseline docs |
| Phase 2A | `phase2/full-platform` / `58842c9` | PASS | 1,322 tests and lint pass; social/group/invite domains, Preview UI, memberships and flags implemented | Phase 2B |
| Phase 2B | `phase2/full-platform` / `97c768b` | PASS | 1,329 tests and lint pass; provider search, tee precedence, Course Handicap snapshots, GPS targets/fallbacks, map/export/device boundaries | Phase 2C |
| Phase 2C | `phase2/full-platform` / `27106fb` | PASS | 1,337 tests and lint pass; participant permissions, provider-neutral realtime, idempotent offline queue, cell conflicts, canonical provisional scoreboard, activity and notification foundations | Phase 2D |
| Phase 2D | `phase2/full-platform` / `8939035` | PASS | 1,350 tests, lint and build pass; optional shot lifecycle, immutable bag snapshots, GPS accuracy guard, club sample thresholds, filters/trends, aggregate-only AI insights, deterministic live questions, analytics and admin aggregates | Transversal QA |
| Transversal QA | `phase2/full-platform` / `53fbdc1` | PASS | Cross-domain contract/regression tests plus local HTTP smoke: Home, Membership, Legal, features, course pagination, PWA and unauthorized Social/Admin behavior | Push Preview branch |
| Full quality gate | `phase2/full-platform` / `53fbdc1` | PASS | 1,350 passed, 0 failed, 0 skipped; lint PASS; Next production build PASS (28 routes) | Push Preview branch |
| Preview deploy | `phase2/full-platform` / `f5726d7` | PASS | Vercel Preview completed successfully; GitHub deployment `6373173612`, Vercel deployment `8nM82BgRwgz4wnaXVdKnuDSiW89C`, branch alias HTTP 200 | Runtime QA |
| Runtime QA | `phase2/full-platform` / `f5726d7` | PASS | Live GETs and real OpenAI POSTs pass for Round Setup, Card AI, Launch Monitor AI, Insights and deterministic live questions; expected unauthenticated 401/405 contracts verified | Controlled DB apply and human/device QA remain gated |
| Security closeout | `phase2/full-platform` / `17a3a66` | PASS | Username discovery returns only minimal identity fields; full HCP/club profile rows require self or accepted friendship. Full 1,350-test suite, lint and build pass | Final Preview deploy |
| Hard closeout baseline | `phase2/full-platform` / `ed21c7dbdfd898def114ba322b0ece6bb8858dce` | PASS | Clean tree; remote refs fetched; attached ZIP validated (SHA-256 `570D46614DB1213E71EF126710C736A7B3876EBFB28B95523F0AC59AD3D1BD36`) | Import Equipment master |
| Equipment master 2010–2026 | `phase2/full-platform` / `d3facee` | PASS | 1,202 club and 285 ball source rows accepted; merged provider has 1,277 clubs, 310 balls and 48 shafts; historical search, pagination, generation and Plus-variant tests pass | Hard-closeout UX |
| Hard-closeout UX | `phase2/full-platform` / `a6ef0ea` | PASS | Server-side club search; native emoji avatar; disabled GHIN provider UI; single onboarding choice; explicit score/putt confirmation; shared modal close control and audit | Final quality gate |
| Hard-closeout quality gate | `phase2/full-platform` / `f34077c` | PASS | 1,358 passed, 0 failed, 0 skipped; lint PASS; Next production build PASS (28 pages) | Push and final Preview QA |
| Hard-closeout Preview | `phase2/full-platform` / `d24f4b4` | PASS | Vercel deployment `62oHsFfJnZVxFo2DacfmAf75G3RM`, GitHub deployment `6376800017`, immutable URL HTTP 200 and READY | Runtime QA |
| Hard-closeout runtime QA | `phase2/full-platform` / `d24f4b4` | PASS | Historical club/ball searches and zero-overlap pagination pass; club search returns La Vista; Ball Fit evaluates all 71 eligible candidates and returns Top 3; AI GET endpoints ready; 390/430px shell has no horizontal expansion or browser errors | Push brand-alias follow-up and verify final Preview |
| Hard-closeout final verification | `phase2/full-platform` / `50d551e` | PASS | Vercel deployment `QYbSSEMgDxruaXWgLkXCV43SMMur`, GitHub deployment `6377074955`, immutable Preview `golf-bets-reh350k2l-saha8.vercel.app`; Home/branch alias 200, catalog and Ball Fit smoke pass, AI GET endpoints ready, 390px browser runtime has no JS errors | Human/device review |
| Shaft master baseline | `phase2/full-platform` / `2d82fb085e0102c434b3459e79bafb6217c20d12` | PASS | Clean tree and synced remote; attached ZIP integrity and JSON/CSV/XLSX consistency verified: 467 rows, 21 brands, 80 fit-eligible and 13 OEM-stock | Import and merge shaft master |
| Shaft master 2010–2026 | `phase2/full-platform` / `2d093b104529af80a9b9fc775ed371b50fcd843b` | PASS | Field-level merge retains legacy IDs and source priority; provider has 474 shafts, 21 brands, 41 aliases, 203 current, 271 historical and 80 fit-eligible; Mi Bolsa supports remote search, manufacturer flex/weight selection and manual fallback | Preview/runtime verification |
| Shaft Preview QA | `phase2/full-platform` / `2d093b104529af80a9b9fc775ed371b50fcd843b` | PASS | 1,367 passed, 0 failed, 0 skipped; lint/build pass; deployment `3JjVwEZtBa86eAxThWXorBSnKW1E` completed; required historical/current queries and zero-overlap pagination pass on the branch alias; 390px shell has no horizontal expansion or browser errors | Human Mi Bolsa review after the user accepts the legal gate |

## Migration ledger

- `202609100001_phase2_social_groups_memberships.sql` created with RLS, grants, indexes, secure hashed-invite storage and a minimal authenticated username-discovery RPC.
- `phase2_social_groups_rls.sql` created.
- `202609100002_phase2_course_handicap_gps.sql` and `phase2_course_handicap_rls.sql` created for player/course tee preferences and immutable Course Handicap snapshots.
- `202609100003_phase2_live_rounds_notifications.sql` and `phase2_live_rounds_rls.sql` created for private participants, immutable operations, activity and notification preferences/events.
- `202609100004_phase2_shots_analytics.sql` and `phase2_shots_analytics_rls.sql` created for private shot snapshots, privacy-minimized idempotent usage events and explicit-admin aggregate metrics.
- Applied: no. Status: `PENDING_CONTROLLED_DB_APPLY` until an isolated Preview Supabase project is confirmed.

## Feature flag ledger

The central registry contains 18 flags. Internal Phase 2 features default on only outside Production; GHIN, score export, push, wearable and rangefinder default off until their external dependencies are verified.

## External blockers known at baseline

- GolfAPI credentials/license: not present or verified.
- GHIN authorized API: not present; scraping is prohibited.
- Push delivery provider/VAPID configuration: not verified.
- Wearable and rangefinder SDKs: not provided.

These dependencies do not block local contracts, adapters, fixtures, feature flags or tests.

## Resume point

Shaft master closeout is ready for human review. The versioned provider and API are verified on Preview; complete the Mi Bolsa touch flow only after the user accepts the legal gate, and verify the physical selector on an iPhone as `PENDING_INTERACTIVE_QA` / `PENDING_DEVICE_QA`. Apply the four existing migrations only after confirming an isolated Preview Supabase project. Do not promote or connect a custom domain before those controlled gates are approved.

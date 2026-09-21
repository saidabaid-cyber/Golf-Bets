# Release reconciliation — 2026-09-21

## Scope and evidence boundary

Repository `saidabaid-cyber/Golf-Bets`; branch `phase2/course-catalog-feedback`.
Initial remote/local SHA after fetch: `7a3f7df86fa1aa8fe29ff247f72f9f674ab452fd`.
Remote `phase2/full-platform` remains `97fe6f3c9258c4336a9bd3e65d99694a2f1dbff5`.
Actual divergence: **28 ahead, 0 behind**; 126 files, 4,310 insertions / 213 deletions before this reconciliation.
The previous reports are retained as historical evidence, not promoted to evidence for a different deployment.
Final deployment SHA/URL and its runtime results are recorded in the final handoff and ignored QA artifacts after READY. No document-only commit is made after that QA, so the tested SHA remains the delivered SHA.

## Commit inventory and inspected implementation

| Commit | Implementation inspected (not just commit title) |
|---|---|
| 7f0b9e6 | Additive course schema/import RPC, course/tee provenance, independent nine ratings, frozen player cards in score/handicap/statistics consumers. |
| 41298ec | Authenticated catalog route, Play/course/total entry wiring, contextual feedback; no alternate round database. |
| ca75d3b | Initial QA/import/deployment limitations; superseded counts retained as historical observations. |
| 3bc7c57 | Git Preview deployment gate; no Production variables or domains in config. |
| 609c532 | Enable only catalog branch Git deployment after QA environment setup. |
| 275ae57 | Geolocation request independent of catalog fetch, cancel/unmount handling and bounded browser callbacks. |
| b851ec3 | Sourced location files and six card supplements with yards/par/SI and preserved limitations. |
| 701c10e | Explicit unapplied-data report; not evidence that SQL had been applied. |
| d382991 | Float8 serialization-only tolerance; changed coordinates still rejected. |
| 2c2b544 | Authenticated catalog/cloud runner, nine mode/nine-hole fixtures and immutable snapshot comparisons. |
| a4d3fed | Feedback DB-first workflow, server-only writes, private bucket, attachment validation, secondary mail. |
| 2766475 | Seven sourced locations, 62 remaining locations inventory, simplified picker. |
| 26695c9 | Private attachment lease/cleanup manifest and repeatable live feedback QA. |
| 64037b8 | OAuth single-flight exchange/start guard; server onboarding progress; course/index/permission steps. |
| cc01076 | Park unfinished rounds in same history, restore same ID/scores, soft close; score-only bypasses money engines. |
| 1f55e14 | Server checkpoint and lifecycle fixture verification, contract tests. |
| 7c4e4ef | Inline onboarding search results, not hidden behind sticky footer. |
| eb88fcf | Automatic account-owner seed is not a configured round; actual edited drafts retain preservation guard. |
| e5b0581 | Shared editorial CSS tokens, stylesheet imported once from layout. |
| b2ceba1 | Existing Home/login/play/equipment/social surfaces; no new model/formula. |
| 8425fe3 | Visual/play action regression contracts. |
| cf28e1d | Active Home content height/reachability. |
| 18efd5f | Product status/media and Rules disclosure navigation; provider unavailable remains explicit. |
| df71b4a | Four account destinations and hidden technical QR URL; sharing retains stable account UUID. |
| 3ac3851 | Existing synthetic-account, fresh-session and A/B read-only runtime runner. |
| d8d63e7 | Account section included in React component identity to prevent retained wrong section. |
| 32a5db4 | Membership Back uses existing accessible CTA/safe area, no entitlement/payment changes. |
| 7a3f7df | Prior release report with explicit physical/interactive/legal limitations. |

## Code / DB reconciliation

| Area | Requirement / code | Real DB readback | Runtime verification required on final SHA |
|---|---|---|---|
| Auth | Same verified identity; single-use PKCE; existing/new mapping, AI consent fail-closed only for AI | Existing synthetic accounts; no Auth configuration changes | Synthetic session/readback; human Google/OTP remains PENDING_INTERACTIVE_QA |
| Onboarding | Quick and complete both visit course/index, optional device permissions; checkpoint separate from authorization | Checkpoint metadata already used by existing fixtures | Do not accept legal terms/AI consents for owner; full new-account path PENDING_INTERACTIVE_QA |
| Settings | Shared completion API; separate four destinations; reused profile editor | Preferences, completion, index metadata, private profile | Compare fresh sessions; inspect each section, 390/430/desktop |
| Rounds | Three modes, preserve live vs cancelled, historical identity unchanged | Existing mode/nine/tee and paused-round fixtures | Read-only fixture verification plus non-destructive navigation; no old round changes |
| Courses | Reviewed relational catalog, local Haversine, aliases, category-null rating restriction | **153 clubs / 176 courses / 769 tees / 91 geolocated / 758 complete / 11 incomplete / 1,538 nine ratings** | Authenticated API actual sums, seven additions, six supplements, ten simulated cities |
| Equipment | Backend versioned seed provider, paginated API; user CAS snapshot in Supabase | `golf_*_catalog` SQL tables contain **0** rows. This is not the API's configured provider. | Compare every API item against deployed source: 1,276 clubs, 310 balls, 474 shafts, generations/eligibility/pinned IDs; user equipment fresh-session readback |
| Feedback | Internal request saved first, image private, notification secondary | Three migrations present; private requests/bucket available | Existing idempotency IDs replay, image ownership, no mail or consent writes |
| Social/QR | Stable UUID, graph/requests/groups; privacy and notice APIs | Existing tables/RLS and canonical memberships | A/B readback, scoped settings; no real emails |
| Rules/AI | Existing navigation/source catalog and readiness | No new AI schema or approval | Readiness/disabled states; do not claim provider response from GET alone |

### Migrations since baseline (all already applied)

| File | Required / safety / repeat / rollback |
|---|---|
| `20260920185147_course_catalog_feedback.sql` | Catalog metadata, independent nine ratings, import RPC and first feedback structure. Additive; normal migration ledger application once, not raw DDL replay. Import RPC is content-hash/advisory-lock idempotent, different source conflicts fail. Private course provider gated to exact QA ref. Logical rollback: disable reviewed provider, retain snapshots; no destructive rollback performed. |
| `20260921002925_feedback_internal_requests.sql` | Additive request workflow, actor/payload idempotency, rate limit, owner read and private attachment bucket. Normal DDL ledger application once. Request replay is idempotent; admin notes and client mutation forbidden. Logical rollback: stop new intake, retain requests privately; no data deletion. |
| `20260921013129_feedback_attachment_lifecycle.sql` | Replaces leased storage-manifest function to include private feedback prefix only for authorized delete job, not archive. No cleanup executed by migration. Function replacement repeatable; ledger already applied. No existing historical data changed. |

Seven additional locations really exist in QA: source IDs `ghin:23167`, `ghin:23170`, `ghin:24742`, `ghin:25257`, `ghin:25683`, `ghin:9`, `ghin:23247`; coordinates and source URLs compared against `course-location-support-closeout.json`.
Six supplements remain: `ghin:31612` GOLD/BLACK/COPPER (6,775/7,218/5,859 yd), `ghin:36036` DORADAS/AZULES/BLANCAS (1,922/2,868/2,578 yd); each has 18 supplied card positions and correct sum. No physical-hole count or rating category invented. Original source evidence retained.
**No migration/import/location/card write is necessary in this reconciliation.** Original import scripts are not replayed merely to prove a ledger entry.

## Fixes made in this reconciliation

1. Nearest verified clubs could be hundreds of km away but always called “campos cercanos”. Keep the closest three selectable and distance sorting intact; show an explicit warning and per-card label above 100 km (the existing nearby search default). Distance remains geographic and calculated locally; no location sent or stored.
2. Existing social-sharing and notification controls were only accessible together under Social. Wire the same server-backed component into **Privacidad** (sharing only) and **Notificaciones** (notice types only), without duplicating state/APIs or changing saved choices.
3. Account lacked a direct name/username editing entry. Reuse the existing profile editor and return to Account correctly; no new profile, ownership or save path.
4. Catalog QA report previously printed some expected constants rather than summing the returned API rows. It now derives all totals and asserts them before reporting. Added exhaustive equipment API/source and fresh-session reconciliation runner.
5. Real 390 px browser inspection found community actions in Más putting text into an absent icon's 44 px grid column. Give only these existing text/chevron cards two columns; preserve all six destinations and the separate icon/tool layout. Regression renders the real component and invokes each existing callback; final browser must verify the actual text width and wrapping.

## Verification protocol / honest limits

- Initial regression at code gate: **2,151/2,151 PASS**, no fail/skipped/cancelled; TypeScript, ESLint, Next distribution build. A later browser-discovered layout regression adds one test; repeat all gates and final runtime on the new SHA. Final handoff records final execution.
- `qa-release-readback.mjs`: private profile/equipment/history and two-user isolation, no mutations.
- `qa-course-catalog-live.mjs --verify-created`: read existing 9 fixtures, preserve all historical hashes, ten geographic cases, actual catalog totals.
- `qa-ux-round-onboarding.mjs --verify-browser-lifecycle`: read persisted soft-close fixture, scores/putts/playMode and other-user denial; does not execute its preparation/write path.
- `qa-release-reconciliation.mjs`: full paginated equipment records match versioned data; actual location evidence; social/preferences/consent fresh-session readback; readiness not confused with provider execution.
- `qa-feedback-live.mjs`: requires mailer unavailable before any request; repeat existing synthetic request IDs, no real email. Replayed request != newly created feedback.
- Nine existing DB RLS scripts: transaction-scoped, fixed synthetic collision precheck, final rollback. No old historical rows modified. Any temporary fixtures must have zero rows after rollback.
- Browser: final immutable URL only, 390/430 and desktop; inspect Home/Profile/Settings/Play/Courses/Equipment/Feedback/Social/Rules, safe exit and hidden-overflow checks.
- Capture final deployment metadata, require exact branch/SHA/READY. Runtime logs belong to that deployment only.

Not claimed: physical Safari/PWA/keyboard/QR camera/Web Share (**PENDING_DEVICE_QA**); real OTP/email delivery/Google selector and all new-user paths (**PENDING_INTERACTIVE_QA**); Apple/GHIN/push/Rules provider or mailer when disabled (**BLOCKED_EXTERNAL**); unverified 62 club locations, 11 cards and ambiguous rating categories remain unavailable/restricted, never fabricated; commercial data rights, terms/privacy/AI/retention (**LEGAL_REVIEW_REQUIRED**).
Preferences currently implement high contrast; language is fixed Spanish and yardage is the existing unit, not new language/unit selectors. Email/reminder delivery is not asserted from an in-app notice toggle. This audit does not manufacture unavailable controls to claim broader support.

No main/beta/Production/domain/DNS/productive secret/Auth change. No owner account, real email, or historical round deletion. React/Next guidance used for scoped shared controls, retained component state and accessible rendering; Supabase guidance for DB-enforced ownership and explicit readback.

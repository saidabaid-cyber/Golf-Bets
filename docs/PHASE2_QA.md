# Phase 2 quality record

Date: 2026-09-10 (America/Mexico_City)

## Automated quality gate

- Branch: `phase2/full-platform`
- Phase 1 baseline: `5c278d7d27bcf68883108341503eaff6cf95fe24`
- Phase 2D checkpoint: `8939035`
- Full suite: PASS — 1,350 passed, 0 failed, 0 skipped.
- Lint: PASS — ESLint completed with no warnings or errors.
- Production build: PASS — Next.js compiled, typechecked and generated 28 routes.
- Phase 1 bet-engine regressions remain in the full suite; the live scoreboard consumes their deterministic balances and rejects a non-zero-sum snapshot.

## Local runtime smoke test

The application was started with the existing local environment; no environment values were changed.

| Check | Result | Notes |
| --- | --- | --- |
| `/` | PASS | HTTP 200 |
| `/membership` | PASS | HTTP 200; comparison UI is reachable |
| `/legal/privacy` | PASS | HTTP 200 and `2026-09-08-v6` present |
| `/legal/terms` | PASS | HTTP 200 and `2026-09-08-v2` present |
| `/api/features` | PASS | HTTP 200; internal Preview flags on and external-device/export flags off |
| `/api/courses/search?q=La%20Vista&limit=2` | PASS | Provider `backyard-internal`; 5 results, 2 returned, `hasMore=true` |
| unauthenticated Social search | PASS | HTTP 401, as required |
| unauthenticated Admin metrics | PASS | HTTP 401, as required |
| PWA manifest | PASS | HTTP 200 |
| service worker | PASS | HTTP 200; existing offline regression suite passes |
| local AI status | BLOCKED_EXTERNAL | Local `.env.local` has AI disabled; Preview runtime must be verified after deployment |

## Cross-domain behavior verified by tests

- Social: username normalization, duplicate request prevention, recipient-only acceptance, remove/block and frequent/recent ranking.
- Groups: owner/admin permissions, member dedupe, deterministic group memory and review-before-play.
- Invites/guest claims: secure token contract, expiry, revocation, identity binding and no name-based auto-claim.
- Courses/tees: provider pagination, per-player precedence and immutable snapshots.
- Handicap: deterministic Course Handicap inputs/formula/version snapshot; HCP capped at 36.
- GPS: explicit permission states, front/center/back only from supplied coordinates, non-blocking fallback and conservative hole suggestions.
- Live: provider-neutral subscription contract, participant permissions, idempotent operations, persistent offline queue, per-cell conflicts and provisional deterministic scoreboard.
- Shots: optional manual/GPS lifecycle, correction/cancel, immutable club snapshot and no distance when GPS accuracy is inadequate.
- Stats: direct versus derived inputs, 5/10/20/season/all windows, course/tee filters and minimum-sample trends.
- AI: strict aggregate/action schemas; no score, HCP, winner or monetary calculation by the model.
- Membership: FREE/PRO/BETA_PRO registry; BETA_PRO is unlimited and no paywall or billing exists.
- Analytics/Admin: metadata allowlist strips PII/prompts/coordinates; admin endpoint requires authenticated explicit authorization and returns counts only.

## Verification that still requires the final Preview

- Authenticated Social/Groups/Live persistence after controlled migration apply.
- Google OAuth and camera/GPS permission prompts.
- Physical Safari iPhone/PWA/shot-GPS behavior.

## Vercel Preview runtime QA

- Branch alias: `https://golf-bets-git-phase2-full-platform-saha8.vercel.app`
- Deployed commit: `f5726d7ee9c525006b954e0f8ce830bcdee7b640`
- Deployment state: PASS — Vercel/GitHub deployment completed successfully.
- Home, Membership, Legal V6/V2, Simplified Privacy, PWA manifest and service worker: HTTP 200.
- Phase 2 feature registry: HTTP 200; internal Preview modules enabled and external score-export/push/wearable/rangefinder flags disabled.
- Course search: HTTP 200 with provider-backed paginated results.
- Round Setup, Card AI, Insights, Live Question and Launch Monitor status: `enabled=true`, `configured=true`, `state=ready`.
- Unauthenticated Social search and Admin metrics: HTTP 401 as designed.
- Analytics GET: HTTP 405 as designed because the ingestion contract is POST-only.

### Real provider requests

All image fixtures were generated temporarily for QA, contained no personal data and were not committed.

| Request | Result | Evidence |
| --- | --- | --- |
| Round Setup AI | PASS | HTTP 200 in 3,990 ms; exact Spanish input returned a schema-valid, canonical command with no fallback path |
| Card AI, readable 9-hole card | PASS | HTTP 200 in 9,035 ms; 4 players, 36 score cells and 9 par cells extracted |
| Card AI, partially obscured card | PASS | HTTP 200 in 9,236 ms; 33 confident cells preserved and exactly 3 ambiguous cells retained for review |
| Launch Monitor AI | PASS | HTTP 200 in 3,499 ms; two images yielded two schema-valid shots |
| Golf Insights | PASS | HTTP 200 in 2,530 ms; schema-valid explanation from privacy-minimized aggregates |
| Live round question | PASS | HTTP 200 in 4,361 ms; schema-valid explanation from precomputed deterministic facts |

The provider path is OpenAI-only and contains no local semantic fallback. The effective model identifier is intentionally not exposed by public endpoints; code defaults to `gpt-5.4-mini` unless an approved Preview override is present. Direct Vercel runtime-log access was unavailable in this execution environment, so the exact override value was not asserted.

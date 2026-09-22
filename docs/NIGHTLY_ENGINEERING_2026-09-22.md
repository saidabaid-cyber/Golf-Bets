# The Backyard nightly engineering — 22 September 2026

Frozen owner base: `8fe4379d4afa034bc1dd6b37fcd058046ed669c3`.
Integration branch: `phase2/nightly-core-ai-games-2026-09-22`.
Stable owner branch is not an integration target.

## Deliverables

- Core: [persistence and sync stress matrix](NIGHTLY_CORE_RELIABILITY_2026-09-22.md),
  24 new tests covering deterministic outage schedules, two-session conflicts,
  account isolation, retries, lifecycle, immutable historical cards and no-bet capture.
- Games: [23-modality matrix](NIGHTLY_GAMES_ENGINE_2026-09-22.md), 924 new tests,
  779 matrix cases and 1,728 independent Monkey combinations. Invalid capture guards
  are hardened without changing valid historical formulas.
- AI: [structured controller contract](../lib/backyard-ai/runtime/STRUCTURED_ACTIONS.md),
  21 versioned actions and 59 new tests. This is an opt-in engineering controller;
  existing UI is not switched automatically. Host persistence must atomically
  store state and receipts and refresh after external revisions. Results always
  use the trusted existing engine adapter, never model arithmetic.
- Vision: [gated review pipeline](NIGHTLY_SCORECARD_VISION_2026-09-22.md), 23 new
  contract/fixture tests, editable review, verified tee selection, exact revision
  confirmation and deferred-consent safety. `scorecard_vision_v1=false` by default.
- Data: [derived gaps](NIGHTLY_DATA_QUALITY_2026-09-22.md), 11 integrity tests and
  reproducible course/equipment JSON backlogs with source digests. No missing
  golf facts are filled by inference.

## Reproduce final gates

From a clean committed nightly checkout with dependencies installed:

```
node scripts/qa-nightly-gates.mjs
```

This records the exact SHA, compilation, full suite (including all new domains),
zero skipped/cancelled/todo, the executable Games matrix, catalog artifact
freshness, TypeScript, ESLint and Next production build in
`.qa-artifacts/nightly/<SHA>/quality-gates.json` and adjacent logs.
Next's official Webpack mode supports shared Windows dependency junctions;
the remote Git deployment uses the project's normal build command.

## Deployment isolation

The remote nightly branch was first published with its own automatic deployment
disabled so Vercel could accept branch-scoped variables before building it.
Only nightly Preview variables were added. Supabase is bound to the verified QA
ref `bymeopxkxapfizeeqeyb`; no schema migration or DB write was required.
Nightly AI provider credentials, invitation mailer and account deletion are
disabled. Polla Live, push, GHIN, wearable, rangefinder and export are not enabled.
The final push is permitted only after all gates pass, and targets only nightly.

## Boundaries remaining

- `PENDING_RULE_CLARIFICATION`: abandonment outside the explicit team-pressure
  contract; Vegas negative/two-digit net-score concatenation. Existing rules retained.
- `BLOCKED_EXTERNAL`: a real Vision/provider call is not part of fixture QA.
- `PENDING_DEVICE_QA`: physical camera and device network/storage behavior.
- `PENDING_INTERACTIVE_QA`: native OAuth/provider interactions and host UI rollout
  of structured AI actions. Engine/controller tests do not claim those ran.
- `LEGAL_REVIEW_REQUIRED`: course-source reuse evidence, unchanged by this audit.

All synthetic inputs are test fixtures. No real user, historical round, mail,
payment, production service or protected branch is a mutation target.

# Phase architecture and release safety

## Immutable Phase 1 baseline

- Final SHA: `5c278d7d27bcf68883108341503eaff6cf95fe24`
- Annotated tag: `phase1-final`
- Archive branch: `archive/phase1-final`
- Phase 2 branch: `phase2/full-platform`

The tag and archive branch must never be force-moved. They are recovery references, not development branches.

## Phase 1 hotfix strategy

1. Create `hotfix/phase1-<issue>` from `phase1-final`.
2. Implement the smallest isolated repair and run the full Phase 1 regression suite.
3. Review the diff against `phase1-final`.
4. Integrate only the repair into the current development branch with a controlled merge or cherry-pick.
5. If Phase 2 moved the affected responsibility, port the behavior and regression test into the new module instead of copying an obsolete file wholesale.

Example:

```text
git switch -c hotfix/phase1-card-parser phase1-final
# fix + tests + commit
git switch phase2/full-platform
git cherry-pick <hotfix-sha>
# resolve against the Phase 2 module boundary, then rerun full tests
```

## Integration policy

- Development and Preview deploys use only `phase2/full-platform`.
- `main`, `beta`, `app.thebackyard.com.mx` and `beta.thebackyard.com.mx` are outside Phase 2 scope.
- No force pushes or destructive rebases.
- Phase 2 is integrated later through an auditable merge after human approval.

## Database policy

- Migrations are additive, forward-compatible and include grants, indexes, constraints and RLS tests.
- No Phase 2 migration is applied to Production during this work.
- If Preview shares Production Supabase, migration files and tests are delivered as `PENDING_CONTROLLED_DB_APPLY`.
- Provider-backed capabilities remain behind feature flags until their data source, credentials and legal terms are verified.

## Phase 2 module boundaries

- `features/social`, `groups`, `invites`: identity-safe relationships, roles, templates and deterministic memory.
- `features/courses`, `handicap`, `gps`, `score-export`: provider contracts, tee precedence, versioned Course Handicap and fail-soft location.
- `features/live-rounds`, `notifications`: provider-neutral realtime, operation permissions, offline idempotency, conflicts and private activity.
- `features/shots`, `stats`, `ai`, `analytics`, `admin`: optional shot facts, filtered aggregates, explanation-only AI and aggregate-only administration.
- `features/feature-flags`, `memberships`: centralized runtime flags and FREE/PRO/BETA_PRO entitlements.

`app/page.tsx` was approximately 3,549 lines at the Phase 1 baseline and 3,582 lines after Phase 2D (net +33). The Phase 2 domain implementation lives outside that file; it only owns integration state and composes extracted components. Responsibilities extracted include social connections, course search, GPS status, shot controls, filtered stats/AI insights and live-round questions. A destructive page rewrite was deliberately avoided to preserve Phase 1 behavior.

The Next.js type/build graph completes without circular-import failures. Shared domain modules do not import React components or database provider internals; UI depends on explicit domain contracts and server routes depend on server-only adapters.

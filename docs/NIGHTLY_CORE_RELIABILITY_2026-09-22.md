# Core reliability — 22 September 2026

Base: `8fe4379d4afa034bc1dd6b37fcd058046ed669c3`. Tests use synthetic local fixtures and the existing in-memory PostgREST protocol implementation. No database changes or external writes.

## Corrected defects

1. A replacement round inherited the previous round's current hole during cloud hydration. Local navigation now restores only when both round IDs match.
2. An offline save held the caller's mutable bundle while awaiting IndexedDB. Its fingerprint could describe a different score from the saved payload. The payload is cloned before the first asynchronous boundary.
3. A cloud sync cycle held a mutable `before` reference. An in-place edit during upload could erase the comparison baseline and incorrectly report synced. The baseline is now an independent snapshot; the newer edit remains pending and retries.
4. All IndexedDB-unavailable browsers shared the literal device ID `browser-no-indexeddb`, which could suppress cross-device conflict detection. A browser-local fallback ID is now persisted, with a session-only unique fallback if all durable storage is unavailable. IndexedDB initialization also uses a single read/write transaction so concurrent tabs cannot independently claim different installation IDs. Connections opened for ID lookup are closed.

## Automated matrix

`tests/nightly-core-reliability.test.ts`: 22 tests, 0 skipped.

| Requirement | Evidence |
| --- | --- |
| H1 local, offline H2, reconnect | Exact scores and putts survive durable reload and acknowledged sync |
| Same round, two sessions | Disjoint edits merge; same-cell divergence produces a conflict |
| New round while active | Recoverable cancelled backup; old navigation cannot contaminate new round |
| Retry same write | 100 compare-and-swap retries preserve one canonical row |
| Reload during sync | Cancellation at download/upload/readback/media cannot apply an obsolete session |
| Logout/login with draft | A → guest → B → A preserves A and B independently |
| A/B isolation | Production service owner filters tested against protocol fake; **not** a claim of live RLS verification |
| Historical catalog freezing | 9/18 holes × start 1/10 preserve exact historical snapshot after catalog edit |
| Cancelled never completed | Cancellation dominates both scores and reviewPending |
| Score-only | 13 engine boundaries × 10 retries never call monetary calculators |
| Total-only | Empty hole scores and putts remain empty through merge/readback |
| Storage stress | 32 deterministic schedules × 18 holes = 576 durable edit/reload checkpoints |
| Scheduling | 100 concurrent trigger events coalesce; retries remain bounded |
| Browser installation identity | Fallback identity isolation and atomic IndexedDB transaction protocol |

Paused and reviewed are current workflow/UI concepts, not additional persisted lifecycle enum values. The tests preserve live rounds while paused and retain the existing completed/reviewPending semantics. No invented lifecycle migration was added.

## Validation

- TypeScript test compilation: PASS.
- ESLint on changed code/tests: PASS.
- New suite plus existing cloud/sync/offline/lifecycle/account suites: 147/147 PASS, 0 failures, 0 skipped.

## Scope limits

Live database RLS is not established by the protocol fake. Actual browser tab scheduling, storage-pressure behavior, and physical device reconnection remain `PENDING_DEVICE_QA`; session/provider interaction remains `PENDING_INTERACTIVE_QA` until exercised in a browser. The automated suite does exercise deterministic cancellation, outbox recovery, ownership filters, conflicts, and retry logic without modifying QA or real histories.

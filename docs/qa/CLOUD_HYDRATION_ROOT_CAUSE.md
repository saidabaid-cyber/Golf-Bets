# Hydration dirty-write diagnosis — DEV

Initial commit: `a7a6d033f733cc3c1a41edbe9aa4c947f28e5c2d`.
Account data was inspected read-only. No rounds, scores, preferences or provider records were edited during local diagnosis.

## Proven writer and local reproduction

In the initial `app/page.tsx`, the passive account-profile effect called
`syncAccountPrimaryFrequentPlayer(current, profile, new Date().toISOString(), accountIndex)`
and `syncLinkedRoundPlayerName` after profile/provider loading. In
`lib/account-primary-player.ts`, the template mutation replaced the owned row's
`handicap`, `updatedAt` and position. The selected Index can temporarily be null
before history/preferences/provider loading completes. A read therefore became
a persistent mutation before any user action.

The in-process reproduction executes the previous page's actual apply,
profile callback, persistence serializer, local reader and sync decision with
synthetic fixtures. With zero user actions, the owned frequent changed from
HCP **30.8** to **null**, kept usage **3**, acquired a new timestamp and produced
`cloudSyncUploadRequired=true`, reason `frequentPlayers`. This reproduces the
dirty-write independently of GHIN, HTTP failures or Vercel.

## Other audited hydration boundaries

The local workspace recovery effect also depended on
`identity.defaultHandicap`. Loading that preference could dispose/recreate
recovery and reapply a draft. The editor serializer discarded canonical
version/metadata and persisted normalized defaults. Tee fallback creation used
the current clock. Pre-start profile Index loading also mutated round players
through the passive handicap effect.

Canonical record versions for the affected active draft show only
`scoreCaptureMode` changes: advanced → quick → advanced → quick. They do not
show changes to H1 or the frozen players. There is no captured callback trace
identifying which setter produced each historical toggle; that limitation is
not presented as a proved retrospective caller.

QA21 version 10 → 11 changed only `updatedAt`, from
`2026-10-06T14:45:27.230Z` to `2026-10-06T19:49:14.818Z`.
All other snapshot fields, including scores, were identical. The captured
client diagnostics start after this mutation, so its original timestamp
caller cannot be established from those diagnostics. Database triggers were
read-only audited and do not rewrite that snapshot field. Version 11 is
preserved, not reverted.

## Correction

- Profile/provider loading projects current display values without changing
  saved frequent rows, IDs, member identity, usage, order or timestamps.
- Workspace hydration depends on account/workspace identity, not an arriving
  handicap preference. Owner fencing prevents an old view writing into a new
  account's storage.
- `CloudHydrationBoundary` remembers the raw document and deterministic editor
  view separately. Apply → read serializes the original material until a real
  editor change exists. Unknown canonical fields survive explicit checkpoints.
  This private in-memory boundary is not a server acknowledgment and does not
  modify CAS bases or authorize access.
- Legacy tee/default/handicap normalization uses stable inputs. Local cursor
  restoration remains local-only. Starting/configuring a round explicitly binds
  the current Index through the existing handicap calculation; started rounds
  remain frozen.
- Completed history normalization and timestamp-only differences do not create
  a new material upload. Real score, lifecycle and configuration differences
  still follow the existing delta/CAS/conflict path.

## Regression evidence

The integration harness uses the actual page apply/persist/checkpoint functions,
production normalizers, storage reader, metadata tracker, sync decision and
sync gate. It verifies an empty browser, QA24-style live H1=5/6 and CH5/12,
derived H2, stable frequent/group identity, completed timestamps, normalization
idempotence, unstarted draft hydration, explicit current-provider start,
true local edits, server-side `CLOUD_FIELD_CONFLICT`, bounded retry, owner
reset and pending-edit acknowledgment safety. Fixtures do not substitute for
the separate real DEV smoke.

The prior observed sequence was a genuine POST **409**, canonical recovery,
retry and POST **200** ending in cycle success. It was not a successful POST
misclassified as failure. Canonical receipts, offline recovery, conflict
checks, bounded retries, coalescing and the absence of polling remain intact.

# Play: canonical cancellation and direct course selection

Base: `9c841e5a3ea8f5cae6d6eaa5fc5786f9b4f974fc`, branch
`integration/backyard-current`, canonical DEV only. Recovery bundle and private
run evidence are preserved outside the checkout. No catalog migration, provider
requests, billing changes or edits to GHIN, bets, social, Career or historical
rounds are part of this change.

## Reproduced failure and correction

A dedicated QA Carlos owner card was created through the actual DEV endpoint.
Its canonical version advanced from 1 to 2 with identical capture inputs.
Cancelling from the acknowledged version 1 reproduced the reported cloud
revision error. Neither another player's round nor the global account draft
was changed to reproduce it.

Cancellation now waits for the same device's pending owner write. A newer
canonical revision is usable only after a full capture-input comparison proves
it is the same card; PUT still uses compare-and-swap. If scores/configuration
changed, the UI preserves the local copy, shows the current canonical card and
requires another explicit confirmation. A race after reading also opens review,
without automatic overwrite/retry. Finished/read-only rounds remain protected.
An uncertain cancellation acknowledgement can retry cleanup of the matching
cloud active slot without modifying the cancelled card or another active round.

## Selection and real QA

Club selection displays configuration buttons directly; a configuration opens
its tees immediately. Back preserves the selected configuration. Solo score
start retains the existing shortcut and optional player/bet editors. GPS uses
the existing shared map/score-sheet components. Async score save keeps the sheet
open until acknowledged and prevents duplicate submission/closing while saving.

The existing restricted `/qa/scorecard?flow=gps` remains memory-only by default.
Explicit `&persist=1` uses the SAME owner endpoint/CAS with one QA-prefixed owned
card and reads that full card again after reload. It never writes the principal
account draft, completes synthetic statistics, or edits another round. The
server-verified DEV/isolated-DB/account gate remains mandatory. This is an
identified persistence test, not proof of physical GPS accuracy or Said's session.

## Par 70: read-only data audit

All four La Vista configurations retain `club-la-vista`; no duplicate club is
created. The normal GHIN and current local Par 72 have 18 hole rows each. Par 70
and legacy Par 69 have **zero** rows each on this run's DEV database.

Par 70 records contain provisional totals only:

| Tee | Yard total | Rating | Slope | Rating category |
|---|---:|---:|---:|---|
| Blue | 6790 | 71.2 | 128 | unknown |
| White | 6191 | 68.4 | 121 | unknown |
| Gold | 5656 | 66.0 | 115 | unknown |
| Red / Ladies | 5156 | 68.6 | 128 | unknown |

These are owner-supplied provisional aggregates, not independently verified
per-hole facts. Existing GHIN sync/reconciliation records, catalog metadata,
local supplemental/seed data and the prior PDF extraction were reviewed. The
La Vista PDF is White, 6591 yd, Par 72, not a temporary Par 70 card. Saved GolfAPI
data is the standard configuration, not a confirmed temporary correspondence.
No new upstream requests were made.

Minimum independent requirements:

- **Gross score:** actual temporary playing order and numbered pars for positions
  **1–18**. No GPS, GHIN account, rating/slope or per-hole yardages are needed to
  record gross score. There is no verified numbered card to connect yet.
- **Handicap/net:** stroke allocations for **1–18**, plus validation of the tee's
  aggregate rating/slope/category for that exact temporary card. Hole yardages
  are missing for all four tees; they are display/card data, not a GPS substitute.
- **GPS:** explicit temporary-position → physical-hole correspondence for
  **1–18**. Existing standard green references cannot silently supply it.

A numbered temporary card or equivalent authorized operation record is the
smallest source needed for score; its physical-hole mapping is separately needed
for GPS. Legacy Par 69 has a known hole-6 par-3 vs confirmed par-4 conflict; fixing
that number in a fixture does not validate the remaining card or create Par 70.
Both variants remain visibly pending and are never replaced with Par 72. The
player catalog deliberately excludes unplayable tee cards; its zero eligible
tees must not be described as zero registered tee aggregates. The incomplete
card notice now separates gross-score, handicap and GPS requirements.

## Verification boundaries

Directed owner cancellation, PostgreSQL route persistence, fresh-round, course
selection, GPS cache, capture, restoration and QA isolation tests pass. The old
cancellation VM harness lacked current capture dependencies; that was reproduced
on the base and repaired without changing business behavior. Typecheck, lint and
build results and deployed interactive evidence are recorded in the external
run report. Post-deployment verification used the actual canonical DEV endpoint:

- The controlled Carlos card reproduced revision 1 vs canonical revision 2.
  The correction cancelled it at revision 3 with scores preserved; reload and
  idempotent retry retained revision 3. Only the matching QA active slot cleared.
  Hashes of the fixture's other history were unchanged.
- The existing El Mongas browser session opened the restricted QA surface,
  selected La Vista's current local card and White / Men directly, started solo,
  explored 1 → 2 → 3 → 1 without saving, moved a measurement target and zoomed.
  A score edit remained pending across hole changes; explicit save acknowledged
  score 5, closed the sheet and returned to the same map.
- Save/exit → reload → continue read the same card and score from the actual
  server at revision 2. Cancellation → reload read revision 3, `cancelled`,
  retained score 5 and offered New Round. The new configuration started empty.
  This identified QA card has no completion timestamp or personal statistics.
- Screenshots at 390×844 and 430×932 show the real Google satellite surface and
  bottom score sheet. Its camera responds to pointer pan, zoom and target drag.
  This is desktop pointer QA at phone dimensions, not physical iPhone gesture QA.
- The desktop location request reached timeout, clearly displayed, and stopped
  through Stop GPS. No phone/field accuracy is inferred. Real nearby results and
  Said's own authenticated session remain pending interactive/device testing.
- Synthetic cards were not completed in El Mongas's personal history; real
  finalization persistence is not claimed by this QA run.

GolfAPI/Mapbox requests remain zero. Google initializations are counted during
interactive QA: **2 observed initializations**, ceiling 20. The saved-course
reader coalesces private DB reads and has no upstream GolfAPI client. The
cross-user coalescing check is automated; two entitled real user sessions were
not available for an interactive comparison. No terrain/tee/path geometry is fabricated. Physical
iPhone gestures and field target accuracy remain `PENDING_DEVICE_QA`.

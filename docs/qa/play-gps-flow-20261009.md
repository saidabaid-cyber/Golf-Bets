# Play → GPS → score, DEV, 2026-10-09

Base: `9434d1cef2b555a0230dd19be8ac5c6cb64fd06e`, branch `integration/backyard-current`.
No migrations, catalog writes, upstream GolfAPI requests, Mapbox resources, GHIN changes or betting formulas are part of this change.

## Behavior

- The automatically inserted current account is not itself a draft. A selected club/configuration, actual roster edits, bets or scores are preserved.
- New solo rounds clear previous participants, bets, template, start hole and duration. Selecting a complete card and tee permits starting directly; additional players/bets remain optional.
- Continue preserves the current hole and other holes' pending edits. GPS navigation never confirms scores. Explicit **Guardar score** checkpoints the same hole without the old advance/summary timer.
- The map stays mounted while the score sheet opens. Location/target updates do not change its camera. Only hole changes or explicit camera controls fit/recenter it.
- Published browser QA exposed target pointer capture retained after dragging. The follow-up observes release in window capture, cancels unpressed mouse hover, and unlocks the map when the target is removed. All listeners are cleaned on removal. This is a fix found by interactive verification, not inferred from passing tests.
- Save/exit retains pending edits. Finish delegates to the existing validation/history flow. Only unstarted, scoreless drafts are discarded; started rounds use existing recoverable cancellation.
- The legacy pilot URL redirects to the canonical round GPS entry. Restricted GPS authorization and login infrastructure are preserved.
- Server readers coalesce concurrent private saved-course reads for 60 seconds. Their source is the existing durable private DEV snapshot store, never the upstream provider. Authorization is checked before the reader.

## Data limits (current evidence, not a claim of geographic completeness)

La Vista saved GolfAPI data has eighteen numbered positions with front/center/back green references. It contains no mapped tee, dogleg, hazard or route. Without a tee, the camera offers a 520 m context window around the known green, labeled **Sin tee/trazado GPS**. This window is camera framing, not published geometry. A far-away device location does not shrink the hole to fit a home-to-course line. Provider front/back are fixed references; center is not the day's flag. Measurement date/absolute accuracy remain unknown.

The current club card's persisted `ghin_provider_alias_v1` was rechecked read-only in DEV. It explicitly confirms eighteen-hole physical identity with canonical `course-la-vista`, evidence `OWNED_SESSION_LIVE_COURSE_AND_GOLD_18_HOLE_GEOMETRY`, version `la-vista-club-current-2026-09-28`, approved 2026-10-06. The GPS reader reuses that identity only while all recorded guards match. It does not substitute the club card's SI/tee yardages/ratings, require a player GHIN connection, or grant GPS mapping to either temporary card. No new alias or coordinate data is written.

Par 70 (`course-la-vista-temporary-par-70`) has only aggregate, owner-provided provisional metadata/tees. Current DEV has **zero** `golf_holes` rows for that configuration. Holes **1–18** lack verified par and stroke index, per-tee hole yardages and the temporary-position→physical-GPS correspondence. The UI preserves the selection and blocks start on the missing card. A numbered temporary scorecard or equivalent authorized record is required.

Par 69 is a preserved legacy identity with a known hole-6 conflict (legacy par 3 versus confirmed par 4). A numeric test fixture totaling 69 is not an authorized temporary scorecard. Changing that fixture to total 70 would not validate the other seventeen holes or GPS mapping. Neither temporary variant is silently replaced with Par 72, nor populated from fixtures. Official/local card IDs, tee categories and historical cards are unchanged.

## Verification boundaries

The directed suite covers owner-only drafts, fresh-roster reset, solo without GHIN/HCP/geometry, missing Par 70, same-hole explicit score commits, lifecycle/restoration/capture regressions, distances, gesture guards, session cleanup, saved-source coalescing and server QA access. Typecheck, lint and build results are recorded with the run report.

Local browser QA uses real saved card data and production components with an explicitly simulated renderer: select La Vista, distinguish all four configurations and white MEN/WOMEN tees, start solo, navigate 1→2→3→1 with zero score writes, preserve an edit, explicitly save it, exit/continue, and inspect 390×844 / 430×932 surfaces.

`/qa/scorecard?flow=gps` is inside the existing canonical DEV/exact-DB/server-verified QA allowlist. It reuses the same production components and real saved cards/Google map; synthetic rounds and scores remain exclusively in React memory. It mounts no cloud sync, account history publisher, notifications or analytics. This mode does not grant QA accounts normal GPS/global-admin entitlements and is not evidence of Said's real session or physical accuracy.

After deployment, record Google initialization logs and screenshots in the external run evidence. A real map render and memory-round QA do not prove physical finger gestures, field accuracy or authenticated Said cloud persistence. Those remain `PENDING_DEVICE_QA` / `PENDING_INTERACTIVE_QA` where untested. Maximum twenty real Google map initializations; no upstream retries or billing changes.

Normal entry: `https://dev.thebackyard.com.mx/?screen=play`.

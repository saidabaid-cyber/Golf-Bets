# La Vista 1 — usable provisional GPS view

Base: `5c72b134a85a16b70c272cdc12782f7a0470617a` on
`integration/backyard-current`. Canonical entry:
`https://dev.thebackyard.com.mx/gps-pilot/la-vista-1`.

## Confirmed defect and correction

The original PNG is intact, opaque RGB, 870×930. In a browser at 390×844
with the actual application CSS, its top was at y≈765: large intro, distance,
signal, status and action blocks preceded it. Only a strip was visible on entry.
No corrupt file, rotation or intrinsic-aspect collapse was found in that
reproduction. The specific original Safari report is not independently reproduced.

The raster is now the main element directly after the compact heading/warning.
Its viewport has explicit aspect, containing the entire image. Local SVG camera
pan/zoom transforms the raster and markers together. Controls reset the full
frame and centre a valid in-coverage location; no outside marker is clamped.
Load failure and manual retry are explicit; they do not disable GPS distances.

## Source and georeferencing

Reuses existing INEGI E14B43d4 imagery, January 2010; no external requests.
The original source BIL SHA-256 remains
`9e628c4efe8b747554c672ed00ea18879ed7f96bf240b6b825b6af10b93cbad1`.
The new crop's original-image pixel box is [2080,5574,2540,6069], 460×495;
WebP is 49,426 bytes. It includes the documentary green, fairway, lake and tee
area context, without inventing tee positions or official hole boundaries.
Original and formerly annotated PNG are retained. Reproduction script and
source images are in the existing external preparation directory.

`image-reference.json` records dimensions, checksum, source, original pixel
extent and NW **pixel centre** UTM [578042,2102375], 1 m pixels. SVG coordinates
of that pixel centre are [0.5,0.5]. x increases east; y increases south.
Device coordinates [longitude,latitude] are projected using GRS80 UTM14N,
the same approximate geographic identity transfer used by the existing target.
Target recovers source UTM [578137,2102304] and crop pixel [95.5,71.5].
No target coordinate or validation status changed.

**The WGS84→ITRF92 datum/epoch transfer is approximate. Absolute ortho and
transfer accuracy are unknown.** Neither a small projection round-trip residual
nor a ±8 m phone report proves target accuracy. The blue accuracy circle models
the phone report in projected metres; it does not include source uncertainty.
Coverage is a raster rectangle, not a verified hole polygon.

## Verification

- 25 portable GPS/geodesic regressions; 10 image/projection/camera/source tests.
- 41 targeted GPS/access/auth-return tests, including real subprocess execution
  of those portable suites. No skipped or failed test in this selection.
- Typecheck and lint passed. Turbopack build passed on temporary input from the
  base HEAD plus exactly the GPS delta, using installed dependencies and an
  input-only root adjustment for their junction. Application config unchanged;
  concurrent unfinished GHIN edits were excluded from that build.
- Browser rendered image and target at 390×844 and 430×932; no horizontal overflow.
  Zoom, pointer drag, full-frame reset and aligned target anchor verified.
- Explicit local QA adapter: inside/outside, centring, metres/yards, stale >15 s,
  low accuracy >30 m, denied permission, timeout, unavailable, recovery, waiting,
  stop. One active subscription; zero after stop. Error/retry image recovery tested.
- Browser inventory: 12 local resources, **zero Mapbox and zero external URLs**.
  No provider, location persistence, telemetry or new paid service was added.

The QA HTML/adapters are external-only and are not shipped. Screenshots show
the actual renderer with the real provisional image/target, GPS stopped. Test
positions used for state verification are synthetic, explicitly labelled.

## Preservation and pending checks

Existing server-side pilot-only tester permission, lifecycle checks, DEV-only
flag and fixed login return are unchanged. API/auth tests cover authorized,
unauthorized, reload/session races and return. User has reported successful
real-account access and GPS on iPhone before this visual delta; agent verification
of this delta in Said's actual session remains **PENDING_INTERACTIVE_QA**.

Physical Safari interactions and target/phone accuracy in the field remain
**PENDING_DEVICE_QA**. The target is not a flag or verified green centre. No
front/back green, hazards, trajectory, new Course Master record, DB migration,
round change or historical rewrite was introduced.

On iPhone: open the canonical URL, sign in if requested, tap **Usar mi ubicación**.
Check the marked green against the ground; inspect reported accuracy and age.
Pan/zoom/reset; outside the raster keep the direct distance and outside notice.
Tap **Detener GPS** when finished. Compare the same fixed target, not a day's flag.

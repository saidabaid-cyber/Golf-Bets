# P04 — Incomplete scorecards closeout

> **DOCUMENTO HISTÓRICO — NO USAR COMO ESTADO ACTUAL NI RUNBOOK.** Este cierre conserva evidencia de la rama original; sus SHA, conteos y observaciones de QA pueden estar superados. La fuente operativa es `integration/backyard-current`; consulte el [manifiesto de consolidación](../CONSOLIDATION_MANIFEST_2026-09-24.md), el [estado canónico del producto](../CANONICAL_PRODUCT_STATUS_2026-09-24.md) y el [ledger canónico de migraciones](../CANONICAL_MIGRATION_LEDGER_2026-09-24.md). No ejecute deploys, cambios de entorno ni migraciones a partir de este archivo.

## Scope and baseline

- Branch: `phase2/admin-control-center-2026-09-22`
- Base SHA: `5912765c64dd00a3e00e3693fc6d9c3a5ea3671b`
- Final SHA: the commit containing this closeout (exact value is recorded in the deployment binding and delivery; a Git commit cannot embed its own hash)
- QA project: `bymeopxkxapfizeeqeyb`
- Read-only QA observation: 24 September 2026
- Before: **153 clubs / 176 courses / 769 tees / 758 complete / 11 incomplete**
- Database writes: **none**
- Ratings/slope categories: unchanged and outside P04

The live QA rows were counted directly. All 758 captured 18-position cards have positive yardages, valid Par values and 18 distinct stroke-index values. Six of those are prior, traceable supplements; none is orphaned from its supplement evidence.

P04 did not promote a card by combining generations, subtracting a missing yardage from a total, copying another tee, or duplicating a physical nine. A source hierarchy was applied, with specialist directories used only for discovery/corroboration.

## Result by tee

| CLUB | COURSE | TEE | ANTES | FUENTE ENCONTRADA | HOLES | PAR | SI | YARDAS | DESPUÉS | STATUS |
|---|---|---|---|---|---:|---|---|---|---|---|
| Las Parotas Club de Golf | `review-course-23170` | AZULES | Incomplete | Official club page + mirrored club brochure | 18 confirmed | Par 72 only at course level | Full historical card, version not reconciled | Historical card conflicts with captured version | Incomplete | `SOURCE_CONFLICT` |
| Las Parotas Club de Golf | `review-course-23170` | BLANCAS | Incomplete | Official club page + mirrored club brochure | 18 confirmed | Par 72 only at course level | Full historical card, version not reconciled | Historical card conflicts with captured version | Incomplete | `SOURCE_CONFLICT` |
| Club Campestre Real del Catorce | `review-course-23195` | BLANCAS | Incomplete | Two specialist directories; no current primary source | 9 physical vs 18-position representation unresolved | Conflicting representation | Secondary only | Secondary only | Incomplete and non-operational | `OPERATION_UNCONFIRMED` |
| Playa Mujeres Golf Club | `review-course-31612` | SILVER | Incomplete | Official scorecard + Offcourse + Golfify | 18 | Official Par available | Secondary card uses a different SI generation | Official H6 absent; secondary says 141 yd | Incomplete | `SOURCE_CONFLICT` |
| Zirándaro Golf Club | `review-course-32225` | AZULES | Incomplete | Official site + Golfify + 18Birdies | **9 physical** | Official confirms all par 3 | Secondary scheme only | H3/total conflict between secondary sources | Incomplete | `SOURCE_CONFLICT` |
| Zirándaro Golf Club | `review-course-32225` | AMARILLAS | Incomplete | Official site + Golfify | **9 physical** | Official confirms all par 3 | Secondary only | Secondary only | Incomplete | `STILL_INCOMPLETE` |
| Zirándaro Golf Club | `review-course-32225` | BLANCAS | Incomplete | Official site + Golfify | **9 physical** | Official confirms all par 3 | Secondary only | Secondary only | Incomplete | `STILL_INCOMPLETE` |
| Campo de Golf Naval | `review-course-35498` | DORADAS | Incomplete | SEMAR + mScorecard | **9 physical** | Secondary only | Missing | Tee identity Gold/Doradas not proven | Incomplete | `STILL_INCOMPLETE` |
| Campo de Golf Naval | `review-course-35498` | AZULES | Incomplete | SEMAR + mScorecard | **9 physical** | Secondary only | Missing | Missing for Blue | Incomplete | `STILL_INCOMPLETE` |
| Campo de Golf Naval | `review-course-35498` | BLANCAS | Incomplete | SEMAR + mScorecard | **9 physical** | Secondary only | Missing | Secondary White yardages only | Incomplete | `STILL_INCOMPLETE` |
| Alquerías de Pozos | `review-course-36036` | Azules / Blancas | Incomplete | Official club page/card | **9 physical** | Official card | No combined-tee mapping | No combined-tee mapping | Incomplete | `STILL_INCOMPLETE` |

## Sources and decisions

- **Las Parotas:** the [official club page](https://www.lasparotasgolf.com/) confirms the current operation, 18 holes and course-level Par/rating facts. The [mirrored Las Parotas brochure](https://www.tomzap.com/GOLF_LasParotas.pdf) has a full scorecard but cannot be tied to the captured tee generation; its rating data differs from the captured inventory. The two tees remain blocked.
- **Real del Catorce:** [Golfify](https://www.golfify.io/courses/club-de-golf-real-del-catorce-s-c) and [FlyAway](https://flyawaygolf.com/es/golfs/club-de-golf-real-del-catorce-s-c) describe a nine-hole course with differing 9/18 representations. No current primary operational evidence was found, so the card remains non-operational.
- **Playa Mujeres SILVER:** the [official scorecard](https://www.golfplayamujeres.com/assets/pdf/scorecard.pdf) is the primary evidence but does not supply SILVER H6 in the captured card. [Offcourse](https://offcourse.co/courses/scorecard/playa-mujeres-golf-club/) and [Golfify](https://www.golfify.io/courses/playa-mujeres-golf-club) agree on 141 yd, but use a different SI generation. P04 does not stitch those versions.
- **Zirándaro:** the [official site](https://www.zirandaro.com.mx/campodegolf) confirms a physical nine-hole par-3 course. [Golfify](https://www.golfify.io/courses/zirandaro) and [18Birdies](https://18birdies.com/golf-courses/club/e4783900-92b9-11e9-b938-06780482e2ce/zirandaro-golf) disagree on the Blue H3/total; no official per-tee card was found.
- **Naval:** the [SEMAR document](https://www.semar.gob.mx/unhicun/henm.pdf) confirms the course's creation. [mScorecard](https://www.mscorecard.com/mscorecard/showcourse.php?cid=1568271539747922) shows a nine-hole card with partial White/Gold yardages but no SI and no Blue yardages. It cannot complete the three captured tees.
- **Alquerías:** the [official course page](https://alquerias.com.mx/golf/) confirms a physical nine-hole par-3 course and separate Blue/White/Gold/Red tees. It does not establish a combined “Azules / Blancas” tee, so that legacy identity remains incomplete.

## Publication hardening

- Runtime publication now validates physical hole count, exact hole-number set, Par, SI and positive yardages before exposing a reviewed tee.
- A physical nine may retain an official odd/even 18-hole SI allocation; it is not renumbered automatically.
- An explicitly documented two-loop capture is projected to its nine physical holes only when both loops match on physical Par and yardage.
- Version-2 supplements are bound to both `courseId` and `teeId`; cross-course and cross-tee application fails closed.
- A legacy enriched row with `supplementOriginal` but without its supplement is no longer publishable.
- Historical round snapshots are not read from or rewritten by this resolver.
- Ratings/slope remain hidden until their category/authority is handled separately in P05.

## Verification

### Executed before code changes

- QA readback: `153 / 176 / 769 / 758 / 11`.
- Exact incomplete-row readback: all 11 stable tee IDs above.
- Structural audit of the 758 complete rows: zero missing/non-positive yardages, zero invalid Par values, zero non-unique 18-hole SI sets.
- Supplement audit: six prior complete supplements, zero orphaned supplements.

### Automated behavior

`tests/p04-incomplete-scorecards.test.ts` executes (rather than searches source strings):

- all six courses and all 11 tee identities;
- rating/slope alone cannot complete a card;
- wrong tee and wrong course supplements are rejected;
- contradictory SI/total remains blocked;
- physical nine remains nine;
- second-loop projection does not mutate source identity;
- historical snapshots remain immutable;
- removing the supplement fails closed;
- Puebla identity/nearby behavior remains club-distinct and distance-derived.

### Final local quality gates

- Full suite: **3,391 passed / 0 failed / 0 skipped / 0 cancelled**.
- P04 behavior subset: **14 passed / 0 failed**.
- TypeScript `--noEmit`: **PASS**.
- ESLint: **PASS**.
- Next.js production build: **PASS**, 34 static pages generated and all dynamic routes compiled.
- `git diff --check`: **PASS**.

The exact fixed-alias deployment SHA is recorded in the final delivery after Preview verification.

## Closeout counts

- **Before:** 758 complete / 11 incomplete
- **After:** **758 complete / 11 incomplete**

This is an evidence result, not a failed arithmetic target. No source met the exact-version publication threshold for a new tee, so no QA database write or controlled apply is necessary for P04.

## Remaining evidence requests

1. Current club-issued hole-by-hole card for Las Parotas Blue/White tied to the captured generation.
2. Primary proof of current Real del Catorce golf operation plus an unambiguous physical card.
3. Club-issued Playa Mujeres SILVER card with H6 and the same SI generation.
4. Official per-tee Zirándaro card and official Naval card with their published 9-hole SI system.
5. Primary definition/mapping of the Alquerías combined “Azules / Blancas” legacy tee, if it remains a valid selection.

## Scope confirmation

No migration, DDL, Auth, Storage, user, geolocation, Admin, Equipment, Social, Profile, bet-engine or Production change was made. P01, P02 and P03 behavior remains in scope for regression testing only.

# Equipment Catalog Data Freeze Closeout

Date: 2026-09-27

Canonical branch: `integration/backyard-current`

Baseline SHA: `a6daa6832ac618246dde68e32c0df4cebc4da873`

Canonical runtime boundary: `/api/catalog/equipment`
Versioned provider without an effective Admin publication: `backyard-equipment-seed`

The exact final Git SHA and Vercel deployment ID are reported in the owner handoff. They cannot be embedded in the same self-versioned commit that creates this document.

## Result

The public catalog remains provider-neutral and continues to be consumed through `/api/catalog/equipment`. Versioned seeds are the complete base; effective Admin Published revisions overlay the base server-side; semantic deduplication then preserves one visible identity and retains alternate IDs as aliases. No UI reads a normalized Supabase catalog table directly.

No Production system, Production data, `main`, `app.thebackyard.com.mx`, `beta.thebackyard.com.mx`, or real user data was changed. No Supabase migration or catalog write was performed.

## Reproducible audit

- Baseline snapshot: `data/qa/equipment-catalog-freeze-baseline-2026-09-27.json`
- Final machine-readable diff: `data/qa/equipment-catalog-freeze-closeout-2026-09-27.json`
- Complete normalized catalog audit: `data/qa/equipment-gaps.json`
- Ball-specific provenance decision log: `data/qa/ball-catalog-diff.json`
- Reproduction command: `npm run audit:equipment-freeze`

The audit checks stable IDs, the requested semantic identity per equipment kind, source evidence, current/legacy state, internal-fixture visibility, required alias searches, saved QA catalog references, plus variants, and the two PXG Xtreme Tour models.

## Final catalog matrix

| Kind | Before total | After total | Brands before/after | Added | Removed | Current | Legacy | Visible duplicate IDs | Visible semantic duplicates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BALL | 314 | 323 | 19 / 20 | 9 | 0 | 94 | 229 | 0 | 0 |
| CLUB | 1,276 | 1,308 | 21 / 23 | 32 | 0 | 263 | 1,045 | 0 | 0 |
| SHAFT | 474 | 481 | 21 / 22 | 7 | 0 | 203 | 278 | 0 | 0 |

No baseline catalog ID was removed. The aggregate, non-PII catalog IDs observed in QA equipment profiles all still resolve. The final versioned items contain 11 BALL, 43 CLUB, and 41 SHAFT item-ID aliases inherited from safe deduplication and historical identity preservation.

### BALL

- Added as current: Top-Flite Gamer, XL Control and XL Distance; Nitro Eclipse, Crossfire and Nitroglycerin.
- Added as legacy: TaylorMade Noodle (2014), Noodle+ Long and Soft, and Noodle+ Easy Distance.
- Kept exactly once: PXG Xtreme Tour and Xtreme Tour X; Pinnacle Distance; Nitro Ultimate Distance.
- Amazon Basics was not added because no stable official product record with sufficient product identity was found. Marketplace listings alone were not treated as authoritative evidence.
- New visible brand: Top-Flite. No models or IDs were removed or merged by the new import.

### CLUB

- Added Honma: current TW777 and BERES 10 families; legacy TW737 and BERES Black families.
- Added Takomo: current Iron 101/201/201T MKII, 301 CB/MB/Combo, 101U, Ignis D2 Fairway and Skyforger wedges; legacy original Iron 101/201 and Ignis D1 Driver.
- New visible brands: Honma and Takomo. No models or IDs were removed or merged by the new import.
- TSR2 and TSR2+, Bio Cell and Bio Cell+, F6 and F6+, and 0811 X and 0811 X+ remain distinct identities.

### SHAFT

- Added Veylix Alpina 573/673, Rome 688/888/988, Arcane 640T and Rome 7RA Roughneck as legacy. The manufacturer pages remain useful archival evidence, but the records were not presented as current without a clear current-product declaration.
- Kinetixx remains the single canonical visible brand. `Paderson` and `Paderson Kinetixx` are historical search aliases and do not create a second product family.
- VENTUS Blue VeloCore and VENTUS Blue VeloCore+ remain distinct identities.
- New visible brand: Veylix. No models or IDs were removed or merged by the new import.

## Aliases

The versioned registry `data/equipment-catalog-aliases.json` is the canonical alias source for seed-backed runtime data. It supports scoped brand aliases and item aliases; search, facets, pinned IDs, and Ball Fit ID resolution consume the same provider layer.

Current mappings include:

- `Paderson` and `Paderson Kinetixx` → Kinetixx for SHAFT search.
- `LAB Golf` and `LAB` → L.A.B. Golf for CLUB search.
- `Vice Golf` → Vice for BALL search.
- `Cleveland Golf` → Cleveland for CLUB search.
- `Bridgestone Golf` → Bridgestone, scoped independently to BALL and CLUB.
- `Cobra Golf` → Cobra and `Nippon` → Nippon Shaft.
- Noodle historical naming is attached to the stable TaylorMade catalog ID.

Aliases never cross equipment kinds and do not merge different generations or plus variants.

## Public visibility and lifecycle

Current models are returned by default. Legacy models remain resolvable by a saved/pinned ID and become searchable only after an explicit query. Public search, facets, recommendations, pinned resolution and Ball Fit all use the same fail-closed visibility predicate.

The following internal markers are rejected when found in IDs, brand/model labels, source names or source types: synthetic, QA, fixture, test/test data, internal QA/test, fake and mock. Internal fixtures remain available to automated tests; the baseline versioned public source contained zero such rows, so zero evidence rows were deleted.

## Provenance decisions

- Honma, Takomo, Veylix, TaylorMade/Noodle, Nitro, PXG and Pinnacle identities use manufacturer sources.
- Top-Flite uses the current catalog of its authorized exclusive retailer for product identity only. Unverified technical attributes remain `null` and the records are excluded from Ball Fit.
- Noodle uses TaylorMade official archive PDFs and is legacy, not current.
- Kinetixx is supported by its current manufacturer catalog. The Paderson terms are search compatibility aliases only; no unsupported corporate-history claim is encoded.
- Unknown compression, launch, spin, material, year, or other specifications were not inferred.

Primary evidence is recorded on every added row. Principal references include Honma (`us.honmagolf.com` and `honmagolf.com`), Takomo (`takomogolf.com`), Veylix (`veylix.com`), TaylorMade official PDFs, Nitro (`thenitrogolf.com`), Pinnacle (`pinnaclegolf.com`), PXG (`pxg.com`), and DICK'S Sporting Goods for current Top-Flite identity.

## Supabase QA read-only audit

Authorized project ref inspected: `bymeopxkxapfizeeqeyb`.

- Actual normalized public tables found: `golf_club_catalog`, `golf_ball_catalog`, and `golf_shaft_catalog`; all were empty during this audit.
- The separately reported `equipment_club_models`, `equipment_club_variants`, `equipment_shaft_models`, `equipment_shaft_variants`, `equipment_ball_models`, `equipment_aliases`, and `equipment_club_shaft_options` names were not present in the current QA schema at inspection time.
- `player_clubs` and `player_balls` had zero rows. Seven `player_equipment_profiles` existed; only aggregate catalog IDs were inspected, with no PII read or changed.
- Admin QA and Production equipment revision sets were empty.
- Result: the versioned provider remains the authoritative complete base. A mass database import would add risk without improving the current runtime and was intentionally not performed.

Database writes: 0. Migrations applied: 0.

## Files

Catalog and provider:

- `data/golf-equipment-catalog.expansion.seed.json`
- `data/equipment-catalog-aliases.json`
- `lib/equipment-catalog-aliases.ts`
- `lib/equipment-catalog-visibility.ts`
- `lib/golf-equipment-catalog.ts`
- `lib/equipment-catalog-provider.ts`
- `lib/equipment-catalog-provider.server.ts`
- `app/api/catalog/equipment/route.ts`

Minimal behavior wiring (no redesign):

- `app/components/use-equipment-catalog-search.ts`
- `app/components/equipment-editors.tsx`

Audit and tests:

- `scripts/qa-equipment-catalog-freeze.mjs`
- `scripts/qa-catalog-data.mjs`
- `tests/equipment-catalog-freeze.test.ts`
- `tests/ball-catalog-public-safety.test.ts`
- `tests/equipment-picker-closeout.test.ts`
- `tests/shaft-master-closeout.test.ts`
- `package.json`
- `data/qa/ball-catalog-diff.json`
- `data/qa/equipment-gaps.json`
- `data/qa/equipment-catalog-freeze-baseline-2026-09-27.json`
- `data/qa/equipment-catalog-freeze-closeout-2026-09-27.json`

## Verification

- Focused equipment tests: 41 passed, 0 failed.
- Full repository suite: 3,626 passed, 0 failed (3,521 product tests plus 105 infrastructure/script tests).
- ESLint: PASS.
- Next route type generation plus `tsc --noEmit`: PASS.
- Next.js 16.3.3 production build: PASS, 35/35 static pages generated.
- `git diff --check`: PASS.
- Equipment catalog freeze audit: PASS.
- Catalog QA regeneration and stale-artifact check: PASS.

Runtime deployment verification and the exact READY deployment metadata are recorded in the final owner handoff after the canonical branch deployment completes.

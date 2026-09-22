# Nightly Games Engine — 22 September 2026

All fixtures are explicitly synthetic mathematical inputs. No catalog records,
users, database rows, mail, integrations, or historical rounds are written.

## Deliverables and reproduction

- `tests/fixtures/games-matrix.ts`: adapters for every active `BET_REGISTRY` entry;
  registry additions without a matching adapter fail closed.
- `tests/games-engine-matrix.test.ts`: generated matrix, invariant checks,
  independent expected-value oracles, historical snapshot and template checks.
- `tests/games-engine-invalid-capture.test.ts`: malformed-capture regression cases.
- `scripts/qa-games-matrix.mjs`: executes the matrix and 1,728 Monkey score triples,
  emitting a JSON report to stdout. It does not write files or contact services.

Run from the checkout being validated:

```sh
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/games-engine-matrix.test.js .test-dist/tests/games-engine-invalid-capture.test.js
node scripts/qa-games-matrix.mjs
```

The standard `npm test` glob includes both new suites. Capture the JSON report
after the final commit so `sourceRevision` matches the nightly SHA. When git is
not on PATH the report returns a null revision rather than inventing one.

## Coverage inventory

The registry currently has 23 modalities. Every adapter receives 29 shared
scenarios; 14 adapters that consume a round HCP receive eight additional
HCP scenarios. That is **779 executable matrix scenarios**. Every modality must
produce at least one nonzero settlement so an inactive or invalid configuration
cannot masquerade as engine coverage.

| Modality | Adapter | Matrix cases | Specific contract exercised |
|---|---|---:|---|
| Conejos | calculateRabbits | 37 | Relative/course HCP, carry state, played order |
| Skins | calculateSkins + payout | 37 | Carry/no carry oracle, pushes, individual tee SI |
| Unidades positivas y negativas | calculateUnits | 29 | Signed entries, automatic units, decimal payment oracle |
| Foursome | calculateFoursomes | 37 | Segments, fixed points, explicit match presses |
| Bola Amiga | calculateBallFriend | 37 | Explicit team assignment, tee/HCP inputs |
| Monkey | calculateMonkey | 37 | Exactly 3 participants; 1,728 independent six-point/payment oracles |
| Polla 1ª vuelta | calculatePolla:first9 | 37 | Complete first played nine; incomplete round oracle |
| Polla 2ª vuelta | calculatePolla:second9 | 37 | Second played nine; no nonexistent nine on short rounds |
| Polla 18 | calculatePolla:total18 | 37 | Complete 18 only |
| Mini Polla | calculateMiniPolla | 37 | Saved play order, final-three component |
| Víboras | calculateCounterBet:vipers | 29 | Zero counters/push, recorded counter settlement, 1–5x pressure oracle |
| Camellos | calculateCounterBet:camels | 29 | Recorded events, 1–5x pressure oracle |
| Peces | calculateCounterBet:fish | 29 | Recorded events, 1–5x pressure oracle |
| Loba | calculateLoba | 37 | Explicit partner configuration, incomplete capture |
| Personales | calculatePersonalBets | 29 | Explicit stroke advantage, played halves, carry/press |
| Nassau individual | calculateSupplementalBets | 29 | Explicit stroke advantage, 9/18 components |
| Dollar a Stroke | calculateSupplementalBets | 29 | Explicit stroke advantage, partial accumulated result |
| Presiones individuales | calculateSupplementalBets | 37 | HCP percentages, seven rounding modes, invalid-score guard |
| Presiones por parejas | calculateSupplementalBets | 37 | Low/high, standard/Mudo/Yo-Yo, explicit abandoned players |
| Chicago | calculateSupplementalBets | 37 | Points/quota, HCP %, validated course par |
| Vegas | calculateSupplementalBets | 37 | Fixed team assignment, net integer arithmetic |
| Mínimo de Putts | calculateSupplementalBets | 29 | Complete 9/18, zero putts valid, invalid counts rejected |
| Manuales | calculateManualBets | 29 | Explicit zero-sum ledger; duplicate IDs fail closed |

Shared scenarios include 18 holes, 9 holes, starts at 1/10, all tied with equal
HCP, zero/one/eight/seventeen holes captured, cent/decimal/large finite stakes,
and 16 seeded streams with gross scores 1–12. HCP scenarios include 0%, 80%,
83.5%, valid -15/36 boundaries, decimals, missing HCP, course basis, and distinct
frozen player tee cards. They are not a Cartesian product of every axis.

Carry/press variants are tested only in contracts that have those fields.
Counter games, units, putts, and manual adjustments do not claim HCP coverage.
Nassau/Personales and Dollar Stroke use the existing explicit agreed stroke
advantage contract, not a newly invented round-HCP percentage field. Course
and tee changes are intentionally irrelevant to a pure manual ledger.

## Invariants and exact oracles

- Finite zero-sum money, with a floating-point tolerance scaled to settlement.
- Same input gives the same entire result; replay cannot accumulate money.
- Frozen inputs and a JSON persistence roundtrip produce the same result.
- Evaluating independent modalities in reverse order cannot change results.
- Reordering roster storage with fixed participant/team IDs cannot change money.
- Equal scores/HCP/facts push; no capture cannot settle money (manuals excluded).
- Missing required HCP does not silently become zero.
- An edited current course/player object cannot affect a serialized historical input.
- Changing a presentation label leaves money unchanged; legacy persisted event
  keys and rule fields are not presentation labels.
- Duplicate manual/supplemental instance IDs fail closed.
- Player-free habitual templates gain selected round participants; opponents and
  team assignments that still need a decision stay explicitly unresolved.
- Independent Skins carry, Polla completeness, signed units, counter pressure,
  frozen tee stroke-index, and Monkey payment oracles.

The 1,728 Monkey triples are subcases inside one test and are also separately
enumerated by the JSON reporter. Do not add them to the Node test count as if
they were separately registered tests.

## Reproduced defects and narrow fixes

Before the fixes, 26 invalid-input regression cases failed. Five affected paths:

1. Minimum Putts accepted NaN, infinity, negative or fractional counts and could
   mark invalid data complete. It now requires nonnegative integer captures;
   a legitimate zero-putt chip-in remains valid.
2. Dollar Stroke accepted malformed gross scores based only on `typeof number`.
   It now shares `completedHole` validation before adding a hole to money/audit.
3. Individual pressures could pick a winner from NaN comparison or invalid gross
   values. It now shares the same completed-hole gate.
4. Team pressures treated any numeric gross as a completed capture. Invalid
   numeric captures stay unresolved, including for a withdrawn player; an
   absent capture retains the existing explicit abandonment substitution rule.
5. Chicago could throw on a missing course hole or settle against duplicate/
   invalid par records. It now requires a unique hole with positive integer par.

These guards do not change any valid-input payout formula, cap, tie, carry,
pressure, or historical rule. The preexisting engine, side-bet, supplemental,
handicap, Nassau, template, and round-wizard regression suites remain required.

## Rule clarification, not fabricated behavior

- `PENDING_RULE_CLARIFICATION`: no common forfeiture/withdrawal settlement contract
  exists outside `team_pressures.abandonedPlayerIds`. Other modalities exercise
  existing incomplete-round behavior. Do not infer a loss or invent replacement
  scores when a player stops recording.
- `PENDING_RULE_CLARIFICATION`: Vegas at negative net or two-digit gross scores
  retains existing arithmetic. Tests verify determinism and conservation, not
  a newly assumed cap, sign treatment, or string-concatenation rule.

No silent skipped tests are used for these gaps. Their existing numerical
contracts are exercised; unspecified product rules are reported separately.

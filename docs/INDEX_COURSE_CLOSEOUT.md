# Backyard Index / Course Data closeout — 2026-09-15

> **Evidencia histórica; no ejecutar como runbook actual.** Sus estados pendientes reflejan el corte fechado de una rama anterior. La clasificación vigente está en [el manifiesto](./CONSOLIDATION_MANIFEST_2026-09-24.md), [el estado del producto](./CANONICAL_PRODUCT_STATUS_2026-09-24.md) y [el ledger de migraciones](./CANONICAL_MIGRATION_LEDGER_2026-09-24.md).

Branch: `phase2/full-platform`. Initial HEAD: `5e36754d58911c5db78cadd13c5b1c4c7447fce4`.
Initial worktree was clean. No Production, main, beta, shared DB writes, migration apply, merge or force push.

## Audit → implementation

| Boundary | Initial | Delivered |
| --- | --- | --- |
| Differential / progressive 3–19 / last 20 best 8 | DONE | Arithmetic unchanged; explicit A–O regression tests added. |
| Activation | PARTIAL: component-local boolean | Versioned owner cache plus private Auth metadata; shared controller at app root, loading/error/retry, metadata readback. |
| Round close | PARTIAL: called engine without verified evidence | Frozen assignment → automatic snapshot → existing local-first history / offline outbox. Missing evidence persists reasons, never fabricates a differential. |
| Course evidence | MISSING: legacy seed lacks rating provenance | Versioned primary-source Puebla JSON/provider; two El Cristo tees integrated in existing course search and tee selection. |
| Profile | Existing local card | Actual progressive sample/count retained; small help dialog and explicit local PCC declaration. |
| History | Missing eligibility explanation | Per-owner frozen eligibility/reasons and differential in round detail. No financial recalculation. |
| Active navigation | JUGAR | CONTINUAR / RONDA; same callback, conditional state, icon and geometry. |
| Stats reset Preview DB | BLOCKED_EXTERNAL | No isolated DB exists. Additive apply/runbook and local SQL/owner-RLS tests ready; **PENDING_CONTROLLED_DB_APPLY**. |

## Index capture and evidence

`captureCompletedRoundIndex` is invoked by `saveConfirmedRound`, before `saveRoundHistoryLocalFirst`.
It takes an immutable copy of the completed round; only the account-linked player and that owner's
activation can contribute. It never looks up mutable course data at close or on historical read.
Verified tee identity, par, Rating/Slope, yardage, URL/authority, review date and data version are
frozen at assignment. Scores, unrestricted Course Handicap (when an Index already exists),
hole adjustments, local/published PCC and activation evidence are frozen in the round record.
The existing history update refreshes Profile calculation and sports Stats. Existing round cloud
outbox carries the same snapshot; no parallel round storage or financial engine was introduced.

Invalid/incomplete/9-hole/unverified rounds remain saveable; their explicit reason is available in
History and the Index card. A disabled Index records `INDEX_NOT_ENABLED`. Enabling later does not
silently backfill rounds explicitly closed with it disabled. Historical corrections reuse frozen
evidence; moving the played date invalidates an inherited local PCC declaration. No manual/GHIN/
Playing Handicap is overwritten. GHIN remains an unconnected future source.

Activation is a preference, not authorization or official certification. Its small record is in
the signed-in owner's Auth metadata and owner-scoped localStorage, not public profile fields.
An actual `auth.getUser()` ownership check surrounds cloud writes. Offline pending changes survive
reload and retry on reconnect. Auth metadata has last-write-wins semantics, not a transactional CAS;
timestamps, post-write readback and next-sync repair of newer local data handle observed conflicts.
Simultaneous multi-device convergence is not claimed as a DB-transaction guarantee.
Confirmed account cleanup removes only that owner's new preference cache.

## PCC methodology — explicitly local

[R&A Rule 5](https://www.randa.org/en/roh/the-rules-of-handicapping/rule-5) describes published daily
PCC and the number of acceptable scores needed for that process. No feed of official PCC is connected;
absence of a feed is **not evidence** that official PCC was zero. The activation disclosure therefore
explicitly asks for a local zero assumption for this non-official estimate. `DECLARED_LOCAL_ZERO`
stores value 0, declarer and declaration time, scoped by the frozen round/date. It is never labeled
published, FMG, WHS-certified or GHIN. The legacy boolean opt-in did not disclose PCC; those users
must separately tap `USAR PCC 0 LOCAL`. No nonzero PCC is invented. Actual published evidence, if
present, must match the played date. The progressive arithmetic itself was not changed.

## Puebla results

See [CURATED_PUEBLA_COURSES.md](CURATED_PUEBLA_COURSES.md) for all five primary-source references,
URLs, discrepancies and future provider maintenance. **2** tees are usable for the local Index:
El Cristo Azules (71.2 / 129) and Blancas (68.6 / 125), per the
[club's published scorecard](https://elcristo.com.mx/campo-golf). This is not an official GHIN rating
certification. Doradas and Rojas are excluded because hole yardages conflict with printed totals.
La Vista is present but its existing legacy Rating/Slope has no adequate primary provenance;
it remains unverified for Index. Puebla coverage is **PARTIAL**, not a complete regional catalog.

## Verification and limits

- Unit/integration tests exercise opt-in persistence/reload, owner isolation, cloud-adapter readback,
  local-first history/outbox, eligibility/ineligibility, immutable tee snapshots and all A–O counts.
- Local browser harnesses use actual components with explicitly synthetic players/rounds. They are
  not screenshots or proof of an authenticated cloud Preview account. 390/393/430 widths, help and
  the two-line active label were inspected without horizontal overflow.
- Full suite, lint and Next build must pass before branch-only push. Preview deployment SHA/READY
  and anonymous read-only routes are checked separately after deployment.
- Cloud reset is **not PASS**: the only visible Supabase project is shared and has no branch.
  No costs or new database were accepted on the owner's behalf. Required isolation, migration order,
  rollback/error checks, zero-account/nonzero-account cases and commands are in
  [STATS_PREVIEW_DB_QA.md](STATS_PREVIEW_DB_QA.md).
- Authenticated cloud activation/round-sync end-to-end and real DB reset cannot be claimed from
  local mocks; they remain part of isolated-Preview QA. Existing Home files/assets are unchanged.

The Supabase safety and Vercel verification skills kept isolated DB execution distinct from local
test evidence; the React review preserved one shared preference controller and owner-scoped effects.

## Closeout matrix

PASS below means the named implementation's local logic/UI tests passed, not authenticated cloud
QA. Remote Stats rows deliberately remain pending until an isolated database is tested.

| Requirement | Result |
| --- | --- |
| BACKYARD_INDEX_ENGINE | PASS |
| INDEX_AUTO_CAPTURE | PASS — actual capture + local history/outbox + reload; authenticated cloud E2E pending |
| INDEX_3_TO_19 | PASS |
| INDEX_20_BEST_8 | PASS |
| INDEX_LAST_20 | PASS |
| COURSE_CURATED_ARCHITECTURE | PASS |
| PUEBLA_COURSE_CATALOG | PARTIAL |
| PUEBLA_VERIFIED_TEES | 2 local, 0 GHIN-certified by this integration |
| STATS_RESET_ZERO_ACCOUNT | PENDING_CONTROLLED_DB_APPLY |
| STATS_RESET_REAL_DATA | PENDING_CONTROLLED_DB_APPLY |
| STATS_HISTORY_PRESERVED | PENDING_CONTROLLED_DB_APPLY — local tests pass, real Preview not applied |
| ACTIVE_ROUND_LABEL | PASS — 390/393/430 local browser |
| TESTS | PASS — 1,603 Node tests; 6 local PGlite SQL checks |
| LINT | PASS |
| BUILD | PASS — Next 16.3.3 |
| HOME_UNCHANGED | PASS — no Home component/CSS/asset diff from initial HEAD |

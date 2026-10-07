# GHIN source transition — el_mongas — DEV

**STATUS: DONE.** Link, unlink, retention, same-GHIN relink, explicit reimport,
QA25 idempotence and final independent private-session recovery passed.
The owner physically certified the final state in a NEW Safari private session.
No further functional change, posting, round or cleanup is required.

## A. INDEX_STATE_MODEL

Before this change, the account resolver already prioritized VERIFIED GHIN,
but Carrera separately recalculated the historical Backyard 5.5 and displayed
it as a preserved alternative. No reset boundary prevented its future revival.
The value was derived from historical eligible Backyard rounds, not a separate
stored numeric Index. The old Auth preference selected GHIN and disabled Backyard.

The server now owns `player_handicap_source_state`: reset instant, transition
instant and revision, retained player identity and at most 20 retained score IDs.
The current source is GHIN only when VERIFIED. Without that link and after
reset, no old preference or historical cards activate an Index automatically.

## B. BACKYARD_INDEX_RESET_IMPLEMENTATION

PASS. A confirmed VERIFIED profile transition records the reset atomically.
Same-identity VERIFIED refresh/reauth and initialization are idempotent. The
server-owned revision overrides stale browser preferences, including a clock
set far in the future. Unlink advances source revision without moving reset.

The existing linked account initially adopted its boundary at
`2026-10-07T01:48:57.501033Z`. The later confirmed relink started revision3
at `2026-10-07T03:27:17.051751Z`; subsequent refresh/import left it unchanged.
Future explicit Backyard activation can use only
eligible rounds started strictly after that boundary. GHIN-only cards remain
excluded. Old rounds, scores and frozen playing handicaps are unchanged.

Migration `20261007012847_ghin_index_epoch_retained_history.sql` was applied only
to DEV project `bymeopxkxapfizeeqeyb`, branch `phase2-full-platform-qa`. Owner
SELECT requires authenticated identity, active account and nonanonymous session.
Authenticated/anon cannot write the state or execute transition RPCs. Server
writes retain fixed search paths and existing ownership rules. Security advisors
show exactly the same four preexisting notice groups, no new findings.

Rollback policy: retain state and historical evidence; disable transition UI
if required. Never restore old preferences or drop/delete historical data.

## C. LINKED_STATE

PASS in real DEV. Profile and Carrera showed GHIN 30.8 as the sole active Index,
without “Backyard Index conservado 5.5”. Local integration verifies new-round
GHIN selection and frozen Course Handicap. No new real round was created.

![Linked Carrera](evidence/index-transition-linked-career.jpg)

## D. UNLINK_PRECHECK

PASS. Provider scores and posting receipts reference the owner and canonical
round, not the active provider profile. Round references use DELETE RESTRICT.
Deleting the active profile cannot cascade into provider history or receipts.
The replacement unlink RPC locks that profile, selects latest 20 by played date
and stable provider ID, records retained IDs and deletes only the active link.
No provider score, posting receipt or round DELETE occurs in this transition.

## E. UNLINK_RESULT

PASS, executed once through the normal DEV UI. Server link is absent.
Unlinked at `2026-10-07T01:58:14.627314Z`, source revision2. Modal explained
retention and absence of an active Index before execution.

## F. RETAINED_GHIN_CARDS

PASS, all seven persisted cards retained (fewer than20):
`1208915748`, `902029046`, `899647834`, `888298526`, `853907291`, `819244193`,
`816066271`. Normal owned GET reads them without a live provider session.
Server database and Profile both confirm seven, one linked, zero ambiguous.
With >20, older rows remain archived; historical linked-round provenance remains
visible even outside the retained GHIN-only window. Local Postgres tests cover
0,7,25 cards and exactly20 retained without destructive deletion.

## G. BACKYARD_INDEX_AFTER_UNLINK

PASS. Active source NONE, active value NONE. Carrera displays **Sin índice
activo**. Old5.5 does not return. The canonical boundary persists independently
of the deleted active link and stale Auth/browser metadata.

![Unlinked Carrera](evidence/index-transition-unlinked-career.jpg)

## H. HISTORY_AFTER_UNLINK

PASS. All27 original snapshot hashes, lifecycle states and versions match the
prechange snapshot:23completed,1cancelled,3live. Carrera → Rondas retains the
six GHIN-only cards,22 Backyard-only completed and one QA25 Backyard+GHIN row.
No import or new round was used to achieve retention.

## I. QA25_RECEIPT_AFTER_UNLINK

PASS. Original round `49cd75db-eb6f-47fa-9e0e-b1841ae0f93b`, provider score
`1208915748`, receipt `106216c7-cdbb-4e30-824c-ebf35139c039` and fingerprint
`5a940101e675cdc613b76e11764e57fdde0ac7788484283f8e69f24464ae413c` unchanged.
Receipt remains SUCCEEDED; QA25 gross103 and frozen GHIN30.8/CH36 remain intact.
No provider posting was performed in this task.

## J. QA24

PASS. Active draft `rrouggse`, round `16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d`,
version5, H1 owner5/guest6, H2 pending. Active-draft hash and version494
unchanged. Inicio still offers **Continuar ronda · Hoyo2 de18**. No score edit,
resume, cancel or completion was performed.

![QA24 still available](evidence/index-transition-unlinked-home.jpg)

## K. CLEAN_SESSION_UNLINKED

PASS, physically certified by the owner in NEW Safari private after unlink:
no linked GHIN, no active Index, no revival of5.5, retained cards and QA25 once,
Atest50%, history/Carrera recovered. The separately reported QA24 resume
regression was subsequently fixed and physically certified before relink.
The final private-session certification also confirms QA24 remains liveH2.
The automated IAB shared storage is not used as the private-session evidence.

## L. RELINK

PASS. The owner manually authenticated the SAME GHIN; server identity matched.
VERIFIED, GHIN30.8 sole active source, old5.5 inactive/invisible. The confirmed
relink established source revision3; explicit refresh left Index30.8 and the
reset boundary unchanged. Provider IDs and receipts remained intact.
No passwords or OTPs were collected in chat, logs or code.

## M. REIMPORT

PASS, executed once explicitly after real relink:0new,1linked,0review,
0duplicates. All7retained provider IDs persist;6GHIN-only and1QA25Backyard+GHIN.
The owner confirmed the same summary in the final private-session UI.

## N. QA25_IDEMPOTENCE_AFTER_RELINK

PASS. Real QA25 “Validar sin publicar” after relink returned ALREADY_POSTED
from the canonical receipt before provider access. Provider score1208915748,
receipt106216c7-cdbb-4e30-824c-ebf35139c039 SUCCEEDED and linked round unchanged.
Additional upstream score POST in this final attempt:0. No repost or new round.

## O. CAREER

PASS in linked and unlinked DEV.23completed, average83.7, best71, birdies18,
and historical rich Backyard data remain. Provider adjusted-only cards do not
invent gross, birdies, putts/GIR, rivalry or betting evidence. One QA25 row;
five approved real subviews, no hero/anchor architecture changes.

## P. ATEST

PASS, unchanged **10/20=50%**. Before QA25 the prior window was11/20=55%; QA25
pending had legitimately displaced one atested card before this task. The eleven
historical attestations were not deleted. Link/unlink does not change Atest.

## Q. REQUEST_BUDGET

Historical unlink-stage browser diagnostics: cloud sync GET2, POST0, cloud rounds0,
retry0, failure0. Two full535,006-byte bundles are explained by initial login
and one deliberate reload to adopt the deployment, both mount/knownCloud=false.
Unexpected full bundles0. No upload followed either hydration. GHIN persisted
import GET3, largest4,551bytes; import POST0; unlink1; relink0; provider POST0
in that stage. These are scoped observations, not totals for the later relink.

Profile requests are not fully byte-instrumented; their total is unknown.
Runtime-log absence is not substituted for global request counts. The final
agent session observed154.636seconds with0cloud diagnostic events. The owner
then certified more than3minutes without runtime events after the last explicit
action:0periodic cloud sync observed,0runtime errors, request stormNO.
Reauthorize and scoring record returnedHTTP200. CLEAN_SESSION and IDLE_2_MIN
are PASS. No additional provider score POST. In the documentary close only
one DEV health GET was performed; no account/provider operations were repeated.

## R. TESTS

Final functional closure:directed171/171PASS. Full suite4,710tests:4,701PASS,
9exact preexisting failures,zero new failures. Script suite117/117PASS.
TypecheckPASS, lintPASS, buildPASS. No mass tests rerun for this documentary close.
Earlier transition tests exercise real
local Postgres triggers, transactions, RLS, retention, relink/import, source
selection, stale clocks, future epochs, frozen snapshots and owned route reads.

Preexisting failures, unchanged from the before-code unsandboxed baseline:

- provider diagnostics contain no token, resource URL or personal coordinates
- new renderer is under demand with local position updates, cleanup and real terrain exaggeration
- round opens isolated GPS view without changing score navigation or creating another round
- every module flag is independent and opt-in, GPS doesn't require map or flyover
- la UI final usa bolsa premium, selección guiada y modo manual explícito
- Mi bolsa abre una ficha limpia por bastón y reserva el borrado para el detalle
- Mi Bolsa keeps approved product media while permanent management stays compact
- Reglas dejan IA/directorio plegables, recursos como accesos directos y videos abiertos al final
- nightly audit artifacts reproduce from canonical runtime catalogs and captured QA metadata

## S. GIT

InitialSHA `5c72b134a85a16b70c272cdc12782f7a0470617a`, clean integration branch.
Concurrent GPS commit `9016d5cd0de488be64d619f8f67a489f5d4f7307` preserved.
Core `de7eb6ce0fca4a9f684d5742d2564e720ee67afd` and tests
`f369b73ee373b5b12684d271ec68b4750f30df63` pushed only to integration.
Subsequent work, including QA24 resume fix and GPS work, is preserved at final
functional SHA `b647eaf7dd168c365665a8d1f9f9c99ba23846c3`. This final commit
changes only reports/manifests/manual guide. Its documentary SHA is recorded
in the delivery and Git history. Main, beta, Production, productive domain and
other accounts were not modified.

## T. DEPLOYMENT

https://dev.thebackyard.com.mx/api/health HTTP200, environment preview,
buildSHA `b647eaf7dd168c365665a8d1f9f9c99ba23846c3`, deployment
`dpl_2dcqTfVGYx9FBKS5kf2G9jwGTrox` READY. Health rechecked2026-10-07T04:10Z.
No new functional deployment and no Production deployment.

## U. MANUAL_REVIEW

[Manual guide](../MANUAL_REVIEW_EL_MONGAS_GHIN.md) updated to the current source
rule. Prior QA25 posting/round-trip evidence is preserved as historical proof.
[Transition manifest](GHIN_INDEX_TRANSITION_EL_MONGAS.json) includes exact IDs
and checkpoint hashes without passwords, auth responses, cookies or tokens.

## V. UNRESOLVED

None blocking. All required stages are PASS; GHIN + BACKYARD QA is DONE.
All retained evidence remains in el_mongas DEV. No cleanup.

BACKLOG_NON_BLOCKING only:review in a separate task the banner “Ronda actualizada
desde la nube. La versión local anterior se conservó en este dispositivo.”
It can confuse in a clean session, but caused no conflict, H2 change or blockage.

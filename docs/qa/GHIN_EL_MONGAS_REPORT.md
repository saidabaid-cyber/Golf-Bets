# GHIN Full Cycle — checkpoint DEV

## A. STATUS

**USER_REAUTH_REQUIRED / BLOCKED_EXTERNAL. No DONE.** Implementación y regresiones locales completadas. El ciclo real de scoring record/import/post/round-trip/relogin sigue pendiente.

## B. BASELINE

PASS: 26 registros Backyard conservan los mismos hashes y versiones que el snapshot inicial: 22 completados, QA22 cancelada y tres live. Incluye las 20 originales, QA21, QA23, QA24 y dos parciales antiguas. No se escribió ni borró ninguna ronda, score, apuesta o Atest.

QA24 ya tenía versión 4 al inicio de esta tarea, frente a versión 3 del checkpoint anterior. H1 sigue 5/6 y el hash de scores no cambió. Se conservó la versión actual; no se restauró un snapshot anterior.

## C. GHIN LINK

PASS persistido: owner `b182e0a1-d3f5-4e32-a005-29c6d55b6cdf`, VERIFIED, GHIN `****3351`. La consulta real de scoring record devolvió REAUTH_REQUIRED. No se solicitaron credenciales globales ni de terceros.

## D. GHIN PROFILE

Index persistido antes/después: **30.8**. La última sincronización exitosa guardada fue `2026-10-06T18:19:44.856Z`. Index actualizado mediante nueva consulta: USER_REAUTH_REQUIRED, no comprobado.

## E. SCORING RECORD

USER_REAUTH_REQUIRED. Cantidad upstream y provider score IDs aún desconocidos. No se sustituyó la consulta por fixtures ni por las 503 tarjetas de Said.

## F. IMPORT

Modelo y flujo DEV implementados. Tabla privada real creada en el proyecto autorizado. Hasta este checkpoint: **0 registros importados reales**; fetched/skipped upstream desconocidos. Primera/segunda importación E2E pendientes. Tests de la RPC real y de idempotencia: PASS.

## G. DEDUPE

Tests PASS: exact match, alta confianza por identidad/fecha/IDs/hoyos/scores, nombres sólo para revisión, múltiples candidatos ambiguos, un vínculo por ronda física, no confundir raw/adjusted, preservar fingerprint, no sobrescribir datos ricos. Dedupe sobre scoring record real: BLOCKED_EXTERNAL.

## H. UNIFIED HISTORY

Implementado en Carrera → Rondas y Histórico, orden por fecha y badges Backyard/GHIN/Backyard + GHIN. Mantiene las acciones Backyard originales. Tarjetas provider-only de lectura y páginas de 20. QA visual con tarjetas oficiales persistidas: BLOCKED_EXTERNAL.

## I. BACKYARD INDEX

PASS preservación: **5.5**. Misma lógica y mismas tarjetas Backyard elegibles; no se cambió la matemática. GHIN-only no entra al cálculo.

## J. HANDICAP PROVIDER

GHIN VERIFIED conserva la prioridad existente para el Handicap Index. Backyard Index permanece separado y visible. No se promedian ambos. QA24 conserva su snapshot/freeze histórico.

## K. POST CANDIDATE

BLOCKED_EXTERNAL: **0 candidatos elegibles** entre las 22 completadas. Sus IDs congelados no tienen ambos mappings CONFIRMED. El mapping de `course-la-vista` no confirma automáticamente `course-la-vista-club-current`; QA21 tampoco tiene mapping confirmado del campo. No se inventaron IDs, rating, slope o gender.

## L. POST RESULT

No ejecutado: **0 posts reales**. `GHIN_SCORE_POSTING_ENABLED` sigue apagado, transport read-only. No se habilitó un transport cuando faltaban los guards obligatorios.

## M. ROUND TRIP

BLOCKED_EXTERNAL: no existe una tarjeta publicada real que verificar y reimportar. Tests de asociación mediante receipt/provider ID/fingerprint: PASS; no equivalen a round-trip upstream.

## N. IDEMPOTENCE

Importación/RPC y exactly-once existentes: tests PASS. Segunda importación/segundo intento de posting contra el registro real: BLOCKED_EXTERNAL. No se realizó un segundo POST real.

## O. OPTIONAL POSTS 2–3

No iniciados: la primera publicación no alcanzó sus prerequisitos.

## P. CAREER

Se conserva la UX de cinco subvistas y las métricas Backyard. Se agregó un agregado combinado sólo con gross real por modalidad, sin sumar vínculos dos veces ni incluir ambigüedades. GHIN no produce rivalidades, Atest, bets o logros por hoyo inventados. Validación con importación real: BLOCKED_EXTERNAL.

## Q. ATEST

PASS preservación: **11/20, 55%**; 12 atestaciones válidas totales incluyendo QA21. No se cambió motor, endpoint o tabla de Atest. Las tarjetas GHIN-only son independientes.

## R. QA24

PASS integridad DB: `16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d` / `rrouggse`, live, H1 **5/6**, pendiente H2, versión 4 intacta. No se cerró, canceló ni usó como candidata.

## S. REQUEST BUDGET

Una acción real “Ver scoring record” devolvió REAUTH_REQUIRED. Importaciones reales: 0. Posts provider: 0. El lector nuevo no agrega polling ni retries automáticos; coalescing probado. La medición autenticada de requests/bytes/reposo está pendiente, y se registra como null, nunca como cero falso. No se ejecutó mega corrida, stress ni loops.

## T. TESTS

- Dirigidos GHIN/import/SQL/RLS/cloud/Carrera/Backyard Index: **409/409 PASS**.
- Suite completa TypeScript: **4,565**, **4,560 PASS**, **5 FAIL preexistentes**, **0 FAIL nuevos**.
- Scripts adicionales: **117/117 PASS**. La primera ejecución aislada falló por permisos de repositorios Git temporales; la ejecución autorizada pasó sin cambio de código.
- Typecheck, lint y build: **PASS**.
- E2E completo real: **BLOCKED_EXTERNAL**, no sustituido por tests locales.

Los cinco fallos ajenos son exactamente Equipment owner review, Equipment UI contract, final-brand-ghin-closeout Equipment, iphone-capture Rules y nightly-catalog-quality equipment-gaps. No se modificaron esas áreas para alterar el baseline.

## U. DB / RLS

Migración aditiva `20261006184558_ghin_owned_score_import`, aplicada exclusivamente en `bymeopxkxapfizeeqeyb`, rama Supabase no default `phase2-full-platform-qa`. RLS y grants exactos verificados: dueño SELECT; anon sin acceso; authenticated sin writes/RPC; servidor sin DELETE. No hubo hallazgos de advisors relativos a la tabla/RPC nuevas. Rollback operacional documentado sin DROP ni limpieza.

## V. CLEAN SESSION

BLOCKED_EXTERNAL: la pestaña canónica está esperando el código manual de el_mongas. El GET persistido no depende de una sesión GHIN viva ni de storage del browser, pero la recuperación con login limpio después de importar aún debe ejecutarse.

## W. MANUAL REVIEW

`docs/MANUAL_REVIEW_EL_MONGAS_GHIN.md`: valores reales actuales, navegación, baseline, QA24 y pasos pendientes. Indica claramente que todavía no acredita el ciclo completo.

## X. MANIFEST

`docs/qa/GHIN_EL_MONGAS_BEFORE.json` y `docs/qa/GHIN_EL_MONGAS_FINAL.json`, sin secretos. Null significa evidencia no disponible, no resultado cero.

## Y. GIT

SHA inicial `8422256d795ed51e35ba99ac37eccdba349bdab3`. Primer commit `d5efcd4`: persistencia privada, reconciliación, API, lector y regresiones. El segundo commit integra UI, guías y evidencia. SHA final/deployment se reportan en la entrega y en `/api/health` para evitar referencias circulares dentro de un commit.

Diff limitado a GHIN privado, presentación de Carrera/Histórico, pruebas y QA docs. Main, beta, Production, app.thebackyard.com.mx y rama de campos no se modificaron. El fix cloud `dc4185fab8fd3143c44d4aa879f10459bd492106` sigue siendo ancestro.

## Z. UNRESOLVED

1. Login manual canónico y reautorización legítima GHIN.
2. Consulta scoring record, importaciones reales 1 y 2, count/IDs/matches/ambigüedades y QA visual.
3. Mappings CONFIRMED suficientes para una tarjeta completada segura.
4. Transport legítimo y posting con los diez guards; verificación provider, round-trip e idempotencia reales.
5. Login limpio posterior con recuperación física de todos los datos y medición autenticada de reposo/tráfico.

No se borra evidencia ni se declara DONE al cerrar este checkpoint.

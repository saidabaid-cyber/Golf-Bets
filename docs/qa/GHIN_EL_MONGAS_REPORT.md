# GHIN Full Cycle — checkpoint DEV

## A. STATUS

**STOPPED_USAGE_GUARD. No DONE.** Login canónico confirmado como El Mongas; QA detenido antes de importar o publicar GHIN por escrituras durante hidratación, POST 409 `CLOUD_FIELD_CONFLICT` y un reintento con bundle completo. Implementación y regresiones locales completadas. Scoring record/import/post/round-trip/relogin siguen pendientes.

## B. BASELINE

Las 26 rondas siguen en servidor: 22 completadas, QA22 cancelada y tres live. Las 20 originales, QA23, QA24 y dos parciales antiguas conservan hashes/versiones. Los hashes de scores de las 26 son idénticos. **Discrepancia QA21:** versión 10 → 11 durante la hidratación de acceso; `cloud_record_versions` confirma que el único campo cambiado fue `updatedAt`. No se revirtió ni sobrescribió esta revisión. No hubo edición manual de scores ni borrado.

QA24 ya tenía versión 4 al inicio de esta tarea, frente a versión 3 del checkpoint anterior. H1 sigue 5/6 y el hash de scores no cambió. Se conservó la versión actual; no se restauró un snapshot anterior.

## C. GHIN LINK

PASS persistido: owner `b182e0a1-d3f5-4e32-a005-29c6d55b6cdf`, VERIFIED, GHIN `****3351`. La consulta real de scoring record devolvió REAUTH_REQUIRED. No se solicitaron credenciales globales ni de terceros.

## D. GHIN PROFILE

Index inicial y visible tras el acceso: **30.8**. Perfil muestra última actualización `6/10/2026, 1:40:10 p.m.`. No se hizo una nueva consulta upstream durante este checkpoint; la consulta anterior había devuelto REAUTH_REQUIRED. No se interpreta el valor visible como prueba de scoring record recuperado.

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

Ventana capturada `19:49:27–19:50:55Z`: **4 GET sync observados**, **3 POST sync observados** (dos 200, uno 409), **1 retry**, **3 GET completos observados**, **2 receipts POST completos**, **1 GET privado de importación** (200, 193 bytes), **0 importaciones y 0 posts GHIN**. Máxima respuesta observada **521,694 bytes**, máximo upload **26,495 bytes**. `/api/cloud/rounds`: 0 en los diagnostics capturados; no equivale a un conteo de red exhaustivo.

Un GET completo adicional de recuperación se infiere del catch de `CLOUD_FIELD_CONFLICT`, que descarga sin callback de diagnostics. Los totales observados no lo incluyen. Dos full GET corresponden a hidratación de acceso/reload intencional para cargar el build publicado; el otro full GET se ejecutó con trigger retry después del conflicto. El body del POST 409 se registra como 0 bytes por el instrumentador, pero su tamaño real no fue medido.

Secuencia comprobada: hidratación dirty (`frequentPlayers`/`activeDraft`) → POST **409 CLOUD_FIELD_CONFLICT** → recovery/rebase → retry GET **521,587 bytes** → POST **200**, receipt **521,694 bytes** → `cycle:success`. **No se observó POST 200 convertido incorrectamente en failure.** La causa exacta de las mutaciones de hidratación sigue sin resolver; no se afirma polling ni request storm demostrado. Guard activado conservadoramente; página llevada a `about:blank` sin limpiar storage. Reposo autenticado de dos minutos **no certificado**, no se reporta cero falso.

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

Acceso canónico confirmado como El Mongas. GET privado de tarjetas persistidas: 200, 193 bytes, tabla todavía vacía. **STOPPED_USAGE_GUARD:** recuperación limpia posterior a importar no ejecutada. No se reutiliza este acceso como prueba de un relogin final con tarjetas GHIN.

## W. MANUAL REVIEW

`docs/MANUAL_REVIEW_EL_MONGAS_GHIN.md`: valores reales actuales, navegación, baseline, QA24 y pasos pendientes. Indica claramente que todavía no acredita el ciclo completo.

## X. MANIFEST

`docs/qa/GHIN_EL_MONGAS_BEFORE.json` y `docs/qa/GHIN_EL_MONGAS_FINAL.json`, sin secretos. Null significa evidencia no disponible, no resultado cero.

## Y. GIT

SHA inicial `8422256d795ed51e35ba99ac37eccdba349bdab3`. Primer commit `d5efcd4`: persistencia privada, reconciliación, API, lector y regresiones. El segundo commit integra UI, guías y evidencia. SHA final/deployment se reportan en la entrega y en `/api/health` para evitar referencias circulares dentro de un commit.

Diff limitado a GHIN privado, presentación de Carrera/Histórico, pruebas y QA docs. Main, beta, Production, app.thebackyard.com.mx y rama de campos no se modificaron. El fix cloud `dc4185fab8fd3143c44d4aa879f10459bd492106` sigue siendo ancestro.

## Z. UNRESOLVED

1. Diagnóstico local de mutaciones sin edición durante hidratación, conflicto 409 y recuperación; no seguir consumiendo DEV hasta esclarecerlo. Acceso manual canónico completado. Validez de sesión GHIN viva todavía no reconsultada.
2. Consulta scoring record, importaciones reales 1 y 2, count/IDs/matches/ambigüedades y QA visual.
3. Mappings CONFIRMED suficientes para una tarjeta completada segura.
4. Transport legítimo y posting con los diez guards; verificación provider, round-trip e idempotencia reales.
5. Login limpio posterior con recuperación física de todos los datos y medición autenticada de reposo/tráfico.

No se borra evidencia ni se declara DONE al cerrar este checkpoint.

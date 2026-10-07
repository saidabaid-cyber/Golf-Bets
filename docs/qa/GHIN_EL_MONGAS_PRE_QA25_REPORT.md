# GHIN FULL CYCLE — continuación de mapping real

Estado: **NO_EXISTING_POSTABLE_ROUND. No DONE.**
DEV exclusivo: https://dev.thebackyard.com.mx. Branch integration/backyard-current.
Inicio: 6701089f443a7e2f5d635a175b5f6fd89121b406. Código probado/desplegado: 7586232a14ae4d1767b0714c964ee0bdeea33d29.

## COURSE_LOOKUP

PASS live con la sesión legítima del GHIN vinculado a el_mongas.
Facility search, course search, details y tee detail respondieron HTTP 200.
Facility **19886**, course **23233**, LA VISTA COUNTRY CLUB, 18 hoyos, par 72.
Evidencia normalizada pública: [GHIN_LA_VISTA_LOOKUP.json](GHIN_LA_VISTA_LOOKUP.json).
No se repitieron scoring record ni imports1/2. No se consultaron otras cuentas.

## COURSE_MAPPING

PASS. El link oficial está en course-la-vista; las rondas congelaron
course-la-vista-club-current, la tarjeta del club versionada. Los IDs externos
son únicos y permanecen en sus links canónicos. Se añadió ghin_provider_alias_v1
a metadata del course actual y de Doradas; dos filas de catálogo, DB DEV
bymeopxkxapfizeeqeyb. No nueva tabla/migración, no cambios RLS ni snapshot.
DML auditado e idempotente: [GHIN_LA_VISTA_MAPPING_DEV.sql](GHIN_LA_VISTA_MAPPING_DEV.sql).
El resolver exige links CONFIRMED, club, rating/género, par, yardaje, geometría
y evidencia congelada; no usa un nombre como prueba. Ante drift devuelve null.
No se ejecutó rollback. La adición se puede retirar de manera controlada
eliminando sólo esas claves de metadata si una revisión futura lo requiere;
no se necesitan restauraciones de rondas, tablas ni catálogo.

## TEE_MAPPING

| Tee | Snapshot Backyard | GHIN live | Resultado |
|---|---|---|---|
| Doradas | MEN,68.4/121,6038yd,par72 |106088 Male,68.4/121,6038yd,par72|Alias físico CONFIRMED|
| Blancas |MEN,70.8/125,6590yd,par72|106087 Male,70.8/128,6591yd|No CONFIRMED|
| Blancas femenina |El snapshot es MEN70.8/125|106089 Female,77.4/153,6591yd|No compatible|

Doradas coincide en las **18 geometrías par/yardaje**. Los 18 stroke indexes
difieren entre las versiones club y provider: se registra esa diferencia y
se conserva el freeze Backyard. No se afirma equivalencia de asignación
ni se recalculan apuestas/handicaps históricos. Blancas además difiere en
slope y H18 yardaje425 vs426; no se corrige una ronda para hacerla postable.

## SCORE_POSTING_ENTITLEMENT

PASS de lectura: /Courses/23233/TeeSetRatingsForScorePosting.json, HTTP200,
seis tees: 106087, 106088, 106089, 106090, 280984 y 281493. No hubo bypass.
La lista de tees permitidas no reemplaza el guard de género/rating del jugador.

## EXISTING_CANDIDATE

**NO_EXISTING_POSTABLE_ROUND**, 22 completadas revisadas.
Una lectura explícita /golfers/search.json confirmó la identidad vinculada
y género **F**, HTTP200,2026-10-06T23:22:40.388Z. No se dedujo del nombre,
no se devuelve nombre/GHIN completo al navegador ni se cambia el perfil.
12 Doradas resuelven el alias pero congelaron MEN; GHIN Doradas sólo es Male.
9 Blancas no tienen rating compatible; 1 Campestre Puebla permanece sin
course+tee confirmado. Los conteos usan tee individual del owner, no el label
global de una card de grupo. Preflight real conservado en el manifest.
No QA25: el bloqueo no es sólo de identidad de catálogo. QA24 no se toca.

## DRY_RUN

Preflight local con rondas persistidas y datos GHIN live: 0 compatibles.
No se construye payload ni fingerprint de un candidato inválido; dry run
READY de posting no ejecutado. No se habilitó el flag privado.

## POST / PROVIDER_VERIFY / ROUND_TRIP / IDEMPOTENCE

**No ejecutados** por el guard anterior. 0 provider POST, 0 receipts nuevos.
No se inventa provider score ID ni se declara PASS usando fixtures.
La importación 1/2 anterior sigue PASS: 6 nuevas / 0 nuevas / 0 duplicados.
Segundo posting attempt no ejecutado, porque no existe un primero válido.

## UNIFIED_HISTORY

Revisado físicamente en DEV después del deploy del resolver. Resumen conserva
22 completas, promedio 82.8, mejor 71 y 18 birdies; GHIN 30.8 y Backyard 5.5 separados.
Rondas muestra 6 GHIN de sólo lectura con Ajustado, 22 completas Backyard-only y
la cancelada preservada; 0 vinculadas, 0 ambiguas. El alias de catálogo no
fabrica un match de score. No se inventan stats ni se duplican rondas.

## REQUEST_BUDGET

Ventana desde23:03Z, sólo sesión del agente. Cuatro POST a /api/profile/ghin/courses
(consultas read-only, no score posting),seis GET upstream necesarios, todos200.
Cloud GET 3 / POST 0 / rounds 0 observados. Dos full bundles legítimos por cargas deliberadas
de las dos UI nuevas;521587B cada uno, knownCloud=false, apply/gate success.
Un evento online produjo lectura condicional259B.0 full inesperados,0 retries,
0 failures/409,0 storm,0 polling. No se reinvestigó cloud ni se cambió su código.
Reposo23:22:41–23:24:41Z:120s,0 llamadas cloud y0 GHIN periódicas.
Lookup requests: 148 B total; respuestas: 34,767 B total, máxima 23,785 B. Request máximo: 41 B.
GHIN upstream raw bytes y conteos exhaustivos de GET perfil/import-page no
instrumentados: null, no cero. No confundir estas cuatro consultas con POST
a /scores/hbh.json: este último recibió **0**.

## QA24 / BASELINE

PASS: 26/26 IDs, versiones y hashes de snapshot/scores intactos: 22 completed,
1 cancelled, 3 live. QA24 v4, ID 16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d, live H2, H1 = 5/6.
SnapshotMD5 16c685ee0777efdeeb9a7795e313446a; scoresMD5 66e1869c4a4a09292175d295235e2762.
GHIN 6, receipts 0, Backyard Index 5.5, Atest 11/20 = 55% y GHIN 30.8 preservados.
No rondas nuevas, edición, cancelación ni cleanup.

## TESTS

142/142 dirigidos GHIN; suite de 4,598: 4,593 PASS, exactamente 5 baseline, 0 nuevos FAIL.
117/117 scripts. Typecheck, lint y build PASS. Baseline: equipment-owner-review,
equipment-ui-contract,final-brand-ghin-closeout Equipment,iphone-capture Rules,
nightly-catalog-quality equipment-gaps. Un fallo de fixture VM se corrigió en
el test nuevo; restricciones locales de localhost/temp/build se validaron
con el mismo runner autorizado y sin credenciales. Ninguna falla nueva final.
Nuevos tests verifican sesión/selector/privacidad/DEV guards, género explícito,
no auto lookup/coalescing,alias conservador,geometría congelada y lectura
batch de50cards con dos consultas de catálogo,en proceso local,sin Vercel.

## GIT

Commits de esta continuación: c2a5503 lookup,52c99d6 género/estado,7586232 alias/regresiones.
Archivos funcionales: route profile/ghin/courses;ghin-course-lookup;read-only
panel/hook y CSS scoped;core/course-lookup/catalog-alias/score-import.server;
tests GHIN. DML/facts/manifest/guía/reporte son auditoría del mismo alcance.
El commit final de documentación y su SHA se entregan tras push/health.
main,beta,Production,app.thebackyard.com.mx y rama de campos no tocados.

## UNRESOLVED

No tarjeta completed compatible con el género/rating del GHIN vinculado.
Posting,provider verify,round-trip y segundo intento no ejecutados.
Confirmación de clean login posterior al import aún pendiente; el Safari
privado previo sigue PASS pero no sustituye esa evidencia.
DEV del código READY/health200/buildSha7586232a14ae4d1767b0714c964ee0bdeea33d29.
Todo queda persistido para revisión; no se declara DONE.

---

# Evidencia anterior de importación — checkpoint preservado

Lo siguiente documenta la fase anterior, no nuevas ejecuciones ni el estado
actual del mapping. Su bloqueo anterior por identidad fue parcialmente
resuelto arriba; el bloqueo actual es la incompatibilidad de rating/género.

# GHIN Full Cycle — importación real de el_mongas

Estado de aquel checkpoint: **POSTING_BLOCKED_MAPPING. No DONE del ciclo completo.**
Continuación desde `b1030d00b27f9a6a259c32c5200eea4063636bb1`,
exclusivamente `integration/backyard-current` y **https://dev.thebackyard.com.mx**.
El smoke limpio de hydration permanece **PASS externo**, certificado por el
usuario en Safari privado. No se reinvestigó ni modificó cloud sync.

## SCORING_RECORD

**PASS real.** Tras la reautorización manual del usuario, una acción “Ver scoring
record” consultó el GHIN ya vinculado. Traza DEV `2026-10-06T22:13:54.980Z`:
`/scores.json`, HTTP **200**, 97 ms, retryable=false. **6 tarjetas** recuperadas.
El vínculo y los seis external_player_id persistidos corresponden al mismo owner
y provider profile de el_mongas; verificación SQL booleana, sin publicar esa identidad.

GHIN VERIFIED **30.8**, último sync exitoso `2026-10-06T22:13:02.411Z`.
Las seis tarjetas tienen 18 hoyos, rating 71, slope 137. El provider devuelve
**adjusted gross**, pero **gross, course ID y tee ID son null**.
No se inventa gross, par, hole scores ni estadísticas.

| Provider score ID | Fecha | Tee | Ajustado | Diferencial | Tipo |
|---|---|---|---:|---:|---|
| 902029046 | 2023-06-07 | Red / Red | 112 | 33.8 | C |
| 899647834 | 2023-06-01 | Red | 107 | 29.7 | H |
| 888298526 | 2023-05-01 | Red / Red | 116 | 37.1 | C |
| 853907291 | 2022-10-06 | Red / Red | 122 | 42.1 | C |
| 819244193 | 2022-06-21 | Red / Red | 129 | 47.8 | C |
| 816066271 | 2022-06-12 | Red | 126 | 45.4 | H |

Nombre recibido para Red: “La Vista Country Club | La Vista”. Para Red / Red:
“La Vista Country Club | La Vista / La Vista Country Club | La Vista”.
Se conserva el texto del provider; no se infiere una identidad de campo desde él.

## IMPORT_1

**PASS real.** Un click en “Sincronizar tarjetas GHIN” ejecutó el endpoint normal,
con sesión legítima, normalización y RPC privada existente. HTTP **200**.
FETCHED **6**, IMPORTED_NEW **6**, MATCHED_EXISTING **0**, AMBIGUOUS **0**,
SKIPPED_INVALID **0**. Se persistieron seis IDs únicos; import timestamp
`2026-10-06T22:14:35.725626Z`. No SQL manual de inserción ni fixtures como evidencia final.

## IMPORT_2

**PASS real / idempotente.** Segunda acción idéntica: HTTP **200**,
IMPORTED_NEW **0**, total persistido **6**, duplicates **0**, matched **0**,
ambiguous **0**. `imported_at` permanece intacto; la sincronización explícita
actualiza el clock `updated_at` del provider, según la RPC existente.
No cambia identidad ni valores oficiales y no modifica rondas Backyard.

## RECONCILIATION

**PASS sobre datos reales disponibles.** GHIN_ONLY **6**, BACKYARD_ONLY
**22 completadas**, BACKYARD_PLUS_GHIN **0**, MATCH_REVIEW_REQUIRED **0**.
Las fechas oficiales 2022–2023 no corresponden a las rondas Backyard QA de 2026.
No hay match por nombre, fusión ambigua, sustitución de scores o pérdida de datos ricos.

## MAPPINGS

**POSTING_BLOCKED_MAPPING.** Ninguna de las 22 completadas tiene ambos mappings
CONFIRMED para sus IDs congelados. Auditoría read-only de las tres combinaciones:

| Campo/ID Backyard congelado | Tee/ID congelado | Completadas | Curso y tee GHIN CONFIRMED |
|---|---|---:|---|
| course-campestre-puebla | ghin:23232:tee:468e7646a10f | 1 | No |
| course-la-vista-club-current | tee-la-vista-club-current-gold | 12 | No |
| course-la-vista-club-current | tee-la-vista-club-current-white | 9 | No |

El scoring record real devuelve IDs de campo/tee **null**, tees **Red / Red** o
**Red**, rating 71/slope 137, sin par. No confirma Blancas/Doradas ni el curso
congelado. Un prefijo en un ID local o una semejanza de nombre no basta.

## POST_CANDIDATE

**POSTING_BLOCKED_MAPPING**, elegibles **0**. No se ejecutó un dry run nuevo
sin los mappings. QA24 y canceladas/incompletas permanecen excluidas.

## POST_RESULT

**No ejecutado**, posts upstream **0**. Transport read-only y flag privado
apagado conservados. No se habilitó posting con guards incompletos.

## PROVIDER_VERIFY

No ejecutado; no hay una tarjeta nueva publicada que confirmar.
La lectura exitosa del scoring record no se presenta como verificación de posting.

## ROUND_TRIP

No ejecutado upstream. Falta mapping → candidato → post → confirmación provider.
No se declara PASS mediante tests locales.

## IDEMPOTENCE

Importación real **PASS**: segunda sincronización 0 nuevas y constraint único
mantiene seis registros. Segundo intento de posting **no ejecutado**:
no existe un primer post válido. No se realizó un segundo POST upstream.

## CAREER

**PASS de lectura real tras importación**: Resumen, Logros, Rivalidades, Rondas,
Torneos y Atest. Carrera mantiene sus cinco subvistas y navegación inferior activa.
Resumen conserva **22 completadas**, gross promedio **82.8**, mejor **71**,
**18 birdies**. Logros conserva **5/7**, incluyendo Birdie Club 18/10.
Rivalidades muestra **25 enfrentamientos**, exclusivamente de tarjetas Backyard.
Torneos conserva estado vacío **0**, sin inventar competiciones.

Rondas muestra las tarjetas oficiales en historial unificado, ordenadas por fecha
real, badge GHIN, sólo lectura y score etiquetado Ajustado. Se abrió el detalle de
`902029046`: 112 ajustado, 18 hoyos, diff 33.8, rating 71, slope 137.
Las seis ajustado-only quedan excluidas del gross promedio/best; no producen
birdies, putts, GIR, rivalidades, bets ni Atest.

Se detectó y corrigió un defecto de presentación en
`app/components/ghin-import-history.module.css`: la columna score fija de 40 px
y “Ajustado” inline se encimaban con el badge. La tarjeta importada ahora usa
columna score intrínseca y etiqueta en otra línea. Alcance únicamente CSS de
GhinProviderCard, usado en Perfil/Carrera/Histórico; sin cambios de contratos.

**PASS visual en DEV** del ajuste: las seis tarjetas tienen score/etiqueta
separados del badge, 0 intersecciones y 0 overflow de tarjeta, con ancho DOM
efectivo **573 px**. Se pidió 390 px mediante la capacidad documentada, pero
no cambió el ancho real; no se declara QA 390 px ni iPhone físico desde esa
observación. Evidencia local: `.qa-artifacts/ghin-import-fixed-dev.jpg`.
Tras una recarga controlada del nuevo build, el GET privado recuperó las
seis tarjetas persistidas (200, **3,372 B**) sin otra llamada upstream GHIN.

## ATEST

**PASS**, **11/20 = 55%** visible después de las importaciones.
Las seis GHIN-only se muestran aparte como sólo lectura; no entran al Atest.

## BACKYARD_INDEX

**PASS**, **5.5** preservado, separado del provider. Ninguna GHIN-only se
añadió al cálculo interno ni se alteraron scores/matemática.

## GHIN_INDEX

**PASS real**, VERIFIED **30.8**, fuente primaria según prioridad actual de
HandicapProvider. No se promedia con Backyard Index ni cambia el freeze de QA24.

## QA24

**PASS integridad**, ID `16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d`,
local `rrouggse`, versión **4**, live en **H2**, H1 **5/6**.
Inicio muestra “Continuar ronda · Hoyo 2 de 18”. No se abrió score capture,
editó, cerró, canceló ni publicó. Hashes y scores coinciden con el pre-import.

## BASELINE

**PASS**: **26/26 snapshots/versiones/scores sin cambios** después de ambos
imports y navegación. **22 completed, 1 cancelled, 3 live**.
Las 20 originales, QA21 versión 11, QA22 cancelada, QA23 y QA24 se preservan.
No se revirtió el clock histórico de QA21, ni se repitieron las rondas.

## REQUEST_BUDGET

Ventana de acciones observadas: `22:13:52.458–22:24:53.727Z`.

| Medición | Resultado y alcance |
|---|---|
| /api/profile/ghin scoring | 1 acción explícita, upstream /scores.json 200 confirmado |
| GHIN scoring reads | 1 traza confirmada; 3 lecturas esperadas por flujo ejecutado (vista + 2 imports) |
| GHIN import POST | 2, ambos HTTP 200 |
| Import request bytes | 20 por POST |
| Import response bytes | 3,401 por respuesta |
| Provider score posting | 0 |
| Cloud sync GET / POST / rounds | 0 / 0 / 0 observados en diagnostics de pestaña |
| Full bundles / retries / failures | 0 / 0 / 0 observados en esa ventana |
| Reposo | 136.778 s, cloud 0, GHIN 0 nuevos eventos |
| Storm / polling / usage guard | No observado / no observado / no activado |

La medición no es un conteo global exhaustivo de Vercel. Bytes del endpoint
de scoring view no capturados: **null**, no cero. Respuesta máxima **medida
de import** 3,401 B; no se afirma que sea el máximo absoluto de todos los endpoints.
Tráfico de deployment/rehidratación posterior se reporta separado.

**Total observado incluyendo carga del build CSS:** cloud sync GET **1**,
POST **0**, cloudRounds **0**; import GET persistido **1**, import POST **2**.
Full bundles **1 legítimo**, **0 inesperados**; retries **0**, failures **0**.
Máxima respuesta cloud medida **521,587 B**; máximo upload medido **20 B**.
El único full GET fue mount con knownCloud=false durante la recarga deliberada
del deployment: apply/gate success, sin POST, conflicto ni recovery.
Desde cycle success `22:29:45.767Z` hasta `22:32:10.784Z` (**145 s**),
no hubo más eventos cloud pese a las lecturas/navegación. Esto es distinto del
reposo puro de 136.778 s ya certificado en la tabla.

## CLEAN_SESSION

Smoke inicial **PASS externo del usuario** en Safari privado.
Relogin limpio **posterior a estas importaciones pendiente de confirmación**
del usuario. Se solicitó nueva sesión privada con seis tarjetas, ambos índices,
Atest y QA24. La pestaña actual del agente no se usa como prueba de contexto vacío.

## TESTS

Ejecutados después del cambio CSS:
- Dirigidos GHIN/import/RLS/identidad/session/guards: **69/69 PASS**.
- Suite completa: **4,581**, **4,576 PASS**, **5 baseline**, **0 nuevos FAIL**.
- Los mismos cinco: equipment-owner-review; equipment-ui-contract;
  final-brand-ghin-closeout Equipment; iphone-capture Rules;
  nightly-catalog-quality equipment-gaps.
- Typecheck **PASS**, lint **PASS**, build **PASS**.
- Compilación TS validada existente, sin cambios TS/JS en esta continuación;
  tests que renderizan/inspeccionan componentes leen el source actual.
- El checkpoint previo ya ejecutó 135 GHIN, 1,139 dirigidos cloud/domain y 117 scripts.
  Esas cifras se conservan con su fecha/alcance; no se cuentan como nuevas ejecuciones.

## GIT

SHA inicial `b1030d00b27f9a6a259c32c5200eea4063636bb1`.
Commit CSS `f3de6341e78f3127ce5b6b6dab6c2b7846ad8d08`:
`fix(ghin): keep adjusted score labels clear of provenance badges`.
Documentos: guía, manifest y reporte actualizados con importación real.
Sin cambios cloud, betting engine, GHIN transport, schema/RLS ni otras áreas.
Main/beta/Production/app.thebackyard.com.mx/rama de campos intactos.

## DEPLOYMENT

Target exclusivo: `origin/integration/backyard-current` →
**https://dev.thebackyard.com.mx**. Código verificado **READY**,
`dpl_3qdXMPYTYeWURxmVH3hcfEV186Rg`, alias DEV confirmado.
Health HTTP **200**, environment **preview**, buildSha
`f3de6341e78f3127ce5b6b6dab6c2b7846ad8d08`.
El commit documental posterior no cambia el código verificado.
Su SHA final y health/READY se entregan después del push del reporte.

## MANUAL_REVIEW

[Guía](../MANUAL_REVIEW_EL_MONGAS_GHIN.md),
[manifest](GHIN_EL_MONGAS_FINAL.json). Se dejan las seis tarjetas persistidas
y todas las rondas/evidencias anteriores. Sin cleanup.

## UNRESOLVED

1. Course + tee CONFIRMED para un candidato existente elegible.
2. Posting/dry run/provider verify/round-trip/segundo post bloqueado reales,
   detenidos antes de upstream por ese guard.
3. Relogin privado posterior a import, pendiente de confirmación externa.
4. Viewport 390 px no aplicado por la capacidad del navegador; prueba visual
   realizada a 573 px. Verificación física posterior pendiente del usuario.

---

# Checkpoints históricos — sustituidos por el reporte actual anterior

# GHIN Full Cycle — scoring record intentado tras smoke físico

Estado actual: **USER_REAUTH_REQUIRED. No DONE.**

| Bloque solicitado | Evidencia / resultado |
|---|---|
| CLEAN_HYDRATION_SMOKE | **PASS externo**, certificado por el usuario en Safari privado DEV: sesión limpia recupera el_mongas, GHIN 30.8, Backyard 5.5, Atest 55%, Carrera/histórico/QA24; sin conflictos; Vercel sync/409/retries/runtime errors = 0 y 1 profile read explícito. No se repite la investigación cloud. |
| SCORING_RECORD | **USER_REAUTH_REQUIRED**. Un click real en Ver scoring record. Traza DEV `2026-10-06T21:56:25.555Z`: operation=scores, stage=scores, code=reauth_required, retryable=false, durationMs=0. La ruta responde 409 antes de llamar `/scores.json` porque no encuentra una sesión GHIN válida para este owner/vínculo. Count/IDs upstream desconocidos; no usar 0 como sustituto. |
| IMPORT_1 | No ejecutado; USER_REAUTH_REQUIRED. DB privada contiene 0 provider scores, confirmado read-only. |
| IMPORT_2 | No ejecutado; idempotencia real pendiente. Cobertura local pasa. |
| RECONCILIATION | No se obtuvo todavía el scoring record. Las 22 completadas permanecen Backyard-only; GHIN_ONLY/BACKYARD_PLUS_GHIN/MATCH_REVIEW_REQUIRED reales pendientes. |
| MAPPINGS | POSTING_BLOCKED_MAPPING; no se inventaron IDs ni equivalencias por nombre. Falta la evidencia provider. |
| POST_CANDIDATE | Ninguno aprobado; dry run nuevo no ejecutado. QA24 está excluida. |
| POST_RESULT | 0 publicaciones. Transport/flag read-only/apagado conservados. |
| PROVIDER_VERIFY | No ejecutado: no existe POST real que verificar. |
| ROUND_TRIP | No ejecutado contra provider; pendiente de import/mapping/post verificado. |
| IDEMPOTENCE | 135 tests dirigidos GHIN PASS, incluida cobertura local import/identidad/guards. Segunda importación y segundo intento de posting reales no ejecutados. |
| CAREER | Datos Backyard preservados; UI provider real pendiente. Usuario certificó recuperación limpia de Carrera/histórico. |
| ATEST | **11/20 = 55%**, confirmado físicamente por el usuario. No importaciones ni atestaciones nuevas. |
| BACKYARD_INDEX | **5.5**, confirmado físicamente, separado y preservado. |
| GHIN_INDEX | **30.8** visible y persistido, VERIFIED; última actualización `2026-10-06T19:40:10.015Z`. No refresh upstream nuevo. |
| QA24 | **PASS integridad**: UUID `16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d`, versión 4, live H2, H1 5/6. No se cerró/canceló/editó/publicó. |
| BASELINE | **26/26 hashes/versiones/scores sin cambios** frente al checkpoint anterior: 22 completed, 1 cancelled, 3 live. QA21/22/23/24 intactas. |
| REQUEST_BUDGET | Una acción POST `/api/profile/ghin` operation=scores confirmada por traza DEV; 0 llamadas upstream de scores en ese intento; 0 imports; 0 posting. Retry del intento = 0. Bytes de esa respuesta y conteo exhaustivo de requests de la pestaña no disponibles: null, no cero. Los ceros Vercel de Safari pertenecen a la certificación externa, no a un contador del agente. Sin loops ni polling añadidos. |
| CLEAN_SESSION | Smoke inicial PASS externo del usuario. Relogin final posterior a import/posting aún no ejecutado. |
| TESTS | **135/135 PASS** dirigidos GHIN ejecutados en esta continuación. Código sin cambios desde el fix validado: previamente dirigidos 1,139 PASS + scripts 117 PASS; suite 4,576 PASS y 5 baseline, 0 nuevos; typecheck/lint/build PASS. No se presenta la suite anterior como una ejecución nueva. |
| GIT | SHA inicial `7e16dcc0db73480b23c0c65678bac4d387068603`; cambios actuales sólo documentos QA. Sin schema/RLS/code changes. |
| DEPLOYMENT | Al iniciar: DEV health HTTP 200, preview, buildSha `7e16dcc0db73480b23c0c65678bac4d387068603`, remote HEAD igual y worktree limpio. Push sólo integration/backyard-current al guardar el reporte. |
| MANUAL_REVIEW | `docs/MANUAL_REVIEW_EL_MONGAS_GHIN.md`; `docs/qa/GHIN_EL_MONGAS_FINAL.json`. Pantalla Reautorizar GHIN abierta en DEV; credenciales sólo allí, ingresadas por el usuario. |
| UNRESOLVED | Reautorizar manualmente; después scoring record, import 1/2, reconciliación/UI, mappings confirmados, dry run/post/provider verify/round-trip/segundo intento y clean relogin final. No cleanup. main/beta/Production/app.thebackyard y ramas ajenas intactos. |

---

# Checkpoint anterior de hidratación — sustituido por el estado arriba

Checkpoint actual: **BLOCKED_EXTERNAL. No DONE.** El fix local está publicado;
falta una sesión limpia para certificar el smoke y desbloquear GHIN. No se
ejecutó ninguna llamada upstream, importación o publicación GHIN en esta continuación.

## A. CLOUD HYDRATION ROOT CAUSE

PASS reproducción local del writer: `app/page.tsx`, efecto pasivo del perfil,
`syncAccountPrimaryFrequentPlayer` en `lib/account-primary-player.ts`.
Index transitorio null → fila propia HCP 30.8 → null, timestamp nuevo y
reordenación; sin acción del usuario. Apply/persist/read/gate reales producen
upload con reason `frequentPlayers`. La recuperación local dependía además de
`identity.defaultHandicap`, y el editor persistía normalizaciones como material.
Diagnóstico detallado: [CLOUD_HYDRATION_ROOT_CAUSE.md](CLOUD_HYDRATION_ROOT_CAUSE.md).
No se inventa el callback retrospectivo de QA21 ni el de cada toggle de capture mode.

## B. CLOUD FIX

PASS local: proyección de frecuentes sin escritura; frontera entre documento
canónico y vista normalizada; recuperación por identidad, sin dependencia del
HCP que llega; fencing del propietario; cursor local-only; timestamps estables;
checkpoints conservan metadatos; cambios sólo de updatedAt no suben historial.
El Index vigente se usa en preflight e inicio explícito con la fórmula existente.
Se conservan CAS, offline, ACK, receipts, conflictos, delta y retries limitados.

## C. CLEAN HYDRATION SMOKE

BLOCKED_EXTERNAL. La nueva pestaña Chrome reutilizó storage autenticado previo
y mostró **14 conflictos** locales/cloud. No fue browser vacío ni login limpio.
No se eligió automáticamente ninguna copia. Falta la sesión limpia solicitada
al usuario. No se certifica PASS por la sola ausencia de POST en ese estado.

## D. GHIN SESSION

VERIFIED persistido en DEV para el owner autorizado. Sesión upstream no
reconsultada: su validez actual es desconocida. El anterior REAUTH_REQUIRED
no se convierte en un nuevo resultado sin efectuar la consulta.

## E. SCORING RECORD

BLOCKED_EXTERNAL, no ejecutado en esta continuación; count/IDs upstream desconocidos.

## F. IMPORT 1

BLOCKED_EXTERNAL, no ejecutado. Tabla privada actual: **0 provider scores**.
FETCHED/MATCHED/AMBIGUOUS/SKIPPED upstream todavía desconocidos.

## G. IMPORT 2 IDEMPOTENCE

PASS tests locales existentes; BLOCKED_EXTERNAL corrida real, no ejecutada.

## H. RECONCILIATION

Implementación/tests conservados. Clasificación real de GHIN_ONLY,
BACKYARD_PLUS_GHIN y MATCH_REVIEW_REQUIRED pendiente de importación.
Las 22 completadas siguen Backyard-only en persistencia actual.

## I. GHIN INDEX / BACKYARD INDEX

GHIN **30.8**, VERIFIED persistido, último sync exitoso
`2026-10-06T19:40:10.015Z`. Backyard **5.5**, último cálculo certificado,
historial material intacto. No se promedian ni se incorpora GHIN-only al cálculo interno.

## J. COURSE/TEE MAPPINGS

POSTING_BLOCKED_MAPPING. No se inventan equivalencias por nombre ni IDs.
Nueva evidencia upstream pendiente del smoke y scoring record.

## K. POST CANDIDATE

POSTING_BLOCKED_MAPPING, sin candidato aprobado ni dry run real nuevo.
QA24 excluida por ser live.

## L. POST RESULT

0 publicaciones reales. Feature flag/transport siguen apagados/read-only.

## M. PROVIDER VERIFY

BLOCKED_EXTERNAL, no ejecutado; no existe respuesta de posting que verificar.

## N. ROUND TRIP

BLOCKED_EXTERNAL, no ejecutado contra GHIN. Tests de vínculo conservados.

## O. SECOND POST BLOCKED

PASS cobertura local de exactly-once; prueba real no ejecutada. No se efectuó segundo POST.

## P. CAREER/HISTORY

PASS regresiones locales. Historial material de las 26 filas conserva hashes,
versiones y scores. QA visual con provider records reales y relogin final pendiente.

## Q. ATEST

Último estado certificado **11/20, 55%**. No se cambió el motor ni se importó
GHIN. No se hizo nueva atestación; provider-only sigue excluido por contrato y tests.

## R. QA24

PASS integridad DB: `16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d` / `rrouggse`,
live, versión 4, H1 **5/6**, H2 pendiente. Mismos hashes de snapshot y scores.
No se cerró, canceló, publicó ni reemplazó.

## S. BASELINE

PASS auditoría read-only: **26/26 sin cambios** desde `a7a6d03`; 22 completed,
1 cancelled, 3 live. QA21 continúa versión 11 con scores intactos; QA22
cancelled; QA23 completed. Draft, frecuentes y grupos también conservan
hashes y clocks: 9 registros auditados, 0 diferencias. No hubo DB/schema writes.

## T. REQUEST BUDGET

Ventana Chrome `21:11:57–21:15:25Z`: **1 GET sync**, **0 POST sync**,
**0 cloudRounds observados**, **0 retries**, **0 failures**, **1 full bundle
legítimo inicial** (knownCloud=false), **0 full bundles inesperados**.
Máxima respuesta: **521,587 bytes**; máximo upload observado: **0 bytes**.
Reposo desde último evento: **205 segundos**, **0 nuevas llamadas cloud**.
No polling/storm observado. Son diagnostics de esa pestaña, no un conteo
exhaustivo global de Vercel. Smoke limpio aún no certificado.
GHIN profile/scoring-record/import/posting upstream de esta continuación: **0 acciones**.

## U. CLEAN SESSION FINAL

BLOCKED_EXTERNAL, pendiente. No se reutiliza la sesión con conflictos como evidencia limpia.

## V. TESTS

- Dirigidos: **1,139 PASS / 0 FAIL**; incluyen cloud/offline/lifecycle/frecuentes/
  grupos/HCP/index/Carrera/Atest/import/RLS y configuración de apuestas.
- Scripts locales: **117 PASS / 0 FAIL**.
- Suite completa: **4,581**, **4,576 PASS**, los **5 baseline** siguientes, **0 nuevos FAIL**:
  equipment-owner-review; equipment-ui-contract; final-brand-ghin-closeout Equipment;
  iphone-capture Rules; nightly-catalog-quality equipment-gaps.
- Typecheck **PASS**, lint **PASS**, build **PASS**.
- Nuevas regresiones de hidratación: **16 PASS**. No equivalen a smoke upstream.

## W. GIT

Inicial `a7a6d033f733cc3c1a41edbe9aa4c947f28e5c2d`.
Fix `a3a6e12286bd19e3d065c2810c5eb0c8620360da`:
`fix(cloud): prevent hydration from producing local mutations`.
17 archivos: page/normalización/frontera cloud/plantillas/delta/tests/fixture y
diagnóstico. Sin cambios al engine, servidor GHIN, schema o RLS.
Los resultados se conservan en el commit documental posterior; consultar HEAD
de `integration/backyard-current` para el SHA del reporte.

## X. DEPLOYMENT

Fix DEV READY: `dpl_6aA2tSk5jtAFfP518tQRsE8ZA2RV`.
**https://dev.thebackyard.com.mx/api/health**, HTTP **200**, preview,
buildSha **a3a6e12286bd19e3d065c2810c5eb0c8620360da** al verificar el fix.
Sólo push a `origin/integration/backyard-current`; main/beta/Production/
app.thebackyard.com.mx y rama de campos no se modificaron.

## Y. MANUAL REVIEW

[Guía](../MANUAL_REVIEW_EL_MONGAS_GHIN.md),
[manifest](GHIN_EL_MONGAS_FINAL.json), [diagnóstico local](CLOUD_HYDRATION_ROOT_CAUSE.md).
Todo queda persistido. La revisión automática rechazó llevar la pestaña
anterior a about:blank por riesgo de descartar estado en memoria; se dejó
intacta y se abrió otra pestaña como alternativa. No se evadió el rechazo.

## Z. UNRESOLVED

Sesión limpia/smoke, scoring record real, import 1/2, reconciliación/UI real,
mappings confirmados, candidato/dry run, transport/post/provider verify/round-trip,
segundo intento bloqueado y relogin final. No se pidió contraseña/OTP en chat
ni se hizo cleanup. Causa de las mutaciones actuales reproducida localmente;
los callers históricos no capturados de QA21/capture-mode quedan explicitados.

---

# Checkpoint anterior conservado — sustituido por el estado arriba

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

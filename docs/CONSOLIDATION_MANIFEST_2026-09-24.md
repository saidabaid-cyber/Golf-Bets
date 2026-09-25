# The Backyard — Consolidation Manifest

- Fecha de corte: 2026-09-24
- Repositorio: saidabaid-cyber/Golf-Bets
- Rama canónica: integration/backyard-current
- Baseline exigido: 3274c418a27da49ca6acb2ce7d025f4efcd070d3
- Ancla de implementación comprometida usada para la gráfica (`CANON`): 108a8642c856a2034f98c9680e57717948f50019
- Commit que contiene este documento: se determina externamente con `git rev-parse HEAD` después de comprometerlo; no se autoescribe dentro del manifiesto.

## Alcance y cautelas

Este documento registra la auditoría semántica de las 28 refs de rama remotas `origin/*` disponibles. Se excluye el ref simbólico `origin`/`origin/HEAD`, que no es una rama adicional. No presupone que el commit más reciente de una rama sea el producto más completo y no equipara compilación, despliegue o presencia de archivos con PASS funcional.

Estado confirmado en el corte:

- Los 14 commits de Admin/Courses de phase2/admin-control-center-2026-09-22 están contenidos en la rama canónica.
- Los cinco commits de codex/ghin-poc están contenidos mediante el merge adc604ac66721d17edd2109f3a40438edfdeb3f2. Esto integra código, no acredita autenticación GHIN real ni QA interactivo.
- La cadena válida de backup de main fue recuperada selectivamente como commits canónicos 1b6dde7a..108a8642. No se hizo merge de main.
- Los runbooks provider-independent de infra/disaster-recovery-clean fueron recuperados y reconciliados en el estado final que contiene este documento; los gates Backup 33/33, Recovery 6/6 y Automation 37/37 pasaron.
- El port manual de health/runtime está integrado con endpoint, identidad sanitizada y prueba dedicada; la suite global pasó, pero la QA runtime del deployment final sigue pendiente.
- La recuperación legal está integrada mediante ledger append-only, API autenticada, cola cliente, wiring de consentimiento, export limitado y RPC transaccional. No acredita revisión jurídica ni QA interactiva; el contrato DB/RLS pasó en QA.
- La rama Supabase QA aislada es `phase2-full-platform-qa` / `bymeopxkxapfizeeqeyb`. Su ledger contiene **58** registros remotos. GHIN/provider, guard lifecycle de Feedback, ingest legal transaccional y hardening Realtime de Polla fueron los cuatro applies controlados, sólo QA.
- La ejecución remota final del runner RLS terminó **17/17 PASS** contra la QA aislada, con rollback y 0 fixtures fijos del runner; preservó 13 solicitudes Feedback QA/internas preexistentes. El security advisor conserva 23 findings abiertos (17 `WARN`, 6 `INFO`) y el advisor de rendimiento 125 (14 `WARN`, 111 `INFO`), por lo que esto no se presenta como cierre global de seguridad.
- La suite local final pasó **3,589/3,589**; ESLint y TypeScript pasaron sin errores; el build de producción con Next.js 16.3.3 compiló y generó 35/35 páginas estáticas. El auditor recorrió 722 archivos fuente, 14 assets públicos y 30 referencias con 0 faltantes y 0 URLs activas de previews Vercel aleatorios. Backup 33/33, Recovery 6/6, Automation 37/37, sintaxis QA 32/32 y `git diff --check` también quedaron verdes. Estos gates no sustituyen QA runtime.
- Evidencia externa observada sin mutación confirma el workflow `365582254`, su run programado exitoso `35979285016` sobre `2c15c9a02f36643244a7b0a420aa2ade570f2a10` y el artifact `10798973211` de 24,437,675 bytes con expiración 2026-10-01. Esto acredita un paquete publicado, no un restore verificado ni custodia remota actual.
- No se promovió Production, no se aplicaron migraciones de Production y no se disparó un nuevo workflow de backup como parte de esta consolidación.
- Antes de consolidar se creó el tag anotado `pre-consolidation-2026-09-24`; su objeto `tag` resuelve con `^{}` exactamente al baseline 3274c418a27da49ca6acb2ce7d025f4efcd070d3.
- El checkout original `C:\Users\said_\Golf-Bets`, en `codex-dev` y HEAD e6c60773384b0785b289cb167f4577489d2d21fc, se mantuvo separado e intacto con sus 17 archivos modificados y `lib/nassau-migration.ts` sin seguimiento.

El working tree canónico no estaba limpio al crear este archivo porque contenía trabajo concurrente y deliberado. Este manifiesto conserva `CANON` como ancla gráfica histórica; los ports aceptados descritos como “recuperados” forman parte del commit que contiene este documento, salvo cuando una fila los clasifica expresamente como pendientes externos o rechazados.

## Metodología

Para cada rama se usaron, según correspondía:

1. git merge-base contra el baseline y contra el HEAD canónico.
2. git rev-list --left-right --count para medir divergencia gráfica.
3. git cherry y patch-id estable para detectar parches equivalentes con SHA distinto.
4. git range-diff para comparar nightly, integration-candidate y sus ports posteriores.
5. git diff, diff-tree, ls-tree, hashes de blob y git log por ruta para comprobar comportamiento y destino.
6. Lectura de implementación, tests, migraciones y configuración; no se clasificó por nombres de archivo solamente.

En las columnas L/R, L es exclusivo del baseline o canonical indicado y R es exclusivo de la rama remota. Un commit puede ser gráficamente único y, aun así, estar semánticamente incluido por un port posterior.

Identificadores de merge-base usados en la tabla:

- BASE = 3274c418a27da49ca6acb2ce7d025f4efcd070d3
- CANON = 108a8642c856a2034f98c9680e57717948f50019
- TIP = el HEAD completo de la rama remota mostrado en ese mismo renglón
- OLD = 6ceea3f4f9ccfe474f3cd2f804b1ee3e88cb59f4
- COURSE = 8fe4379d4afa034bc1dd6b37fcd058046ed669c3
- FULL = 97fe6f3c9258c4336a9bd3e65d99694a2f1dbff5
- DR = dbf30b080c8e76d3e56bab5c311a60e7ac65d897

## Clasificaciones

- ALREADY_SEMANTICALLY_INCLUDED: la intención válida está en canonical, aunque el SHA o el parche completo difieran.
- RECOVER_REQUIRED: había implementación válida ausente al auditar.
- SUPERSEDED: canonical contiene una implementación posterior y mejor.
- QA_DOCS_ONLY: evidencia, test o documentación sin nueva función de producto.
- DO_NOT_MERGE: el cambio introduciría regresión, configuración de rama obsoleta o una política insegura.
- MANUAL_PORT_REQUIRED: la intención es válida, pero el commit no se puede integrar sin adaptar la arquitectura actual.

## Grupos de rutas afectadas

- CORE: producto histórico bajo app/, lib/, tests/, data/, public/ y supabase/.
- RH: app/page.tsx, numeric capture, account-provider, cloud-sync, cloud-sync-cycle, round-review, round-half, engine, side-bets, bet catalog/help y tests de captura/apuestas.
- ADMIN: Admin Control Center, selección de campo/tee/hoyo, permisos, catálogos de Puebla/México, Rating/Slope, scorecards incompletos, separación QA, datos y docs P01–P05, migración admin_data_environment_separation y tests.
- GHIN: lib/ghin/, features/handicap/providers.ts, feature flags, app/admin/dev/ghin, API diagnóstica, migración/mapeos RLS, docs y tests GHIN.
- FULLPLATFORM: permisos, username/handedness, Equipment detail, onboarding/first-round, feedback, tee/start-hole, ball visibility y sus migraciones/tests.
- AIQA: scorecard vision/review, cloud/offline store, structured actions, supplemental bets, matrices deterministas, catalog QA, consent y scripts de gates.
- LEGAL: documentos v6/v2, legal choice state, evidence API, account export, consentimiento, migración append-only y tests.
- HARDENING: health/runtime, telemetría de errores/eventos, Admin/export antiguo y migración production_hardening_v1.
- BACKUP: workflow, scripts/backup/, docs/disaster-recovery/, .env.example, .gitignore, package.json y vercel.json.
- DEPLOY: sólo toggles deploymentEnabled/ignoreCommand para ramas históricas.

La columna Rutas usa estos grupos como expansión de los archivos afectados por los commits únicos de cada rama. `— (sin archivos únicos)` significa que el tip remoto es ancestro de la comparación y no aporta un diff propio que recuperar; no significa que la rama histórica estuviera vacía.

## Inventario exhaustivo de refs remotas

| Branch | HEAD completo | Merge-base BASE; L/R | Merge-base CANON; L/R | Commits gráficamente únicos e intención | Rutas | Clasificación y destino |
|---|---|---|---|---|---|---|
| origin/ai-first-phase1 | e1852d9eb2f6dbb23dfd2c654881809775278ddd | TIP; 278/0 | TIP; 308/0 | Ninguno contra canonical | — (sin archivos únicos) | ALREADY_SEMANTICALLY_INCLUDED en canonical |
| origin/archive/phase1-final | 5c278d7d27bcf68883108341503eaff6cf95fe24 | TIP; 265/0 | TIP; 295/0 | Ninguno | — (sin archivos únicos) | ALREADY_SEMANTICALLY_INCLUDED |
| origin/beta | c9a9d3550a0feb39fdeda82fcc79ab6eddb1a582 | TIP; 274/0 | TIP; 304/0 | Ninguno | — (sin archivos únicos) | ALREADY_SEMANTICALLY_INCLUDED |
| origin/codex-dev | 6ceea3f4f9ccfe474f3cd2f804b1ee3e88cb59f4 | TIP; 341/0 | TIP; 371/0 | Ninguno | — (sin archivos únicos) | ALREADY_SEMANTICALLY_INCLUDED |
| origin/codex/ghin-poc | f23064e063f3a2b22a364e2a3652f810b7dd9381 | BASE; 0/5 | TIP; 25/0 | 0b7688d foundation; d1a13db diagnostic; 60ba35d mappings; f14e572 evidence doc; f23064e access hardening | GHIN | ALREADY_SEMANTICALLY_INCLUDED por adc604ac; fundación DB aplicada sólo en QA como `20260924233419`, con RLS PASS y live flags apagados |
| origin/fix/phase1-final-unblock-beta | 5c278d7d27bcf68883108341503eaff6cf95fe24 | TIP; 265/0 | TIP; 295/0 | Ninguno | — (sin archivos únicos) | ALREADY_SEMANTICALLY_INCLUDED |
| origin/hotfix-round-half | 940a3902443340497655abcab55ef9b5bf060e96 | OLD; 341/4 | OLD; 371/4 | 51d42c0 sync races; c0d8eb6 checkpoints; fec2e56 local-first; 940a390 halves by play order | RH | ALREADY_SEMANTICALLY_INCLUDED mediante a7813f3/e638729/ee1b2fa/5209f18 |
| origin/hotfix/backup-drive-resume-308 | 3ffffdf6b377760a4daaccf975171795d6494acf | OLD; 341/15 | OLD; 371/15 | Prefijo MAIN/BACKUP hasta 3ffffdf: aceptar respuestas HTTP 308/resume | BACKUP | SUPERSEDED por 659ff01 y port canónico 6936a62 |
| origin/hotfix/backup-final-drive-upload | aa8d7557832ec59edb864ee1fba80d1f138ef9ae | OLD; 341/14 | OLD; 371/14 | Prefijo MAIN/BACKUP hasta aa8d755: chunks replayables | BACKUP | SUPERSEDED por 9885fc4 y port 79c4201 |
| origin/hotfix/backup-final-drive-upload-v2 | 15275e597d83cba04a6d8190a7721c6a2831ed32 | OLD; 341/16 | OLD; 371/16 | Prefijo MAIN/BACKUP hasta 15275e5: diagnostics resumables finales | BACKUP | SUPERSEDED por 2c15c9a y port 108a864 |
| origin/hotfix/cloud-backup-diagnostics | 657268979337ec1579b365d4d52f6b76d02221b9 | OLD; 341/10 | OLD; 371/10 | Prefijo MAIN/BACKUP hasta 6572689: categorías seguras de fallo | BACKUP | SUPERSEDED por 5153900 y port adaptado 650536c |
| origin/hotfix/cloud-backup-drive-upload-retry | b16f6bea90a5f42613b849bcd9633fd095c36055 | OLD; 341/13 | OLD; 371/13 | Prefijo MAIN/BACKUP hasta b16f6be: conservar retry budget | BACKUP | SUPERSEDED por 31c720e y port 39f868a |
| origin/hotfix/cloud-backup-postgres17 | b542d7f2fbc69e37bf385dd21a393d450ad90829 | OLD; 341/9 | OLD; 371/9 | Prefijo MAIN/BACKUP hasta b542d7f: PostgreSQL 17 | BACKUP | SUPERSEDED por 76d7f82 y port adaptado 23dee48 |
| origin/hotfix/cloud-backup-shared-drive | b849d7270d8d1cd7c26a6b9177a670d9441e5ff2 | OLD; 341/12 | OLD; 371/12 | Prefijo MAIN/BACKUP hasta b849d72: Shared Drive root exacto | BACKUP | SUPERSEDED por 647cbc6 y port 79362f7 |
| origin/hotfix/cloud-backup-supabase-ca | a4d86dfd856a3c345663f7d669150966397bb348 | OLD; 341/11 | OLD; 371/11 | Prefijo MAIN/BACKUP hasta a4d86df: CA Supabase fijada | BACKUP | SUPERSEDED por 11ed530 y port 028f210 |
| origin/infra/backup-automation | dffcaf233c9649044ecc185a585f9700f23ed51b | OLD; 341/7 | OLD; 371/7 | RH histórico; c3c320c legal; e574a2d backup; dffcaf2 gates | BACKUP, LEGAL, RH | SUPERSEDED como fuente por main; backup ALREADY_SEMANTICALLY_INCLUDED; port legal MANUAL_PORT_REQUIRED al auditar y recuperado en el estado final |
| origin/infra/disaster-recovery | 7c34e2416c1ea7b4207b7c7c89aefbc95c3f0585 | DR; 55/4 | DR; 85/4 | 4d11288 docs; 9bafd49 cifrado; e3e2d39 restore hardening; 7c34e24 deploy off | BACKUP, DEPLOY | SUPERSEDED por disaster-recovery-clean; toggle DO_NOT_MERGE |
| origin/infra/disaster-recovery-clean | d250b33f9ca0db5c10cbda0403b1f992be70059a | DR; 55/8 | DR; 85/8 | b0814ab docs; dc0b6e4 cifrado; c610fc4 restore; 002a82f deploy; 7db0b20 owner source; 3629044 pooler; 4142c37 preflight; d250b33 libpq | BACKUP, DEPLOY | Docs RECOVER_REQUIRED al auditar y reconciliados en el estado final; scripts SUPERSEDED por main; 002a82f DO_NOT_MERGE |
| origin/integrate/phase1-ai-first-beta | 429dfa99b0d65fb36eb34cdb909847336ed5ae69 | TIP; 275/0 | TIP; 305/0 | Ninguno | — (sin archivos únicos) | ALREADY_SEMANTICALLY_INCLUDED |
| origin/legal-app-v6-v2-hotfix | c3c320cc95ade217a5cf446aefba511192e5543f | OLD; 341/5 | OLD; 371/5 | RH histórico más c3c320c: Privacy v6, Terms v2, evidencia y export local | LEGAL, RH | Texto ALREADY_SEMANTICALLY_INCLUDED; evidencia/export MANUAL_PORT_REQUIRED al auditar y ya recuperado/verificado en canonical; DB/RLS PASS en QA, QA interactiva y revisión jurídica pendientes |
| origin/main | 2c15c9a02f36643244a7b0a420aa2ade570f2a10 | OLD; 341/16 | OLD; 371/16 | RH; c3c320c legal; e574a2d..2c15c9a backup; f857bb5 merge wrapper | RH, LEGAL, BACKUP | Nunca se mergeó entero. Backup ALREADY_SEMANTICALLY_INCLUDED por recuperación selectiva; port legal recuperado en el estado final; RH ya incluido |
| origin/phase2/admin-control-center-2026-09-22 | eaf54976582e054674f69d4c356265a62ddf35b7 | BASE; 0/14 | TIP; 16/0 | 5fb7967..eaf5497: Admin, QA separation, course flow, Puebla/México, scorecards, Rating/Slope | ADMIN | ALREADY_SEMANTICALLY_INCLUDED, destino canonical |
| origin/phase2/course-catalog-feedback | 8fe4379d4afa034bc1dd6b37fcd058046ed669c3 | TIP; 52/0 | TIP; 82/0 | Ninguno | — (sin archivos únicos) | ALREADY_SEMANTICALLY_INCLUDED |
| origin/phase2/full-platform | db517b72be2f4dd72ba6465a73d43af8e77bd7ce | FULL; 87/8 | FULL; 117/8 | b0dadbe permissions; 8ecc252 username; 3a7cd06 equipment; d9cc1f1 onboarding; a168f3d course/feedback; 46fcc8d balls; 801c673 build; db517b7 tests | FULLPLATFORM | ALREADY_SEMANTICALLY_INCLUDED o SUPERSEDED, según ledger |
| origin/phase2/integration-candidate-2026-09-22 | 9085b526133787e28575bddca35471afe7524f96 | COURSE; 52/15 | COURSE; 82/15 | 15: 11 AIQA comunes; cf9880a gate; 9085b52 RLS consent; 45a2689/c8f8f26 toggles | AIQA, DEPLOY | Función ALREADY_SEMANTICALLY_INCLUDED; toggles DO_NOT_MERGE |
| origin/phase2/nightly-core-ai-games-2026-09-22 | 98af4786f90605ee1da215fa31f335c328780080 | COURSE; 52/13 | COURSE; 82/13 | 13: 11 AIQA comunes; 9e16c08/072accb toggles; 072accb también engineering doc | AIQA, DEPLOY | Función ALREADY_SEMANTICALLY_INCLUDED; doc QA_DOCS_ONLY; toggles DO_NOT_MERGE |
| origin/production-hardening | 68090d6f8de7c291525715c0c883fc3ef62b28e4 | OLD; 341/5 | OLD; 371/5 | 51d42c0/c0d8eb6/fec2e56 RH; 185696c Admin/telemetry/health; 68090d6 version | RH, HARDENING | Admin/analytics SUPERSEDED; migración vieja DO_NOT_MERGE; health/version MANUAL_PORT_REQUIRED al auditar y recuperado en el estado final |
| origin/release/final-candidate-2026-09-23 | 3274c418a27da49ca6acb2ce7d025f4efcd070d3 | BASE; 0/0 | BASE; 30/0 | Ninguno | — (sin archivos únicos) | ALREADY_SEMANTICALLY_INCLUDED como baseline |

## Ledger semántico por bloque

### Admin, campos y datos

Los 14 commits de eaf5497 son ancestros del HEAD canónico:

- 5fb7967 — separar datos QA de operaciones.
- 232d141 — clasificar solicitudes QA legacy.
- 5c20180 — aislar fixtures QA pre-v2.
- 5d23e93 — reportar hallazgos de calidad legacy.
- eff4a80 — verificar métricas de separación QA.
- 66de81f — corregir flujo de campo, tee y hoyo inicial.
- adb7597 — aplicar separación QA en accesos legacy.
- 9e1a4fc — alinear plantillas de importación controlada.
- 1ac04b8 — endurecer catálogo de Puebla.
- feaae89 — ocultar Course Rating/Slope no verificados.
- 5cc8419 — documentar QA runtime del catálogo.
- 5912765 — auditar geolocalización México.
- cb265ea — cerrar scorecards nacionales incompletos de forma segura.
- eaf5497 — clasificar evidencia Rating/Slope por autoridad.

Rutas finales: app/api/admin/control-center, app/api/courses/search, componentes de selección/onboarding/permisos, data de cursos y evidencia, lib/admin-data-environment, providers de catálogo/geolocalización/rating, docs P01–P05, migración 20260924010936 y tests asociados.

Clasificación: ALREADY_SEMANTICALLY_INCLUDED. Esto confirma integración de código. En DB QA, la separación Admin y la proyección course/player fueron reconciliadas como equivalentes existentes y el runner RLS pasó; aún faltan runtime QA, dispositivo y triage de advisors.

### GHIN

Commits y destino:

- 0b7688d — read-only client, config, runtime server-only, provider adapter y comparación. ALREADY_SEMANTICALLY_INCLUDED.
- d1a13db — diagnóstico Admin Preview protegido. ALREADY_SEMANTICALLY_INCLUDED.
- 60ba35d — provider mappings y prueba RLS. ALREADY_SEMANTICALLY_INCLUDED en código; la fundación faltante se aplicó sólo a QA como `20260924233419` y su test RLS pasó, sin activar GHIN live.
- f14e572 — evidencia de estado Preview. QA_DOCS_ONLY.
- f23064e — hardening de acceso diagnóstico. ALREADY_SEMANTICALLY_INCLUDED.

Rutas finales: lib/ghin, app/admin/dev/ghin, app/api/admin/dev/ghin, features/handicap/providers.ts, feature flags, migración 20260924010000, prueba RLS, docs y tests.

No se declara GHIN conectado. Login real, golfer 11103349, Score History y Course Data siguen pendientes de secretos/entitlement y QA interactivo. Score posting permanece fuera de alcance.

### Hotfix de mitades, captura y local-first

Mapeo de intención hacia la línea moderna:

- 51d42c0 → a7813f3 — score commit y active draft sync races.
- c0d8eb6 → e638729 — checkpoint por hoyo y corte de sync loop.
- fec2e56 → ee1b2fa — active round estrictamente local-first.
- 940a390 → 5209f18 — mitades por orden de juego.

lib/round-half.ts tiene el mismo blob funcional y los tests canónicos agregan cobertura de salida por H10. Clasificación: ALREADY_SEMANTICALLY_INCLUDED; no cherry-pick.

### Checkout original sucio de codex-dev

Además de la ref remota limpia origin/codex-dev, se preservó intacto el checkout original de trabajo asociado a codex-dev. Su estado observado era:

- 17 archivos modificados sin commit.
- lib/nassau-migration.ts sin seguimiento.
- Intención funcional: unificar Nassau Individual, mejorar la UX de toggles/acordeones y hacer el guardado local-first tolerante a fallos de IndexedDB.

Este WIP no se usó como fuente de copia ni se limpió, descartó o alteró durante la consolidación. La revisión semántica encontró su intención integrada y endurecida en canonical mediante 5e17b45 — migrateSupplementalNassau, offlinePersisted y labels — además de mejoras posteriores de engine, configuración, persistencia y UX.

Clasificación: ALREADY_SEMANTICALLY_INCLUDED para la intención válida y SUPERSEDED para la implementación WIP. Destino final: implementación moderna ya presente en integration/backyard-current. Decisión: no copiar archivos sucios, no crear commit desde ese checkout y conservarlo intacto como evidencia recuperable.

### Full platform

- b0dadbe — permisos/onboarding. SUPERSEDED por 44afea9 y hardening 66de81f.
- 8ecc252 — handedness y username. ALREADY_SEMANTICALLY_INCLUDED por 8d9d37e.
- 3a7cd06 — controles de bastón dentro del detalle. ALREADY_SEMANTICALLY_INCLUDED por afe926a.
- d9cc1f1 — diferir grupos/apuestas a primera ronda. ALREADY_SEMANTICALLY_INCLUDED por 135ffe0.
- a168f3d — tee, shotgun y feedback. Course flow incluido por d4ca8ca/66de81f; feedback simple SUPERSEDED por la arquitectura privada posterior.
- 46fcc8d — ball additions y exclusión de QA. Patch-id exacto de 4fe4961.
- 801c673 — tipo del route context. ALREADY_SEMANTICALLY_INCLUDED; la diferencia restante es formato.
- db517b7 — contratos UX. SUPERSEDED por los ajustes 5f3c42d y c3feb3d.

Rutas afectadas: device permissions, profile username, equipment panel/CSS, first-round experience, onboarding/group builder, feedback, tee/start-hole, round/AI schemas, ball seeds/visibility y tests. No queda RECOVER_REQUIRED en esta rama.

### AI, vision, games, cloud/offline y gates

El rango `COURSE..origin/phase2/integration-candidate-2026-09-22` contiene exactamente 15 commits: 11 intenciones AIQA comunes con nightly, un gate de integración (`cf9880a`), una corrección RLS de consentimiento (`9085b52`) y dos toggles de despliegue (`45a2689`, `c8f8f26`). El rango nightly contiene 13: las mismas 11 intenciones funcionales y dos toggles (`9e16c08`, `072accb`); este último también aporta un documento de engineering. No se cuentan gate, RLS ni toggles como supuestos parches AIQA comunes.

Range-diff y patch-id demostraron:

- 4bc5c07/5176fcb → 65c658a: revisión humana de scorecard vision.
- d957fd1/7e44770 → 2eef4ce: snapshots sync y device identity.
- 5513068/d9e8cda → 768e8c0: nightly gates.
- 1e35b25/74d1bca → 577c3f2: matriz determinista de juegos.
- 9acb93f/844dad9 → 231391e: inventories de procedencia.
- d46d0e2/1570a4e → 3b5e88c: abort de identity transactions.
- 4f8e275/32d47a8 → 3c4e44e: revalidación tras consentimiento.
- 4449486/c05a36c → 9ff6d6c: structured actions versionadas.
- 6a5867a/916dc46 → 4d24489: QA bundle.
- e2e45ba/0d832a8 → 9ea7808: harness de consentimiento.
- 98af478/6146fdf → f989a66: guard ligado a active round.
- cf9880a → 0cce79f: integration gates.
- 9085b52 → 0f462bc: lectura de consentimiento bajo owner RLS.

Clasificación funcional: ALREADY_SEMANTICALLY_INCLUDED.

45a2689, c8f8f26 y 9e16c08 sólo alteran deploymentEnabled para ramas históricas: DO_NOT_MERGE. De 072accb, el toggle es DO_NOT_MERGE y docs/NIGHTLY_ENGINEERING_2026-09-22.md es QA_DOCS_ONLY; el manifiesto canónico y los closeouts posteriores lo superan como estado operativo.

### Legal

c3c320c contiene varias intenciones:

- Privacy v6 y Terms v2 están ALREADY_SEMANTICALLY_INCLUDED mediante 02fa1ab.
- app/api/legal/evidence, el estado/cola de evidencia, hashes/definitions, la migración append-only y sus pruebas no estaban en canonical: MANUAL_PORT_REQUIRED al auditar.
- lib/account-data-export implementaba una copia local limitada, no una exportación completa cloud/photos. Requería port manual y no debía exponerse como export indiscriminado.

En el corte, la intención válida está recuperada en el árbol moderno: `app/api/legal/evidence`, `app/api/account/export`, `lib/legal-evidence.ts`, `lib/legal-evidence-client.ts`, `lib/account-data-export.ts`, wiring de UI/providers, las migraciones legales `20260924220041` y `20260924235930`, prueba RLS y pruebas TypeScript/PGlite. El port conserva eventos append-only e idempotentes por actor/entorno, valida la envolvente legal actual, limita el export a conjuntos/columnas explícitos y usa ingest transaccional service-only con deduplicación/rate limit.

Clasificación final de recuperación: MANUAL_PORT_REQUIRED al auditar, ejecutado sin restaurar el account-provider antiguo. El wiring/cola/export tienen verificación local; la tabla DB fue reconciliada como equivalente, el ingest incremental se aplicó QA-only y el RLS/RPC legal pasó en QA. Siguen pendientes revisión jurídica y QA interactiva; por ello no se declara PASS global aquí.

### Production hardening

185696c mezclaba Admin/export PII, analytics genérico, health, telemetría de errores, runtime identity y una migración que reescribía RLS de profiles. Decisión:

- Admin/export/analytics antiguos: SUPERSEDED por Admin Control Center, scopes, separación de entorno y product_usage_events_v2.
- 20260906210425_production_hardening_v1.sql: DO_NOT_MERGE porque modificaría políticas actuales.
- Health y app version/build SHA: MANUAL_PORT_REQUIRED al auditar; portados al estado final mediante una respuesta de liveness `no-store`, sin probes ni secretos, y un SHA que sólo acepta 40 hexadecimales.
- La telemetría antigua dependía de `analytics_events`/`app_errors`, admin key y la migración rechazada. No se restauró: SUPERSEDED por el pipeline autenticado y allowlisted `product_usage_events_v2`; los endpoints legacy completos son DO_NOT_MERGE.
- 68090d6 era un fix de versionado sobre esa base antigua: sólo se conserva su intención.

`app/api/health`, `lib/server-runtime.ts` y `tests/health-endpoint.test.ts` están integrados en el estado final y pasaron la suite global. La respuesta del deployment aún debe verificarse contra el SHA final; health no sustituye el smoke funcional.

### Backup y disaster recovery

No se mergeó main. Se recuperó únicamente su cadena válida:

| Fuente main | Port canónico | Intención |
|---|---|---|
| e574a2d | 1b6dde7 | workflow offsite, cifrado, restore verification, retention, security scan y Drive; adaptado a canonical |
| dffcaf2 | cfb57f3 | safety gates |
| 76d7f82 | 23dee48 | runtime PostgreSQL 17; adaptado |
| 5153900 | 650536c | categorías seguras de error; adaptado |
| 11ed530 | 028f210 | CA Supabase fijada |
| 647cbc6 | 79362f7 | Shared Drive root exacto |
| 31c720e | 39f868a | retry budget |
| 9885fc4 | 79c4201 | chunks replayables |
| 659ff01 | 6936a62 | respuestas resume |
| 2c15c9a | 108a864 | diagnostics resumables finales |

Rutas finales: .github/workflows/automated-offsite-backup.yml, scripts/backup completos, docs automáticos, variables documentadas, ignore rules, scripts package.json y configuración Vercel reconciliada. Los SHAs adaptados difieren donde era necesario conservar la línea moderna.

Documentación DR-clean recuperada y reconciliada en el estado final:

- ARCHITECTURE, AUTH_RECOVERY, BACKUP_POLICY, DEPENDENCIES, DNS_RECOVERY.
- FULL_RESTORE_FROM_ZERO, GITHUB_RECOVERY, MIGRATION_TO_NEW_PROVIDER.
- STORAGE_RECOVERY, SUPABASE_RECOVERY, SYSTEM_INVENTORY, VERCEL_RECOVERY.
- QA metadata y snapshots de Edge Functions.
- README reconciliado con los runbooks de automatización.

Clasificación de los docs: RECOVER_REQUIRED al auditar, recuperación realizada en el estado final. Scripts de DR-clean: SUPERSEDED por la cadena final de main. Toggling de ramas DR: DO_NOT_MERGE.

El workflow conserva barreras para no convertir esta recuperación de código en una escritura o promoción de Production. La auditoría read-only observó el workflow activo `365582254`, el run programado exitoso `35979285016` sobre SHA `2c15c9a02f36643244a7b0a420aa2ade570f2a10` y el artifact `10798973211` de 24,437,675 bytes, con expiración 2026-10-01. Esa evidencia acredita un backup empaquetado por una ejecución histórica; no acredita descifrado, custodia vigente en Drive, restore completo, RPO/RTO ni una ejecución nueva durante esta consolidación.

## Destino final y pendientes derivados de esta auditoría

### Auditoría de imágenes y assets entre ramas

`git ls-tree -r` sobre las 28 refs remotas produjo 22 blobs visuales canónicos y **cero** filas históricas únicas ausentes de canonical. El inventario de path, hash y rol está en [CANONICAL_ASSET_LEDGER_2026-09-24.md](./CANONICAL_ASSET_LEDGER_2026-09-24.md). La comprobación runtime complementaria cubre raíces runtime/config/data/docs/scripts, referencias estáticas, CSS `url(...)`, Markdown y scripts: **30 referencias, 0 archivos faltantes y 0 URLs Vercel hardcodeadas activas**.

| Bloque | Estado de consolidación de código | Pendiente que impide cerrar como PASS |
|---|---|---|
| Admin/Courses | En el ancla comprometida `CANON`; DB equivalente reconciliada y RLS PASS en QA | Runtime/advisor/device QA según ledger separado |
| GHIN | En el ancla comprometida `CANON`; fundación DB QA-only y RLS PASS | Secretos, entitlement, auth/lookup/history/course-data reales; flags live apagados y zero posting |
| Full platform | Incluido o superado | QA integral del producto |
| AI/Games/Vision/Offline | Incluido por patch-equivalent/ports | QA runtime y providers externos |
| Backup automation | Recuperado selectivamente en `CANON`; run histórico y artifact observados | No se disparó un run nuevo; custodia/descifrado/restore real no acreditados |
| DR docs | Recuperados, reconciliados e incluidos en el estado final | Validación operativa de un drill desechable |
| Legal evidence | Port manual integrado; DB/RLS/RPC PASS en QA y suite local verde | Revisión jurídica y QA interactiva |
| Health/runtime | Port manual integrado y suite local verde | QA runtime en Preview con binding SHA |
| Configs históricas de Preview | Rechazadas | Ninguno; no deben volver |

No queda justificación para mergear main, production-hardening, full-platform, integration-candidate, nightly ni ramas hotfix completas. Cualquier función aceptada debe terminar en integration/backyard-current; la presencia exclusiva en una rama histórica no cuenta como implementación vigente.

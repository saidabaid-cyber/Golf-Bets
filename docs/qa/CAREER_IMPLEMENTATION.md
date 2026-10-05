# Carrera — ejecución en DEV

Este reporte conserva la auditoría y el estado anterior a la aplicación controlada. El [cierre posterior](CAREER_CONTROLLED_CLOSEOUT.md) documenta ambas migraciones aplicadas y verificadas en DEV, la nueva evidencia de permisos/runtime y los pendientes actuales.

## Entorno y recuperación

Base canónica: `integration/backyard-current`, `e6b9390d1e4ba58e10e02dc6dc7237e1b0963599`, igual al upstream y al deployment READY de `https://dev.thebackyard.com.mx` verificado en Vercel.
El intento detenido sólo hizo lecturas: árbol limpio, ningún cambio de código ni commit. El cambio a DEV fue expresamente autorizado por el usuario.
Rama de campos preservada en `6f4f06180d4b0572b298dc705fbcf9c568be70d7`; no se incorpora ningún commit de ese frente. Git registra siete commits exclusivos sobre `e6b9390` (ocho si se cuenta la base compartida). Su caché local no rastreada `.next-course-master/` se conserva, fuera de los commits y verificaciones de Carrera.

KEEP: `buildGolfInsights`, estadísticas con reset autenticado, `buildHistoricalRoundRecap`, scorecards, `deriveRoundAchievements`, `FriendsHub`, flujo GHIN y navegación global.
COMPLETE: Carrera y las cinco vistas. REFACTOR: composición y selección por URL. FIX: loading/error, privacidad y atribución. REMOVE_DUPLICATE: ninguno encontrado.

## PREEXISTING_BASELINE_FAILURES

Auditoría inicial antes de escribir código, sobre la rama abierta: 4,328 tests, 4,323 PASS y 5 FAIL. Log completo local: `.qa-artifacts/career-baseline-tests.log`.

| Suite / archivo | Test | Error | Causa aparente |
| --- | --- | --- | --- |
| `tests/equipment-owner-review.test.ts` | la UI final usa bolsa premium, selección guiada y modo manual explícito | `AssertionError`: no coincide `/styles\.bagItemMain/` | contrato de markup de Bolsa desactualizado respecto al componente |
| `tests/equipment-ui-contract.test.ts` | Mi bolsa abre una ficha limpia por bastón y reserva el borrado para el detalle | `AssertionError`: no coincide `/EN MI BOLSA/` | contrato de texto de Bolsa desactualizado |
| `tests/final-brand-ghin-closeout.test.ts` | Mi Bolsa keeps approved product media while permanent management stays compact | `AssertionError`: no coincide `/EN MI BOLSA/` | mismo contrato de texto, fuera de Carrera |
| `tests/iphone-capture.test.ts` | Reglas dejan IA/directorio plegables, recursos como accesos directos y videos abiertos al final | `deepStrictEqual`: `rules-more-resources` adicional | selector incluye un disclosure adicional existente |
| `tests/nightly-catalog-quality.test.ts` | nightly audit artifacts reproduce from canonical runtime catalogs and captured QA metadata | `STALE_CATALOG_AUDIT:equipment-gaps.json`, exit 1 | artefacto generado del catálogo no coincide con fuentes |

No se modifican estos tests para ocultar fallos. Se vuelve a medir el baseline canónico, porque la rama de campos tenía tests adicionales.

## Arquitectura y fuentes auditadas

Rondas: `RoundSnapshot`, historial sincronizado con `rounds_cloud` y las proyecciones canónicas de participación; sin otro store. Los reinicios deportivos continúan filtrando estadísticas y progreso, conservando histórico. Perfil e índice: identidad existente, `selectedHandicapIndex`, controller GHIN de lectura.
Rivalidades se derivan de tarjetas completas comparables, identidad estable y resultados deportivos; no se infieren victorias desde dinero.
Torneos Polla: `tournaments`, `tournament_players.profile_id`, `tournament_scores`, RLS de owner/admin. Un torneo organizado no implica participación. Ranking por puntos global y clasificación global de logros no cuentan con fuente suficiente: estados honestos y contratos extensibles, sin jugadores inventados.
Analytics: existe `recordProductEvent` y allowlist/constraint de DB; cualquier ampliación deberá respetar ambos.
Navegación global observada en DEV: Inicio, Carrera, Play, My Coach, Reglas. Se preserva.

## Fase 1 — shell

Cinco vistas canónicas con selección en URL, recarga directa y Back/Forward. Amigos mantiene su dominio existente y sus entradas desde Inicio, notificaciones y QR, mediante `screen=friends`. Los cambios de tab reinician el scroll; la página no añade overflow. Header, skeleton y errores reutilizables. 23 tests de navegación/Carrera/Amigos PASS. Las expectativas del contrato anterior de cuatro destinos se actualizan al producto solicitado; las pruebas funcionales de Amigos se conservan.

## Fase 2 — Resumen

Perfil/club/ciudad e índice canónicos, métricas de tarjetas completas, balance propio verificado, temporada por cohorte de hoyos, meses sin actividad, rondas recientes con handler histórico y GHIN de lectura. No se infiere antigüedad de cuenta ni nivel. Precisión usa exclusivamente capturas explícitas; nunca score+putts para GIR. Queries deportivas existentes y loading/error se preservan; el error deportivo no oculta perfil/GHIN. 4 tests de cálculo/SSR PASS, además de los contratos existentes.

## Fase 3 — Logros

Catálogo extensible dentro de `round-achievements`, usando su validador estricto de tarjetas. Siete criterios documentados, estados/progreso derivados, fechas y referencia del hito, filtros de estado y detalle de logro. No persiste porcentajes. Salón de la Fama con placa de honor, contrato de ranking empatado y vacío real: no existe fuente global autorizada. 14 tests PASS (5 nuevos y 9 del motor original). CTA social traducido a Logros.

## Fase 4 — Rivalidades

Proyección deportiva sin campos financieros; score bruto, tarjetas completas y mismo par. Identidad Auth/grupo estable, invitado sin vínculo separado por ronda. Filtros, G-P-E, tasa con empates incluidos, rachas, hitos, cara a cara y detalle histórico. Balance propio consolidado del periodo, no del rival seleccionado. Resumen/Win Streak reutilizan esos cálculos. 10 tests de Logros/Rivalidades PASS, incluyendo inyección de dinero en props y SSR de filas/hero que garantiza no renderizarlo. Ninguna nueva tabla.

## Fase 5 — Rondas

Histórico íntegro con estados, filtros, paginación de 10, captura existente del detalle y scorecard real. Analítica respeta reset, separa 9/18 hoyos, distribución, promedio y tendencia (últimas cinco vs. cinco previas, mínimo cuatro); gráfica por fecha y agregación mensual para >40 muestras. Totales declarados válidos aportan sólo score bruto, sin datos por hoyo ni logros. Precisión exclusivamente explícita. 8 tests de Rondas/estadísticas PASS, incluidos datos escasos/muchos y falsos positivos de precisión.

## Fase 6 — Torneos

Schema y RLS reales inspeccionados en la DB canónica de DEV. Lector privado autenticado valida lifecycle antes de service role, filtra `profile_id` exacto, exige owner/publicación/acceso vigente para metadatos, revalida atribución y entrega únicamente resultado deportivo propio. Nunca expone PIN, identidades ni scorecards de otros participantes. Lecturas por lotes/páginas de diez con límites detectados. Motor `buildPollaLeaderboard` existente, sin par/HCP inventado; posición sólo con todas las tarjetas completas. Filtros por temporada/modalidad/sede (no existe club_id), próximo evento calculado, historial, detalle, resumen de la muestra cargada, cache de 60s por cuenta y cancelación al desmontar. No agrega tablas ni modifica RLS. Ranking por temporada honestamente vacío. Top Finish consume participaciones vinculadas; fallo de esta query no destruye otros logros. 11 tests PASS (Torneos + Logros), incluyendo sesión vencida y torneo privado sin acceso.

## Fase 7 — integración y regresión

Se reutiliza analytics existente con los seis eventos solicitados y metadata mínima, sin nombres, dinero, scores ni información del rival. Migración aditiva `20261005110904_career_usage_events.sql`: amplía la constraint existente preservando su expresión anterior. Prueba PGlite verifica registros previos, eventos nuevos, rechazo de nombres inválidos y RLS/policies conservadas. Aplicación DEV: PENDING_CONTROLLED_DB_APPLY. Revisión automática rechazó aplicar esta modificación persistente porque requiere autorización explícita para su aplicación controlada; se solicitó al usuario y no se aplicó. Los eventos deportivos y las vistas funcionan independientemente de analytics.

Se corrigieron contratos de navegación afectados legítimamente: mock de parser de URL, reset de scroll por vista, test funcional Back/Forward/reload de las cinco vistas. No se modificaron los cinco tests preexistentes que fallan.

El primer runner tras el cambio de rama encontró cuatro tests compilados de campos sin fuentes en DEV: caché `.test-dist` heredada, no regresiones. Toda validación final compila desde cero a `tmp/career-test-dist`, excluido de Next. Hay 44 pruebas exclusivas del frente de campos. La población de baseline canónica se reconstruye por diferencias de fuentes: 4,328 − 44 = 4,284; no se presenta como una segunda ejecución limpia anterior a Carrera. La suite final agrega 36 pruebas y conserva exactamente los cinco fallos documentados. No se incorporan los commits de campos.

Verificación antes de despliegue: suite fresca 4,318 tests, 4,313 PASS / cinco FAIL preexistentes / cero nuevos / cero resueltos. Scripts adicionales 117 PASS / cero FAIL. Typecheck PASS. Lint PASS (cero errores y advertencias; caché preservada de campos excluida). Build PASS. Última revisión agregó protección contra truncamiento PostgREST por conteo exacto y compatibilidad con HandicapMode legacy `partial`; se verifica nuevamente antes del push.

DEV inspeccionado: DB canónica sin torneos ni participaciones, por lo que Torneos debe presentar estado vacío real. No se crearon eventos para rellenar la UI. La sesión de Chrome disponible corresponde a una cuenta existente sin datos deportivos visibles; la QA con datos sintéticos se identifica expresamente como fixtures locales, nunca se publica como datos reales.

La QA de runtime encontró que el lector nuevo estaba usando el flag del editor Polla aún no liberado (`POLLA_LIVE_RELEASED=false`). Se corrigió para leer el histórico propio con la nube autenticada ya disponible; no activa Polla ni cambia su flag. El CTA a su editor se muestra únicamente cuando ese producto está liberado. La cuenta existente sin participaciones debe recibir el vacío, no un falso error. Se verificará tras el deployment.

La inspección posterior identificó el bloqueo real: la DB canónica no concede SELECT de tabla ni de columnas a `service_role` en los cuatro dominios de torneos. Se conserva esta restricción hasta aprobación controlada. Migración preparada `20261005114931_career_tournament_server_read.sql`: SELECT exclusivamente de columnas utilizadas por Carrera para `service_role`, excluye hashes/PIN/tokens, roles del navegador y escrituras. Prueba PGlite PASS confirma esos límites y conserva RLS/policies. Estado PENDING_CONTROLLED_DB_APPLY. La UI reconoce esta indisponibilidad y no muestra un falso cero de torneos ni de puntos. Se solicitó autorización explícita al usuario; ninguna de las dos migraciones se ha aplicado.

## Verificación final

Snapshot de QA interactiva: `03b57de9bbff54e05d2c78095ae264b2f5cd0dee`, deployment DEV READY `dpl_EWahC7VeuXaS2EY79RsKoA6adiek`, target Preview/null y alias canónico `dev.thebackyard.com.mx`, verificados mediante metadata de Vercel y sesión autenticada en Chrome. Después se protegió también el enlace al tablero Polla (`32eaef9`) y se ajustó el entorno aislado del harness SSR (`8e7c492`), conservando sus aserciones y sin secretos. La ejecución final vuelve a comprobar suite completa/typecheck/lint/build; el SHA de cierre se obtiene de `git rev-parse HEAD` y se verifica contra el deployment que alimenta el dominio canónico.

| Verificación | Estado | Evidencia y límite |
| --- | --- | --- |
| Pruebas focalizadas de Carrera | PASS | 51/51; incluyen seguridad de columnas y privacidad de rivales |
| Suite de unidades completa | FAIL | 4,320 total; 4,315 PASS / cinco FAIL preexistentes; cero nuevos, cero resueltos, cero skipped |
| Scripts del comando de test | PASS | 117/117, cero FAIL |
| Regresión contra baseline | PASS | mismos cinco nombres, archivos y errores; 44 pruebas de campos excluidas legítimamente y 36 nuevas |
| Typecheck | PASS | `next typegen` + `tsc --noEmit`, exit 0; compile de tests también exit 0 |
| Lint | PASS | ESLint exit 0, cero errores/advertencias; caché preservada `.next-course-master` excluida |
| Build | PASS | Next 16.3.3, compile, typecheck y generación de 38 páginas; env local neutralizada y sin operaciones DB |
| Strings antiguos en UI | PASS | búsqueda `app`, `lib`, `features` sin los tres nombres prohibidos |
| Protección de campos | PASS | SHA original intacto; tip de campos no es ancestro de DEV; cero commits incorporados |

La suite completa devuelve exit 1 por los cinco FAIL que el usuario autorizó preservar; no se etiqueta globalmente PASS.

## QA visual e interactiva

| Vista | Estado | Verificación real |
| --- | --- | --- |
| Resumen | PASS | identidad existente sin avatar/índice/rondas, GHIN sin asociación, métricas honestas, header y CTA a configuración real |
| Logros | PASS | siete criterios, colección bloqueada real, abrir Birdie Club, filtro Desbloqueados vacío, placa de Salón de la Fama sin ranking inventado |
| Rivalidades | PASS | vacío real, formato 9 hoyos, CTA a búsqueda de Amigos, regreso; filas/hero poblados y dinero inyectado verificados en SSR/local |
| Rondas | PASS | vacío real, filtro 9 hoyos, histórico/analítica separados; gráficas, muchos datos y scorecard por hoyo verificados en SSR/local |
| Torneos: disponibilidad y errores | PASS | loading, error/retry y estado real de consulta no habilitada; no presenta cero ni resultados inventados |
| Torneos: lectura real | PENDING_CONTROLLED_DB_APPLY | requiere SELECT de columnas sólo para servidor en DB DEV |
| Analytics persistido | PENDING_CONTROLLED_DB_APPLY | constraint pendiente; eventos best effort no afectan las vistas |
| Flujos poblados en DEV | PENDING_INTERACTIVE_QA | la cuenta disponible tiene cero rondas y la DB tiene cero torneos; abrir ronda/rivalidad/torneo con datos reales no se pudo verificar |
| Safari/PWA en iPhone físico | PENDING_DEVICE_QA | Chrome responsive no confirma Safari, teclado ni safe areas físicas |

Fixtures locales de los componentes reales, nunca publicados: veinte combinaciones de cinco vistas × 320/375/390/430 px sin overflow. Se revisaron nombres/username/campo largos, ausencia de avatar, 70 rondas, valores grandes, líder de ranking sintético, skeleton y error. En Chrome DEV la medición efectiva fue 390 px: las cinco vistas sin overflow, selección visible y tabs de 44 px. El override adicional no cambió el ancho efectivo de esa pestaña; no se afirma QA DEV a los otros tres anchos. Se corrigieron tarjeta de jugador estrecha, filtros comprimidos, selección de tab fuera de viewport y colección filtrada sin explicación.

Contrastes calculados para los pares usados por Carrera: texto secundario/ivory 4.89:1; texto oscuro/ivory 11.57:1; texto claro/forest 9.52:1; botón dorado 9.32:1; foco/ivory 3.01:1. No es una certificación de accesibilidad de toda la aplicación.

Back/Forward entre Rondas y Torneos, recarga directa, apertura de detalle de logro, filtros y CTA de Amigos/crear ronda verificados realmente. No se registraron rondas ni torneos de QA en la cuenta existente. Las acciones de Polla siguen ocultas mientras no esté liberado.

También se conserva el gate del tablero publicado: Carrera no enlaza un tablero de Polla mientras ese producto siga sin liberarse. El detalle deportivo propio permanece disponible dentro de Carrera cuando su lectura sea autorizada.

Regresiones runtime de entrada: Inicio/feed, Perfil/GHIN/Bolsa vacío, Play con configuración existente, setup desde CTA, Amigos, My Coach y Reglas cargan. Un aviso existente de Inicio no pudo guardar su decisión al cerrarlo; no se alteró su lógica ni se certifica su persistencia. Autenticación, grupos, score/apuestas, notificaciones y los restantes flujos cuentan con las pruebas existentes sin nuevos FAIL, sin afirmar un recorrido manual completo de cada uno.

Capturas locales disponibles en `.qa-artifacts/career-dev-resumen.jpg`, `career-dev-logros.jpg`, `career-dev-rivalidades.jpg`, `career-dev-rondas.jpg` y `career-dev-torneos.jpg`. Logs: `career-final-unit-tests.log`, `career-script-tests.log`, `career-typecheck.log`, `career-lint.log`, `career-build.log`. Se conserva el baseline original.

## Pendientes reales

- PENDING_CONTROLLED_DB_APPLY: aplicar las dos migraciones únicamente en `bymeopxkxapfizeeqeyb` tras autorización explícita, revalidar grants/constraint/RLS y lectura vacía real. Ninguna aplicada durante este turno.
- PENDING_INTERACTIVE_QA: recorridos con una cuenta de DEV que tenga rondas/rivales y una participación de torneo vinculada; clasificación global/puntos aún sin fuente real, con estado vacío y contrato preparado.
- PENDING_DEVICE_QA: Safari y PWA en iPhone físico.
- FAIL: cinco fallos automáticos preexistentes enumerados al inicio, ajenos a Carrera y sin cambios para ocultarlos.

## Archivos creados y modificados

- Modificado: `app/api/analytics/events/route.ts`
- Creado: `app/api/career/tournaments/route.ts`
- Creado: `app/components/career-achievements.tsx`
- Modificado: `app/components/career-hub.module.css`
- Modificado: `app/components/career-hub.tsx`
- Creado: `app/components/career-overview.tsx`
- Creado: `app/components/career-rivalries.tsx`
- Creado: `app/components/career-rounds.tsx`
- Creado: `app/components/career-shared.tsx`
- Creado: `app/components/career-tournaments.tsx`
- Modificado: `app/components/cloud-social-activity.tsx`
- Creado: `app/components/use-career-tournaments.ts`
- Modificado: `app/components/use-screen-navigation.ts`
- Modificado: `app/page.tsx`
- Creado: `docs/qa/CAREER_IMPLEMENTATION.md`
- Creado: `features/analytics/career.ts`
- Modificado: `features/analytics/domain.ts`
- Modificado: `lib/app-navigation.ts`
- Creado: `lib/career-navigation.ts`
- Creado: `lib/career-rivalries.ts`
- Creado: `lib/career-statistics.ts`
- Creado: `lib/career-tournaments.server.ts`
- Creado: `lib/career-tournaments.ts`
- Modificado: `lib/round-achievements.ts`
- Creado: `supabase/migrations/20261005110904_career_usage_events.sql`
- Creado: `supabase/migrations/20261005114931_career_tournament_server_read.sql`
- Creado: `tests/career-achievements.test.ts`
- Creado: `tests/career-analytics.test.ts`
- Modificado: `tests/career-friends-hub.test.ts`
- Modificado: `tests/career-navigation.test.ts`
- Creado: `tests/career-rivalries.test.ts`
- Creado: `tests/career-rounds.test.ts`
- Creado: `tests/career-shell.test.ts`
- Creado: `tests/career-statistics.test.ts`
- Creado: `tests/career-tournament-permissions.test.ts`
- Creado: `tests/career-tournaments.test.ts`
- Modificado: `tests/functional-closure.test.ts`
- Creado: `tests/helpers/career-round.ts`
- Creado: `tests/helpers/render-career.ts`
- Modificado: `tests/home-dashboard-actions.test.ts`
- Modificado: `tests/saved-round-navigation.test.ts`

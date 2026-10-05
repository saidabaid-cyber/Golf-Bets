# Carrera — ejecución en DEV

## Entorno y recuperación

Base canónica: `integration/backyard-current`, `e6b9390d1e4ba58e10e02dc6dc7237e1b0963599`, igual al upstream y al deployment READY de `https://dev.thebackyard.com.mx` verificado en Vercel.
El intento detenido sólo hizo lecturas: árbol limpio, ningún cambio de código ni commit. El cambio a DEV fue expresamente autorizado por el usuario.
Rama de campos preservada en `6f4f06180d4b0572b298dc705fbcf9c568be70d7`; no se incorporan sus ocho commits. Su caché local no rastreada `.next-course-master/` se conserva, fuera de los commits y verificaciones de Carrera.

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

El primer runner tras el cambio de rama encontró cuatro tests compilados de campos sin fuentes en DEV: caché `.test-dist` heredada, no regresiones. Toda validación final compila desde cero a `tmp/career-test-dist`, excluido de Next. El baseline canónico tiene 4,284 tests (4,279 PASS y los mismos cinco FAIL); la rama aislada tenía 44 tests adicionales. La suite de Carrera agrega pruebas sin incorporar dichos commits.

Verificación antes de despliegue: suite fresca 4,318 tests, 4,313 PASS / cinco FAIL preexistentes / cero nuevos / cero resueltos. Scripts adicionales 117 PASS / cero FAIL. Typecheck PASS. Lint PASS (cero errores y advertencias; caché preservada de campos excluida). Build PASS. Última revisión agregó protección contra truncamiento PostgREST por conteo exacto y compatibilidad con HandicapMode legacy `partial`; se verifica nuevamente antes del push.

DEV inspeccionado: DB canónica sin torneos ni participaciones, por lo que Torneos debe presentar estado vacío real. No se crearon eventos para rellenar la UI. La sesión de Chrome disponible corresponde a una cuenta existente sin datos deportivos visibles; la QA con datos sintéticos se identifica expresamente como fixtures locales, nunca se publica como datos reales.

La QA de runtime encontró que el lector nuevo estaba usando el flag del editor Polla aún no liberado (`POLLA_LIVE_RELEASED=false`). Se corrigió para leer el histórico propio con la nube autenticada ya disponible; no activa Polla ni cambia su flag. El CTA a su editor se muestra únicamente cuando ese producto está liberado. La cuenta existente sin participaciones debe recibir el vacío, no un falso error. Se verificará tras el deployment.

La inspección posterior identificó el bloqueo real: la DB canónica no concede SELECT de tabla ni de columnas a `service_role` en los cuatro dominios de torneos. Se conserva esta restricción hasta aprobación controlada. Migración preparada `20261005114931_career_tournament_server_read.sql`: SELECT exclusivamente de columnas utilizadas por Carrera para `service_role`, excluye hashes/PIN/tokens, roles del navegador y escrituras. Prueba PGlite PASS confirma esos límites y conserva RLS/policies. Estado PENDING_CONTROLLED_DB_APPLY. La UI reconoce esta indisponibilidad y no muestra un falso cero de torneos ni de puntos. Se solicitó autorización explícita al usuario; ninguna de las dos migraciones se ha aplicado.

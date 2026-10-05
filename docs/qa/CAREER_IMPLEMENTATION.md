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

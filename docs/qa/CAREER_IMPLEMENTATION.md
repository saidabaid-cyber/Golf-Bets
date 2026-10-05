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

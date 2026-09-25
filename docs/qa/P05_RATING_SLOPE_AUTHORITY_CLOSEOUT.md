# P05 — Rating / Slope: autoridad, categoría y evidencia por tee

> **DOCUMENTO HISTÓRICO — NO USAR COMO ESTADO ACTUAL NI RUNBOOK.** Este cierre conserva evidencia de la rama original; sus SHA, conteos y observaciones de QA pueden estar superados. La fuente operativa es `integration/backyard-current`; consulte el [manifiesto de consolidación](../CONSOLIDATION_MANIFEST_2026-09-24.md), el [estado canónico del producto](../CANONICAL_PRODUCT_STATUS_2026-09-24.md) y el [ledger canónico de migraciones](../CANONICAL_MIGRATION_LEDGER_2026-09-24.md). No ejecute deploys, cambios de entorno ni migraciones a partir de este archivo.

## Identidad del cierre

- Rama: `phase2/admin-control-center-2026-09-22`
- SHA base: `cb265ea8f98b823a5e133a247078325ab773701a`
- SHA final: el commit que contiene este documento; el SHA exacto se registra en la entrega y en Vercel.
- Supabase QA: `bymeopxkxapfizeeqeyb`
- Producción: no tocada.
- DDL/migraciones: ninguna.

## Causa y criterio

El catálogo tenía 769 tees físicos con Rating/Slope capturados y 1,538 pares independientes de nueve hoyos, pero no tenía ninguna categoría explícita. La captura histórica apuntaba a URLs de GHIN, sin integración actual ni evidencia suficiente para decidir una categoría del jugador. El proveedor especial de Puebla además hacía elegibles automáticamente los valores publicados por El Cristo aun cuando la categoría y la autoridad de handicap seguían sin comprobarse.

P05 separa ahora:

1. identidad del tee físico;
2. evidencia Rating/Slope;
3. categoría declarada por la fuente;
4. autoridad y URL;
5. estado/conflicto;
6. versión y fecha;
7. decisión de uso automático, que permanece siempre en `false`.

No se infiere categoría por color, nombre, yardaje, par, Rating, Slope, SI ni posición. No se divide un Rating de 18 hoyos para fabricar nueve hoyos. No se modificó ninguna fórmula de handicap.

## Resultado QA después del apply

| Métrica | Resultado |
|---|---:|
| Tees físicos activos | 769 |
| Bundles versionados leídos de vuelta | 769 |
| Registros de evidencia | 811 |
| `OFFICIAL_VERIFIED` | 39 |
| `CLUB_PUBLISHED` | 2 |
| `CAPTURED_UNCLASSIFIED` | 769 |
| `SOURCE_CONFLICT` | 1 |
| `STALE_OR_UNCONFIRMED` | 0 |
| Evidencias con categoría explícita | 39 |
| Evidencias con categoría desconocida | 772 |
| Evidencias aplicables automáticamente | 0 |
| Bindings course/tee incorrectos | 0 |
| Registros de autoridad sin tee exacto | 0 |

La suma de estados es mayor que el número de tees físicos porque un tee puede conservar varias evidencias y varias categorías. Esto es intencional.

## Evidencia por tee / fuente

El inventario exacto de las 42 evidencias clasificadas adicionales está versionado en `data/course-rating-authority-evidence.json`. Cada registro incluye `courseId`, `teeId`, tee físico, categoría explícita o `null`, Rating/Slope, front/back cuando la fuente los publica, autoridad, URL y estado.

| Campo / tee físico | Categorías verificadas | Registros | Estado | Autoridad |
|---|---|---:|---|---|
| El Camaleón Mayakoba · Negras | M | 1 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 23244 |
| El Camaleón Mayakoba · Azules | M | 1 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 23244 |
| El Camaleón Mayakoba · Blancas | M | 1 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 23244 |
| El Camaleón Mayakoba · Verdes | M, F | 2 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 23244 |
| Chapultepec · Negras Prov | M | 1 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 23185 |
| Chapultepec · Azules Prov | M | 1 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 23185 |
| Chapultepec · Doradas Prov | M | 1 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 23185 |
| Chapultepec · Blancas Prov | M, F | 2 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 23185 |
| Chapultepec · Amarillas Prov | M | 1 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 23185 |
| Chapultepec · Plateadas Prov | M, F | 2 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 23185 |
| Cabo del Sol · I, II, III, IV, V | M, F en cada tee | 10 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 7 |
| Cove Club · Cove, Gold, Blue, Blue/White, White, White/Red, Red, Cove Kids | M, F en cada tee | 16 | OFFICIAL_VERIFIED | USGA NCRDB CourseID 8 |
| El Cristo · Azules | desconocida | 1 | CLUB_PUBLISHED | Club Campestre El Cristo |
| El Cristo · Blancas | desconocida | 1 | CLUB_PUBLISHED | Club Campestre El Cristo |
| El Cristo · Doradas | desconocida | 1 | SOURCE_CONFLICT | Club Campestre El Cristo / suma por hoyos en conflicto |
| Todos los 769 tees capturados | desconocida | 769 | CAPTURED_UNCLASSIFIED | Captura histórica GHIN; no integración activa |

Fuentes primarias:

- [FMG — Calificación de campos](https://fmg.org.mx/index.php/es/clubes-y-campos/Calificaci%C3%B3n%20de%20campos)
- [USGA NCRDB — El Camaleón Mayakoba](https://ncrdb.usga.org/courseTeeInfo?CourseID=23244)
- [USGA NCRDB — Club de Golf Chapultepec](https://ncrdb.usga.org/courseTeeInfo?CourseID=23185)
- [USGA NCRDB — Cabo del Sol](https://ncrdb.usga.org/courseTeeInfo?CourseID=7)
- [USGA NCRDB — Cove Club](https://ncrdb.usga.org/courseTeeInfo?CourseID=8)
- [Club Campestre El Cristo — Campo de golf](https://elcristo.com.mx/campo-golf)

La FMG describe la calificación oficial y su vigencia, pero no se usó como fuente de valores curso por curso. Los valores oficiales aquí marcados provienen únicamente de las páginas NCRDB exactas. El Cristo permanece como publicación del club, no como calificación FMG/GHIN/WHS oficial.

## La Vista y El Cristo

- La Vista normal Par 72 y sus configuraciones temporales Par 70/69 conservan identidades y layouts separados. P05 no copió ningún Rating/Slope entre ellas.
- El Cristo Azules (6,698 yd, 71.2/129) y Blancas (6,152 yd, 68.6/125) se conservan como evidencia publicada por el club, con categoría `null` y sin uso automático.
- El Cristo Doradas queda `SOURCE_CONFLICT`; no se corrigieron yardas inventando un hoyo.
- La evidencia conflictiva de Rojas permanece en la investigación de Puebla, pero no se vinculó a los 769 tees activos porque no existe un tee físico activo exacto correspondiente en QA.

## Apply controlado y recuperación

- Dry-run: 769 filas de metadata por cambiar; 0 fuentes sin binding.
- Apply: 769 filas.
- Readback: 769 bundles, 811 evidencias, 0 bindings incorrectos.
- Segundo apply: 0 filas (idempotente).
- Artefacto privado previo: `.qa-artifacts/p05-rating-evidence-before-apply.private.json`.
- Recuperación: `node scripts/p05-rating-evidence-sql.mjs rollback`; sólo elimina `ratingEvidenceV1` cuando todos sus registros pertenecen a `p05-2026-09-24.v1`.

Los digests antes y después son idénticos:

| Invariante | Digest |
|---|---|
| IDs de tee | `7af247d4612479b7bc9a63a890344147` |
| Rating/Slope/par/yardas | `4c481ebc85077f1359aafa49b7687b76` |
| Ratings independientes de nueve hoyos | `f0908983771e3f81a9959b7c16ffafb2` |

También permanecen: 3,096 hoyos, 13,644 yardajes tee/hoyo, 1,538 ratings de nueve hoyos y 150 clubes geolocalizados. El universo operativo OWNER_CATALOG_REVIEW sigue siendo 153 clubes / 176 recorridos; QA contiene adicionalmente un club/recorrido interno sin tees.

## Regresiones P03/P04

- Cobertura geográfica: 150/153 clubes operativos.
- Tarjetas completas: 758.
- Tarjetas incompletas: 11.
- Tees: 769.
- No se convirtió un recorrido de 9 hoyos en 18.
- No se cambió ninguna tarjeta, SI, Rating/Slope capturado ni ID.

## Pruebas

- `npm test`: 3,400 pass; 0 fail; 0 skipped; 0 cancelled.
- Pruebas P05: clasificación no inferida, múltiples categorías por tee, aislamiento course/tee, front/back independientes, unknown/conflict, La Vista sin mezcla, El Cristo prudente, e invariantes P03/P04.
- Los resultados finales de TypeScript, ESLint, build, `git diff --check` y Preview quedan consignados en la entrega del SHA final.

## Pendientes honestos

- Los 769 registros históricos siguen `CAPTURED_UNCLASSIFIED` hasta que una fuente primaria exacta permita clasificar cada categoría.
- El Cristo requiere autoridad/categoría documentada y resolución de los conflictos Doradas/Rojas antes de poder tratarlo como evidencia oficial aplicable.
- P05 no decide qué categoría corresponde a un jugador; esa política queda fuera del alcance y ningún registro se usa automáticamente.

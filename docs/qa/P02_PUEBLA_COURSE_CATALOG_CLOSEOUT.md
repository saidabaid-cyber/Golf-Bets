# THE BACKYARD — P02 Puebla Course Catalog Closeout

## Versiones y alcance

- Rama: `phase2/admin-control-center-2026-09-22`
- SHA base: `9e1a4fcecde5b353f12159946af38b99eb9babd8`
- SHA final: el commit que contiene este informe; el valor exacto se registra en el handoff y en la inspección del deployment porque un archivo versionado no puede contener el hash de su propio commit.
- Prompt 01 preservado: sí (`66de81f` sigue en la historia).
- Base de datos: sin migraciones, DDL ni escrituras de catálogo.
- Fuera de alcance preservado: Admin, Equipment, Social, apuestas, Profile y Production.

## Causa raíz y correcciones

1. El endpoint de cercanos paginaba por recorrido antes de consolidar clubes. Un club con varios recorridos podía consumir varios de los tres lugares. Ahora ordena por distancia y deduplica por `clubId` antes de limitar.
2. El catálogo capturado describía La Huerta como una tarjeta jugable de 18 hoyos/Par 62, mientras la fuente oficial vigente describe el campo físico como 9 hoyos/Par 29. La evidencia capturada se conserva en QA, pero no se publica como tarjeta jugable hasta reconciliar una tarjeta oficial hoyo por hoyo.
3. El fallback versionado podía exponer Rating/Slope sin que el recorrido tuviera evidencia y fecha verificadas. Esos valores ahora quedan fuera de la presentación y del cálculo cuando falta esa evidencia.
4. La preselección del tee habitual podía coincidir sólo por texto. Ahora exige primero el `courseId` estable, prefiere el `teeId` estable y sólo entonces permite el fallback por nombre dentro del mismo recorrido.

## Estado real del catálogo

Lectura QA previa a cualquier cambio:

- Tablas activas crudas: 154 clubes, 177 recorridos, 769 tees, 3,096 hoyos, 13,644 yardajes hoyo/tee y 1,538 ratings independientes de nueve hoyos.
- Fuente operacional `OWNER_CATALOG_REVIEW`: 153 clubes, 176 recorridos y 769 tees.
- La diferencia cruda es un club/recorrido `SYNTHETIC` de pruebas ya archivado en publicaciones Admin; no forma parte del catálogo operacional del jugador.
- Calidad operacional: 91 clubes geolocalizados, 758 tarjetas completas y 11 incompletas.
- Los 769 tees conservan `rating_category = null`; Rating/Slope no se presentan como oficiales ni se aplican al índice mientras la categoría no esté verificada.

## Puebla auditado

| Club | Course | Hoyos | Tees capturados / jugables | Tarjetas completas jugables | Geo verificado | Rating/Slope | Conflictos | Estado de fuentes |
|---|---|---:|---:|---:|---|---|---|---|
| La Vista Country Club | `course-la-vista` | 18 | 4 / 4 | 4 | Sí | Capturado; categoría no verificada, no publicado como oficial | La tarjeta normal Par 72 y el fixture temporal Par 69 permanecen separados | Identidad, ubicación y tarjeta trazables; autoridad de rating pendiente |
| Club Campestre de Puebla | `course-campestre-puebla` | 18 | 5 / 5 | 5 | Sí | Capturado; categoría no verificada | Ningún duplicado de identidad encontrado | Catálogo owner revisado; autoridad de rating pendiente |
| Club de Golf La Huerta | `review-course-23231` | 9 físicos | 1 / 0 | 0 | Sí | No publicado | La captura QA de 18 hoyos/Par 62 contradice la fuente oficial 9 hoyos/Par 29 | Layout físico verificado en fuente oficial; tarjeta por hoyo pendiente |
| Club Campestre El Cristo | `course-el-cristo` | 18 | 4 / 2 con rating local elegible | 4 | Sí | Azules 6698 yd, 71.2/129; Blancas 6152 yd, 68.6/125, sólo con clasificación local documentada | Doradas/Rojas siguen bloqueadas por conflicto de suma; no se inventaron yardajes | Tarjeta del club consistente para Azules/Blancas; no se promovió a GHIN/WHS/FMG |
| Club de Golf Las Fuentes | `review-course-24458` | 18 en captura | 2 / 2 | 2 | Sí | Capturado; categoría no verificada | El número físico de hoyos requiere confirmación primaria | Identidad/ubicación trazables; tarjeta física primaria pendiente |
| Cola de Lagarto Campo Mítico | `course-cola-de-lagarto` | 18 en proyecto/captura | 3 / 3 | 3 | No | Capturado; categoría no verificada | Operación y ubicación exacta no confirmadas | Referencia oficial del proyecto; no se inventó coordenada |
| Vista Verde Country Club | `review-course-23167` | 18 en captura | 2 / 2 | 2 | Sí | Capturado; categoría no verificada | Layout físico y tarjeta primaria pendientes | Ubicación con evidencia secundaria conservada |

## Diff antes / después

| Métrica | Antes (QA operacional) | Después (runtime reconciliado) | Cambio |
|---|---:|---:|---:|
| Clubes nacionales | 153 | 153 | 0 |
| Recorridos nacionales | 176 | 176 | 0 |
| Tees jugables nacionales | 769 | 768 | -1 tarjeta incompatible de La Huerta, preservada como evidencia QA |
| Tarjetas completas jugables | 758 | 757 | -1 tarjeta incompatible, no borrada |
| Tarjetas incompletas | 11 | 11 | 0 |
| Clubes geolocalizados | 91 | 91 | 0 |
| Clubes Puebla auditados | 7 | 7 | 0 |
| Recorridos Puebla auditados | 7 | 7 | 0 |
| Tees Puebla capturados / jugables | 21 / 21 | 21 / 20 | La Huerta queda en cuarentena de publicación |
| Duplicados de identidad de los siete clubes | 0 | 0 | 0 |

No se eliminaron ni remapearon IDs. El cambio es de publicación fail-closed, no de destrucción de evidencia.

## Comportamiento verificado

- Búsquedas sin distinción de mayúsculas, acentos o aliases: La Vista, Vista, Campestre Puebla, Campestre de Puebla, La Huerta, Huerta, El Cristo y Las Fuentes.
- Cercanos desde coordenadas simuladas de La Vista: clubes distintos, orden geográfico y radio de 50 km; el resultado probado comienza La Vista, Campestre de Puebla y Las Fuentes sin hardcodear el orden.
- Un recorrido adicional del mismo club no ocupa otro lugar.
- Un dato desconocido permanece `undefined`/`null`; no se fabrican yardas, Rating ni Slope.
- Recorridos de nueve hoyos siguen siendo nueve; no se fabrican otros nueve.
- La Vista normal Par 72 y la configuración temporal Par 69 no se sobrescriben.
- El snapshot de ronda permanece inmutable si cambia después el catálogo.
- El tee habitual sólo se preselecciona cuando sus IDs son compatibles con el campo seleccionado.

## Archivos modificados

- `app/api/courses/search/route.ts`
- `app/page.tsx`
- `data/curated-puebla-courses.json`
- `lib/course-catalog-provider.server.ts`
- `lib/course-nearby-clubs.ts`
- `lib/golf-course-directory.ts`
- `lib/puebla-course-publication.ts`
- `lib/round-course-selection.ts`
- `tests/course-nearby-route.test.ts`
- `tests/curated-puebla-course-data.test.ts`
- `tests/golf-course-directory.test.ts`
- `tests/p02-puebla-course-catalog.test.ts`

## Pruebas ejecutadas

- Pruebas P02 y regresiones dirigidas: 32 PASS, 0 FAIL.
- Suite completa `npm test`: 3,362 PASS, 0 FAIL, 0 skipped, 0 cancelled.
- `tsc --noEmit`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS (34 páginas estáticas y rutas dinámicas generadas).
- `git diff --check`: PASS; sólo avisos de normalización LF/CRLF de Git en Windows.

## Pendientes honestos

- `LEGAL_REVIEW_REQUIRED`: categoría/autoridad de Rating/Slope de los tees revisados; ningún valor fue presentado como oficial.
- `PENDING_INTERACTIVE_QA`: recorrido autenticado final de búsqueda, tee y creación de ronda en el Preview después del deployment.
- `PENDING_DEVICE_QA`: ubicación real, orden de cercanos y selección en iPhone físico.
- Datos pendientes: tarjeta oficial por hoyo de La Huerta; coordenada exacta verificable de Cola de Lagarto; confirmación primaria de layout/tarjeta de Las Fuentes y Vista Verde.

## Fuentes primarias usadas para la reconciliación

- La Huerta, campo de 9 hoyos Par 29: https://www.lahuertagolfhotel.com/club
- Cola de Lagarto, referencia oficial del proyecto de 18 hoyos: https://coladelagarto.com/

No se conectó GHIN/GolfAPI, no se amplió el catálogo nacional y no se aplicó ninguna migración.

# Backyard Course Master — estado canónico de dev/QA

Fecha de auditoría: 2026-09-28
Entorno auditado: Supabase QA `bymeopxkxapfizeeqeyb`
Branch: `integration/backyard-current`

## Resultado ejecutivo

The Backyard ya tenía un dominio normalizado de campos. No se creó una segunda jerarquía. La correspondencia canónica es:

| Dominio | Tabla actual | Regla |
| --- | --- | --- |
| Facility | `golf_clubs` | Identidad estable de la instalación. |
| Course / Layout | `golf_courses` | En Backyard cada fila es un layout jugable; varios layouts pueden pertenecer al mismo facility. |
| Tee Set | `golf_course_tees` | Rating, Slope, par, distancia, género y ratings por lado cuando existen. |
| Hole | `golf_holes` | Hoyo canónico del layout con par y Stroke Index verificados. |
| Tee × Hole | `golf_tee_hole_yardages` | Distancia, par y asignación específica del tee cuando existen. |
| Scorecard / Playing Profile | `course_scorecard_profiles` | Identidad y vigencia de cada tarjeta oficial, del club, torneo o histórica sobre un mismo layout físico. |
| Rating por profile × tee | `course_scorecard_profile_tees` | Rating/Slope/Bogey/par/longitud propios de la tarjeta seleccionada, sin sobrescribir el tee físico. |
| Stroke Index por profile × hole | `course_scorecard_profile_holes` | Ventajas por hoyo y género propias de la tarjeta; no se asumen universales para el layout. |
| Ratings de 9 | `golf_tee_nine_ratings` | Front/Back independientes; nunca se derivan dividiendo el total. |
| Mapping externo | `golf_course_provider_links`, `golf_tee_provider_links` | IDs de proveedores sin reemplazar las identidades internas. |
| Auditoría de sync | `golf_provider_sync_runs` | Resumen normalizado y diff; no guarda payload crudo ni secretos. |
| Histórico de ronda | `round_course_snapshots`, `round_course_handicap_snapshots` | Congela campo, tee, hoyos y HCP usados. |
| Fuente/licencia | `golf_course_data_sources` | Autoriza o bloquea importación, display y reutilización de Rating/Slope por proveedor. |

`golf_courses` cumple el papel operativo de `course_layouts`. Crear otra tabla de layouts duplicaría identidades y rompería el modelo ya conectado a rondas. Los nombres no son claves: se conservan IDs internos estables y external IDs/provider links.

## Layout físico vs. scorecard profile

El modelo no supone `1 facility = 1 course = 1 tarjeta`. Se separan dos conceptos:

- `golf_courses`, `golf_holes`, `golf_course_tees` y `golf_tee_hole_yardages` describen el recorrido físico: routing, par, tees y distancias.
- `course_scorecard_profiles` describe cómo se califica o se juega ese recorrido durante una vigencia concreta. Sus tablas hijas guardan Rating/Slope por tee y Stroke Index por hoyo/género.

Un cambio sólo de ventajas o Rating/Slope crea una nueva versión de profile sobre el mismo layout. Un cambio material de par, hoyos, recorrido o yardajes por reparación crea un layout físico temporal independiente. Las procedencias permitidas son `GHIN_OFFICIAL`, `USGA_OFFICIAL`, `CLUB_SCORECARD_VERIFIED`, `CLUB_OPERATIONAL`, `CLUB_TEMPORARY`, `TOURNAMENT`, `ADMIN_VERIFIED`, `PROVIDER_REVIEWED` y `PROVIDER_VERIFIED`. `PROVIDER_REVIEWED` conserva evidencia legacy sin presentarla como oficial o reutilizable.

Puede existir una tarjeta actual predeterminada por layout, pero todas las tarjetas oficiales y del club conservan identidad propia. `historical=true` la retira de la selección normal sin borrarla. La sincronización de un proveedor sólo hace upsert de su propia identidad `source_provider + source_external_id`; si ya hay una tarjeta actual del club, la importada no la desplaza.

Al iniciar una ronda se congela en `round_course_snapshots` el profile elegido, su procedencia, tee, Rating, Slope, par y Stroke Index. Los cambios posteriores del catálogo no recalculan ni reescriben rondas jugadas.

La Vista y Club Campestre de Puebla no tienen ramas especiales en el motor. La Vista se representa mediante sus layouts físicos normal/temporales y profiles disponibles. Campestre queda listo para compartir un mismo layout físico entre `GHIN / USGA — Oficial` y `Tarjeta del club — Actual`; la segunda se publicará sólo cuando exista scorecard/evidencia real, sin inventar valores.

## Inventario real de QA antes de esta fase

| Recurso | Total | Activos | Completitud observada |
| --- | ---: | ---: | --- |
| Facilities (`golf_clubs`) | 154 | 154 | 150 con coordenadas; 153 con país; 153 con external ID. |
| Layouts (`golf_courses`) | 179 | 179 | 176 con external ID; 3 con `total_par`; 2 provisionales. |
| Tee sets (`golf_course_tees`) | 783 | 779 | 783 con Rating + Slope; 768 con longitud total; 6 con género y ratings Front/Back/Bogey estructurados. |
| Holes (`golf_holes`) | 3,096 | 3,096 | 172/179 layouts (96.09%) con número completo de hoyos; 0 con GPS de hoyo. |
| Tee × Hole | 13,752 | n/a | 760/779 tees activos (97.56%) con yardage completo por hoyo. |
| Ratings de nueve | 1,538 | n/a | Front/Back preservados como observados. |
| Snapshots de ronda | 21 | n/a | Histórico separado del catálogo vivo. |
| Legacy `courses_cloud` | 354 | n/a | No es la fuente maestra; funciona como puente/snapshot legacy. |

Presencia de valores no equivale a autorización de reutilización. Aunque 100% de las 783 filas de tee contienen Rating/Slope, la mayoría pertenece a `OWNER_CATALOG_REVIEW` y mantiene `LEGAL_REVIEW_REQUIRED`; no se aplica automáticamente a Course Handicap. Las fuentes autorizadas y los layouts internos/provisionales aprobados sí pueden exponer los valores a la app.

Cobertura geográfica demostrada: México. La base contiene 152 filas con etiqueta `México`, una con `MX` y una sin país; es una inconsistencia de normalización legacy, no tres países. El importador V1 normaliza México a `MX`, pero esta fase no reescribe silenciosamente filas existentes.

## Procedencia actual

| Recurso | OWNER_CATALOG_REVIEW | GHIN | BACKYARD_INTERNAL |
| --- | ---: | ---: | ---: |
| Facilities | 152 | 1 | 1 |
| Layouts | 175 | 1 | 3 |
| Tees | 769 | 6 | 8 |
| Holes | 3,078 | 18 | 0 |
| Tee × Hole | 13,644 | 108 | 0 |

Los layouts La Vista Par 72, Temporary Par 70 y Temporary Par 69 permanecen separados. El Par 72 sincronizado en QA conserva IDs GHIN y scorecard completo. Los temporales siguen siendo Backyard Provisional; esta fase no altera su mapping ni habilita score posting.

## Cobertura México reutilizable hoy

El inventario reproducible está en `docs/course-data/MEXICO_COURSE_COVERAGE.csv`. Excluye el fixture sintético de QA y separa presencia física de datos de autorización para reutilizarlos:

| Métrica | Resultado QA |
| --- | ---: |
| Facilities reales inventariados | 153 |
| Courses/layouts | 178 |
| Tee sets | 779 |
| Tees con Rating + Slope reutilizable | 14 (1.80%) |
| Tees con hole-by-hole físico | 760 (97.56%) |
| Facilities con coordenadas | 150/153 (98.04%) |
| Tees con coordenadas de facility | 769/779 (98.72%) |
| `COMPLETE` | 6 |
| `MISSING_HOLES` | 8 |
| `NEEDS_VERIFICATION` | 765 |

Los 14 tees reutilizables pertenecen a un solo facility: 6 tees del layout oficial La Vista Par 72, con scorecard completo, y 8 tees de los layouts provisionales Par 69/70, todavía sin configuración completa de hoyos. Por ello el criterio estricto campo → layout → tee → Course Handicap → ronda completa está demostrado actualmente en **1 facility, 1 layout y 6 tees**. Los dos layouts provisionales permiten selección y cálculo con los valores first-party existentes, pero no se clasifican como completos ni aptos para publicación GHIN.

Los 765 tees `OWNER_CATALOG_REVIEW` conservan evidencia privada para revisión, pero el CSV omite Rating/Slope y la app ya no los promueve por el mero hecho de tener un `origin=GHIN` legacy. La reutilización requiere una fuente autorizada o un mapping GHIN real y confirmado cuyo Course ID corresponda exactamente al Tee Set.

## Duplicados y conflictos

- Facilities duplicados por nombre normalizado + ubicación: **0 grupos exactos**.
- Layouts duplicados por facility + nombre normalizado + hoyos: **0 grupos exactos**.
- Colisiones de nombre normalizado de tee: **4 grupos**. Son tees `I / I I` frente a `I I I`; tienen Rating/Slope/yardage diferentes. Se clasifican como conflicto de alias, no como duplicados, y no se eliminaron.
- Registros eliminados en esta fase: **0**.

La deduplicación del importador usa primero `provider + external_id`. Una similitud de nombre/ciudad/país entre proveedores produce `CONFLICT` y exige reconciliación administrativa; nunca fusiona facilities o layouts sólo por nombre.

## NCRDB / USGA

Fuente evaluada: [USGA National Course Rating Database](https://ncrdb.usga.org/).

Hallazgos:

- La interfaz pública ofrece una búsqueda HTML por país, nombre, ciudad y estado.
- No se encontró API pública documentada, export, bulk download ni feed autorizado en la interfaz o documentación pública revisada.
- Los [Terms of Use de USGA](https://www.usga.org/terms-and-conditions.html) otorgan acceso limitado y prohíben, entre otras conductas, extracción automatizada/scraping y explotación comercial sin autorización.
- El contacto publicado por NCRDB para preguntas de la base es `crdbquestions@usga.org`; debe solicitarse feed/licencia/acuerdo antes de una ingesta masiva.

Estado: **LEGAL_REVIEW_REQUIRED** y **BLOCKED_EXTERNAL** para descarga masiva. No se ejecutó scraping, no se evadieron controles y no se usaron credenciales GHIN de usuarios.

## Fuente de verdad y lectura runtime

```text
fuente autorizada
       ↓
normalize + dry-run diff
       ↓
BACKYARD COURSE MASTER
       ↓
Campo → Layout → Tee → ronda
```

La aplicación lee `read_backyard_course_master_v1()` con el JWT del usuario. La proyección incluye:

- los registros existentes revisados de QA;
- GHIN y provisionales que ya formaban parte del catálogo controlado;
- cualquier fuente futura que tenga `authorized_for_display = true` en `golf_course_data_sources`.

Las filas proveedor/revisadas permanecen `PRIVATE` en sus tablas base para impedir lecturas directas. Esa bandera no equivale a estado de publicación: la proyección autenticada y el registro de autorización deciden qué entra al catálogo del jugador.

La contraseña, tokens GHIN y payloads crudos nunca forman parte del Course Master. El cálculo local usa `Index × (Slope / 113) + (Course Rating − Par)` y congela sus inputs en la ronda.

## Importador reproducible

Comando:

```text
npm run course:sync -- <authorized-bundle.json>
npm run course:sync -- <authorized-bundle.json> --apply
```

Dry-run es el modo por defecto. `--apply` exige simultáneamente:

- URL exacta de Supabase QA `bymeopxkxapfizeeqeyb`;
- ref Preview exacto;
- ausencia de indicadores de Production;
- fuente `AUTHORIZED` en `golf_course_data_sources`;
- `authorized_for_import = true` y `authorized_for_display = true`;
- metadata de licencia del bundle consistente con el registro;
- cero conflictos de reconciliación.

El bundle V1 contiene `source`, `scope` y `facilities[]`; cada facility contiene `layouts[]`, y cada layout `tees[]`/`holes[]`. El importador crea además un scorecard profile independiente para esa fuente. Unknown permanece `null`. Cuando sólo una unidad existe, la conversión yardas/metros es determinística y queda marcada como derivada.

El diff usa `ADDED`, `UPDATED`, `UNCHANGED`, `CONFLICT` y `DEPRECATED`. Ausencias sólo se clasifican como `DEPRECATED` si el bundle declara un scope completo. Desactivar requiere además `--deactivate-missing`; no se borran filas ni snapshots históricos. Los cambios manualmente verificados de otro proveedor no se sobrescriben. En particular, una tarjeta `CLUB_SCORECARD_VERIFIED` marcada como actual sigue siendo el default cuando llega un profile GHIN/USGA nuevo.

## Búsqueda, nearby y operación sin GHIN

- Búsqueda: nombre de facility/layout, ciudad, estado y aliases; parcial, sin distinguir mayúsculas o acentos.
- Nearby: usa únicamente ubicación autorizada del dispositivo; muestra primero los 3 facilities más cercanos, ofrece “Ver más” y no bloquea búsqueda manual si el permiso falta.
- La selección de ronda ya es Course/Layout → Tee y muestra yardage, Rating y Slope disponibles.
- El catálogo está persistido en Supabase QA y tiene fallback local versionado. Una caída de GHIN no impide seleccionar datos ya sincronizados.
- GHIN no participa en el cálculo de Course Handicap cuando Rating/Slope ya existen localmente.

## Huecos reales

- Base completa de México/Estados Unidos/Canadá/resto del mundo: **BLOCKED_EXTERNAL** hasta obtener un feed/licencia autorizados.
- Hole-by-hole público de NCRDB: no demostrado; no se inventó. Debe complementarse con club/federación/proveedor autorizado o carga administrativa verificada.
- GPS/geometría: 0 hoyos con datos; queda pendiente de una fuente autorizada.
- 7 layouts no tienen conjunto completo de hoyos; 19 tees activos no tienen yardage completo por hoyo.
- 175 layouts de investigación legacy conservan Rating/Slope, pero su reutilización automática permanece bloqueada hasta resolver categoría y derechos.

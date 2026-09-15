# Catálogo curado Puebla · evidencia para Backyard Index local

Versión de datos: `puebla-primary-2026-09-15.v1` (revisión 2026-09-15).
El JSON vive en `data/curated-puebla-courses.json`; la validación/proveedor
en `lib/curated-puebla-course-data.ts`. Es una capa de referencias primarias,
separada del seed interno y de cualquier conexión futura a GHIN/WHS.

## Fuentes y estado

| Campo | Fuente primaria revisada | Datos verificables | Tee apto para Index **local** |
| --- | --- | --- | --- |
| La Vista | [Tarjeta de yardajes publicada por Asociación de Golf del Sur](https://www.golfsur.com.mx/la-vista-country-club-tarjeta-de-yardajes/) | 18 hoyos, par 72, yardajes de evento/edades | No. No hay stroke index ni Rating/Slope por tee en la tarjeta. El seed legado no se promueve. |
| Club Campestre de Puebla | [Página del club](https://clubcampestrepuebla.com/index.php/golf/campo) | 18 hoyos, par 72 | No. Falta scorecard completa y Rating/Slope por tee. |
| El Cristo | [Scorecard publicada por el club](https://elcristo.com.mx/campo-golf) | 18 hoyos, par 72, pares/SI/yardas por hoyo, Rating/Slope publicados | Azules y Blancas, sólo como `CURATED_RATED_TEE` local no oficial. Doradas/Rojas bloqueadas por totales contradictorios. |
| Cola de Lagarto | [Sitio del desarrollo](https://coladelagarto.com/) | Referencia a proyecto de 18 hoyos | No; operación vigente y scorecard no confirmadas. |
| Las Fuentes | [Convocatoria de FMG](https://fmg.org.mx/wp-content/uploads/Convocatoria-II-Copa-Sur-2025-v2-comprimido-comprimido.pdf) | Club sede de evento | No; la convocatoria no prueba tarjeta, rating ni 18 hoyos distintos. |

La [FMG describe la calificación de campos](https://fmg.org.mx/index.php/es/clubes-y-campos/Calificaci%C3%B3n%20de%20campos)
como proceso técnico que produce Rating/Slope para el sistema oficial. El
Rating/Slope mostrado por El Cristo en su sitio **no se presenta como vínculo
GHIN, certificación WHS ni registro FMG vigente**. Para esa afirmación haría
falta una fuente técnica oficial adicional.

## Conflictos concretos en El Cristo

Se conservan los números publicados sin repararlos por conjetura. La
validación fail-closed compara cada fila de hoyos con los subtotales y el
total impresos en la [scorecard del club](https://elcristo.com.mx/campo-golf):

| Tee | Total publicado | Suma de 18 yardas | Diferencia | Acción |
| --- | ---: | ---: | ---: | --- |
| Azules | 6,698 | 6,698 | 0 | Local apto; Rating 71.2 / Slope 129 |
| Blancas | 6,152 | 6,152 | 0 | Local apto; Rating 68.6 / Slope 125 |
| Doradas | 5,702 | 5,916 | +214 | Bloqueado; segundo nueve suma 3,161 vs 2,947 publicado |
| Rojas | 5,262 | 5,466 | +204 | Bloqueado; primer nueve 2,619 vs 2,609 y segundo 2,847 vs 2,653 publicados |

No se crean tees para campos sin Rating/Slope y tarjeta completa verificables.
No se sustituyen yardajes internos de La Vista por una tarjeta de torneo.

## Contrato de uso

`curatedPueblaCourseProvider.listCourses()` devuelve referencias de clubes;
`getTeeById(teeId)` incluye `issues`, `eligibleForLocalIndex` y
`eligibleForOfficialGhin: false`. `getIndexRatedTeeEvidenceById(teeId)`
y `getPlayableSelectionByTeeId(teeId)` devuelven `null` para un tee no
validado. Para Azules/Blancas devuelven Rating/Slope y un
`BackyardIndexRatedTeeEvidence.kind = "CURATED_RATED_TEE"` con autoridad,
URL, fecha, versión e IDs.

Estados legibles por consumidor: `COURSE_AVAILABLE` significa que existe al
menos una tarjeta jugable verificada en esta capa; `COURSE_REFERENCE_ONLY`
significa referencia de club sin tee curado completo; `TEE_UNVERIFIED` indica
que el tee no puede nutrir Index (ausente, heredado o contradictorio);
`TEE_INDEX_ELIGIBLE` identifica el tee con fuente consistente para el **Index
local**. `getCourseStatusById` lo devuelve para el catálogo curado;
`getCourseDataStatusForSelection(course)` lo calcula para cualquier selección
real: un campo legacy/manual puede seguir `COURSE_AVAILABLE` para score aunque
su tee permanezca `TEE_UNVERIFIED`. No se bloquea la ronda casual por falta de
Rating/Slope.

Ambas selecciones verificadas están incluidas en `DEFAULT_COURSES`: el
proveedor local de `/api/courses/search`, el selector móvil de Campo y
`teeOptionsForCourse` pueden encontrarlas sin un proveedor remoto ni datos
fabricados. La inclusión es **data-driven** con
`curatedPueblaCourseProvider.listPlayableSelections()` (la prioridad del tee
habitual se almacena en el dataset, no en la UI). La búsqueda compacta
conserva un resultado por campo y prefiere
el tee curado cuando hay más de una opción del mismo layout; el usuario aún
puede elegir `General` para una ronda casual, pero ese tee no aporta evidencia
de Index. La UI dice explícitamente **Index local** y no GHIN.

Al seleccionar tee para un jugador, pasar el `Course` producido por
`getPlayableSelectionByTeeId` a `teeAssignmentSnapshot(playerId, course,
capturedAt, "catalog")`. Ese helper vuelve a verificar **todos** los hechos
del tee y congela `par`, `indexRatingEvidence`, URL/autoridad/versión y
Rating/Slope en `PlayerTeeAssignmentSnapshot`. Si un objeto fue modificado,
es manual o es un seed viejo, no congela evidencia de Index. Al completar una
ronda, el autocapture debe leer sólo la asignación/snapshot congelados,
**nunca consultar de nuevo el catálogo mutable**. Editar el catálogo o el
grupo después no cambia los snapshots históricos.

Si el campo se eligió antes de agregar el primer jugador, la reconciliación
de una configuración **nueva y aún no iniciada** puede pasar
`{ allowCuratedNewAssignment: true }` a `reconcilePlayerTeeAssignments`.
Sólo asignaciones faltantes reciben evidencia del tee curado; una asignación
legacy existente, un draft/histórico restaurado o una corrección de ronda
mantienen sus snapshots sin promoción automática. El default del helper es
fail-closed (`false`).

## Mantenimiento

1. Revisar la página/PDF primarios y guardar URL, autoridad, fecha de revisión.
2. Transcribir par, SI, yardas, Rating y Slope sólo cuando estén publicados
   para el mismo tee; no llenar un dato ausente con un proveedor secundario.
3. Validar suma por hoyo, subtotales y total; un desacuerdo deja el tee
   `SOURCE_TOTAL_CONFLICT` hasta obtener aclaración primaria.
4. Subir `dataVersion` ante cualquier cambio sustantivo. Los snapshots de
   rondas anteriores conservan su versión/evidencia original.
5. No marcar `OFFICIAL_RATED_TEE` o GHIN sin fuente oficial verificable para
   ese tee y fecha; `CURATED_RATED_TEE` sólo fundamenta un cálculo local.

Los tests P/Q/R/S en `tests/curated-puebla-course-data.test.ts` cubren
proveniencia, elegibilidad local, congelamiento y validación fail-closed.

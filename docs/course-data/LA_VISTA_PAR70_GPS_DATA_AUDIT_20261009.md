# La Vista Par 70 y encuadre GPS — diagnóstico contrastado con originales

Fecha: 2026-10-09. Rama: `integration/backyard-current`.
Base local/remota y DEV comprobado por HTTPS:
`ac4b50e3153b4acea483df01b64534e58ac6782e`.
DEV respondió HTTP 200 con ese `buildSha`. Checkout limpio antes de preparar
este informe. Consulta exclusiva de lectura a la base DEV
`bymeopxkxapfizeeqeyb`. No cambios de catálogo, tarjetas, permisos, perfiles,
rondas, históricos, despliegue, facturación ni motores.

Se contrastaron los diagnósticos anteriores
`docs/qa/play-gps-flow-20261009.md` y
`docs/qa/play-cancel-real-persistence-20261009.md` con respuestas originales,
extracciones ya hechas, catálogo y caché persistente actuales. No se volvió a
extraer el conjunto de PDFs ni a investigar proveedores.

## Resultado concreto

**La importación de La Vista no perdió tees GPS ni una tarjeta Par 70:
ninguno figura en las respuestas recibidas.** Las respuestas guardadas contienen
una tarjeta estándar Par 72, cuatro tees con sus 18 yardajes, pars/ventajas globales
y 54 coordenadas: frente, centro y fondo de los 18 greens. Los 54 puntos y los
datos de tarjeta se conservan íntegros en la versión normalizada privada. No hay
puntos de salida, dogleg, trayectoria, polígonos ni asociación GPS a color/ID de tee.

Esto describe **las respuestas consultadas**, no demuestra que GolfAPI carezca
de una versión más reciente o de una tarjeta temporal en toda su base. La lista
guardada ofrece un único recorrido para el club; no se hicieron consultas nuevas.

No apareció una fuente adicional suficientemente comprobada que permita activar
Par 70 o publicar coordenadas de salida. Reimportar el mismo contenido no resolvería
esos faltantes. Se conservó la tarjeta del jugador: los datos de GolfAPI permanecen
como fuente separada, sin sobrescribir GHIN ni la variante local.

## Fuentes realmente revisadas

| Ref. | Fuente original / evidencia | Qué contiene y límite |
|---|---|---|
| A | GolfAPI respuestas 2 y 3, búsquedas guardadas del 7/oct; club `1179800210230`, Puebla/PUE/Mexico | Un recorrido `01213326512553886`, 18 hoyos, 4 tees y 54 coordenadas. No lista Par 70/69. `oldCourseIDs` son IDs anteriores del mismo recorrido según la documentación; no prueban otros layouts. |
| B | Respuesta 4, `courses/01213326512553886`, 2026-10-07T15:49:03.181Z | Pars suman 72, ventajas por categoría y 18 yardajes para Blue, White, Yellow y Red. No datos temporales. SHA256 del cuerpo: `df545fece5bc53c83a22aebf245b8d89dd199153259e7231c86e3c5485296d51`. |
| C | Respuesta 5, `coordinates/01213326512553886`, 2026-10-07T15:49:08.013Z | 54 puntos, todos POI 1 (GREEN), tres por hoyo 1–18. Cero POI 11/12 (tees) y cero POI 9 (dogleg). SHA256: `e48d095ebd3b6d7245b2ddc99fb52ce163df2214607cd9d3bc19edcffdc10954`. |
| D | GHIN guardado: `.qa-artifacts/ghin-live-course-23233.json` y `ghin-live-course-search.json` | Identidad facility 19886 / course 23233. Seis tees completos, tarjeta Par 72; no tarjeta temporal identificada. Las posiciones GPS de tees no están en estos datos guardados. No se volvió a iniciar sesión/consultar GHIN. |
| E | PDF La Vista, SHA256 `5c414b78492bf948187cd4014b559146f00b27c88f8d019b298b080e0cc1077e`; extracción `yardage-book-cards.json` | WHITE, 6591 yd, Par 72, 18 paneles numerados. Hoyo 8 conserva yardaje truncado “3…” como desconocido. No transformación geográfica ni tarjeta temporal. Fecha de exportación 6/oct no prueba vigencia operativa. |
| F | Seed `legacySelections/lavista-temporal-white`; migración `20260927195527_ghin_course_sync_and_posting_guard.sql`; reconciliador y reportes GHIN | Plantilla histórica Par 69 con hoyo 6=3, contradicho por la confirmación del owner de par 4. Par 70 se creó con totales provisionales del owner, sin inventar filas. No consta tarjeta fechada para validar los restantes hoyos. |
| G | DEV actual: `golf_courses`, `golf_holes`, tees, perfiles, configuraciones, enlaces y caché privada | Par 72 oficial/local: 18 filas cada una. Par 70/69: 0 filas cada una. Cero coordenadas de salida o geo-features La Vista. No configuraciones con mapping temporal. Los perfiles temporales dicen PUBLISHED, pero ese estado de metadata **no implica tarjeta completa**: sus tees solo tienen agregados. |
| H | OSM guardado y revisión INEGI E14B43d4 de enero 2010, piloto y metadatos | OSM: seis fairways sin número; cero tees/greens/trayectorias asignadas. INEGI: un objetivo de green 1 candidato documental; no tees de los 18 hoyos ni mapping temporal comprobados. Los contornos PDF siguen en coordenadas del dibujo. |

## Tabla de pendientes y acción que desbloquea cada uno

| Dato faltante / conflicto | Función que lo necesita | Fuentes revisadas | Proveedor vs importación | Acción mínima concreta |
|---|---|---|---|---|
| **Orden y par de las posiciones 1–18 de Par 70** | Tarjeta temporal de score, total contra par e inicio con esa configuración. No necesita GPS ni cuenta GHIN. | A–G; en particular B/D/E son Par 72 y F es un fixture Par 69 conflictivo. | No existe en respuestas guardadas ni en otra fuente revisada. No se perdió al importar. | Una foto/escaneo legible de la **tarjeta temporal Par 70 realmente usada**, o registro operativo fechado equivalente, con hoyos 1–18 y sus pars. Confirmar específicamente hoyos 4 y 6, orden y que no existen otros cambios. Integrar una nueva versión de ese mismo ID tras validar la fuente, sin copiar Par 72. |
| **Ventaja/stroke index 1–18 para las categorías aplicables** | Repartir golpes por hoyo y resultados netos. No indispensable para score bruto ni para encuadrar el mapa. | B, D, E, F, G. Las 18 ventajas de GolfAPI difieren de las 18 del GHIN White guardado. | Los dos conjuntos estándar llegaron completos y se conservaron separados. No hay conjunto temporal verificado. | La misma tarjeta temporal debe incluir columna HCP/ventaja/SI. Si solo hay una asignación operativa, documentar a qué categorías aplica; no elegir arbitrariamente GHIN/GolfAPI/legacy. El score bruto no debe depender de conseguir estos datos. |
| **Yardaje por hoyo del tee temporal seleccionado; demás tees independientemente** | Yardaje de cabecera/tarjeta y comprobación de sus totales. No calcula GPS ni impide por sí solo anotar score bruto. | B/E/F/G; los totales temporales existentes no desglosan hoyos. | Se guardaron los 18 yardajes de los cuatro tees estándar. No se entregó desglose temporal; no es un fallo de unidad o importación. | Obtener 18 yardajes del tee que se quiera usar primero (por ejemplo White); agregar Blue/Gold/Red cuando existan. Una tarjeta con los cuatro colores resuelve todo a la vez. No restar diferencias totales a hoyos arbitrarios. |
| **Categoría y validación/vigencia de rating y slope temporales** | Convertir Index a handicap del tee conforme a autoridad aplicable; no necesario para GPS/score bruto. | D/F/G y evidencia de autoridad existente. | Hay valores agregados Par 70 pero categoría desconocida y fuente provisional. No son ratings certificados por haber sido almacenados. | Documento de rating aplicable a **esa configuración Par 70, tee y categoría**, con fecha/vigencia; si no existe, conservar como desconocido/provisional y permitir únicamente funciones que no dependan de rating oficial. No trasladar el rating del Par 72. |
| **Par 70 posición 1–18 → hoyo físico; cambios de green/salida** | Reutilizar coordenadas sin mostrar un green de otro recorrido. Independiente de pars/ventajas/yardajes. | A–H; alias aprobado solo para Par 72 local ↔ oficial. | No hay mapping temporal en originales, normalización, configuraciones o enlaces actuales. No lo perdió el reader. | Registro de 18 correspondencias con el hoyo físico estándar, más declaración de tees/greens modificados. Si orden y greens son todos iguales, basta una **confirmación fechada y explícita de esa igualdad completa**, revisada y ligada a la tarjeta temporal. Cualquier excepción necesita su referencia propia; “mismo club”/“par 70” no bastan. |
| **Coordenada(s) de salida por hoyo, 1–18, con procedencia; relación con tee seleccionado** | Encuadrar desde salida hasta green. Para etiquetar un tee por color hace falta su vínculo específico. Los 54 greens ya sirven para distancias de green del estándar, sujetas a límites del proveedor. | C/D/G/H, PDF y metadatos originales. | **0 en el original, 0 rechazadas, 0 en caché/DTO.** No es una coordenada que el importer haya omitido. | Primero pedir al proveedor confirmar si ofrece POI 11/12 para este course ID y si su versión cambió. Solo después, una consulta autorizada de coordinates. Si no los tiene: observación/levantamiento geográfico identificando el punto de salida de cada hoyo y fuente/fecha/precisión. Un punto revisado por hoyo puede servir para encuadre genérico; no permite inventar todos los colores. |
| **Puntos de dogleg/trayectoria en los hoyos que lo requieren** | Encuadre que abarque el trazado doblado, no solo una recta salida–green. No hacen falta todos los hazards o polígonos para este encuadre básico. | C/G/H; fairways OSM sin número y dibujos sin calibración. | Ningún POI 9/recorrido recibido; no fue descartado por la importación. | Obtener POI 9 y su número de hoyo cuando el proveedor confirme cobertura, o puntos geográficos revisados de los cambios de dirección. Integrar únicamente esos puntos con salida/green; un dibujo o sus yardas no aportan la correspondencia. |
| **Precisión, fecha de captura y datum de los puntos de proveedor** | Evaluar incertidumbre de GPS; no confundir punto reportado con bandera diaria o medida de campo. | B/C/H y metadata normalizada. | Proveedor no documentó estos valores en respuestas; se mantienen null. “Actualizado 2021-04-14” es fecha de registro, no de medición. | Ficha técnica del proveedor o contraste en campo sobre los mismos objetivos identificados. La prueba física sigue PENDING_DEVICE_QA y no se reemplaza por checksums/tests. |

### Pista histórica, sin promoverla a tarjeta válida

El vector de pars de `lavista-temporal-white` suma **69**.
Cambiar **solo** el hoyo 6 de 3 a la confirmación registrada de 4 suma **70**.
El hoyo 4 permanece en **3**, mientras el estándar está en **5**.

Esa aritmética identifica una hipótesis concreta y reduce la pregunta al documento
operativo: ¿la configuración temporal realmente acorta el 4 a par 3, conserva el
6 como par 4 y mantiene los otros 16 pars y todo el orden?
No existe confirmación documental suficiente de esa hipótesis en los archivos
revisados. No se aprobó el array, no se copiaron sus ventajas y no se actualizó
el catálogo. Coincidir con un total no valida el recorrido.

### Datos ya recuperados y correctamente conservados

- Frente/centro/fondo: los **54 puntos** están disponibles en el snapshot privado
  DEV para los 18 hoyos estándar y su alias local **ya aprobado**. No se volvió a
  consultar ni reimportar. No se asignaron a Par 70/69.
- Las cuatro tarjetas y ventajas globales de GolfAPI se reconstruyen idénticas
  desde los originales. `holeOverrides=null` significa que no hay una excepción
  por tee; **no** significa que hayan desaparecido los pars globales.
- El PDF muestra “3…” en el hoyo 8. White/8=**374 yd** aparece explícito e
  independiente en B y D; ya está en sus tarjetas Par 72. Se conserva ese respaldo
  sin falsificar el texto truncado del PDF ni trasladarlo al temporal.
- Las 18 ventajas distintas entre GolfAPI y GHIN quedan como **versiones separadas**,
  no como una normalización de nombres/colores. Los IDs y categorías de tees
  distintos se conservan.
- El encuadre actual sin tees es una ventana de contexto de **520 m** alrededor del
  green, no la geometría del hoyo completo. `holeViewport` consume referencias
  guardadas cuando existen; cambiar zoom/padding sin datos no desbloquea el
  encuadre demostrado de los 18 hoyos.

## Exactamente qué tarjeta se necesita

**La Vista Country Club — configuración temporal por reparación, Par 70, vigente
para la fecha en que se va a jugar.** No el yardage book WHITE Par 72 ni una
tarjeta antigua “La Vista Temporal” sin identificar versión.

Mínimo para score: nombre/configuración, fecha/vigencia, orden 1–18 y sus pars.
Una fotografía de ambos lados de una tarjeta usada por un jugador es suficiente
como entrada para revisión; no se exige un plano del club ni cientos de capturas.

En la misma evidencia conviene incluir SI/HCP/ventajas y yardajes por color.
Para GPS se necesita además confirmar correspondencias físicas y excepciones
temporales. Rating/slope/categoría se validan por separado y no bloquean el
trabajo documental de score/GPS.

Plantilla adjunta `la-vista-par70-required-card.template.csv`: 18 filas con
campos **vacíos**, no un scorecard inventado, no apta para importación automática.
La metadata/diff de preparación permanece fuera del checkout.

## Consultas futuras documentadas: preparadas, NO ejecutadas

Documentación oficial enlaza la colección Postman:
<https://www.golfapi.io/docs/> → <https://documenter.getpostman.com/view/1756312/UVeDsT2b>.
Se releyó la colección oficial guardada, sin autenticar contra la API.
Base: `https://golfapi.io/api/v2.3/`.

| Endpoint | Información que sí puede devolver | Consumo documentado | Condición antes de pedir autorización |
|---|---|---:|---|
| `GET /clubs/1179800210230` | Identidad del club y lista de course IDs/nombres/hoyos, timestamp y hasGPS. No promete tarjeta temporal ni tees geográficos. | 1 crédito; 1 solicitud física | Solo si el proveedor confirma que cambió su lista de recorridos o hace falta conocer el ID nuevo. La lista ya guardada tiene un único recorrido. |
| `GET /courses/{courseID confirmado}` | `parsMen/parsWomen`, `indexesMen/indexesWomen`, tees, `length1…18`, ratings/slope/categorías cuando existan; overrides reales por tee. | 1 crédito; 1 solicitud física | Obtener antes un ID/versión que el proveedor identifique como **Par 70 temporal**. Repetir el ID estándar sin noticia de actualización no proporciona esa evidencia. |
| `GET /coordinates/01213326512553886` o el ID temporal confirmado | Puntos por hoyo: POI 11 Front tee, 12 Back tee, 9 Dogleg y 1 Green **cuando el proveedor los tenga**. | 1 crédito; 1 solicitud física | Confirmación previa de puntos adicionales/versión actualizada. Misma respuesta de 54 greens no resuelve el hueco. Si cambia el recorrido, revisar mapping antes de servirlo. |

El contrato de coordinates **no contiene teeID/color, polígonos, trayectoria
completa ni parámetro para forzar tees inexistentes**. POI Front/Back tee son
referencias genéricas: no se pueden presentar automáticamente como Blue/White/
Gold/Red. `oldCourseIDs` son alias históricos del mismo recorrido, no IDs
documentados de Par 70/69.

No se propone pagar una consulta a ciegas. Si el proveedor confirma tarjeta y
puntos en un ID conocido, **detalle + coordenadas = 2 peticiones / 2 créditos**;
club-details solo sería un tercero si realmente hace falta descubrir un ID.
El presupuesto previo sigue **10/10 solicitudes consumidas**, no se reinició.
Saldo 17.7 fue el observado el 7/oct, **no un saldo consultado hoy**.
Todo pedido futuro requiere nueva autorización; no se hizo ninguno.

## Verificaciones de esta corrida y límites

- PASS: SHA256 de los **10 originales** y checksum del PDF La Vista.
- PASS: reproducción offline del snapshot completo, orden lon/lat, los 54
  puntos y yardajes/pars/SI preservados; fingerprints de cuerpos completos
  guardados en DEV coinciden con los originales locales.
- PASS: **205 comprobaciones** documentales/numéricas; ledger antes/después
  permanece en 10; **36/36 tests dirigidos** de normalización/GPS existentes.
- PASS: lectura actual de filas, perfiles, configuraciones, enlaces y caché
  del mismo DEV. No SQL de escritura ni migración.
- No cambios de código de aplicación/dependencias: no se repitieron build,
  typecheck o toda la suite para atribuirle un PASS a una integración inexistente.
- Cero solicitudes nuevas a GolfAPI/Mapbox; **0 inicializaciones Google**
  en esta auditoría. Lecturas de documentación y health no consumen esos productos.
- Par 70 y encuadre geográfico completo: pendientes de los datos exactos de
  la tabla. No se declara GPS completo.
- Precisión de teléfono/objetivos y gestos físicos: PENDING_DEVICE_QA.
  No se abrió una ronda ni se alteró El Mongas/Said/GHIN durante esta auditoría.

Evidencia durable y script reproducible, sin credenciales:
`C:/Users/said_/.codex/visualizations/2026/10/03/01a1039a-6144-7c61-ae88-7601acdff261/golfapi-ingestion-20261007/la-vista-data-audit-20261009/`.

Contiene `audit-existing.mjs`, `audit-result.json`,
`dev-readonly-evidence.json` y plantilla/metadata. Conserva originales privados
en su ubicación anterior; no se publicaron respuestas completas ni recursos
licenciados en Git.

# GPS con GolfAPI guardado y Google Maps — preparación aislada

Fecha: 2026-10-07. Estado: implementación aislada PASS; integración coordinada pendiente.
Rama: `codex/golfapi-controlled-ingestion`. Base de esta fase:
`e2b130ed55fdfbea46ee00455ca23b025b7d4e08`, conservando `3202b6c` y `e2b130e`.
No se hizo merge, cherry-pick, push, despliegue ni escritura remota.
La otra sesión conserva el checkout de `integration/backyard-current`.

## Implementado

- `GolfGpsReader`: una lectura privada autenticada de los cuatro snapshots,
  sin polling ni requests externos al cambiar hoyo/ubicación/objetivo/unidades.
- `GolfGpsView`: campo, posición de tarjeta, anterior/siguiente, metros/yardas,
  frente/centro/fondo, estado GPS, precisión/antigüedad, objetivo por toque/arrastre,
  dos distancias y líneas, centrar jugador, encuadrar referencias, detener GPS.
- Adaptador Google Maps JS satelital bajo demanda, una instancia por sesión,
  reutilizada entre hoyos. Sin Places, Routes, Directions, Geocoding,
  Google Geolocation API, Mapbox o ortofoto antigua.
- Guardas de origen exacto DEV, variable y flag antes de cargar SDK. Fallos de
  red/autenticación quedan detenidos, sin reintentos automáticos. Cancelación
  evita crear mapas después de abandonar la vista. Atribuciones nativas intactas.
- Geolocalización del dispositivo reutiliza `PilotLocation`. Un watcher activo,
  sin almacenamiento/upload. Caducidad 15 s y precisión reportada hasta 30 m;
  lecturas deficientes conservan estado visible y pausan distancias/posición.
  Pantalla oculta: detener; regreso: nueva lectura. No seguimiento en segundo plano.
- Distancias horizontales WGS84/Vincenty en dispositivo. 1 yd = 0.9144 m.
  Frente/fondo son puntos fijos del proveedor; Centro no es la bandera.
- DTO mínimo: IDs internos, posiciones/vueltas, puntos aceptados y procedencia.
  Sin payload crudo, claves, ratings, tarjetas, paths privados o cuarentena.
- Ruta GET `/api/golf-gps/courses`: off por defecto; dominio/branch DEV,
  autenticación/lifecycle y permiso específico existente del piloto o course-admin
  comprobado en servidor. No agrega roles ni modifica login/navegación.

## Datos reales guardados, sin nueva descarga

| Campo | Hoyos físicos / posiciones | F/C/B | Otros puntos GPS | Pendientes |
| --- | --- | --- | --- | --- |
| La Vista | 18 / 18 | 18 de cada rol | Ninguno | Tees GPS; precisión/captura/validación física |
| Campestre Puebla | 18 / 18 | 18 de cada rol | 36 tees + 1 referencia | Asociar tees a color/tarjeta solo con evidencia |
| Las Fuentes | 9 / 18 | 18 observaciones de cada rol | 18 tees | Revisión de correspondencia entre vueltas y tees |
| El Cristo | 18 / 18 | 18 de cada rol | 36 tees + 73 referencias aceptadas | Scorecard no descargado; 1 punto en cuarentena excluido |
| Cola de Lagarto | Pendiente | Sin datos guardados | Sin datos | No aparece como opción disponible |

Las Fuentes conserva 1/10 … 9/18 en los mismos nueve IDs físicos. Las coordenadas
de ambas posiciones permanecen distintas: no se promedian ni presentan como
otros nueve hoyos. Diferencia máxima entre referencias equivalentes: 9.537372 m,
evidencia del dataset, no error GPS demostrado. Mapping pendiente de prueba física.
Tees GPS genéricos no se asignan automáticamente a colores. Hazards son referencias
puntuales, sin inventar polígonos/bordes de penalización. En La Vista el encuadre
es del green y contexto satelital: no se promete una salida mapeada inexistente.

Fecha de actualización del registro: La Vista 2021-04-14; Campestre/El Cristo
2025-10-24; Las Fuentes 2025-10-26. No prueba fecha de captura ni precisión de
coordenadas o imágenes. Ningún punto tiene validación física aprobada.

## Configuración y persistencia pendientes

Se inspeccionaron nombres de variables locales accesibles y metadatos Vercel
de la rama canónica (32 entradas, sin decrypt). No apareció una clave de Maps.
Pendiente: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. No se pidió ampliar restricciones,
activar facturación ni cambiar cuotas. Configuración futura en el mismo DEV:

```dotenv
GOLF_GPS_ENABLED=false
GOLF_GPS_MAPS_ENABLED=false
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
GPS_LOCAL_QA_ENABLED=false
```

`GOLFAPI_NETWORK_ENABLED=false` permanece. La clave GolfAPI es solo servidor,
no es necesaria para visualizar datos ya guardados. El interruptor bloquea
nuevas cargas; no equivale a un corte garantizado de facturación de Google.
No se consultó consumo de Google ni saldo actual GolfAPI en esta fase.

Persistencia: `PENDING_CONTROLLED_DB_APPLY`. Reutilizar la base DEV existente
`bymeopxkxapfizeeqeyb` únicamente después de reconfirmar URL/binding/aislamiento
y relevo visual. No se creó otro entorno/DB. Preparado previamente:
`scripts/sql/golfapi-private-cache.pending.sql` y plan privado de diez respuestas
+ cuatro snapshots. Dos tablas privadas append-only/RLS, RPC service-role,
FK a clubes/campos existentes. No actualiza Course Master, GHIN ni históricos.
La ruta server usa `read_golfapi_snapshot_v1`, con guard de binding aislado,
y falla explícitamente si la importación está pendiente. No cae en archivos
efímeros del deployment. Los archivos privados locales sirven solo para QA.

Importación posterior: verificar backup/hash/IDs/diff, generar migración aditiva
según procedimiento del repositorio, aplicar controladamente en DEV comprobado,
importar plan privado, repetir importación para probar idempotencia, reiniciar
y comprobar lectura. La reversión funcional mantiene flags off y conserva
evidencia; no requiere DROP ni borrar tarjetas. Restricciones/licencia del
proveedor siguen las documentadas en `GOLFAPI_PUEBLA_20261007.md`.

## QA ejecutado

- Dependencias propias: `pnpm install --frozen-lockfile --offline --ignore-scripts`.
  418 paquetes reutilizados, cero downloads, lockfile intacto. El junction previo
  está conservado fuera de uso en `.qa-artifacts/node_modules-shared-link`.
- `next typegen`, `tsc --noEmit`, compilación TS de tests: PASS.
- Lint completo: PASS sin errores/warnings.
- `next build` predeterminado/Turbopack: PASS. No se modificó Carrera ni next.config.
  Se separó el lector local del escritor/transporte GolfAPI; build final sin warning
  de tracing completo del proyecto. El fallo histórico de Webpack no se atribuye
  a este build ni se corrigió con cambios ajenos.
- Suite dirigida: 42/42 tests de integración/regresión, incluyendo wrappers
  que ejecutan 22 casos GPS/mapa nuevos, 22 ingestión/cache, 25 GPS previo
  y 10 alineación de imagen del piloto. Todo offline/sintético donde corresponde.
- Google doble SDK: loader dedup, flags/offline/key/origen, fallo persistente,
  auth tardía, arrastre/teclado, overlays, precisión, líneas, limpieza; ningún
  mapa se reconstruye tras 100 updates GPS/unidades/objetivo.
- Datos guardados: diez hashes de respuestas completas válidos; diez solicitudes
  acumuladas y ledger inalterado. Se comprobó campo/posición/rol/orden lon-lat,
  puntos excluidos y nueve IDs físicos en Las Fuentes. Cero nuevo GolfAPI.
- Navegador IAB local, viewports 390×844 y 430×932, sin overflow horizontal.
  Inicio/detención, cambio de campo/hoyo, anterior/siguiente, unidades, toque,
  arrastre, centrado, encuadre y recuperación de señal simulada comprobados.
  Denegado/timeout/caducidad/baja precisión visibles sin distancias ficticias.
  La primera prueba encontró un receptor incorrecto al limpiar el timer browser:
  corregido; no errores posteriores en la sesión QA.
- Auditoría Resource Timing visible en QA: solo `127.0.0.1:3217` (22 recursos
  en la recarga registrada); cero GolfAPI/Google Maps/Mapbox. Sin SDK real.
  No se pretende auditar todo el tráfico de otras sesiones del navegador.
- Capturas privadas `gps-local-390x844-simulation.jpg` y
  `gps-local-430x932-simulation.jpg`. Viewport solicitado; el screenshot full-page
  excluye la barra de scroll desktop (contenido 375/415 px). No son iPhone físico
  ni satélite; avisos de SIMULACIÓN visibles.

No se ejecutó toda la suite de la app ni se extrapola PASS a pruebas físicas.
Google Maps real/atribuciones/carga satelital en DEV: `PENDING_INTERACTIVE_QA`.
Precisión/funcionamiento iPhone y correspondencia de referencias en campo:
`PENDING_DEVICE_QA`.

## Abrir la QA local

Desde este worktree, sin cargar un archivo de secretos en el frontend:

```powershell
$env:GPS_LOCAL_QA_ENABLED='true'
$env:GOLFAPI_NETWORK_ENABLED='false'
$env:GOLFAPI_STORE_PATH='<ruta absoluta privada a private-store>'
$env:NEXT_TELEMETRY_DISABLED='1'
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3217
```

Ruta probada: `http://127.0.0.1:3217/gps-preparation`, exclusivamente esta computadora.
No es una URL accesible desde iPhone. Denegada en Vercel, producción, flags off
y cualquier host distinto al loopback/puerto específico. Controles simulados
de QA no existen en la superficie canónica. Verificador offline reproducible:

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node scripts/golf-gps-saved-data-check.mjs '<store absoluto>' '<informe privado absoluto>'
node --test .test-dist/tests/golf-gps.test.js .test-dist/tests/golfapi-ingestion.test.js .test-dist/tests/gps-la-vista-pilot.test.js .test-dist/tests/gps-pilot-auth-return.test.js
```

## Integración coordinada posterior

1. Esperar confirmación explícita de cierre visual. Releer status/branch/HEAD real,
   preservar cambios ajenos y revisar los commits propios sobre ese HEAD final.
   No desplegar esta base antigua ni resolver conflictos automáticamente.
2. Aplicar la persistencia controlada y comprobar sus guardas. Configurar la clave
   existente de Maps para DEV sin ampliar restricciones ni tocar billing.
3. Cambio compartido mínimo pendiente: en el host GPS aprobado (ruta dedicada
   autenticada o entrada `app/page.tsx`), pasar la sesión ya resuelta a
   `<GolfGpsReader token={session.access_token} onBack={...} />`.
   No reiniciar rondas ni modificar scores. Si se conecta contexto de una ronda,
   pasar solo `initialCourseId`/`initialPosition`, sin escribir el hoyo del marcador.
   Este bloque NO modifica ninguno de esos archivos compartidos.
4. QA/regresión sobre HEAD integrado, un único despliegue DEV coordinado,
   comprobación de SHA/HTTPS/permiso y primera carga real de Maps allí.
   Abrir cuatro campos, mover objetivo/cambiar hoyos/GPS sin reloads del mapa,
   confirmar atribuciones/errores y funcionamiento real de ubicación en iPhone.
5. Probar referencias conocidas en campo, diferenciando incertidumbre del teléfono,
   dataset y objetivo; Centro ≠ bandera. No afirmar precisión de telémetro.

Referencias oficiales verificadas para el adaptador:
[carga JS](https://developers.google.com/maps/documentation/javascript/load-maps-js-api),
[tipos de mapa](https://developers.google.com/maps/documentation/javascript/maptypes),
[OverlayView](https://developers.google.com/maps/documentation/javascript/customoverlays),
[eventos y gm_authFailure](https://developers.google.com/maps/documentation/javascript/events),
[errores](https://developers.google.com/maps/documentation/javascript/error-messages).
No se cambió ninguna cuenta o servicio.

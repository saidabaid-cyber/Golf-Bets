# Piloto GPS La Vista 1 — integración incremental

Fecha: 2026-10-06. Base verificada: `0d70689ecc1ca3100ac9aedd253f3a791a1177b4`,
`integration/backyard-current`, local y remoto iguales, worktree limpio antes de
copiar el paquete. El cierre de El Mongas terminó antes de integrar
(turno `01a11365-4f67-7de3-9c93-cf6ecedce5c0`); sus commits son ancestros de esta
base. No se interrumpieron operaciones ni se resolvieron conflictos de sus datos.

## Alcance y acceso

- Ruta canónica: `https://dev.thebackyard.com.mx/gps-pilot/la-vista-1`.
- Flag privado `GPS_LA_VISTA_1_PILOT_ENABLED=true`, limitado en Vercel a target
  `preview` y gitBranch `integration/backyard-current`. Apagado por defecto.
- Además se comprueban rama, entorno y host exactos en página y API.
- El servidor reutiliza `requireAdminMode(request, "courses")`: sesión real,
  lifecycle y membresía administrativa vigente. No se amplían permisos.
- La membresía ADMIN GLOBAL existente de Said se confirmó por lectura.
- API GET privada/no-store; no hay mutaciones, migraciones, inserción al Course
  Master ni almacenamiento/transmisión de posiciones del teléfono.
- Se reutilizó el paquete preparado, sin incorporar la antigua rama GPS ni
  sustituir archivos de GHIN, rondas, scores, apuestas o autenticación.
- La imagen es un recorte atribuido a INEGI. No se distribuye la imagen del PDF
  ni imágenes privadas de otros proveedores.

## Condición del objetivo

El punto es candidato interior del green, **no bandera ni centro medido**.
INEGI E14B43d4, UPC 889463190707, enero de 2010, píxel de 1 m.
`target.json` conserva checksum, selección de píxel, UTM, correspondencias
documentales y transformación. La transferencia del marco ITRF92/época 1988.0
a WGS84 del teléfono es aproximada, sin corrección de datum/época. Su precisión
absoluta es desconocida. Estado `PROVISIONAL_NOT_FIELD_VERIFIED`.

La advertencia permanece visible. Este punto no se publica como geometría
revisada. No se añadieron otros hoyos, flyover, 3D ni ajustes de elevación.

## Ubicación y distancias

Cálculo Vincenty WGS84 local, coordenadas `[longitud, latitud]`, `1 yd = 0.9144 m`.
Se solicita ubicación exclusivamente al pulsar **Usar mi ubicación**.
Una lectura de más de 15 s o precisión reportada mayor de 30 m no produce yardaje.
Timeout 12 s, `maximumAge: 0`, un watcher; al detener, ocultar o salir se limpia.
El regreso requiere volver a activar. Los datos simulados se etiquetan
explícitamente en QA y no forman parte del flujo desplegado.

## Verificación local

- 25/25 pruebas portables de geodesia, unidades y estados/listeners de ubicación.
- 7/7 pruebas de integración: ejecución real de las 25 portables, flag, host/rama,
  401, 403, acceso administrativo, caché y ausencia de escritura.
- 30/30 pruebas dirigidas contando acceso administrativo y navegación/configuración
  de ronda; la prueba portátil ejecuta adicionalmente sus 25 casos.
- Suite vigente compilada en directorio limpio: 4600/4605. Mismos cinco fallos
  previos: tres contratos Equipos, contrato Reglas y auditoría de catálogo.
- Scripts: 117/117. Typecheck, lint y build PASS.
- La primera ejecución usó salida compilada antigua con 43 casos adicionales;
  se descartó como evidencia y se recompiló en una salida aislada limpia.
- Las restricciones del sandbox bloquearon fixtures Git/loopback y archivos
  generados de Next. Con ejecución local autorizada pasaron scripts y build.
- El código GPS no importa SDK externo ni realiza solicitudes Mapbox.

El manifiesto de integración, recuperación y logs completos permanecen en el
directorio de preparación externo `gps-pilot-integration-20261006`. La evidencia
de despliegue/HTTP/SHA y navegador se añade allí después de publicar; un build
local por sí solo no acredita publicación.

## Prueba de iPhone

1. Iniciar sesión en el DEV con la cuenta autorizada de Said y abrir la ruta.
2. Pulsar **Usar mi ubicación**, permitir ubicación y revisar distancia, precisión
   y antigüedad. Ante lectura caducada/imprecisa no debe aparecer un número.
3. En La Vista 1, comparar el green de la imagen con el real; contrastar el mismo
   objetivo identificable, no una bandera móvil. Registrar hora y discrepancia;
   finalizar con **Detener GPS**.

Funcionamiento físico y exactitud del objetivo: **PENDING_DEVICE_QA**.
Mapbox apagado; sin servicios ni cargos nuevos. Para desactivar, retirar/apagar
solo el flag de esta rama y volver a desplegar el DEV existente.

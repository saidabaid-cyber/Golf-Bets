# GolfAPI: ingestión privada de Puebla — 7 de octubre de 2026

## Alcance y conservación

Base: `5b946739913954770e5c0362bf5f170f1c9712fb`, HEAD real de
`integration/backyard-current` al iniciar. Trabajo exclusivo en
`codex/golfapi-controlled-ingestion`, worktree separado. El checkout visual,
la configuración de despliegue, pantallas, GHIN, rondas y Course Master no se
modifican. No push ni despliegue durante esta etapa. No migraciones remotas.

La clave está configurada como `GOLFAPI_API_KEY` solamente en un archivo
privado externo al repositorio. `GOLFAPI_NETWORK_ENABLED=false` es el estado
persistente. No se modificaron variables Vercel ni secretos compartidos.
No nuevas dependencias, servicios, cuentas, pagos ni solicitudes a Mapbox.

## Contrato comprobado y presupuesto

Documentación oficial: <https://www.golfapi.io/docs/> y su colección Postman
<https://documenter.getpostman.com/view/1756312/UVeDsT2b>.
Base documentada: `https://golfapi.io/api/v2.3/`, Bearer Authorization.
IDs de texto, conservando ceros iniciales. Búsquedas parciales por nombre o
filtros de país/estado/ciudad; páginas de hasta 200 resultados. Lat/lng ordenan
por proximidad y no constituyen un filtro de radio. No se descargó un país
completo ni se recorrieron páginas adicionales.

El límite humano es **10 peticiones físicas acumulativas**, también ante error.
GolfAPI contabiliza búsquedas a 0.1 crédito y detalles/coordenadas a 1; esto
no amplía el límite de diez. Todas las peticiones reales respondieron HTTP 200.

| # | Operación documentada | Motivo / resultado | Saldo comunicado |
|---|---|---|---:|
| 1 | clubs, state=puebla | Búsqueda regional acotada; sin resultados | 24.9 |
| 2 | clubs, name=la vista | Resolver La Vista entre homónimos; Puebla usa PUE | 24.8 |
| 3 | clubs, country=Mexico, state=PUE | Nueva hipótesis basada en el código recibido; cinco clubes, cuatro objetivos | 24.7 |
| 4 | courses/01213326512553886 | Tarjeta completa La Vista | 23.7 |
| 5 | coordinates/01213326512553886 | Todos los puntos La Vista | 22.7 |
| 6 | courses/0121254756996467 | Tarjeta completa Campestre | 21.7 |
| 7 | coordinates/0121254756996467 | Todos los puntos Campestre | 20.7 |
| 8 | courses/0121235348037759 | Tarjeta completa Las Fuentes | 19.7 |
| 9 | coordinates/0121235348037759 | Todos los puntos Las Fuentes | 18.7 |
| 10 | coordinates/0121165709980130 | Priorizar GPS El Cristo sobre otra tarjeta | 17.7 |

**10/10 usados, cero peticiones autorizadas restantes.** Saldo GolfAPI observado
en la última respuesta: 17.7 créditos; no se consultó después. No reintentos,
polling ni consultas desde tests/build/lecturas normales.

El ledger persistente reserva un intento antes del GET, tiene bloqueo exclusivo
y no se reinicia al reabrir el script. Una respuesta íntegra se guarda antes de
parsearse. Corrupción, interrupción, fallo de escritura, autenticación o cuota
detienen nuevas consultas. Los reads usan respuestas guardadas incluso sin
clave o con red apagada; no reparan una caché dañada llamando al proveedor.

## Cobertura recibida y correspondencia

Identidad revisada por club, localidad, país, curso externo y registros existentes;
la ubicación regional sirve como control adicional, no como único identificador.
Los IDs internos proceden de una consulta de solo lectura al catálogo DEV.

| Campo | ID interno conservado | Posiciones / físicos | Frente-centro-fondo | Otros puntos | Tarjeta |
|---|---|---|---|---|---|
| La Vista | course-la-vista | 18 / 18 | 18 greens, 54 puntos | Sin tees GPS ni hazards en respuesta | 18 posiciones, cuatro tees |
| Campestre Puebla | course-campestre-puebla | 18 / 18 | 18 greens, 54 puntos | 36 puntos de tee, una referencia | 18 posiciones, cuatro tees |
| Las Fuentes | review-course-24458 | 18 / 9 | 54 observaciones para 18 posiciones | 18 puntos de tee | 18 posiciones, cuatro tees |
| El Cristo | course-el-cristo | 18 / 18 | 18 greens, 54 puntos | 36 tees, 73 hazards/referencias aceptados | Detalle no solicitado por límite |
| Cola de Lagarto | course-cola-de-lagarto | No obtenido | No obtenido | No obtenido | No obtenido |

Cola de Lagarto **no fue identificado en la búsqueda guardada**; no se afirma
que esté ausente de todo GolfAPI. Falta una búsqueda dirigida autorizada en una
etapa posterior. El Cristo tiene 164 puntos originales: se aceptaron 163 y se
conservó aparte un bunker de fairway del hoyo 1, fuera de la región del campo.
No se corrigió a ojo ni se borró la respuesta original.

Las Fuentes mantiene nueve entidades físicas y 18 posiciones/vueltas. La
asociación 1–10 hasta 9–18 es candidata consistente con la confirmación de nueve
hoyos y los puntos repetidos del proveedor. Hay diferencias de hasta 9.54 m entre
observaciones equivalentes. Se conservan ambas, sin promedio ni selección
silenciosa; `TWO_LOOP_PROVIDER_PAIR_PENDING_FIELD_REVIEW`.

POI son puntos, **no polígonos de green, límites oficiales de hazards ni trazados**.
Front/back de tees no están vinculados al color o ID de tee de la tarjeta.
Frente/centro/fondo son referencias fijas etiquetadas por GolfAPI; el centro no es
la bandera diaria ni un centro geométrico calculado por nosotros. Distancias
horizontales locales WGS84/Vincenty, metros y yardas (1 yd = 0.9144 m), sin
ajustes por viento/elevación. El orden interno/GeoJSON es [longitud, latitud].

Precisión, fecha de captura de coordenadas y datum formal no documentados:
permanecen desconocidos y señalados. La fecha de actualización del registro
(La Vista 2021, otros 2025) **no es fecha de medición GPS**. Validación física:
`PENDING_DEVICE_QA`. La prueba numérica desde un centro del propio proveedor
está explícitamente etiquetada `SIMULATED_PROVIDER_REFERENCE_NOT_PHONE_GPS`.

## Persistencia y diff

Directorio privado duradero de operador:
`C:/Users/said_/.codex/visualizations/2026/10/03/01a1039a-6144-7c61-ae88-7601acdff261/golfapi-ingestion-20261007/private-store`.
ACL restringida al usuario local y SYSTEM. Fuera de Git y del filesystem efímero
del deployment. Archivo de clave aparte, excluido de respaldo de datos.

Contenido: ledger, diez envelopes completos con SHA256, cuatro snapshots
normalizados/versionados, GeoJSON privado, coverage, diffs, evidencia offline
y plan de importación privado. Los datos originales se conservan completos.
Las diferencias con tees/ratings existentes no se aplican: diez advertencias en
La Vista, seis en Campestre y dos en Las Fuentes, incluidos valores divergentes
y categorías de rating no especificadas. Sin cambios al catálogo activo,
variantes locales/temporales, tarjetas GHIN ni históricos.

`source.server.ts` ofrece lectura privada del cache y reutiliza el contrato
`CourseCatalogProvider`; no tiene fetch upstream. Su proyección es una vista
de la fuente, **no un merge**: ratings siguen en el snapshot privado, no habilitan
handicap/posting GHIN. Archivos locales se rechazan como persistencia Vercel.

## Integración controlada posterior

Estado: `PENDING_CONTROLLED_DB_APPLY` e integración pendiente del cierre visual.
Recurso previsto: la base DEV aislada existente `bymeopxkxapfizeeqeyb`, nunca una
base compartida con producción. La asociación se revisó con lectura real, pero
la vinculación URL/variables/HEAD se debe comprobar nuevamente al relevo.
No se crearon otro proyecto, entorno ni base.

DDL preparado: `scripts/sql/golfapi-private-cache.pending.sql`, todavía fuera de
la lista de migraciones aplicables. Reutiliza `golf_courses` / `golf_clubs` como
referencias. Agrega únicamente dos tablas **privadas**, versionadas, append-only,
RLS activado, sin grants anon/authenticated; RPC solo service_role y SECURITY
INVOKER. No modifica políticas globales ni registros de campos actuales.
Probado en PGlite local en memoria; no ejecutado remotamente. Supabase CLI no
estaba disponible en esta ejecución: al relevo, generar la migración según el
procedimiento existente, revisar destino y aplicar una vez de manera controlada.

El plan privado contiene diez saves de respuestas y cuatro saves de snapshots.
Los saves son idempotentes y rechazan versiones conflictivas. No se ejecuta
automáticamente; el generador del plan no importa un SDK remoto ni usa fetch.
Después de aplicar, cargar el plan desde servidor/operador autorizado, comprobar
counts/hash/IDs y reload, y habilitar únicamente lectura autenticada necesaria.
Reversión funcional: mantener deshabilitado/no conectado el adaptador; conservar
evidencia privada, sin DROP, borrado ni actualización de tarjetas.

Revisar commits propios sobre el **HEAD final** de la tarea visual; no sustituir
DEV por el HEAD base de este worktree. Hacer integración, QA y un único despliegue
coordinado posterior. Este bloque no cambió alias, workflows ni secretos remotos.

## Comandos offline reproducibles

Desde el worktree, con Node del proyecto y una ruta privada de configuración:

```powershell
node --env-file="<archivo-privado>" scripts/golfapi-ingest.mjs status
node --env-file="<archivo-privado>" scripts/golfapi-reconcile.mjs
node --env-file="<archivo-privado>" scripts/golfapi-private-import-plan.mjs
node --test scripts/golfapi-ingest.test.mjs scripts/golfapi-normalize.test.mjs scripts/golfapi-cache-db.test.mjs
```

No ejecutar nuevos GET: presupuesto agotado. `env.example` contiene nombres
vacíos; no contiene la clave. Variables locales de operación: GOLFAPI_API_KEY,
GOLFAPI_STORE_PATH, GOLFAPI_NETWORK_ENABLED, GOLFAPI_MAPPING_PATH y
GOLFAPI_EXISTING_CARDS_PATH. Para remote cache se reutilizarán las variables
server-only de Supabase existentes después de comprobar aislamiento; ningún
nombre público GolfAPI ni nueva cuenta.

Licencia/uso: la página oficial permite cachear y reutilizar en la aplicación
propia; no autoriza redistribuir/revender el dataset. Por eso los payloads,
GeoJSON y plan no se incluyen en Git, public/ ni fixtures. Las pruebas usan solo
datos sintéticos. Revisar condiciones vigentes antes de distribuir otra capa.

Queda preparado para Google Maps: puntos etiquetados, IDs internos conservados,
tee/card separados de GPS, lectura server-only y cálculo local independientes
del renderer. No incluye mapa satelital, bandera móvil, polígonos, flyover ni
validación física. La ausencia del proveedor de mapas no bloqueó la ingestión.

## Verificación ejecutada

- Línea base: compilación TypeScript de tests y 15 pruebas existentes PASS.
- GolfAPI: 22 casos offline (11 control/almacenamiento, diez normalización y
  uno SQL/PGlite con numerosas aserciones de permisos/conflictos), más cinco
  casos de integración/proyección server-only, PASS.
- Regresión dirigida de catálogo, geodesia, Course Master, seguridad GHIN y
  acceso/retorno del piloto GPS: 46 casos PASS (algunos ejecutan subpruebas).
- Typecheck (`next typegen` + `tsc --noEmit`) y lint completo: PASS.
- Build predeterminado: FAIL por el enlace node_modules del worktree que
  Turbopack rechaza fuera de su root. Build alternativo Webpack: FAIL en
  `app/components/career-hub.module.css:4`, selector global no puro ya presente
  en la base, commit `524ac32`; archivo intacto, SHA256
  `ee191505d739eaf7a264240cfc00554e29e435e191e1890966b1119b5e1f29bc`.
  No se modificó Carrera ni next.config para forzar un PASS. Repetir el build
  real después del relevo visual, con dependencias locales del checkout vigente.
- Lectura/reconciliación repetida: snapshots idénticos, diez hashes de respuestas
  válidos, ledger antes/después 10, cero nuevas peticiones y cero writes remotos.
- Suite completa de toda la app, browser/UI y dispositivo: no ejecutados para
  este bloque backend. No se atribuyen cinco fallos históricos de otra corrida.

El checkout visual avanzó independientemente a `3e34b260e4570c23baf4e294e9d235fff9006434`
durante la preparación. Este registro es una observación, no autorización de
relevo ni un HEAD que deba reemplazarse. La integración posterior debe releerlo.

# GPS: configuración real y persistencia preparada — 2026-10-07

Continuación de `GPS_GOOGLE_PREPARATION_20261007.md`, conserva todos sus commits.
Preparación exclusiva en `codex/golfapi-controlled-ingestion`. Sin merge, push,
deployment ni escrituras remotas en DB. La sesión visual sigue activa.

## Configuración comprobada

Encontrada la clave **existente** de `The Backyard Maps`, proyecto
`the-backyard-maps`, mediante su consola autenticada. Restricciones observadas:
Maps JavaScript API; `https://dev.thebackyard.com.mx/*`. No se modificaron.
No se cambió facturación, no se creó clave/proyecto/cuenta y no se cargó Maps JS.

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` guardada en `.env.local` ignorado por Git del
worktree GPS y en respaldo local privado. Flags locales `GOLF_GPS_ENABLED=false`
y `GOLF_GPS_MAPS_ENABLED=false`. No se guardó en la copia visual de la app.

En Vercel, proyecto existente `golf-bets`:

| Variable | Alcance | Rama | Evidencia |
|---|---|---|---|
| NEXT_PUBLIC_GOOGLE_MAPS_API_KEY | Preview, override de rama | integration/backyard-current | creada sin upsert; readback coincide con la clave existente |
| GOLF_GPS_ENABLED | pendiente | mismo override cuando se integre | no creada/activada ahora |
| GOLF_GPS_MAPS_ENABLED | pendiente | mismo override cuando se integre | no creada/activada ahora |

No se tocó Development, Preview global ni Production. La clave pública se
incorpora al cliente durante el **futuro build coordinado**; cambiar una variable
no altera el deployment vigente. El loader admite únicamente el origin DEV;
localhost, ausencia de clave, mapa desactivado y falta de red fallan sin cargar
scripts. No ampliar el referrer para hacer pruebas locales.

## Destino persistente: inspección remota de solo lectura

Vercel override de `integration/backyard-current` observado el 7 de octubre:
`NEXT_PUBLIC_SUPABASE_URL=https://bymeopxkxapfizeeqeyb.supabase.co`,
`PREVIEW_DB_REF=bymeopxkxapfizeeqeyb`,
`ADMIN_MODE_DB_REF=bymeopxkxapfizeeqeyb` y origin DEV canónico.

Listado de ramas Supabase: `phase2-full-platform-qa` con ref
`bymeopxkxapfizeeqeyb`, no predeterminada, distinta del proyecto padre
`zhqmlpljloumldaczcfp`. El proyecto padre permanece protegido; se consultó
únicamente su metadata de ramas para demostrar separación, no sus datos.
La base DEV es compartida con la **sesión visual**, por lo que no se aplica nada
durante esta preparación, aunque sea distinta de Production.

PostgreSQL DEV 17.6. `golf_courses.id`, `golf_courses.club_id` y `golf_clubs.id`
son `text`, compatibles con las FK pendientes. `service_role` lee ambos catálogos
y tiene BYPASSRLS; `authenticated` lee los catálogos; `anon` no los lee.
No se ampliaron permisos. Las dos tablas privadas y las tres funciones del cache
GolfAPI **no existen todavía**: estado `PENDING_CONTROLLED_DB_APPLY`.

| Campo | ID existente de campo | ID existente de club | Posiciones / físicos GPS |
|---|---|---|---|
| La Vista | course-la-vista | club-la-vista | 18 / 18 |
| Campestre | course-campestre-puebla | club-campestre-puebla | 18 / 18 |
| Las Fuentes | review-course-24458 | review-club-75f6ac3a0e37a69eabd3 | 18 / 9 |
| El Cristo | course-el-cristo | club-el-cristo | 18 / 18 |

El catálogo DEV declara 18 posiciones en Las Fuentes. Se conserva intacto;
el snapshot GPS representa aparte los nueve hoyos físicos y ambas vueltas.
No se consultó Cola de Lagarto ni se añadieron campos.

## Importación y reversión preparadas

- `scripts/sql/golfapi-private-cache.pending.sql`: DDL aditivo sin aplicar.
  Cache privado con RLS, sin grants de cliente; RPC SECURITY INVOKER exclusivamente
  `service_role`. Ninguna modificación a tarjetas, tees, ratings, GHIN o rondas.
  Comprobación explícita de valores nulos y versión; bloqueo de transacción para
  evitar que un conflicto concurrente quede oculto tras ON CONFLICT.
  Revoca grants heredados/defaults de las dos tablas propias antes de dar solo
  SELECT/INSERT a service_role; la prueba local incluye defaults amplios.
- `scripts/golfapi-private-import.mjs`: valida offline integridad de las diez
  respuestas y cuatro snapshots, mapping, posiciones y coordenadas. Genera SQL
  privado de preflight/backup/import/rollback; **sin transport ni cliente remoto**.
- `scripts/golfapi-private-persistence-check.mjs`: prueba los payloads guardados
  sobre PGlite en disco fuera del checkout. Crea solamente un catálogo mínimo
  local de FK con los IDs comprobados; no copia usuarios ni rondas.

Privado, fuera de Git y de `public/`:

`C:/Users/said_/.codex/visualizations/2026/10/03/01a1039a-6144-7c61-ae88-7601acdff261/golfapi-ingestion-20261007/private-store/`

Allí permanecen las respuestas completas, normalización, ledger, plan de
importación y checksums. `persistence-verification.json` indica el directorio
de PostgreSQL local, respaldo del plan, SQL y recibo utilizados. Los recibos de
esa prueba están marcados **LOCAL ONLY**: nunca usarlos para revertir DEV.

Comprobado con datos reales guardados, **no con solicitudes nuevas**:

1. Una respuesta preexistente; importar añadió nueve respuestas y cuatro snapshots.
2. Segunda importación: cero altas, diez respuestas/cuatro snapshots en total.
3. Cerrar/reabrir PostgreSQL desde disco: cuatro snapshots idénticos al original.
4. `anon` y `authenticated` no leen RPC ni tablas; `service_role` no puede borrar.
5. Reversión local por recibo: conserva la respuesta preexistente y cuatro IDs
   de catálogo; no borra tablas/RPCs. Se repone el cache local para inspección.
6. Ledger original intacto, cero solicitudes externas y cero escrituras DB remotas.

Antes del apply futuro: reconfirmar binding/aislamiento y estado de schema, tomar
respaldo DEV con el mecanismo existente y registrar checksums; generar migración
desde el DDL pendiente mediante el procedimiento del repo. No repetir DDL ante
objetos divergentes ni desactivar RLS. Después del DDL, ejecutar el SELECT generado
por `preparedPreflightSql(plan)` y **guardar su resultado completo privadamente**.
`receiptFromPreflight(baseline, plan)` rechaza registros anteriores distintos y
determina exactamente qué claves serán nuevas. Aplicar los catorce RPC en una
transacción y verificar 10 respuestas/4 versiones, hashes, roles y readback.
Repetir la importación debe añadir cero registros.

Reversión: apagar flags GPS primero. Conservar respaldos y evidencia. Generar
`preparedRollbackSql(receiptDev, plan)` desde el baseline DEV fresco, nunca el
local. Revisar/ejecutar por operador privilegiado únicamente si hace falta:
elimina solo claves nuevas de este lote con valores originales coincidentes y
conserva respuestas referenciadas por snapshots sobrevivientes. No elimina
catálogos, datos históricos, tablas o funciones, ni registros anteriores al lote.

## Sesión y modo real

`GolfGpsAccountReader` consume `useBackyardAccount` **dentro del AccountProvider
ya existente**. Este último espera la restauración de sesión antes de renderizar
sus hijos. Invitados usan `openAccess` existente; no se introduce otro login o
provider. Autenticados pasan el token real a `GolfGpsReader`, con remount por
identidad; el servidor vuelve a verificar sesión, lifecycle y permiso específico
GPS o administración de campos. No exige ni consulta GHIN.

`GolfGpsReader` lee `/api/golf-gps/courses` una vez por token, con timeout/abort y
retry manual. No consulta al cambiar campo/hoyo, mover objetivo o recibir GPS.
El servidor usa el cache privado normalizado; no importa escritor de archivos
ni upstream. El cliente utiliza `googleMapsFactory` y `browserLocationAdapter`
reales por defecto. No importa el simulador. Falta de configuración/datos,
permiso denegado, timeout, caducidad o mala precisión tienen estados explícitos.
Sin posición válida no hay distancia del jugador inventada. Centro != bandera.

## Integración después del cierre visual

HEAD visual observado al inicio: `5114642548d1e2f7b5da86748bd5fa9e03c52e0c`.
Durante la preparación se observaron cambios ajenos sin commit en ese checkout,
incluido `app/page.tsx`. No se copiaron, editaron, restauraron ni incorporaron.
El HEAD definitivo de integración **debe ser el final de la sesión visual**.

Dependencias GPS en orden, desde base histórica
`5b946739913954770e5c0362bf5f170f1c9712fb`:

1. `3202b6c`: ingest controlado y contador durable (preservar, no volver a ejecutar).
2. `e2b130e`: normalización, cuatro mappings y DDL privado pendiente.
3. `1fe050a`: DTO GPS, cálculo y adaptadores reales Google/device.
4. `0b1b28c`: UI aislada y QA sin proveedor.
5. Commit de esta fase: persistencia, wrapper de sesión y este handoff.

No merge completo ni reemplazar archivos compartidos desde esta rama antigua.
Revisar los diffs y aplicar los commits propios selectivamente al HEAD final;
resolver cualquier conflicto preservando cambios visuales y pasar QA coordinado.

Conexión mínima pendiente en archivos **compartidos**, no modificados ahora:

- `app/page.tsx`: abrir/cerrar el lector bajo el AccountProvider actual; pasar
  `catalogCourseId` y posición cuando exista contexto, sin mutar ronda/score.
  Acceso independiente conserva el panel anterior; no inicia ronda.
- `app/components/round-capture-v2.tsx`: revisar el acceso GPS existente
  (`initialGpsOpen`) y el slot del panel; utilizar el lector solo en el alcance
  habilitado, manteniendo el cierre y retorno al marcador. Explorar otro hoyo
  del GPS no cambia el hoyo de score ni guarda/cancela una ronda.

No cambio al AccountProvider, GHIN, login, CSS global o Course Master necesario.
No diseñar otra navegación ahora. La ruta provisional `/gps-pilot/la-vista-1`
permanece intacta y no se convierte implícitamente en el GPS de cuatro campos.

Orden de integración: relevo visual confirmado → HEAD/status/respaldo nuevo →
diff selectivo GPS → conexión mínima → apply/import DEV controlados y readback →
flags exclusivos de esa rama → tests/typecheck/lint/build → un único deployment
coordinado en el mismo DEV → comprobar SHA/HTTPS → sesión Said y Google reales.

QA posterior: sesión con y sin GHIN, denegación sin permiso, cuatro campos/FCB,
Las Fuentes ambas vueltas, toque/arrastre/unidades, un mapa por montaje, GPS real
start/stop y retorno a score sin cambios. Google real `PENDING_INTERACTIVE_QA`;
precisión geográfica/teléfono `PENDING_DEVICE_QA`. Ningún mock acredita esas dos.

## Comprobaciones ejecutadas en esta fase

- 20/20 tests dirigidos del repo (tres wrappers ejecutan además 49 casos offline
  de GPS, ingest/normalización/SQL e importación). Sin upstream real.
- Typecheck completo PASS; lint completo PASS y warning de prueba retirado;
  build Next 16.3.3 PASS. No se ejecutó la suite completa de la app en esta fase.
- Diez respuestas crudas verificadas por hash; cuatro DTO y FCB/orden lon-lat
  comprobados offline; Fuentes 9 físicos/18 posiciones; punto rechazado de El
  Cristo sigue fuera del DTO. Ledger intacto y presupuesto restante cero.
- No prueba de navegador con Google real ni prueba física nueva. El simulador
  anterior se conserva exclusivamente para QA y no se ofrece como entrega real.

Referencias técnicas consultadas: [Google Maps JS loader](https://developers.google.com/maps/documentation/javascript/load-maps-js-api),
[Supabase seguridad de API](https://supabase.com/docs/guides/api/securing-your-api).
Reglas de variables/componentes leídas en la documentación Next instalada.

# The Backyard: nube, sincronización y modo offline

## Causas reparadas en el repositorio

La causa confirmada de las escrituras incompletas era una confirmación inválida: después de insertar scores el cliente pedía `select("id")`, pero `round_scores_cloud` no tiene esa columna; su llave es `(round_player_id, hole)`. PostgREST respondía `42703`, la proyección se detenía y quedaban ronda/jugadores sin el resto del detalle. La sincronización ahora confirma esas dos columnas reales, conserva la operación pendiente si falla cualquier proyección y la reconstruye de forma idempotente en el siguiente intento.

Además, una instalación reciente de Supabase puede no exponer tablas nuevas a `authenticated` de forma automática. En ese estado, una sesión válida recibe `42501` al leer `profiles` y las tablas cloud. La migración `20260904013601_repair_cloud_profiles_and_permissions.sql` agrega los `GRANT` explícitos, repara perfiles faltantes y conserva RLS como límite por `auth.uid()`.

La migración es aditiva: no borra filas ni vuelve a ejecutar migraciones anteriores. Debe aplicarse una sola vez al proyecto hospedado antes de declarar la prueba entre dispositivos aprobada.

La aplicación nunca traduce un `42703`, `42501`, 503 o una confirmación incompleta en “Guardado en la nube”. El snapshot queda en IndexedDB y se reintenta sin borrar la copia local.

## Fuentes de datos

- Supabase es la fuente central para una cuenta autenticada y vinculada.
- IndexedDB (`the-backyard-offline-v1`) es la copia durable offline por `user_id` y contiene el último workspace y una sola operación idempotente pendiente.
- `localStorage` continúa como caché de lectura y capa de compatibilidad para rondas ya existentes. No se elimina hasta que Supabase confirma el snapshot exacto.
- Las fotos usan su almacén IndexedDB y una cola independiente; un error de Storage nunca se marca como subida correcta.

## Flujo

1. Cada edición se guarda inmediatamente en `localStorage` y en IndexedDB.
2. Con sesión vinculada se reemplaza el elemento del outbox de esa cuenta; no se agregan operaciones duplicadas.
3. Al recuperar conexión, foco, recargar o durante el refresco visible de 45 segundos, se descarga Supabase, se concilian IDs/fechas/tombstones y se sube el resultado.
4. El cliente vuelve a descargar la versión canónica antes de mostrar “Guardado en la nube”.
5. El outbox se elimina únicamente si su huella coincide con el snapshot confirmado.
6. Los fallos usan backoff exponencial acotado a cinco minutos. “Reintentar sincronización” lo omite de forma explícita.

Si el token vence mientras el teléfono está sin red, la app puede abrir la copia local del último workspace autenticado usando únicamente nombre/HCP/ID no sensibles. Ese modo no contiene JWT ni autoriza peticiones cloud. Al regresar internet, Supabase debe restaurar una sesión real antes de sincronizar.

## Eliminaciones

Las eliminaciones generan tombstones `(owner_id, entity_type, local_id, deleted_at)`. El servidor aplica primero los tombstones y vuelve a barrer después de escribir. Por eso una copia obsoleta no puede reinsertar una ronda, jugador, grupo, rival o campo eliminado.

## Conflictos

- Fechas distintas: gana el `updated_at` más reciente.
- Un score vive dentro del draft/snapshot y las proyecciones cloud lo materializan por jugador/hoyo.
- Dos dispositivos que modificaron el mismo draft desde la última base canónica (aunque sus relojes difieran), o igual fecha con payload distinto: no se elige en silencio. La UI conserva ambas copias y pide “Usar copia de la nube” o “Usar este dispositivo”. La elección avanza la fecha de versión.
- Antes de reemplazar rondas/drafts, Supabase guarda la versión anterior en `cloud_record_versions` con el dispositivo que la sustituyó.
- Los snapshots históricos mantienen ID estable; una corrección actualiza ese mismo ID en vez de duplicarlo.

## PWA

`public/sw.js` guarda únicamente el shell, manifest y assets estáticos. Nunca cachea `/api/*` ni respuestas con datos privados. El workspace y la cola se guardan en IndexedDB. Tras una visita online y activación del service worker, la app puede abrir su shell, recuperar la ronda descargada y seguir calculando/capturando sin red.

QA local 2026-09-03: el build de producción se abrió online en `localhost:3100`, se detuvo por completo el servidor y una navegación nueva al mismo origen volvió a mostrar The Backyard desde el service worker. Esto verifica el shell offline en navegador; la reinstalación, cierre forzado y modo avión físico de iPhone siguen requiriendo dispositivo.

## Validación hospedada pendiente de intervención

1. Aplicar y registrar la migración reparadora en el proyecto Supabase correcto.
2. Iniciar sesión con la misma cuenta en dos contextos, sin Service Role.
3. Completar perfil en A y comprobar nombre/HCP en B.
4. Crear una ronda QA en A, editar un score en B y recuperar foco en A.
5. Instalar la PWA en iPhone, abrir la ronda online, activar modo avión, cerrar/abrir, editar y reconectar.
6. Verificar en Supabase que no hay IDs duplicados y que RLS impide a otra cuenta leer los datos.

Las pruebas unitarias y la automatización del navegador validan la lógica, pero no sustituyen la prueba física de correo, iPhone ni dos dispositivos reales.

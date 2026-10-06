# Importación GHIN privada en DEV

Entorno autorizado: `integration/backyard-current`, `https://dev.thebackyard.com.mx`, Supabase `bymeopxkxapfizeeqeyb`. No se habilita posting ni se modifica el motor de ronda, apuestas, Atest o Backyard Index.

## Persistencia y origen

`handicap_provider_scores` guarda columnas normalizadas explícitas. La clave primaria es `(owner_id, provider, external_score_id)`. No guarda respuestas de autenticación, tokens, cookies, contraseñas, documentos ni scores por hoyo inventados.

Las tarjetas GHIN no se convierten en `RoundSnapshot`. La ronda Backyard sigue siendo editable mediante sus flujos existentes. Un vínculo apunta al ID canónico de `rounds_cloud`, sin sobrescribir su snapshot, jugadores, scores, apuestas o Atest.

RLS permite SELECT al dueño autenticado, no anónimo y activo. `anon` no tiene acceso. `authenticated` no puede insertar, actualizar, borrar ni ejecutar la RPC de importación. `service_role` tiene SELECT/INSERT/UPDATE sobre la tabla nueva, sin DELETE. La RPC es SECURITY INVOKER, valida el vínculo GHIN VERIFIED, el dueño de cada ronda/candidato y serializa por dueño antes del upsert.

## Reconciliación conservadora

1. ID externo ya vinculado o ID de una publicación confirmada: vínculo exacto.
2. Un único candidato con golfer vinculado, fecha, IDs confirmados de campo y tee, hoyos y score compatibles: alta confianza.
3. Coincidencia apoyada por nombres cuando faltan IDs: revisión, sin fusión automática.
4. Dos rondas candidatas o dos registros externos para una misma ronda: revisión. Una asociación exacta previa prevalece sobre otra tentativa.

Gross y adjusted gross no son intercambiables. El fingerprint guardado de posting se conserva. Si el provider no devolvió ID, sólo se asocia su receipt tras una coincidencia completa única. Un hash de evidencia local incluye los scores por hoyo: una edición material marca `GHIN_OUT_OF_SYNC`, incluso si el total no cambia. Nunca ejecuta un repost.

## Flujo y presupuesto

GET `/api/profile/ghin/import` reconstruye páginas privadas persistidas sin necesitar una sesión GHIN viva. POST con `{operation:"sync"}` exige la sesión legítima del mismo dueño/golfer, consulta el provider mediante `GhinReadOnlyClient` y persiste por RPC. El cliente no puede suministrar scores ni IDs de dueño.

El límite soportado actual es 1,000 tarjetas normalizadas por consulta. El transport existente consulta `/scores.json?golfer_id=...` y recibe el scoring record en una respuesta. No se inventan URLs de paginación. Se comunica `providerLimitReached` si se alcanza el límite; no significa que se haya verificado la totalidad upstream.

Se devuelven 20 tarjetas por página, vínculos y agregados seguros. No hay polling, retries automáticos de importación ni escritura de tarjetas GHIN en storage del navegador. Las visitas a Atest usan las tarjetas persistidas una vez disponibles y evitan volver a consultar GHIN por esa navegación.

## Métricas

El historial muestra `BACKYARD`, `GHIN` o `BACKYARD + GHIN`, ordenado por fecha. Las vinculadas se muestran una sola vez. Se conservan las acciones originales del histórico Backyard, incluidas rondas pendientes/canceladas.

El resumen combinado agrega exclusivamente gross real de tarjetas GHIN-only de 9/18 hoyos y evidencia Backyard de la misma modalidad. Las coincidencias en revisión quedan fuera de esos agregados. GHIN no inventa birdies, putts, GIR, fairways, rivalidades, logros por hoyo, apuestas ni Atest.

GHIN VERIFIED conserva la prioridad existente de Handicap Index. Backyard Index se sigue calculando exclusivamente con las tarjetas Backyard elegibles y se muestra por separado. Una tarjeta Backyard elegible sin Atest sí cuenta para Backyard Index según la regla actual; importar una tarjeta GHIN-only no la hace elegible.

## Posting y bloqueo actual

`GHIN_SCORE_POSTING_ENABLED` permanece apagado y el transport sigue siendo read-only. Se conserva el dry run y el exactly-once maduro; esta entrega no inventa un endpoint autorizado ni relaja sus guards.

Las 22 tarjetas completadas auditadas no tienen ambos mappings confirmados para sus IDs congelados. El mapping GHIN confirmado de `course-la-vista` no habilita `course-la-vista-club-current`. Los campos/rating/slope actuales no se sustituyen por aproximaciones. QA21 tampoco tiene un mapping confirmado del campo. QA24 es live y no es candidata.

Sin candidato seguro no se envía ninguna tarjeta ni se habilita el flag. El round-trip real queda BLOCKED_EXTERNAL hasta que existan sesión y mappings legítimos suficientes.

## Migración y rollback operacional

`supabase/migrations/20261006184558_ghin_owned_score_import.sql` fue aplicada exclusivamente al proyecto DEV indicado. Es aditiva; no ejecuta backfill ni altera tablas anteriores.

Ante un problema, detener las importaciones y deshabilitar el endpoint mediante su guard DEV. Conservar la tabla y toda evidencia ya importada. No hacer DROP, DELETE, rollback general ni cambios a las rondas Backyard.

## Evidencia

Snapshot inicial: `docs/qa/GHIN_EL_MONGAS_BEFORE.json`. Se compararon los 26 hashes/versiones de rondas después de la migración: cero diferencias. Tests SQL locales ejecutan la migración real con PGlite, verificando idempotencia, RLS, ownership, restricciones de escritura y ausencia de modificación del snapshot Backyard.

Los tests con fixtures verifican el comportamiento; no sustituyen la consulta real ni un relogin limpio de el_mongas. Esos pasos siguen sujetos al acceso manual pendiente.

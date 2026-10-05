# Carrera — cierre controlado de DEV (2026-10-05)

## Identificación y autorización

Autorización explícita del usuario: aplicar secuencialmente las dos migraciones sólo si son aditivas, sin pérdidas de datos, sin relajación de RLS ni acceso público, y exclusivamente en DEV.
Rama Git `integration/backyard-current`; SHA al comenzar `26f2cddb81a7a219c7cbd990b3064b1721d99dfb`.
Alias canónico `https://dev.thebackyard.com.mx`; deployment Preview READY `dpl_D9Lin4MJLGDvSj6qL2UMiVZmTuKZ` del mismo SHA.
DB destino exclusiva `bymeopxkxapfizeeqeyb`, API `https://bymeopxkxapfizeeqeyb.supabase.co`.
Management API identifica esa DB como branch `phase2-full-platform-qa`, id `a3dbcd66-bf2d-4f25-b0ea-92f0ebfa4c06`, `is_default=false`, ACTIVE_HEALTHY. La rama default del proyecto tiene otro ref; no se ejecuta SQL en ella.
`get_project` sobre el ref de branch devolvió NotFound; `list_branches`, URL, schema accesible y las guardas canónicas del repo resolvieron su identidad sin cambiar configuración.

Snapshot previo: `.qa-artifacts/career-closeout-schema-before.json`, con columnas, constraints, índices, triggers, ACL/RLS/policies, conteos y advisors. Eventos existentes: 329, hash MD5 de filas ordenadas `1bb3bfe712e479157c1ca654340daf19`. Torneos/participantes/scores/accesos: 0/0/0/0. No se extraen payloads privados al reporte.

## Auditoría 1 — Eventos de Carrera: PASS

Archivo exacto: `supabase/migrations/20261005110904_career_usage_events.sql`.

SQL íntegro revisado:

```sql
-- DEV only: additive event allowlist extension. Keeps all previously accepted events,
-- permissions, RLS, columns, indexes and existing rows. No product data migration.
set lock_timeout = '5s';
do $career$
declare previous_check text;
begin
  select pg_get_constraintdef(oid) into previous_check
  from pg_constraint where conrelid='public.product_usage_events_v2'::regclass
    and conname='product_usage_events_v2_event_name_check' and contype='c';
  if previous_check is null then raise exception 'Existing analytics event constraint is required'; end if;
  execute format('alter table public.product_usage_events_v2 add constraint product_usage_events_v2_career_check check (%s OR event_name = ANY (ARRAY[''career_opened'',''career_tab_viewed'',''achievement_opened'',''rivalry_opened'',''round_opened'',''tournament_opened'']::text[])) not valid',substring(previous_check from 7));
  alter table public.product_usage_events_v2 validate constraint product_usage_events_v2_career_check;
  alter table public.product_usage_events_v2 drop constraint product_usage_events_v2_event_name_check;
  alter table public.product_usage_events_v2 rename constraint product_usage_events_v2_career_check to product_usage_events_v2_event_name_check;
end $career$;
```

Único objeto modificado: CHECK `public.product_usage_events_v2.product_usage_events_v2_event_name_check`.
Se crea temporalmente `product_usage_events_v2_career_check`, se valida con las filas existentes, se sustituye atómicamente el CHECK anterior conservando su expresión mediante OR y se conserva el nombre original.
El DROP de constraint es una sustitución validada dentro del DO transaccional: no elimina tablas, columnas, datos ni otras restricciones.
No hay tablas/columnas/tipos/índices nuevos o eliminados; cero UPDATE, DELETE, INSERT, TRUNCATE, backfill, funciones persistentes, triggers, grants o policies nuevos.
Se preservan PK, FK, checks de ID/metadata, los tres índices y el trigger `account_scrub_deleted_snapshot`.
RLS actual: activado; `account_active_access` restrictiva y `usage events self insert` exige `owner_id=auth.uid()`. authenticated tiene sólo INSERT; no SELECT ni policy de lectura global.
Compatibilidad: tabla y CHECK originales existen y están validados; nombre temporal ausente; event_name es text. Se mantiene la allowlist anterior completa.
Idempotencia: reaplicar el SQL completo añade otro OR equivalente, sin perder nombres admitidos. No es reparación de un objeto temporal ajeno: si existe el nombre temporal o falta el CHECK base, aborta atómicamente. El historial impide aplicar la migración dos veces durante este cierre.
Impacto previsto: seis eventos nuevos admisibles; posibles bloqueos breves de DDL acotados por lock_timeout=5s. No pérdida ni reescritura de datos.
Payload Carrera emitido por código: sólo `surface=career` y `feature` del componente; no IDs de rivales, dinero, scores ni nombres. API autentica cuenta/lifecycle, fija owner_id, valida nombre/ID y reutiliza sanitizer de claves escalares acotadas. No tracking paralelo.
El schema histórico sólo exige metadata como objeto; esta migración no amplía permisos de escritura ni permite leer analytics. El control de metadata de la API se mantiene, sin certificar que un cliente malicioso no pueda escribir JSON propio por una capability preexistente.
Rollback razonable: restaurar el CHECK original capturado en una transacción usando ADD ... NOT VALID, DROP del CHECK ampliado y RENAME; validar únicamente si no hay filas con los seis eventos nuevos. Si ya existen, conservarlas y detener validación en vez de borrarlas. No se ejecuta rollback ni se destruyen eventos válidos.
Prueba local PGlite verifica filas previas, RLS/policies, evento anterior/nuevo y rechazo de evento inválido.

CHECK original para rollback:
```sql
CHECK ((event_name = ANY (ARRAY['signup_completed'::text, 'round_created'::text, 'round_completed'::text, 'group_created'::text, 'friend_added'::text, 'ai_round_setup'::text, 'card_ai_used'::text, 'game_used'::text, 'gps_used'::text, 'shot_recorded'::text, 'ball_fit_completed'::text, 'course_selected'::text, 'round_invite_sent'::text, 'round_invite_accepted'::text, 'membership_benefits_viewed'::text, 'ai_insight_viewed'::text, 'stats_deleted'::text, 'account_delete_requested'::text])))
```

## Auditoría 2 — Lectura de Torneos: PASS

Archivo exacto: `supabase/migrations/20261005114931_career_tournament_server_read.sql`.

SQL íntegro revisado:

```sql
-- Controlled DEV application only. Read-only columns for Carrera's authenticated server projection.
-- Polla release flag, data, policies, RLS and browser roles remain unchanged.
-- No access to PIN hashes, entry tokens or write columns.
begin;
set local lock_timeout = '5s';
grant select (id, tournament_id, profile_id, name, handicap, created_at)
  on public.tournament_players to service_role;
grant select (id, public_id, short_code, name, tournament_date, course_name, holes,
  start_hole, format, status, course_snapshot, hcp_pct, handicap_mode, public_leaderboard, created_by)
  on public.tournaments to service_role;
grant select (tournament_id, user_id, expires_at, revoked_at)
  on public.tournament_access to service_role;
grant select (tournament_id, player_id, hole, score)
  on public.tournament_scores to service_role;
commit;
-- Operator rollback: REVOKE SELECT for these same columns FROM service_role.
```

Sólo añade SELECT de columnas existentes para service_role en cuatro tablas; no SELECT de tabla universal.
- tournament_players: id, tournament_id, profile_id atribuyen participación; created_at ordena/pagina; name/handicap alimentan el motor deportivo existente.
- tournaments: metadatos/campo/formato y geometría/HCP necesarios para resultado; created_by/public_leaderboard validan acceso; public_id/short_code son identificadores de navegación.
- tournament_access: tournament_id/user_id/expires_at/revoked_at validan acceso vigente.
- tournament_scores: tournament_id/player_id/hole/score calculan resultado y posición completa.
No concede PIN hashes, token_hash, columnas de auditoría o escrituras nuevas. service_role tiene BYPASSRLS preexistente: la API es la frontera de autorización y sólo proyecta el resultado propio, nunca identidades o tarjetas de otros participantes.
No modifica tablas/columnas/tipos/constraints/índices/funciones/triggers; no INSERT/UPDATE/DELETE/TRUNCATE/backfill. Conserva 13 policies de las cinco tablas auditadas y todos los flags RLS.
No añade grants a PUBLIC/anon/authenticated. Las capacidades históricas distintas de SELECT se capturan y no se modifican fuera de alcance.
Compatibilidad: las 29 columnas especificadas existen y no tenían SELECT concedido a roles cliente o service_role. Constraints e índices actuales permanecen; profile_id referencia profiles y usa UUID del usuario autenticado.
Idempotencia: GRANT repetido conserva la misma capacidad; BEGIN/COMMIT y lock_timeout=5s limitan aplicación.
Rollback: REVOKE SELECT de exactamente las columnas concedidas a service_role, manteniendo otros permisos previos; ningún dato se modifica.
API: getUser valida bearer, rechaza anónimo y lifecycle inválido antes de crear admin; service key sólo en módulo server-only, sin NEXT_PUBLIC. Ignora userId solicitado y deriva perfil de la sesión. Primero own profile_id, luego owner/publicación/acceso vigente, revalida atribución exacta. Diez participaciones/página, lotes acotados, truncamiento detectado; respuesta private/no-store/Vary Authorization, sin raw opponents/PIN. Caché cliente por cuenta 60s, borra al perder Auth y cancela al desmontar.
Pruebas PGlite de grants/RLS y pruebas de API/proyección: ejecutadas antes y después, con denegación de sesión vencida, acceso revocado, perfil ajeno y truncamiento.

## Condiciones de aplicación

PASS: aditivas; sin eliminar tablas/columnas ni DROP destructivo; sin truncar, sobrescribir, alterar tipos o actualizar datos; RLS conservada; sin acceso público nuevo; lectura servidor limitada; payload funcional mínimo; DB branch no default identificada y diferente del ref protegido; ejecución sólo en DEV.
Aplicación prevista: migración 1 -> verificación schema/RLS/datos -> tests -> migración 2 -> verificación schema/RLS/grants/datos -> tests -> smoke/runtime. Nunca aplicar ambas juntas.

Referencias de permisos consultadas: [Supabase Data API](https://supabase.com/docs/guides/api/securing-your-api) y [PostgreSQL GRANT](https://www.postgresql.org/docs/current/sql-grant.html).

## Aplicación controlada y comprobaciones posteriores

Migración 1 aplicada exclusivamente en DEV: PASS. Historial remoto `20261005131629 / career_usage_events` (el MCP asigna timestamp de aplicación; archivo original arriba conservado). Verificación antes de aplicar la segunda:
- CHECK ampliado validado; seis eventos nuevos y eventos anteriores admisibles; evento desconocido rechazado por evaluación del CHECK real, sin insertar datos de prueba.
- 329 filas previas y hash `1bb3bfe712e479157c1ca654340daf19` idénticos antes/después.
- Columnas, tabla ACL, policies/RLS, índices, triggers y roles iguales al snapshot previo.
- Tests analytics 2/2 PASS.

Migración 2 aplicada después de esa verificación: PASS. Historial remoto `20261005131727 / career_tournament_server_read`.
- Exactamente 29 SELECT de columna añadidos a service_role; cero SELECT añadidos para anon/authenticated/PUBLIC, sin SELECT universal de tabla.
- PIN/token_hash siguen denegados incluso para service_role.
- Tabla ACL, columnas, constraints, índices, triggers, policies/RLS y roles iguales al estado tras migración 1.
- 0 torneos / 0 participantes / 0 scores / 0 accesos antes/después.
- Tests Torneos/permisos 8/8 PASS; sin escritura de torneos ficticios.

SQL de roles ejecutado dentro de BEGIN/ROLLBACK, sin insertar ni modificar datos. SELECT directo de analytics y las cuatro tablas de torneos denegado a authenticated y anon; SELECT de las columnas mínimas funciona para service_role, secretos denegados. La primera sonda de rondas sin session_id fue negada por la guarda de reactivación; no se usa ese vacío como prueba de atribución. Se repitió con una sesión existente activa de la cuenta QA: account_data_access_allowed=true, una ronda propia visible, cero de otros usuarios y cero privadas ajenas.
El test de API existente se amplió legítimamente: una sesión válida con query userId/profile_id de otro perfil usa únicamente authenticatedRequest.userId, conserva private/no-store/Vary Authorization y rechaza offset inválido antes de llamar a admin. No se cambia el código de producto.
Compilación cliente local: búsqueda sin referencias a SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY/readCareerTournaments/career-tournaments.server en .next/static; server-only y la guarda de autenticación se conservan.
Advisors antes/después: mismas cuatro categorías y conteos (13 INFO sin policy, 7/34 avisos de funciones definidoras y 1 de protección de contraseñas); cero nuevos. No se modifica seguridad ajena a Carrera.

## QA interactiva con datos disponibles

Cuenta existente `@saidabaidfinalcloseoutqa`, autenticación real del dominio canónico. Analytics persistido confirma owner correspondiente y sólo surface/feature en eventos navegados; no wallet, dinero, nombres, tarjetas ni rivales en metadata emitida.
Torneos: GET /api/career/tournaments pasó de 503 previo a 200 tras grants. Estado vacío real, filtro de modalidad, recarga directa y ranking sin fuente simulada: PASS. No hay torneos/participantes/scores en DEV.
Perfil/nombre/username verificados, índice sin datos y GHIN sin asociación: estados honestos. Logros: detalle Birdie Club, filtros, bloqueados y Salón de la Fama vacío verificados. Rivalidades: vacío real y privacidad por tests; no se inventan enfrentamientos.
Se localizaron 146 rondas persistidas en DEV; una propia de la cuenta QA, nueve hoyos, completada el 3 de octubre, score bruto 36. No se recreó ni se alteró. La sesión de Chrome indica `Nube sin vincular`, por lo que su histórico local no la carga; no se presenta esta diferencia como ausencia de datos en DB.
Confirmar `Vincular a mi cuenta` fue rechazado por revisión automática: puede subir datos locales y trasladar consentimientos anteriores, y la autorización de migraciones no cubría esa transferencia/cambio persistente. No se ejecutó ni se sustituyó por un bypass. Se solicitó autorización específica al usuario. Mientras no llegue, abrir la ronda real y validar progreso/estadísticas pobladas en UI quedan PENDING_INTERACTIVE_QA.
Back/Forward Rondas/Torneos y recarga directa después de migraciones: PASS.
Veinte combinaciones reales de DEV (cinco vistas cargadas × 320/375/390/430 px): sin overflow de página, pestaña seleccionada visible y altura 44px. Overrides temporales se restauran al finalizar.
Safari/PWA/iPhone físico: PENDING_DEVICE_QA, sin declarar equivalencia con Chrome.
Evidencia: `.qa-artifacts/career-closeout-schema-before.json`, `career-closeout-schema-after.json`, `career-closeout-privacy-runtime.json`, `career-closeout-viewport-checks.json`, `career-closeout-torneos.jpg`, `career-closeout-link-review.jpg`.

## Tests y cierre de código

Suite completa fresca tras añadir la aserción de atribución: 4,320 total, 4,315 PASS, cinco FAIL preexistentes, cero nuevos/cancelados/skipped. Los cinco nombres/errores son los mismos del baseline; ninguno se modifica.
Carrera 51/51 PASS; analytics 2/2; Torneos/permisos 8/8; scripts adicionales 117/117.
Typegen + typecheck PASS; lint PASS sin errores/advertencias (caché de campos excluida); build PASS.
No desarrollo visual ni cambios de producto en este cierre. Sólo auditoría/evidencia y ampliación de test de privacidad.
Rama de campos en SHA `6f4f06180d4b0572b298dc705fbcf9c568be70d7` preservada, cero commits incorporados. Main/beta/Production y sus bases de datos no modificadas.
El SHA de documentación/test y su deployment Preview se confirman tras push exclusivo a integration/backyard-current. No se cambian aliases o configuración productiva.

## Pendientes actuales

- PENDING_INTERACTIVE_QA: vinculación expresamente aprobada de la cuenta QA o una sesión DEV ya vinculada, para abrir la ronda real y comprobar progreso/estadística poblada. No hay enfrentamientos ni torneos suficientes para certificar esos recorridos poblados.
- PENDING_DEVICE_QA: Safari/PWA en iPhone físico.
- FAIL: cinco fallos preexistentes de Bolsa/Reglas/artefacto de catálogo; cero nuevos.
Las dos migraciones dejaron de estar pendientes: aplicadas/verificadas sólo en DEV.


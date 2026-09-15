# Activación controlada de Preview — cuentas, Stats y Social

## CONTROLLED_DB_ACTION_REQUIRED

**Única acción del owner necesaria ahora:** responder «Confirmo usar la organización Supabase `wrogzsycxchwakaglbpm` (saidabaid-cyber's Org) para consultar el costo de una rama Preview aislada». Esto autoriza consultar la cotización, **no aceptar un importe desconocido**. Codex debe mostrar el importe real y obtener aprobación del costo antes de crear la rama. La autorización de push ya existe y no debe solicitarse otra vez.

Estado auditado el 2026-09-15: sólo es visible el proyecto compartido Supabase **The Backyard**, ref `zhqmlpljloumldaczcfp`; la lista de branches está vacía. No se aplicó SQL remoto. No usar ese proyecto para reset, eliminación de cuentas ni fixtures. Las pruebas PostgreSQL locales no acreditan QA en Supabase Preview.

Destino Vercel existente: proyecto `golf-bets`, ID `prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn`, equipo `team_8pj0WyTTVhVSw78CAZ0qNLEO`. La CLI está instalada pero no autenticada; el intento anterior de acceso por dispositivo expiró. Si el conector Vercel no permite configurar/desplegar, se debe renovar `vercel login` con el owner, no crear tokens ni reutilizar códigos expirados.

Todo lo siguiente queda limitado a Git `phase2/full-platform`, **Vercel Preview de esa rama** y la **nueva ref Supabase**. No modificar main, beta, Production, dominios personalizados ni DB compartida. HOME HERO: NO TOUCH.

### 1. Crear una rama vacía, con identidad verificable

Después de confirmar organización y cotización:

1. En el conector Supabase: `get_cost(organization_id="wrogzsycxchwakaglbpm", type="branch")`; mostrar la cotización y sus condiciones al owner. No inventar importe ni asumir que es gratis.
2. Tras aprobación del importe: `confirm_cost` con importe, recurrencia y tipo devueltos; usar su `confirmation_id` en `create_branch(project_id="zhqmlpljloumldaczcfp", name="phase2-full-platform-qa", confirm_cost_id=...)`.
3. Alternativa equivalente en Dashboard Supabase: The Backyard → Branches → crear rama de desarrollo/Preview **sin Include data**. No copiar datos/Auth/Storage de producción. La creación copia esquema/migraciones, no debe importar usuarios o rondas.
4. Registrar el `project_ref` nuevo. Debe ser distinto de `zhqmlpljloumldaczcfp`; URL exactamente `https://<PREVIEW_REF>.supabase.co`. Confirmar que `list_branches` identifica esa ref como la nueva rama y que está lista.
5. Obtener claves **de esa rama**, no del proyecto padre. Mantener las claves secretas únicamente en servidor y gestor de secretos. No pegarlas en chats, commits, argumentos de comandos ni documentación.

**Riesgos controlados:** cómputo/storage facturables según cotización; una credencial equivocada podría afectar datos compartidos. Toda escritura debe abortar si ref/host no coinciden. `current_database() = postgres` por sí solo **no** demuestra aislamiento.

### 2. Verificar ledger y aplicar exactamente lo que falte

Primero llamar `list_migrations(project_id="<PREVIEW_REF>")`. El ledger antiguo del proyecto padre tiene timestamps distintos a varios archivos históricos locales. **No ejecutar `db push --include-all`, no reparar el ledger a ciegas y no reaplicar las migraciones fundacionales ya heredadas.** La integración Git podría aplicar archivos automáticamente: comparar nombre, definición y dependencias, no sólo timestamp.

Esta es la secuencia aditiva esperada de **13 archivos**. Aplicar cada uno sólo si falta, siempre en la ref nueva:

1. `supabase/migrations/20260906193435_equipment_ball_fitting.sql`
2. `supabase/migrations/20260906211937_golf_profile_course_architecture.sql`
3. `supabase/migrations/20260908134650_ai_processing_consents.sql`
4. `supabase/migrations/202609100001_phase2_social_groups_memberships.sql`
5. `supabase/migrations/202609100002_phase2_course_handicap_gps.sql`
6. `supabase/migrations/202609100003_phase2_live_rounds_notifications.sql`
7. `supabase/migrations/202609100004_phase2_shots_analytics.sql`
8. `supabase/migrations/20260913175810_group_round_presets.sql`
9. `supabase/migrations/20260913205122_user_statistics_reset.sql`
10. `supabase/migrations/20260915114707_user_statistics_reset_idempotency.sql`
11. `supabase/migrations/20260915183026_social_activity_v3.sql`
12. `supabase/migrations/20260915203125_account_lifecycle_preview.sql`
13. `supabase/migrations/20260915203550_social_service_privileges.sql`

Acción exacta mediante conector, por archivo: leer el SQL completo del archivo local; ejecutar `apply_migration` con `project_id` igual a la **ref nueva**, `name` igual al nombre descriptivo del archivo sin timestamp/extensión y `query` igual al contenido literal completo. Por ejemplo, el paso 10 usa `name="user_statistics_reset_idempotency"`. Volver a listar el ledger tras cada aplicación y registrar su versión efectiva. No concatenar los 13 archivos en una transacción opaca ni continuar después de un fallo.

Antes del paso 12, consultar en la rama:

```sql
select rolname, rolconfig
from pg_roles where rolname = 'authenticator';

select version, name
from supabase_migrations.schema_migrations order by version;
```

Si ya existe otro `pgrst.db_pre_request`, **no sobrescribirlo**: la migración falla con `existing_pre_request_hook_requires_controlled_composition`. Componer ambos controles mediante una nueva migración revisada en Preview; volver a probar el hook anterior y `account_api_access_guard`. Si el proveedor no permite `ALTER ROLE authenticator`, requiere la acción equivalente del administrador de esa rama, nunca aplicar en el padre.

El paso 12 instala una barrera de cuenta activa en Data API y RLS/Storage; no borra cuentas al aplicarse. La eliminación sólo empieza tras una solicitud autenticada y confirmada. No quitar esa barrera para conseguir un test verde. No exponer el esquema `private` en Data API.

### 3. Verificación del esquema antes de habilitar acciones

Consultas de inspección **en la ref nueva**:

```sql
select n.nspname as schema, c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and c.relname in (
  'user_statistics_resets','user_statistics_reset_requests',
  'social_activities_v3','social_likes_v3','social_comments_v3',
  'social_round_attestations_v3','account_lifecycle_state','account_lifecycle_jobs'
) order by n.nspname, c.relname;

select n.nspname, p.proname, p.prosecdef, p.proconfig,
       pg_get_userbyid(p.proowner) as function_owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('reset_my_statistics','account_access_status',
  'account_api_access_guard','account_lifecycle_acquire',
  'account_lifecycle_prepare','account_lifecycle_complete');

select
  has_function_privilege('authenticated','public.reset_my_statistics(text,uuid)','EXECUTE') as reset_allowed,
  has_function_privilege('anon','public.reset_my_statistics(text,uuid)','EXECUTE') as anonymous_reset_must_be_false,
  has_function_privilege('authenticated','public.reset_my_statistics(text)','EXECUTE') as legacy_reset_must_be_false,
  has_function_privilege('authenticated','public.account_lifecycle_prepare(uuid,uuid)','EXECUTE') as client_graph_must_be_false,
  has_function_privilege('service_role','public.account_lifecycle_prepare(uuid,uuid)','EXECUTE') as server_graph_allowed;

select schemaname, tablename, policyname, permissive, roles
from pg_policies
where policyname = 'account_active_access'
   or tablename in ('user_statistics_resets','user_statistics_reset_requests')
order by schemaname, tablename, policyname;
```

Comprobar también constraints/índices de likes únicos, comentarios de autor y attest por versión. Ejecutar `get_advisors` de seguridad y rendimiento en la ref nueva. Revisar cualquier hallazgo antes de activar. En proyectos nuevos, la [exposición Data API necesita grants explícitos además de RLS](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically); el paso 13 completa los permisos server-side del reconciliador Social. Comprobar REST real con clientes `anon`, `authenticated` y servidor: ver tablas en Dashboard no acredita acceso correcto.

### 4. Conectar sólo Vercel Preview de la rama

Desde la raíz de `Golf-Bets`, verificar primero:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
Get-Content .vercel/project.json
```

Branch debe ser `phase2/full-platform`; `.vercel/project.json` debe contener los IDs Vercel indicados arriba. No relink automático a otro proyecto.

En esta máquina la CLI comprobada es Vercel 59.16.0. Si no existe el comando global `vercel`, utilizar su instalación auxiliar existente:

```powershell
$taskNode = 'C:\Users\said_\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$env:Path = (Split-Path $taskNode) + ';' + $env:Path
function vc { & $taskNode '../qa-vercel-tool/node_modules/vercel/dist/vc.js' @args }
vc login
vc whoami
vc env add --help
vc deploy --help
```

Completar la autenticación normal en el navegador; no aceptar un código expirado. Con CLI global, sustituir `vc` por `vercel`.

Añadir las variables con el prompt seguro, **sin valores secretos en línea de comandos**:

```powershell
vc env add PREVIEW_DB_REF preview --git-branch phase2/full-platform --project prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vc env add NEXT_PUBLIC_SUPABASE_URL preview --git-branch phase2/full-platform --project prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vc env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY preview --git-branch phase2/full-platform --project prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vc env add SUPABASE_SECRET_KEY preview --git-branch phase2/full-platform --sensitive --project prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vc env add CLOUD_ENABLED preview --git-branch phase2/full-platform --project prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vc env add EQUIPMENT_CLOUD_ENABLED preview --git-branch phase2/full-platform --project prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vc env add ACCOUNT_LIFECYCLE_ENABLED preview --git-branch phase2/full-platform --project prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vc env add SOCIAL_ACTIVITY_ENABLED preview --git-branch phase2/full-platform --project prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
```

Valores: `PREVIEW_DB_REF=<ref nueva>`; URL `https://<ref nueva>.supabase.co`; claves publicable/secreta de esa misma rama; los cuatro flags `true`. Si existe `SOCIAL_PREVIEW_DB_REF`, actualizar su override de esta rama al mismo ref o retirar sólo ese override redundante. Nunca dejar una ref distinta.

Si una variable ya existe, revisar su target/branch antes de usar `env add ... --force` sobre **ese mismo override Preview**. No quitar/editar variables de Production. Auditar aliases legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`: ningún valor efectivo debe seleccionar el proyecto compartido; el código prioriza los nombres publicable/secreto anteriores. No marcar secretos como `NEXT_PUBLIC_`. `VERCEL_ENV=preview` lo proporciona Vercel; no falsearlo para saltar guards.

### 5. Push y nuevo deployment

Después de tests/lint/build y revisión de diff de Home:

```powershell
git push origin HEAD:refs/heads/phase2/full-platform
vc deploy --target preview --project prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
```

Si el push ya generó Preview Git, inspeccionar ese deployment en vez de crear otro. No usar `--prod`, `promote`, `--temporary`, force push ni dominios personalizados. Verificar que el deployment detectó `phase2/full-platform` y sus variables de branch; esperar `READY`, anotar su SHA y la URL **inmutable exacta** `https://golf-bets-<id>-<scope>.vercel.app`. Un URL anterior o un alias móvil no es evidencia del commit nuevo.

### 6. QA real ejecutable, con cuentas desechables

Los runners no cargan automáticamente `.env.local`. Inyectar en la sesión/gestor de secretos las variables Preview anteriores y estas variables de operador:

```powershell
$env:PREVIEW_QA_URL = 'https://golf-bets-<ID_DE_DEPLOYMENT>-<SCOPE>.vercel.app'
$env:PREVIEW_DB_REF = '<REF_PREVIEW_NUEVA>'
$env:QA_CONFIRM_ISOLATED_PREVIEW = $env:PREVIEW_DB_REF
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node scripts/qa-preview-statistics.mjs --check-config
node scripts/qa-preview-account-lifecycle.mjs --check-config
node scripts/qa-preview-statistics.mjs --run
node scripts/qa-preview-account-lifecycle.mjs --run
```

Reemplazar placeholders por valores verificados, no inventados. Requieren también `NEXT_PUBLIC_SUPABASE_URL`, clave publicable/anon y clave secreta/service-role de Preview en esa sesión. No copiar las variables productivas del host. Si deployment protection lo exige, proporcionar `VERCEL_AUTOMATION_BYPASS_SECRET` por gestor de secretos; sólo se envía al origen Preview exacto. No desactivar protección.

Ambos runners rechazan la DB compartida, URLs ambiguas, aliases de branch/Production, keys JWT de otro proyecto y redirecciones con credenciales. Inspeccionan el bundle público para comprobar su URL Supabase antes de crear usuarios. Sólo crean identidades aleatorias `@example.invalid`; no aceptan IDs de usuarios existentes.

- **Stats:** crea dos usuarios; reset con cero stats e idempotencia; ronda capturada → reset → lectura del ledger en la misma DB; nueva sesión sin caché; histórico/balance intactos; ronda anterior excluida y ronda posterior incluida mediante la lógica real compilada. Limpia sólo cuentas creadas por ese run mediante el endpoint de cuentas. Si falla limpieza, reporta IDs exactos; no ampliar el borrado.
- **Cuentas:** crea tres usuarios; borrar cuenta vacía, borrar organizador de ronda compartida preservando el acceso/datos del compañero, retry con prueba de recuperación, bloqueo Auth/JWT y archive. Conserva **intencionalmente un fixture archivado** con dos rondas para comprobar retención futura; reporta `archivedQaFixtures` con IDs exactos. No borrar ese archivo por Admin para ocultar el resultado.
- **Límites:** los runners no acreditan QA visual, uploads Storage, ownership de grupos ni Social API completo. Probar likes/unlike, comentario propio/ajeno, participante/self/no participante/duplicado de attest y cambio material de score contra la nueva DB con identidades QA. Like/comentario/avatar no deben invalidar attest; cambios materiales sí. Respetar privacidad y comprobar notificaciones reales. No etiquetar Social PASS por la existencia de tablas.

Completar QA móvil real a 390×844, 393×852 y 430×932: modal reset cierra, confirmación visible, Perfil/Stats reloaded, Mi Bolsa de página completa y acciones Social accesibles. Conservar capturas completas y resultados de los runners vinculados al deployment/ref/SHA. `LEGAL_REVIEW_REQUIRED` sigue aplicando a retención/copy definitivo; **no bloquea** la prueba técnica de cuentas sintéticas.

### 7. Qué constituye cierre

PASS exige DB aislada identificada, migraciones aplicadas/verificadas, Preview `READY` del SHA final y pruebas reales exitosas. Un mensaje de migración, respuesta ambigua, Auth todavía activo tras delete, marcador sólo local, o likes/comments/attest sin persistencia es FAIL, no un cierre documental. Si falta autorización/costo/login, registrar el punto exacto y mantener los guards activos mientras se completa el código/pruebas no dependientes de DB.

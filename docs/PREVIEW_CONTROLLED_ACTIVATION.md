# Activación controlada de Preview — cuentas, Stats y Social

> **Contrato canónico desde 2026-09-24:** la única rama operativa es `integration/backyard-current` y la única URL de QA es `https://dev.thebackyard.com.mx`. Las ramas, deployments `*.vercel.app`, costes y resultados fechados que aparecen en el antecedente del 16 de septiembre son evidencia histórica; no son destinos vigentes ni instrucciones para owner QA. Production permanece fuera de alcance.

## Estado actual verificado — no recrear ni aplicar a ciegas

La rama Supabase aislada ya existe: `phase2-full-platform-qa`, ref `bymeopxkxapfizeeqeyb`, estado `ACTIVE_HEALTHY`, `with_data=false`. Es distinta del proyecto padre/Production `zhqmlpljloumldaczcfp`. No crear una segunda rama ni repetir la cotización histórica.

El ledger remoto no coincide linealmente con los **51** archivos canónicos: QA registra **58** migraciones. La reconciliación por SQL/objetos quedó completada el 24 de septiembre. Cuatro migraciones revisadas se aplicaron sólo a QA: GHIN `20260924233419`, guard lifecycle Feedback `20260925010316`, ingest legal transaccional `20260925012322` y hardening Realtime Polla `20260925012920`. La ejecución remota final de RLS pasó **17/17** con rollback y 0 fixtures fijos del runner; preservó las 13 solicitudes Feedback QA/internas ya existentes. No queda un apply canónico pendiente para la QA actual. Production no fue consultado, reparado ni escrito.

Los asesores de seguridad aún requieren revisión controlada: reportaron 17 `WARN` y 6 `INFO` (tablas fail-closed sin políticas, permisos de ejecución de funciones `SECURITY DEFINER` y protección contra contraseñas filtradas). Por tanto:

1. No usar `db push`, `--include-all`, `migration repair`, `db pull` ciego ni SQL Editor por lista histórica.
2. No aplicar una “secuencia de 15” antigua: quedó superada por el ledger real.
3. Usar [el ledger canónico](./CANONICAL_MIGRATION_LEDGER_2026-09-24.md) como evidencia de la reconciliación completada; una versión remota distinta no implica ausencia si el SQL/objeto equivalente está demostrado.
4. Ante una migración futura, preparar un plan de apply explícito sólo para objetos realmente ausentes en `bymeopxkxapfizeeqeyb`, con dependencia, checksum y rollback revisados.
5. Volver a ejecutar los tests RLS transaccionales y readbacks después de cualquier cambio; GHIN debe continuar apagado.
6. No consultar, reparar ni escribir Production como parte de esta activación.

Supabase Auth de QA ya usa `https://dev.thebackyard.com.mx` como Site URL y permite únicamente su callback más localhost. Esto no acredita todavía Google/OTP end-to-end y no autoriza modificar Auth de Production.

Destino Vercel: proyecto `golf-bets`, ID `prj_Hin0ieF71l1aSyaOcOPCmu7NzNjn`, equipo `team_8pj0WyTTVhVSw78CAZ0qNLEO`. Toda acción queda limitada a `integration/backyard-current`, el branch domain objetivo `https://dev.thebackyard.com.mx` y la ref QA anterior. No modificar main, beta, `app.thebackyard.com.mx`, DNS de Production ni datos reales.

### 3. Verificación del esquema antes de habilitar acciones

Consultas de inspección **en la ref QA canónica existente `bymeopxkxapfizeeqeyb`**:

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

Comprobar también constraints/índices de likes únicos, comentarios de autor y attest por versión. Ejecutar `get_advisors` de seguridad y rendimiento en la ref QA canónica existente. Revisar cualquier hallazgo antes de activar. En proyectos nuevos, la [exposición Data API necesita grants explícitos además de RLS](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically); el paso 13 completa los permisos server-side del reconciliador Social. Comprobar REST real con clientes `anon`, `authenticated` y servidor: ver tablas en Dashboard no acredita acceso correcto.

### 4. Conectar sólo Vercel Preview de la rama

Desde la raíz de `Golf-Bets`, verificar primero:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
Get-Content .vercel/project.json
```

Branch debe ser `integration/backyard-current`; `.vercel/project.json` debe contener los IDs Vercel indicados arriba. No relink automático a otro proyecto.

Si `.vercel/project.json` no existe en el worktree, la vía CLI queda bloqueada hasta contar con un vínculo explícito y revisado; no ejecutar `vercel link` implícitamente. Usar Project Settings en la sesión ya autenticada o proporcionar los identificadores explícitos sólo a un comando que lo admita, sin cambiar el proyecto vinculado.

El flujo principal es la Git Integration del proyecto: configurar primero los overrides de Preview restringidos a `integration/backyard-current` y después hacer push de esa rama. No usar una instalación auxiliar, una ruta temporal de otra tarea ni relinkear el proyecto para suplir una CLI ausente.

La configuración puede hacerse en **Project Settings → Environment Variables**, seleccionando `Preview` y la rama `integration/backyard-current`. Si hay una Vercel CLI instalada y autenticada, comprobar su ayuda antes de operar:

```powershell
vercel login
vercel whoami
vercel env add --help
vercel env ls preview integration/backyard-current --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
```

Completar la autenticación normal en el navegador; no aceptar un código expirado. La sintaxis vigente de `env add` recibe la rama como tercer argumento posicional: `vercel env add <nombre> preview integration/backyard-current`. Los valores se introducen en el prompt seguro; no se incluyen en la línea de comandos ni en historial.

Añadir los overrides de rama necesarios, **sin valores secretos en línea de comandos**:

```powershell
vercel env add PREVIEW_DB_REF preview integration/backyard-current --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vercel env add NEXT_PUBLIC_SUPABASE_URL preview integration/backyard-current --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY preview integration/backyard-current --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vercel env add SUPABASE_SECRET_KEY preview integration/backyard-current --sensitive --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vercel env add NEXT_PUBLIC_APP_ORIGIN preview integration/backyard-current --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vercel env add GROUP_INVITES_APP_URL preview integration/backyard-current --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vercel env add CLOUD_ENABLED preview integration/backyard-current --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vercel env add EQUIPMENT_CLOUD_ENABLED preview integration/backyard-current --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vercel env add ACCOUNT_LIFECYCLE_ENABLED preview integration/backyard-current --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
vercel env add SOCIAL_ACTIVITY_ENABLED preview integration/backyard-current --scope team_8pj0WyTTVhVSw78CAZ0qNLEO
```

Valores: `PREVIEW_DB_REF=bymeopxkxapfizeeqeyb`; URL `https://bymeopxkxapfizeeqeyb.supabase.co`; claves publicable/secreta de esa misma rama; `NEXT_PUBLIC_APP_ORIGIN=https://dev.thebackyard.com.mx`; `GROUP_INVITES_APP_URL=https://dev.thebackyard.com.mx`; los cuatro flags `true`. Si existe `SOCIAL_PREVIEW_DB_REF`, actualizar su override de esta rama al mismo ref o retirar sólo ese override redundante. Nunca dejar una ref distinta.

Si una variable ya existe, revisar su target/branch antes de usar `env add ... --force` sobre **ese mismo override Preview**. No quitar/editar variables de Production. Auditar aliases legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`: ningún valor efectivo debe seleccionar el proyecto compartido; el código prioriza los nombres publicable/secreto anteriores. No marcar secretos como `NEXT_PUBLIC_`. `VERCEL_ENV=preview` lo proporciona Vercel; no falsearlo para saltar guards.

### 5. Push y nuevo deployment

Después de tests/lint/build y revisión de diff de Home, hacer push normal de la rama canónica:

```powershell
git push origin HEAD:refs/heads/integration/backyard-current
```

La Git Integration debe crear el Preview de ese push. Inspeccionar el deployment resultante en Vercel; no crear un deployment CLI paralelo, no usar `--prod`, `promote`, `--temporary`, force push ni tocar dominios de Production. Verificar que detectó `integration/backyard-current`, que el branch domain fijo está asignado a `https://dev.thebackyard.com.mx` y que `/api/health` devuelve el SHA completo exacto esperado. Hasta comprobar esas tres condiciones, registrar `BLOCKED_EXTERNAL` o `PENDING_INTERACTIVE_QA`: este procedimiento **no afirma que el deployment o el dominio ya existan**. Las URLs `*.vercel.app` pueden aparecer como metadata técnica, pero no son URL de QA ni sustituyen el binding SHA.

### 6. QA real ejecutable, con cuentas desechables

Los runners no cargan automáticamente `.env.local`. Inyectar en la sesión/gestor de secretos las variables Preview anteriores y estas variables de operador:

```powershell
$env:PREVIEW_QA_URL = 'https://dev.thebackyard.com.mx'
$env:PREVIEW_QA_EXPECTED_SHA = (git rev-parse HEAD).Trim()
$env:PREVIEW_DB_REF = 'bymeopxkxapfizeeqeyb'
$env:QA_CONFIRM_ISOLATED_PREVIEW = $env:PREVIEW_DB_REF
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node scripts/qa-preview-statistics.mjs --check-config
node scripts/qa-preview-account-lifecycle.mjs --check-config
node scripts/qa-preview-statistics.mjs --run
node scripts/qa-preview-account-lifecycle.mjs --run
```

Reemplazar placeholders por valores verificados, no inventados. Requieren también `NEXT_PUBLIC_SUPABASE_URL`, clave publicable/anon y clave secreta/service-role de Preview en esa sesión. No copiar las variables productivas del host. Si deployment protection lo exige, proporcionar `VERCEL_AUTOMATION_BYPASS_SECRET` por gestor de secretos; sólo se envía al origen Preview exacto. No desactivar protección.

Ambos runners rechazan la DB compartida, Production, Beta, cualquier URL `*.vercel.app`, keys JWT de otro proyecto y redirecciones con credenciales. Antes de crear usuarios validan `/api/health` contra `PREVIEW_QA_EXPECTED_SHA` y después inspeccionan el bundle público para comprobar su URL Supabase. Sólo crean identidades aleatorias `@example.invalid`; no aceptan IDs de usuarios existentes.

- **Stats:** crea dos usuarios; reset con cero stats e idempotencia; ronda capturada → reset → lectura del ledger en la misma DB; nueva sesión sin caché; histórico/balance intactos; ronda anterior excluida y ronda posterior incluida mediante la lógica real compilada. Limpia sólo cuentas creadas por ese run mediante el endpoint de cuentas. Si falla limpieza, reporta IDs exactos; no ampliar el borrado.
- **Cuentas:** crea tres usuarios; borrar cuenta vacía, borrar organizador de ronda compartida preservando el acceso/datos del compañero, retry con prueba de recuperación, bloqueo Auth/JWT y archive. Conserva **intencionalmente un fixture archivado** con dos rondas para comprobar retención futura; reporta `archivedQaFixtures` con IDs exactos. No borrar ese archivo por Admin para ocultar el resultado.
- **Límites:** los runners no acreditan QA visual, uploads Storage, ownership de grupos ni Social API completo. Probar likes/unlike, comentario propio/ajeno, participante/self/no participante/duplicado de attest y cambio material de score contra la nueva DB con identidades QA. Like/comentario/avatar no deben invalidar attest; cambios materiales sí. Respetar privacidad y comprobar notificaciones reales. No etiquetar Social PASS por la existencia de tablas.

Completar QA móvil real a 390×844, 393×852 y 430×932: modal reset cierra, confirmación visible, Perfil/Stats reloaded, Mi Bolsa de página completa y acciones Social accesibles. Conservar capturas completas y resultados de los runners vinculados al deployment/ref/SHA. `LEGAL_REVIEW_REQUIRED` sigue aplicando a retención/copy definitivo; **no bloquea** la prueba técnica de cuentas sintéticas.

### 7. Qué constituye cierre

PASS exige DB aislada identificada, migraciones aplicadas/verificadas, Preview `READY` del SHA final y pruebas reales exitosas. Un mensaje de migración, respuesta ambigua, Auth todavía activo tras delete, marcador sólo local, o likes/comments/attest sin persistencia es FAIL, no un cierre documental. Si falta autorización/costo/login, registrar el punto exacto y mantener los guards activos mientras se completa el código/pruebas no dependientes de DB.

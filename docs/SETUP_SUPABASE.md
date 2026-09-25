# Supabase: cuentas, nube y Polla Live

La aplicación conserva su modo Invitado/local cuando Supabase no está configurado o no responde. No pegues llaves en el código ni las subas a Git.

## 1. Crear y enlazar el proyecto

1. Crea o abre **el proyecto correcto de THE BACKYARD** en Supabase.
2. En **Project Settings → API** copia Project URL y la llave pública `anon`.
3. Copia la llave `service_role` únicamente al entorno del servidor. Tiene privilegios elevados y nunca debe llegar al navegador.
4. Crea `.env.local` desde `.env.example` y completa, sin comillas:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_ORIGIN=https://dev.thebackyard.com.mx
SUPABASE_SECRET_KEY=
CLOUD_ENABLED=true
POLLA_LIVE_ENABLED=false
AUTH_SOCIAL_ENABLED=true
```

En Vercel, las claves se configuran como variables de entorno; `SUPABASE_SECRET_KEY` debe permanecer server-side. Los nombres legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` sólo existen como compatibilidad y no deben duplicar bindings distintos. Reinicia el servidor local después de modificar `.env.local`.

## 2. Migraciones: reconciliación obligatoria

La rama QA canónica es `phase2-full-platform-qa` / `bymeopxkxapfizeeqeyb`; Production usa otra ref y permanece fuera de alcance. El repositorio contiene **51** migraciones, pero el ledger QA incluye **58** versiones históricas/remotas que no forman una secuencia uno-a-uno con esos archivos.

No ejecutar `supabase db push`, `--include-all`, `migration repair`, `db pull` ciego ni pegar una lista histórica completa en SQL Editor. La reconciliación canónica quedó cerrada por SQL y objetos; cuatro migraciones se aplicaron individualmente sólo a QA (GHIN, lifecycle Feedback, ingest legal y publicación Polla). La ejecución remota final pasó **17/17** tests RLS con rollback y 0 fixtures fijos del runner. Seguir exclusivamente [CANONICAL_MIGRATION_LEDGER_2026-09-24.md](./CANONICAL_MIGRATION_LEDGER_2026-09-24.md) ante cualquier cambio futuro.

### Protección del ledger AI en Preview

Vercel define `VERCEL_ENV=preview` automáticamente. En ese entorno, el ledger autenticado queda bloqueado antes de crear un cliente Supabase salvo que se configure, con alcance **Preview** restringido a la rama canónica, esta vinculación server-only:

```dotenv
PREVIEW_DB_REF=bymeopxkxapfizeeqeyb
NEXT_PUBLIC_SUPABASE_URL=https://bymeopxkxapfizeeqeyb.supabase.co
```

El servidor acepta únicamente ese ref y ese hostname exactos; otro proyecto Supabase se rechaza aunque su ref y URL coincidan entre sí. El alias histórico `BACKYARD_AI_CONSENT_PREVIEW_SUPABASE_URL` no sustituye este control. No copies aquí la URL compartida con Production. Si falta o no coincide, las cuentas autenticadas reciben `consent_environment_blocked` y no se consulta Auth ni `ai_processing_consents`; Invitado continúa local porque no usa el ledger server-side. Los cambios de variables sólo afectan deployments nuevos, por lo que se debe redesplegar el Preview.

## 3. Verificar base y RLS

En **Table Editor** confirma perfiles, consentimientos, preferencias, snapshots cloud y tablas Polla. En **SQL Editor** confirma que RLS está habilitado y ejecuta `supabase/tests/polla_live_rls.sql` en un proyecto de prueba.

Comprobaciones obligatorias:

- una cuenta solo consulta/modifica su perfil, preferencias, rondas, jugadores, grupos, rivales, campos y fotos;
- un administrador delegado solo obtiene acceso al torneo asignado;
- scorer solo escribe su grupo y únicamente con tarjeta abierta;
- viewer no escribe;
- anon no consulta tablas privadas;
- el endpoint público no devuelve email, PIN, token, apuestas privadas ni auditoría.

Las APIs de scorer validan el token hash y grupo en servidor. La service role se utiliza solo en módulos `server-only` después de validar sesión/rol.

## 4. Realtime

La última migración de hardening conserva `tournament_leaderboard_events` en `supabase_realtime` y retira las tablas raw `tournament_scores`/`tournament_groups`. Es una señal sanitizada por torneo; el cliente recibe el evento y vuelve a consultar el endpoint autorizado. Verifica en **Database → Publications** que sólo la señal figure entre esas tres tablas.

Si Realtime falla, la UI conserva polling ligero de 15–20 segundos.

## 5. Storage

La migración crea el bucket privado `scorecard-photos`, máximo 8 MB, JPEG/PNG/WebP. Sus policies exigen que la primera carpeta sea el `auth.uid()` del dueño. Confirma que el bucket sea **Private** y prueba subir, descargar y eliminar una foto con dos cuentas distintas.

## 6. Auth

Configura **Authentication → URL Configuration**:

- En la rama QA `bymeopxkxapfizeeqeyb`, el Site URL canónico es `https://dev.thebackyard.com.mx`; ya fue configurado en esta consolidación.
- Redirect local: `http://localhost:3000/auth/callback`
- Redirect Preview canónico: `https://dev.thebackyard.com.mx/auth/callback`
- Production conserva su propia configuración y callback; no abrir ni modificar ese proyecto para QA.
- No agregar wildcards ni callbacks de deployments `*.vercel.app`.

Agregar Redirect URLs no requiere ni autoriza cambiar el Site URL de Production.

Continúa con [Email OTP](./SETUP_EMAIL_OTP.md), [Google](./SETUP_GOOGLE_AUTH.md) y [Apple](./SETUP_APPLE_AUTH.md).

## 7. Prueba manual previa a publicar

1. Login OTP → perfil → consentimiento → Home.
2. Vincular datos locales dos veces: no duplica y no borra localStorage.
3. Abrir la misma cuenta en otro navegador y comprobar Histórico/frecuentes/campos.
4. Borrar una ronda y confirmar que no reaparece en el segundo navegador.
5. Crear Polla, entrar con PIN como scorer/viewer, capturar offline, reconectar, confirmar y corregir como admin.
6. Verificar que el leaderboard público contiene solo datos deportivos permitidos.

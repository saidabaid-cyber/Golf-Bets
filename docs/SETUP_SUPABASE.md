# Supabase: cuentas, nube y Polla Live

La aplicación conserva su modo Invitado/local cuando Supabase no está configurado o no responde. No pegues llaves en el código ni las subas a Git.

## 1. Crear y enlazar el proyecto

1. Crea o abre **el proyecto correcto de THE BACKYARD** en Supabase.
2. En **Project Settings → API** copia Project URL y la llave pública `anon`.
3. Copia la llave `service_role` únicamente al entorno del servidor. Tiene privilegios elevados y nunca debe llegar al navegador.
4. Crea `.env.local` desde `.env.example` y completa, sin comillas:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CLOUD_ENABLED=true
POLLA_LIVE_ENABLED=true
AUTH_SOCIAL_ENABLED=true
```

En Vercel, las tres llaves se configuran como variables de entorno; `SUPABASE_SERVICE_ROLE_KEY` debe permanecer server-side. Reinicia el servidor local después de modificar `.env.local`.

## 2. Aplicar migraciones

Aplica estos archivos **en orden**:

1. `supabase/migrations/202609010001_golf_bets_v3.sql`
2. `supabase/migrations/202609010002_backyard_accounts_legal.sql`
3. `supabase/migrations/202609020001_cloud_sync_polla_hardening.sql`

Opción SQL Editor: pega y ejecuta cada archivo por separado, revisando que termine sin error antes del siguiente.

Opción CLI, solo después de verificar el project ref:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push --dry-run
supabase db push
```

No se ejecutó `db push` durante esta fase porque el repositorio local no tiene credenciales ni enlace verificable al proyecto externo.

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

La última migración agrega `tournament_leaderboard_events` a `supabase_realtime`. Es una señal sanitizada por torneo; el cliente recibe el evento y vuelve a consultar el endpoint público. No hay una suscripción por jugador. Verifica en **Database → Publications** que la tabla figure en `supabase_realtime`.

Si Realtime falla, la UI conserva polling ligero de 15–20 segundos.

## 5. Storage

La migración crea el bucket privado `scorecard-photos`, máximo 8 MB, JPEG/PNG/WebP. Sus policies exigen que la primera carpeta sea el `auth.uid()` del dueño. Confirma que el bucket sea **Private** y prueba subir, descargar y eliminar una foto con dos cuentas distintas.

## 6. Auth

Configura **Authentication → URL Configuration**:

- Site URL actual: `https://golf-bets-psi.vercel.app`
- Redirect local: `http://localhost:3000/auth/callback`
- Redirect actual: `https://golf-bets-psi.vercel.app/auth/callback`
- Redirects futuros, solo cuando los dominios existan: `https://thebackyard.com.mx/auth/callback` y `https://www.thebackyard.com.mx/auth/callback`

Continúa con [Email OTP](./SETUP_EMAIL_OTP.md), [Google](./SETUP_GOOGLE_AUTH.md) y [Apple](./SETUP_APPLE_AUTH.md).

## 7. Prueba manual previa a publicar

1. Login OTP → perfil → consentimiento → Home.
2. Vincular datos locales dos veces: no duplica y no borra localStorage.
3. Abrir la misma cuenta en otro navegador y comprobar Histórico/frecuentes/campos.
4. Borrar una ronda y confirmar que no reaparece en el segundo navegador.
5. Crear Polla, entrar con PIN como scorer/viewer, capturar offline, reconectar, confirmar y corregir como admin.
6. Verificar que el leaderboard público contiene solo datos deportivos permitidos.

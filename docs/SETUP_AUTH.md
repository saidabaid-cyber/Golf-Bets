# The Backyard Account — configuración de Auth

La aplicación funciona en modo Invitado aunque este setup no esté terminado. No guardes credenciales reales en Git.

## 1. Supabase

1. Ejecuta las migraciones de `supabase/migrations/` en orden.
2. Configura en local y Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SECRET_KEY` únicamente en el servidor (necesaria para eliminación segura de cuenta).
3. En Authentication → URL Configuration define:
   - Site URL producción: `https://golf-bets-psi.vercel.app`
   - Redirect URL local: `http://localhost:3000/auth/callback`
   - Redirect URL producción: `https://golf-bets-psi.vercel.app/auth/callback`
4. No uses la secret/service-role key con prefijo `NEXT_PUBLIC_`.

## 2. Google

1. En Google Cloud crea o selecciona un proyecto y configura OAuth consent screen.
2. Crea credenciales OAuth 2.0 tipo Web application.
3. Usa como Authorized redirect URI la URL de callback que Supabase muestra en Authentication → Providers → Google, normalmente `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Copia el Client ID y Client Secret en el proveedor Google de Supabase, no en el repositorio.
5. Conserva en Supabase las redirect URLs de la sección anterior.

Si el proveedor no está habilitado, THE BACKYARD muestra “Acceso con Google pendiente de configuración” y permite continuar como invitado.

## 3. Apple

1. Se necesita una cuenta Apple Developer.
2. Crea/configura un App ID y un Service ID con “Sign in with Apple”.
3. En el Service ID agrega el dominio de producción y la return URL de Supabase: `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Genera una Sign in with Apple key y configura en Supabase el Service ID, Team ID, Key ID y secret generado conforme a la guía vigente de Supabase/Apple.
5. No copies archivos `.p8` ni secretos al repositorio.

En PWA/iPhone el retorno pasa por Supabase y termina en `/auth/callback`, que regresa a Home sin una vista muerta. Si Apple no está listo, el invitado sigue disponible.

## 4. Correo OTP

1. En Supabase Authentication habilita Email.
2. Configura la plantilla de email para incluir el token de 6 dígitos (`{{ .Token }}`), no únicamente un enlace.
3. Revisa límites de envío y proveedor SMTP antes de producción.
4. Prueba enviar, verificar, reenviar, código expirado y rate limit.

La app usa `signInWithOtp` y `verifyOtp` tipo `email`, sin contraseña.

## 5. Verificación manual

- Local: `http://localhost:3000`
- Callback local: `http://localhost:3000/auth/callback`
- Producción actual: `https://golf-bets-psi.vercel.app`
- Callback producción: `https://golf-bets-psi.vercel.app/auth/callback`
- Confirmar Google, Apple, OTP, restauración de sesión y cierre de sesión.
- Confirmar que cerrar sesión no borra rondas ni históricos locales.

# Google Auth con Supabase

El botón ya llama `signInWithOAuth({ provider: "google" })`. Faltan únicamente credenciales/configuración del proveedor externo.

1. En Google Cloud Console crea o selecciona el proyecto de THE BACKYARD.
2. Configura **Google Auth Platform / OAuth consent screen**, nombre, contactos y usuarios de prueba mientras esté en testing.
3. Crea un OAuth Client ID tipo **Web application**.
4. Agrega como Authorized JavaScript origins: `http://localhost:3000`, `https://golf-bets-psi.vercel.app` y, cuando existan, los dominios The Backyard.
5. Agrega como Authorized redirect URI **el callback de Supabase mostrado en Authentication → Providers → Google**, normalmente `https://PROJECT_REF.supabase.co/auth/v1/callback`.
6. Copia Client ID y Client Secret en Supabase → Authentication → Providers → Google. No los guardes en Git.
7. En Supabase conserva `/auth/callback` local/producción/futuro en la allow list de redirects.
8. Prueba éxito, cancelación, proveedor deshabilitado, sesión restaurada y regreso desde Safari/PWA.

Para esta etapa usar el Preview `https://golf-bets-git-codex-dev-saha8.vercel.app`
como origen web y agregar `https://golf-bets-git-codex-dev-saha8.vercel.app/auth/callback`
en la allow list de Supabase. El callback del proveedor es
`https://zhqmlpljloumldaczcfp.supabase.co/auth/v1/callback`; no confundirlo con el
callback de la aplicación. No modificar Production ni dominios en esta etapa.

Hasta completar esos pasos, el botón muestra **Google · pendiente de configuración**
y está deshabilitado. Si no se puede consultar el estado del proveedor, indica
acceso no disponible. Invitado sigue siendo una elección independiente.

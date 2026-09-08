# Google Auth con Supabase

El botón llama `signInWithOAuth({ provider: "google" })` y deriva el callback del `window.location.origin` real. El proveedor público ya está configurado para la beta.

1. En Google Cloud Console crea o selecciona el proyecto de THE BACKYARD.
2. Configura **Google Auth Platform / OAuth consent screen**, nombre, contactos y usuarios de prueba mientras esté en testing.
3. Crea un OAuth Client ID tipo **Web application**.
4. Agrega como Authorized JavaScript origins: `http://localhost:3000` y `https://beta.thebackyard.com.mx`.
5. Agrega como Authorized redirect URI **el callback de Supabase mostrado en Authentication → Providers → Google**, normalmente `https://PROJECT_REF.supabase.co/auth/v1/callback`.
6. Copia Client ID y Client Secret en Supabase → Authentication → Providers → Google. No los guardes en Git.
7. En Supabase conserva `/auth/callback` local/producción/Preview en la allow list de redirects. No cambies el Site URL de Production para probar un Preview.
8. Prueba éxito, cancelación, proveedor deshabilitado, sesión restaurada y regreso desde Safari/PWA.

La beta estable `https://beta.thebackyard.com.mx` conserva su propio callback,
pero este hotfix se prueba únicamente desde el Preview de la rama. El callback del proveedor es
`https://zhqmlpljloumldaczcfp.supabase.co/auth/v1/callback`; no confundirlo con el
callback de la aplicación. No modificar Production ni dominios en esta etapa.

## Preview `ai-first-phase1`

En **Supabase → Authentication → URL Configuration → Redirect URLs** agrega:

```text
https://golf-bets-git-ai-first-phase1-saha8.vercel.app/auth/callback
```

Para futuros deployments inmutables del mismo proyecto puede usarse el patrón
restringido `https://golf-bets-*-saha8.vercel.app/auth/callback`. El patrón oficial
más amplio de Supabase para todos los Preview del equipo es
`https://*-saha8.vercel.app/**`; úsalo sólo si el patrón restringido no cubre los
aliases reales. Ninguno de estos valores reemplaza el Site URL de Production.

La app consulta el estado público del proveedor antes de habilitar el botón. Si la
consulta o la configuración externa deja de estar disponible, muestra un estado
controlado y no redirige a un error crudo. Invitado sigue siendo independiente.

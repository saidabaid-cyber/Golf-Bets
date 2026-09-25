# Google Auth con Supabase

El botón llama `signInWithOAuth({ provider: "google" })`. En remoto deriva el callback del `NEXT_PUBLIC_APP_ORIGIN` exacto; localhost conserva su propio origen para desarrollo.

1. En Google Cloud Console crea o selecciona el proyecto de THE BACKYARD.
2. Configura **Google Auth Platform / OAuth consent screen**, nombre, contactos y usuarios de prueba mientras esté en testing.
3. Crea un OAuth Client ID tipo **Web application**.
4. Agrega como Authorized JavaScript origins: `http://localhost:3000` y `https://dev.thebackyard.com.mx`. Conserva el origin de Production existente sin modificarlo para QA.
5. Agrega como Authorized redirect URI **el callback de Supabase mostrado en Authentication → Providers → Google**, normalmente `https://PROJECT_REF.supabase.co/auth/v1/callback`.
6. Copia Client ID y Client Secret en Supabase → Authentication → Providers → Google. No los guardes en Git.
7. En Supabase conserva `/auth/callback` local/producción/Preview en la allow list de redirects. No cambies el Site URL de Production para probar un Preview.
8. Prueba éxito, cancelación, proveedor deshabilitado, sesión restaurada y regreso desde Safari/PWA.

El Preview canónico se prueba únicamente desde `https://dev.thebackyard.com.mx`. El callback del proveedor para la rama QA aislada es
`https://bymeopxkxapfizeeqeyb.supabase.co/auth/v1/callback`; no confundirlo con el
callback de la aplicación. El callback existente de Production usa su propio proyecto y se conserva sin cambios.

## Preview canónico `integration/backyard-current`

En **Supabase → Authentication → URL Configuration → Redirect URLs** agrega:

```text
https://dev.thebackyard.com.mx/auth/callback
```

No agregar wildcards ni callbacks `*.vercel.app`. `NEXT_PUBLIC_APP_ORIGIN` debe ser
`https://dev.thebackyard.com.mx` en esta rama; Supabase y Google deben regresar al
mismo origen. Esto no reemplaza ni autoriza cambios en el Site URL de Production.

La app consulta el estado público del proveedor antes de habilitar el botón. Si la
consulta o la configuración externa deja de estar disponible, muestra un estado
controlado y no redirige a un error crudo. Invitado sigue siendo independiente.

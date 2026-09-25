# The Backyard Account — índice de configuración

La app usa Supabase Auth con PKCE y restaura la sesión. Sin Supabase conserva Login en modo controlado y permite **Continuar como invitado** sin borrar datos.

## Variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_ORIGIN` (`https://dev.thebackyard.com.mx` en Preview; localhost se conserva automáticamente)
- `SUPABASE_SERVICE_ROLE_KEY` únicamente server-side

`SUPABASE_SECRET_KEY` se acepta temporalmente como alias server-side para instalaciones previas, pero la variable canónica documentada es `SUPABASE_SERVICE_ROLE_KEY`. Ninguna de las dos puede usar prefijo `NEXT_PUBLIC_`.

## Redirects

- Local: `http://localhost:3000/auth/callback`
- Preview canónico: `https://dev.thebackyard.com.mx/auth/callback`
- Production existente: `https://app.thebackyard.com.mx/auth/callback` (conservar; no modificar para QA)

No usar wildcards ni callbacks de deployments `*.vercel.app`. Los que aparecen en documentos de cierre antiguos son evidencia histórica, no configuración vigente.

## Guías

- [Supabase completo](./SETUP_SUPABASE.md)
- [Email OTP](./SETUP_EMAIL_OTP.md)
- [Google](./SETUP_GOOGLE_AUTH.md)
- Apple queda documentado solo para una etapa futura; no se muestra en la UX actual.

Después de cualquier proveedor, Supabase regresa a `/auth/callback`; la página intercambia el code PKCE y vuelve a Home. En error siempre ofrece “Volver a The Backyard”.

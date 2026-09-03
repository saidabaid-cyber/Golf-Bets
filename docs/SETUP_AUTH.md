# The Backyard Account — índice de configuración

La app usa Supabase Auth con PKCE y restaura la sesión. Sin Supabase conserva Login en modo controlado y permite **Continuar como invitado** sin borrar datos.

## Variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` únicamente server-side

`SUPABASE_SECRET_KEY` se acepta temporalmente como alias server-side para instalaciones previas, pero la variable canónica documentada es `SUPABASE_SERVICE_ROLE_KEY`. Ninguna de las dos puede usar prefijo `NEXT_PUBLIC_`.

## Redirects

- Local: `http://localhost:3000/auth/callback`
- Producción actual: `https://golf-bets-psi.vercel.app/auth/callback`
- Futuro, todavía no activar: `https://thebackyard.com.mx/auth/callback`
- Futuro, todavía no activar: `https://www.thebackyard.com.mx/auth/callback`

## Guías

- [Supabase completo](./SETUP_SUPABASE.md)
- [Email OTP](./SETUP_EMAIL_OTP.md)
- [Google](./SETUP_GOOGLE_AUTH.md)
- [Apple](./SETUP_APPLE_AUTH.md)

Después de cualquier proveedor, Supabase regresa a `/auth/callback`; la página intercambia el code PKCE y vuelve a Home. En error siempre ofrece “Volver a The Backyard”.

# Email OTP de The Backyard

El código de la aplicación usa Supabase Auth passwordless con `signInWithOtp` y `verifyOtp({ type: "email" })`. No envía correos reales durante tests.

## Configuración

1. En Supabase abre **Authentication → Providers → Email** y habilita Email.
2. Decide si se crea el usuario automáticamente en el primer acceso; la app completa nombre/HCP después.
3. En **Authentication → Email Templates**, edita Magic Link para mostrar claramente el token `{{ .Token }}`. Esto permite introducir el OTP de seis dígitos dentro de la app.
4. Conserva las redirect URLs descritas en `SETUP_SUPABASE.md`.
5. Revisa expiración y rate limits en Auth. Prueba código correcto, incorrecto, expirado, reenviar y límite de frecuencia.

## Correo y SMTP

`privacidad@thebackyard.com.mx`, `soporte@thebackyard.com.mx` y `contacto@thebackyard.com.mx` son contactos legales/soporte; no son automáticamente un servicio SMTP.

Para la primera prueba puede usarse el envío permitido por Supabase. Antes de tráfico real, configura un SMTP propio/transaccional en Supabase y valida SPF, DKIM y remitente del dominio. Las credenciales SMTP pertenecen a Supabase/Vercel, nunca al repositorio ni a variables `NEXT_PUBLIC_*`.

## Resultado esperado

Correo → Enviar código → seis dígitos → Verificar → sesión restaurable → perfil/consentimiento si es primer acceso → Home. Cerrar sesión no borra información local.

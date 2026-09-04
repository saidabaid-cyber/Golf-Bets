# Email OTP de The Backyard

El código de la aplicación usa Supabase Auth passwordless con `signInWithOtp` y `verifyOtp({ type: "email" })`. No envía correos reales durante tests.

## Configuración

1. En Supabase abre **Authentication → Providers → Email** y habilita Email.
2. Decide si se crea el usuario automáticamente en el primer acceso; la app completa nombre/HCP después.
3. En **Authentication → Email → Templates → Magic Link**, pega el contenido de `supabase/templates/email-otp.html`. Asunto sugerido: **Tu código de The Backyard**. La plantilla debe usar `{{ .Token }}`, no `{{ .ConfirmationURL }}`. Supabase llama a esta plantilla “Magic Link” aunque se use OTP; `signInWithOtp` por sí solo NO cambia el contenido del correo.
4. Conserva las redirect URLs descritas en `SETUP_SUPABASE.md`.
5. Revisa expiración y rate limits en Auth. Prueba código correcto, incorrecto, expirado, reenviar y límite de frecuencia.

## Correo y SMTP

`privacidad@thebackyard.com.mx`, `soporte@thebackyard.com.mx` y `contacto@thebackyard.com.mx` son contactos legales/soporte; no son automáticamente un servicio SMTP.

Para la primera prueba puede usarse el envío permitido por Supabase. Antes de tráfico real, configura un SMTP propio/transaccional en Supabase y valida SPF, DKIM y remitente del dominio. Las credenciales SMTP pertenecen a Supabase/Vercel, nunca al repositorio ni a variables `NEXT_PUBLIC_*`.

## Resultado esperado

Correo → Enviar código → ocho dígitos → Verificar → sesión restaurable → perfil/consentimiento si es primer acceso → Home. Cerrar sesión no borra información local.

## Checklist real pendiente (no lo aplica un push a Vercel)

- Proyecto: `zhqmlpljloumldaczcfp`. No reaplicar migraciones ni usar una service key para configurar Auth.
- En Email, conservar la longitud efectiva de OTP hosted en **8** y revisar la expiración. Mantener el límite de reenvío de al menos 60 segundos. La entrega real del proyecto confirmó que `{{ .Token }}` genera ocho dígitos.
- Aplicar la plantilla anterior en **Magic Link**. Si el proyecto tiene un flujo separado de confirmación de nuevos usuarios, revisar también **Confirm signup** para que no presente un enlace como alternativa al código esperado.
- Redirect permitido de la beta: `https://beta.thebackyard.com.mx/auth/callback`. Local: `http://localhost:3000/auth/callback`. No modificar Production.
- **Restricción vigente desde 3 de junio de 2026:** los proyectos Free nuevos con SMTP predeterminado no pueden personalizar plantillas. Si el panel bloquea el cambio, hace falta SMTP propio (o una configuración de plan que lo permita). No se ha comprobado aquí el plan/SMTP real del proyecto y no se contratará ningún servicio automáticamente.
- Con un correo real autorizado: enviar, recibir **ocho dígitos**, verificar, comprobar perfil/onboarding, recargar, salir y volver a entrar. No basta con que `/auth/v1/otp` devuelva HTTP 200.
- Si llega un enlace, la plantilla remota sigue pendiente; la app mantiene la pantalla OTP y NO simula una sesión ni pasa automáticamente a Invitado.
- Invitado se elige mediante su botón separado. Sus datos permanecen locales hasta una vinculación explícita.
- Los tests de código usan mocks; no prueban entrega de email ni dictado/iPhone físico.

Fuentes oficiales revisadas: [OTP y plantilla Magic Link](https://supabase.com/docs/guides/auth/auth-email-passwordless), [plantillas de correo](https://supabase.com/docs/guides/auth/auth-email-templates), [restricción Free/SMTP de junio de 2026](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

# Sign in with Apple con Supabase

El botón ya llama `signInWithOAuth({ provider: "apple" })`. No hay Team ID, Service ID, Key ID ni llave privada inventados en el proyecto.

1. En Apple Developer registra/verifica los dominios web necesarios.
2. Crea primero un App ID principal con la capacidad **Sign in with Apple**.
3. Crea un **Services ID** para la web y asócialo al App ID.
4. Configura Website URLs: dominios local/actual/futuros según admita Apple, y como Return URL el callback de Supabase `https://PROJECT_REF.supabase.co/auth/v1/callback`.
5. Crea una key con Sign in with Apple y guarda de forma segura Team ID, Services ID, Key ID y `.p8`.
6. Genera/configura el client secret en Supabase → Authentication → Providers → Apple. Nunca subas `.p8` ni el secret al repositorio.
7. Conserva las redirect URLs de la app en la allow list de Supabase.
8. Prueba en Safari y PWA: éxito, cancelación, private relay, callback y session restore.

Apple puede entregar nombre completo solo en la primera autorización. La app por eso solicita/completa el nombre en el onboarding si el perfil cloud todavía no está completo.

El client secret de Apple expira y debe rotarse según su vigencia. Hasta terminar
la configuración, el botón muestra **Apple · pendiente de configuración** y está
deshabilitado. Invitado continúa disponible; Email OTP requiere su configuración
propia descrita en `SETUP_EMAIL_OTP.md`.

Para esta etapa: callback del proveedor
`https://zhqmlpljloumldaczcfp.supabase.co/auth/v1/callback`; redirect de la app
permitido por Supabase
`https://golf-bets-git-codex-dev-saha8.vercel.app/auth/callback`. No modificar
Production ni dominios. No se han configurado ni inventado credenciales Apple.

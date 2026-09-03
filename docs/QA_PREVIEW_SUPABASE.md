# QA Preview / Supabase — 3 septiembre 2026

Rama exclusiva: `codex-dev`. Punto de partida: `15f491b7de68247b4f6864538bf87580b0a437ef`.
Preview: https://golf-bets-git-codex-dev-saha8.vercel.app
Supabase: `zhqmlpljloumldaczcfp`. No cambios en main, dominio ni Production.

## Evidencia real (no mocks)

- Preview protegido: acceso temporal autorizado por Vercel; protección no desactivada.
- Navegador, invitado, datos sintéticos `QA *`: nueva ronda de 9 hoyos; cuatro jugadores; HCP; selección y edición de parejas Foursome; Personal con ventaja directa; scores H1–9; guardado; resumen; resultados; copiar resumen; histórico; corregir H1 con confirmación; recargar. Una sola ronda, histórico actualizado, scores preservados. Transferencias del fixture antes de corregir: -1150 -350 -950 +2450 = 0; después: -1450 -50 -850 +2350 = 0. **Este flujo fue localStorage en el Preview, NO cloud.**
- Foursome sin scores/parcial: Esperando scores. Completo: +2/-2. Editar parejas conservó scores.
- Reglas: 25 reglas; consultas `16.1`, `cart path`, `área penalidad` devuelven resultados; browser Back regresa a Histórico. Micrófono llega a solicitar permiso y presenta fallback por falta de inicio; no se verificó voz física ni iPhone.
- Aclaraciones julio 2026: PDF HTTP 200, firma `%PDF-`, 316707 bytes, 13 páginas, render canvas y siguiente/regresar comprobados.
- Parte 1 / Parte 2: el proxy del Preview devuelve HTTP 502. GET desde este dispositivo a las URLs oficiales devuelve PDF real (13566580 / 5186675 bytes), CORS `*`. En el Preview corregido, se verificó el render real interno de ambos PDFs (410 y 172 páginas), página 1 → 2 y regreso por botón/browser Back. La recuperación CORS funciona sin salir de The Backyard; no se afirma que el proxy 502 esté arreglado.
- Se comprobaron los 12 chunks iniciales del Preview: proyecto Supabase esperado, clave pública presente, ninguna clave privilegiada identificada. `server.ts` continúa `server-only`; sync usa JWT de usuario, no admin/RLS bypass.
- `/api/features`: cloud, Polla y social `true`. `/auth/v1/settings` REAL: email `true`, Google `false`, Apple `false`, registro habilitado y confirmación de correo obligatoria. Un flag no habilita un proveedor OAuth.
- Lecturas anónimas reales: ninguna fila de perfiles, rondas, scores, jugadores, grupos, rivales, drafts, preferencias, borrados, consentimientos ni accesos. RPC `resolve_polla_access` e `is_polla_admin` rechazan anon (401 / PostgreSQL 42501).
- `polla_join_attempts`: SELECT anónimo respondió 200 con cero filas (RLS), **no** denegación del privilegio de tabla. La nueva migración también revoca el privilegio directo. No se aplicó sobre la base real.

## Correcciones locales

1. Los refresh/repetidos SIGNED_IN de la misma cuenta actualizan token sin reiniciar los checks de onboarding que dependen del ID; antes podían dejar «Preparando tu perfil…» indefinidamente.
2. Los errores PostgREST de consentimiento (promesas resueltas con `error`) se comprueban; no se anuncian como éxito cloud. Perfil local de cuenta se actualiza después de confirmar escritura.
3. `/api/features` lee ajustes públicos de Auth. Google/Apple deshabilitados se informan dentro de la app, sin redirigir al error JSON del proveedor.
4. Endpoints cloud sin token: 401 «Inicia sesión», no falso 503 «Nube no configurada».
5. Un autosave inicial vacío ya no oculta el draft real recuperado de otro dispositivo.
6. Alias moderno publishable compatible con ANON_KEY; SECRET_KEY compatible con SERVICE_ROLE_KEY. No exige cambiar las variables actuales.

## Migraciones y hardening

Las migraciones 001 y 003 del repositorio resuelven pgcrypto en `public, extensions`, incluyendo cuerpos SQL durante instalación y search_path persistente de funciones. Se crea `extensions` si falta; no se relocaliza una extensión existente. No se ejecutaron las migraciones antiguas en el proyecto real.

Nueva `202609030001_function_privileges.sql`: no toca filas. Revoca PUBLIC y grants directos anon/authenticated en funciones de servidor/trigger; conserva service_role. Revoca tabla/secuencia de `polla_join_attempts` para clientes. Reconcilia la intención del hardening comunicado, pero **no se pudo comparar cada ACL real** sin conexión administrativa.

`is_polla_admin(uuid)` conserva EXECUTE para authenticated: lo llaman las políticas RLS de administradores delegados; revocarlo rompería SELECT legítimos. SECURITY DEFINER evita recursión; identidad exclusivamente `auth.uid()`, sin argumento user_id, search_path fijado, resultado booleano. No se amplían permisos de usuarios.

`supabase/tests/function_privileges_check.sql` contiene consultas solo lectura para comparar ACL, RLS, pgcrypto, publicación Realtime y bucket. Ejecutar/revisar antes de aplicar exclusivamente la nueva migración. No marcar las tres anteriores como pendientes ni volver a ejecutarlas. Instalación SQL limpia y Security Advisor **pendientes de ejecución administrativa**, no verificados por tests de texto.

## Bloqueos externos / afirmaciones que NO se hacen

No existe conexión Supabase administrativa/SQL ni sesión de dashboard en este entorno; dashboard/GitHub solicitan acceso. Tampoco hay un correo de prueba autorizado/inbox accesible. Se solicitó al usuario completar acceso por UI, sin pedir ni imprimir secretos.

Por ello NO se declaran probados: envío/recepción/verificación OTP real, sesión autenticada persistente, escritura cloud, RLS entre dos usuarios, recuperación multidispositivo, sincronización de correcciones/borrados, bucket privado/fotos reales ni emisión Realtime. La lectura pública confirma conectividad y defensas anónimas, no estas operaciones.

Los scores/configuraciones/Personales/resultados están representados por snapshots y proyecciones en el código, pero eso no equivale a confirmar que ya se guardaron en Supabase.

Riesgos a comprobar con dos cuentas/dispositivos: conflictos simultáneos de drafts/preferencias; eliminación offline de un draft frente a otro dispositivo; reintento de proyecciones tras fallo parcial; cola/reintento de fotos offline. No se declara atomicidad transaccional del sync actual.

## Configuración externa exacta

- Email: permitir `https://golf-bets-git-codex-dev-saha8.vercel.app/auth/callback` en Supabase Authentication → URL Configuration, además de localhost. En Email Templates → Magic Link mostrar `{{ .Token }}`. Verificar plantilla de Confirm Signup si aplica y SMTP/remitente/rate limits. No es necesario cambiar dominio ni Site URL de producción para probar el Preview.
- Google: proveedor deshabilitado. Verificar/completar OAuth Client ID Web y Client Secret en Supabase → Authentication → Providers → Google; callback del proveedor: `https://zhqmlpljloumldaczcfp.supabase.co/auth/v1/callback`. Origin Preview en Google y callback de app en allow list Supabase.
- Apple: proveedor deshabilitado. Verificar/completar Team ID, Services ID, Key ID y key `.p8`/client-secret generado en Apple Developer/Supabase → Providers → Apple. Return URL `https://zhqmlpljloumldaczcfp.supabase.co/auth/v1/callback`; retorno app al callback Preview permitido. No pegar credenciales en chat/Git.
- Actualización administrativa comunicada por Said (3 septiembre): el hardening ya fue aplicado como function_privileges_repo_reconciliation. No volver a aplicarlo ni pedir acceso administrativo. Restan únicamente INFO RLS sin policies en polla_join_attempts (sin grants cliente, intencional) y WARN EXECUTE authenticated de is_polla_admin (necesario para RLS delegada). Véase CLOUD_SYNC_HARDENING.md para la continuación de QA; no confundir las limitaciones del bloque anterior con el estado administrativo actual.

Fuentes oficiales consultadas: [OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [templates](https://supabase.com/docs/guides/auth/auth-email-templates), [redirects](https://supabase.com/docs/guides/auth/redirect-urls), [keys](https://supabase.com/docs/guides/getting-started/api-keys), [API security](https://supabase.com/docs/guides/api/securing-your-api).

## Validación local del bloque

- `npm test`: 272 tests aprobados, 0 fallidos. Se conservan Said/Carlos -600, Said/José Juan -200, Said/Flavio +800, Said/Javier -800 y total Said -800, sin cambios al motor.
- `npm run lint`: aprobado, sin errores.
- `npm run build`: aprobado (Next.js 16.3.3, TypeScript y generación de páginas).
- `git diff --check`: aprobado. `.env.local` y fuentes PDF locales ignorados; ningún candidato de clave privilegiada en archivos trackeables revisados.
- La validación SQL es estructural; no equivale a ejecutar las migraciones en PostgreSQL ni a revisar Security Advisor.

## Verificación del Preview corregido

Código validado: `cf3cb20b9d99018554b9f60534d61612795c38fc`, deployment `dpl_5n82rV1CySFpC2Wiqccq3M63358g` READY, rama codex-dev, target Preview. El commit de cierre documental no cambia código.

- Los tres PDFs renderizan dentro de la app; Parte 1/2 por recuperación CORS, Aclaraciones por proxy. Navegación de páginas y regreso comprobados. Navegador automatizado a 390×844; no es una prueba física de Safari/iPhone.
- Google/Apple muestran «Pendiente de configuración» al pulsarlos, sin navegar al error JSON de Supabase. Correo inválido muestra mensaje humano; no se envió correo a un destinatario no autorizado.
- Entrar/salir de la pantalla de acceso como invitado no borró consentimiento ni ronda. Recargar, continuar H1, abrir Histórico y Resultados mantuvo los 9 hoyos y la corrección de H1. Histórico sigue con una sola ronda.
- Clipboard real verificado: THE BACKYARD / La Vista / fecha / cuatro jugadores con -1450, -50, -850, +2350. Mensaje «Resumen copiado» visible.
- Script público real repetido: flags activos, proveedor Email habilitado, Google/Apple deshabilitados, endpoints cloud 401 sin sesión, ninguna fila privada anónima devuelta y sin clave privilegiada detectada en los 12 chunks iniciales. RLS entre cuentas y escrituras siguen pendientes.
- «Preguntar a IA» aparece «IA no configurada» en este Preview. No se modificó ni reindexó el Vector Store ni se enviaron consultas a OpenAI.

## Repetir comprobaciones públicas

`node scripts/qa-preview-public.mjs https://golf-bets-git-codex-dev-saha8.vercel.app`

Si el Preview está protegido, configurar temporalmente `PREVIEW_QA_ACCESS_URL` por mecanismo seguro; nunca guardarlo en Git ni registrar cookies/keys. El script no inicia sesión ni escribe datos. Un PDF 502 debe comprobarse además en navegador (ruta CORS interna), no considerarse éxito de proxy.

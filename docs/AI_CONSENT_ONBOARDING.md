# Consentimientos de IA en onboarding y cuentas existentes

## Comportamiento implementado

- El cierre del onboarding autenticado, después del perfil y la personalización, muestra **ANTES DE EMPEZAR**. Reúne los checks legales existentes y las autorizaciones separadas para instrucciones/dictado, fotografías de scorecards y fotografías de pantallas de práctica. Ninguno está premarcado.
- **CREAR CUENTA Y CONTINUAR** finaliza el alta funcional de la cuenta ya autenticada; no crea una segunda identidad Auth.
- Para cuentas existentes, **ACTUALIZAMOS TUS PREFERENCIAS** muestra únicamente los propósitos sin decisión para la versión vigente. Aceptar, rechazar o revocar resuelve esa versión; el rechazo no se considera aceptación.
- La consulta inicial siempre es al servidor. No se utiliza una bandera local para saltar el checkpoint. Un error de consulta o escritura conserva el bloqueo y ofrece reintentar; no se simula consentimiento guardado.
- Las autorizaciones de IA son provisionalmente opcionales. Se puede continuar con ellas desmarcadas, guardadas como `declined`; las funciones correspondientes permanecen desactivadas.
- Perfil → Cuenta y privacidad → Privacidad / IA permite autorizar explícitamente y revocar cada propósito. Las funciones autenticadas no muestran otro popup: consultan el permiso vigente o enlazan a su configuración. Invitados conservan su autorización explícita local separada, sin atribuirles consentimiento de una cuenta.
- Antes de transmitir a un proveedor, los endpoints vuelven a validar la sesión, estado de cuenta y aceptación vigente. El dictado de usuarios autenticados también consulta el permiso antes de iniciar el micrófono.

## Ledger canónico y seguridad

Se extiende `public.ai_processing_consents`; no se crea otro registro paralelo. `scope` representa `purpose`; `policy_version` representa `version`. Se guardan `user_id`, `decision_status`, `accepted_at`, `revoked_at`, `decided_at` y `source` (`onboarding`, `account_update`, `settings` o `legacy`). Las negativas tienen `accepted_at = null`.

`GET /api/backyard-ai/consent` devuelve los propósitos, sus estados y si están resueltos. `POST` recibe elecciones y origen, nunca un `userId` del navegador. La identidad se obtiene mediante Auth `getUser`. El RPC `record_ai_processing_consent_decisions` guarda el lote transaccionalmente y serializa cambios por cuenta. Un formulario de onboarding atrasado sólo completa propósitos faltantes; no sobrescribe decisiones o revocaciones más recientes. Las modificaciones explícitas desde Configuración siguen usando las rutas por scope.

La auditoría encontró que la lectura de launch monitor reutilizaba el permiso de scorecards. Se separa en `AI_LAUNCH_MONITOR_PROCESSING_CONSENT`: aceptar fotografías de tarjetas no autoriza fotografías de práctica. Las aceptaciones anteriores de scorecards no se transfieren a ese propósito nuevo.

RLS permite leer únicamente registros propios. Sólo el servidor con `service_role` puede ejecutar el RPC; no hay claves privilegiadas en el cliente. Las fechas de IA se asignan en PostgreSQL. Las aceptaciones previas conservan su evidencia; no se generan autorizaciones retroactivas para scopes faltantes.

## Aplicación controlada necesaria

Migración nueva: `supabase/migrations/20260916020557_ai_consent_onboarding_decisions.sql`.

Requiere previamente `20260908134650_ai_processing_consents.sql` y las dependencias del control de cuenta ya documentadas en [activación de Preview](PREVIEW_CONTROLLED_ACTIVATION.md). Aplicar únicamente en una ref Preview aislada verificada, nunca `zhqmlpljloumldaczcfp` (base compartida).

Configurar exclusivamente en Vercel Preview de `phase2/full-platform`:

1. `NEXT_PUBLIC_SUPABASE_URL` y clave pública correspondientes a esa ref aislada.
2. `SUPABASE_SECRET_KEY` o `SUPABASE_SERVICE_ROLE_KEY`, sólo servidor, de la misma ref.
3. `BACKYARD_AI_CONSENT_PREVIEW_SUPABASE_URL` igual exactamente al origen HTTPS aislado.
4. Los controles de aislamiento/estado de cuenta del runbook existente.

El checkpoint es obligatorio antes de entrar a la app. **No publicar esta integración contra la base compartida o sin esta migración**: el bloqueo seguro impediría completar el acceso. La prueba local o PostgreSQL WASM no acredita persistencia real en Supabase Preview.

## QA remota pendiente

Verificación local de este bloque: 1,734 tests PASS, lint PASS y build PASS. El script `node scripts/test-ai-consent-decisions-db.mjs` prueba PostgreSQL real en PGlite local: escritura atómica, rollback, RLS, separación de propósitos y reintentos. Las pruebas de caché reconocen reautorización en otro dispositivo por ID de registro monotónico; nunca comparan relojes de navegador para reactivar una revocación pendiente.

El harness `node scripts/qa-account-consent-browser.mjs` ejecuta el componente React real con una API QA en memoria, sólo loopback. Verificado en Chromium a 390×844, 393×852 y 430×932: sin overflow horizontal, checkboxes desmarcados, guardado, reload sin repetición, rechazo y fallo de escritura. La pantalla final tiene scroll vertical normal para leer todos los checks, sin modal recortado. Capturas y reporte están en `.qa-artifacts/consent-*`, claramente marcados LOCAL / NO PREVIEW DB. **Esto no es PASS de persistencia Supabase Preview**.

En la nueva DB, con una cuenta QA desechable:

1. Completar alta, comprobar checks desmarcados, aceptar instrucciones y scorecards, decidir por separado el permiso de práctica, guardar y verificar en el ledger versión, tres propósitos, fechas server-side y origen `onboarding`.
2. Usar instrucciones, dictado y lectura de tarjeta sin popup adicional.
3. Entrar desde otro navegador/dispositivo sin almacenamiento local y comprobar reconocimiento de las autorizaciones del servidor.
4. Revocar cada scope: el proveedor no recibe contenido, la app no repite el checkpoint; volver a autorizar desde Configuración.
5. Con una cuenta anterior sin decisiones, mostrar la pantalla una vez, rechazar los permisos, recargar y comprobar que sigue resuelta/desactivada.
6. Simular fallo transaccional: no queda un lote parcialmente guardado ni se abre la app como si hubiera terminado.
7. Verificar lectura/escritura cruzada rechazada para otra cuenta.

## Revisión legal

`LEGAL_REVIEW_REQUIRED`: clasificación definitiva de permisos obligatorios/opcionales, redacción jurídica, proveedor/destinatarios aplicables, retención y tratamiento de contenido. No se afirma validación legal. No se cambia la versión del consentimiento existente sin una política aprobada; una versión futura requerirá una nueva decisión explícita.

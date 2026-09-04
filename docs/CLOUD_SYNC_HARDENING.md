# QA cloud / OTP — codex-dev, 3 septiembre 2026

## Alcance y evidencia

Base: e60fa0e70b8819bff4c3a4a6828a638210e42120. Solo codex-dev.
No se ejecutan migraciones remotas ni se modifica main, Production o dominio.
Según la verificación administrativa comunicada por Said, function_privileges_repo_reconciliation ya está aplicada. Se mantienen intencionalmente los avisos RLS sin policies de polla_join_attempts (sin grants cliente) y EXECUTE authenticated de is_polla_admin, requerido por las policies delegadas. No se solicita ni usa acceso administrativo.

Las pruebas nuevas de sincronización usan un fake de PostgREST y transportes en memoria: **no son prueba E2E autenticada ni certifican RLS real**. No se envían OTP a correos ficticios.

## Cambios verificables

- Un solo ciclo descarga → combina → escribe → vuelve a leer la versión canónica → sincroniza fotos → aplica y confirma. No hay fallback local presentado como éxito cloud.
- Fechas de edición de draft/preferencias separadas del autosave. Un draft vacío con versión nueva representa eliminación. Cambiar de pantalla o recargar no renueva la fecha.
- Escrituras compare-and-swap verifican updated_at y filas devueltas; un conflicto o actualización de cero filas exige reintento.
- Los tombstones prevalecen sobre dispositivos antiguos, incluso si éstos editaron posteriormente el registro borrado. Lectura paginada, con regresión de 1,200 tombstones.
- Fallos parciales conservan snapshots canónicos. Reintentos reconstruyen las proyecciones desde la versión guardada, incluyendo scores, jugadores, personales, apuestas, resultados, gastos y campo.
- Las colecciones conservan sus ids; las correcciones históricas no duplican rondas. Los campos predeterminados también conservan sus modificaciones al sincronizar.
- Cambiar de cuenta archiva y restaura el espacio local correspondiente; un callback antiguo no puede aplicar datos sobre una identidad distinta. Invitado conserva su espacio.
- La ronda se combina por campo desde una base canónica: hoyos y jugadores distintos se conservan automáticamente. Solo dos valores distintos del mismo campo (por ejemplo, el mismo jugador/hoyo) abren el selector visual, que muestra jugador, hoyo, valores, fecha y dispositivo y resuelve únicamente ese campo.
- Un `CLOUD_FIELD_CONFLICT` tardío conserva HTTP 409 y un arreglo `conflicts`; el cliente vuelve a descargar, rebasa la base y reintenta cambios compatibles. `currentIndex`, pestaña, resumen de hoyo, contador, modales, scroll y navegación nunca forman parte del estado compartido.
- Fotos: archivo local primero, identificador versionado, cola persistente por usuario, confirmación de subida y reintento de errores. No se borra el blob al subir. Las fotos de otra cuenta no se envían.
- Cuenta distingue sesión, pendiente, sincronizando, error y última sincronización confirmada. Lectura/guardado fallido de cuenta o consentimiento bloquea la confirmación del ciclo de datos.
- Onboarding guarda preferencias antes del marcador de perfil completado; un fallo no permite omitir el paso tras recargar.
- OTP usa verifyOtp type=email, correo editable, input de ocho dígitos, errores humanos y cooldown persistente de 60 segundos para reenvío/doble clic. Peticiones del cliente tienen timeout recuperable y conservan cancelación externa.
- Google consulta el estado público del proveedor antes de OAuth. Apple queda oculto de la UX actual.

## Límites y conflictos (no ocultarlos)

La API actual usa varias operaciones PostgREST, no una transacción SQL global. Los snapshots son canónicos; las proyecciones pueden estar temporalmente incompletas hasta un reintento exitoso. Se rechaza la confirmación si una proyección falla o cambia la versión durante su cálculo. Una garantía serializable entre dispositivos para todas las tablas requeriría una operación transaccional en backend; no se añadió ni aplicó una migración remota.

La resolución de colecciones históricas sigue usando fecha de edición; dentro del draft se usa merge de tres vías por campo e identidad estable. Un mismo score contradictorio requiere elección explícita. Los borrados son definitivos para ese id. La sincronización se activa tras editar, volver a la pestaña, recuperar conexión o Reintentar; no es streaming Realtime del draft.

Si un dispositivo se desconecta después de subir el tombstone pero antes de borrar la foto, la limpieza queda en su cola hasta reconectarse. La ronda no reaparece. Una foto aún solo local no puede recuperarse desde otro dispositivo hasta que el original complete su cola.

## PDF

El proxy transmite sin Next Data Cache y sin copiar Content-Length de una respuesta que fetch pudo descomprimir. Verifica la firma PDF en vez de depender exclusivamente del MIME. Devuelve diagnóstico público acotado X-Rules-Source-Status y un log sin claves, cookies ni body de errores.
Se conserva el fallback CORS **dentro del visor PDF.js**; no navega a una página externa.
La comprobación directa desde Node de las tres fuentes oficiales devolvió HTTP200 / application/pdf; USGA permite CORS *. Esto no prueba que la fuente acepte conexiones desde Vercel. El resultado del nuevo Preview debe verificarse por separado.

## Prueba humana pendiente

1. Abrir https://beta.thebackyard.com.mx y usar un correo real autorizado.
2. Recibir código, introducirlo, completar consentimientos/perfil y vincular datos.
3. Confirmar Cuenta → Sincronizado con hora actual. Recargar, cerrar y reabrir; comprobar sesión.
4. Segundo navegador con la misma cuenta: recuperar draft, scores, históricos, jugadores, grupos, rivales, campos y preferencias.
5. Editar/corregir, borrar una ronda de QA y sincronizar desde ambos; verificar que no se duplique ni resucite.
6. Adjuntar foto, simular desconexión, reconectar y comprobar foto desde el segundo navegador. Verificar errores/reintento.
7. Cerrar sesión/iniciar otra cuenta y confirmar aislamiento. Ninguna de estas comprobaciones se sustituye por los mocks.
8. Safari/PWA iPhone físico: teclado OTP/AutoFill, micrófono con permisos, safe areas y regreso desde PDF.

Si llega solo enlace y no código, comprobar plantilla de Supabase con {{ .Token }}, SMTP y redirect permitido:
https://beta.thebackyard.com.mx/auth/callback.
No se conoce desde esta prueba el plan/SMTP efectivo. Supabase anunció restricciones para personalizar plantillas en proyectos Free nuevos con SMTP predeterminado; verificar esa condición antes de asumir que basta editar la plantilla:
https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier
https://supabase.com/docs/guides/auth/auth-email-passwordless

## Resultado comprobado del Preview

Código: 95e316083ba2a8c24f377de62dcbe779c15f51e6.
Deployment: dpl_HbjZywhZDCkYKoDLxH7v2WgvgbU3, READY, target Preview / codex-dev.
El cierre documental posterior no modifica código de aplicación.

- 313 tests aprobados / 0 fallidos (41 nuevos respecto de 272), lint sin errores ni advertencias, build aprobado y git diff --check correcto.
- Las cuatro regresiones Personales y total Said siguen siendo -600, -200, +800, -800; total -800. Ningún archivo del motor fue modificado.
- Node directo: las tres fuentes oficiales PDF responden 200. Desde Vercel: Parte 1 y Parte 2 reciben **HTTP403 de USGA**, observado mediante X-Rules-Source-Status: upstream-403; por eso el proxy devuelve 502. No es un fallo de Next Data Cache. No se intenta eludir ese rechazo; se conserva el fallback CORS interno.
- Visor real en navegador: Parte 1 = 410 páginas, Parte 2 = 172 páginas, Aclaraciones = 13 páginas. Los tres renderizan dentro de The Backyard. Cambio de página y regreso por botón/browser Back conservan la búsqueda cart path. Aclaraciones responde HTTP200 por proxy.
- Medidas DOM confirmadas 390×844 y 430×932. Capturas visuales de acceso, correo, configuración, modal histórico y PDFs; sin overflow horizontal del viewport en las pantallas revisadas. Inputs email de 16px. No se probó teclado nativo ni Safari/PWA físico.
- En Preview: Apple/Google dan Pendiente de configuración sin salir al JSON de Supabase. Correo inválido produce error humano sin enviar OTP. El paso de ocho dígitos se valida con mocks/estructura; la longitud de ocho fue confirmada además mediante una entrega física real de Supabase hosted.
- Invitado → Cuenta → Acceso → Invitado y recarga preservan la ronda QA de 9 hoyos y el histórico. H1 conserva 4/3/5/5; los demás hoyos siguen presentes. Se verificaron Foursome Live, resultados (-1450,-50,-850,+2350; suma cero), copia real a clipboard, abrir histórico, cancelar corrección y editar configuración sin modificar la tarjeta.
- Script público de solo lectura: flags cloud/Polla/social activos, Email habilitado y Google/Apple deshabilitados; endpoints cloud devuelven 401 sin JWT. No devuelve filas privadas a anon. polla_join_attempts y RPCs sensibles consultados responden 401/42501. No se declara por esto RLS entre usuarios autenticados.
- 12 chunks iniciales del navegador: URL del proyecto esperado, public key presente, cero candidatos de key privilegiada. No se imprimen claves ni tokens.
- IA muestra IA no configurada en este Preview (estado previo); no se cambia Vector Store ni se envía consulta a OpenAI.
- Pendiente humano: OTP real y E2E autenticado de perfil/consentimiento/sync, dos sesiones/dispositivos y fotos. La nueva tarjeta de estado cloud requiere esa sesión para su verificación visual autenticada. Dictado/AutoFill/teclado/Safari físico siguen pendientes.

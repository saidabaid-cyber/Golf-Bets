# Phase 2 — cierre de auditoría real, 17 septiembre 2026

> **EVIDENCIA HISTÓRICA — NO EJECUTAR COMO RUNBOOK.** Rama, URL, resultados y pasos pertenecen a un corte anterior. Usar [activación canónica](./PREVIEW_CONTROLLED_ACTIVATION.md) y [matriz de producto](./CANONICAL_PRODUCT_STATUS_2026-09-24.md) para el estado actual.

## Dictamen

**Phase 2 no tiene aprobación total.** Los flujos técnicos enumerados como PASS tienen evidencia delimitada abajo. Invitaciones de Grupos siguen incompletas; el historial compartido conservado no alimenta todavía los agregados personales del receptor. Auth físico, integraciones externas y decisiones legales no se convierten en PASS por compilar.

No se construyeron nuevas funcionalidades ni se rediseñó el producto. Se reprodujeron regresiones de búsqueda cercana sin coordenadas, `INSERT … RETURNING` de grupos y username desincronizado entre Perfil y Social. Home, proveedores/callbacks Auth, diseño de Perfil, motores de apuestas/HCP, settlements y el wizard no se modificaron.

## Identidad del entorno

- Rama exclusiva: `phase2/full-platform`.
- HEAD inicial local/remoto: `7166d80db7fac9b1471910bfbcef14917e11dbb0`.
- Preview de las pruebas completas: <https://historical-preview-url-retired.invalid>, READY, mismo HEAD.
- Alias QA de rama: <https://historical-preview-url-retired.invalid>.
- Supabase: `phase2-full-platform-qa`, ref `bymeopxkxapfizeeqeyb`, `ACTIVE_HEALTHY`.
- Los runners verificaron ref exacta, rama y bundle desplegado antes de crear usuarios sintéticos o borrar datos.
- No se utilizaron datos personales de Production. No se operó sobre `zhqmlpljloumldaczcfp`, main, beta ni dominios Production.
- El SHA y la URL inmutable del despliegue posterior a estas correcciones se entregan con la publicación final; no se atribuyen las pruebas anteriores a un despliegue distinto.

## Correcciones verificadas

### Coordenadas ausentes

En el Preview inicial, `GET /api/courses/search?nearby=1` respondía 200 porque `Number(null)` se convertía en cero. Ahora rechaza valores ausentes/vacíos/no numéricos/fuera de rango con 400 `invalid_location`; coordenadas explícitas 0,0 siguen siendo válidas. No se inventa ubicación ni se cambia el catálogo.

- Commit: `456af38`.
- Archivo: `app/api/courses/search/route.ts`.
- Diez pruebas ejecutan el handler real, comprueban respuesta y que no se consulte al proveedor con ubicación inválida.

### Owner de grupo durante INSERT RETURNING

Una petición PostgREST autenticada real fallaba con 42501 al insertar su propio grupo y solicitar la fila resultante. INSERT sin RETURNING y SELECT posterior sí funcionaban. La función STABLE de membresía veía el snapshot anterior al statement.

- Commit: `422c8a0`.
- Migración: `20260917070829_group_owner_returning_read.sql`.
- Único cambio: la policy SELECT permite `owner_id = auth.uid()` en la propia fila, o la membresía existente.
- Aplicada sólo a QA mediante Management API y registrada en ledger, versión `20260917070829`, nombre `group_owner_returning_read`; 28 → 29 entradas.
- No se reaplicaron migraciones fundacionales. No se ampliaron GRANTs ni permisos de escritura.
- PostgreSQL aislado reproduce primero el fallo y valida la reparación, miembros, extraños, falsificación del owner, anon/service-role y cuenta archivada.
- PostgREST QA real posterior: owner INSERT RETURNING PASS; B no lee ni actualiza el grupo privado de A; owner falsificado devuelve 42501; valor original intacto.

### Username de Perfil distinto del directorio Social

La prueba visual guardó un username nuevo y lo recuperó en Perfil, pero el readback descubrió que sólo había cambiado Auth metadata: `profiles.username` y `social_profiles.username` conservaban el bootstrap. La búsqueda Social y el autor de tarjetas consumen esas tablas, no el valor optimista del editor.

La reparación reutiliza el guardado versionado/CAS y la cola existente del perfil para incluir el username. La proyección Social afecta exclusivamente la fila existente del mismo propietario; no crea identidad ni altera privacidad. Un conflicto o fallo de esa proyección no se reconoce como sincronización exitosa. La lectura canónica del perfil prevalece sobre metadata antigua. No requiere migración ni nuevo endpoint.

- Commit: `dccbe584df526c7b4e1691426082d3bca9be1ec3`.
- Preview de repetición: <https://historical-preview-url-retired.invalid>, READY, ref QA confirmada en bundle y runners.
- 14/14 comprobaciones reales: ambas tablas/directorio, nuevo handle y ausencia del antiguo, Auth metadata antigua no revierte la lectura canónica, dos sesiones, retry, duplicado 23505, ownership y privacidad intacta.
- El primer runner no había optado por visibilidad social para su fixture nuevo y no encontraba el perfil privado. Se corrigió sólo el fixture usando el API de privacidad real; no se relajó RLS ni se ocultó un fallo de aplicación.
- Se repitieron en este mismo Preview los 7 checks de reset y los 14 de lifecycle: PASS, incluyendo shared history, Auth delete y JWT antiguo rechazado.
- Búsqueda cercana corregida comprobada por HTTP: ausente/vacía/fuera de rango → 400; coordenadas reales explícitas → 200. Sin regresión de búsqueda manual.
- UI autenticada posterior: guardar nuevo username → reload → perfil y Social coinciden, aunque Auth metadata siga antigua. Avatar manual y México/Puebla intactos; 393px sin overflow. Cuenta QA eliminada después.
- Protección complementaria: una edición sólo de avatar no envía el username de una sesión antigua. Conserva un rename explícito ya pendiente; prueba de regresión con estado remoto renombrado y cache obsoleta. No cambia el editor visual.

## Matriz definitiva de lo comprobado

| Área / requisito | Estado | Evidencia y alcance |
| --- | --- | --- |
| Preview → Supabase QA; aislamiento de las pruebas | PASS | Guard exacto en runners; config/bundle y branch identity verificados. |
| Google: configuración y canje servidor PKCE | PASS | Callback QA correcto; logs posteriores al error antiguo registran callback 302 y `/token` PKCE 200 a 05:40:43Z y 05:53:57Z el 17/09. |
| Google completo: selección → Home → logout → Google, owner | PENDING_INTERACTIVE_QA | El éxito del canje servidor no prueba por sí solo la pantalla final del owner. No se vuelve a solicitar callback ni secreto ya configurados. |
| Email OTP: entrega al buzón y login completo del owner | PENDING_INTERACTIVE_QA | SMTP QA Resend: host/465/sender/credencial presente y template OTP verificados. `/otp` 200 no demuestra entrega al buzón. No se sustituye esta prueba por login password o token administrativo. |
| Sesiones sintéticas, logout/login, cambio de cuenta y dedupe | PASS | Dos cuentas Auth reales; clientes nuevos y re-login; perfil único, carreras sin sobrescritura, aislamiento de cuenta y ausencia de enumeración pública. |
| Safari/iPhone físico, remember session y teclado nativo | PENDING_DEVICE_QA | Chromium a 390/430 no equivale a Safari físico. |
| Account delete vacío / con datos / Auth / sesión antigua | PASS | 14 checks API y flujo UI real: confirmación, cancelación, doble toque → una petición, Auth eliminado, vuelta al acceso, JWT antiguo rechazado. |
| Limpieza de Storage y PII exclusivos | PASS | Objetos QA privados desaparecen tras delete; perfil/rounds exclusivos eliminados, identidad compartida anonimizada. |
| Retry / idempotencia / cuenta ajena | PASS | Replay durable, recovery proof y rechazo de userId arbitrario verificados contra endpoints reales. |
| Archive técnico | PASS | Datos preservados; login y JWT antiguo bloqueados. Se conserva sólo fixture sintético archivado deliberado. |
| Retención, recuperación y copy de archive/delete | LEGAL_REVIEW_REQUIRED | No se promete retención indefinida ni eliminación jurídica absoluta. |
| Reset vacío e idempotente | PASS | API real sobre cuenta sin estadísticas; watermark persistido sin error. |
| Reset con datos, reload y sesiones nuevas | PASS | Siete checks DB/API; UI real queda en cero tras reset/reload, historial intacto. Ronda posterior vuelve a alimentar Stats. |
| Reset/delete A no destruyen ronda compartida de B | PASS | Readback con B/fresh login, scores compartidos conservados; A anonimizado. Grupo compartido sobrevive con owner NULL y acceso B. |
| RLS A ↔ B | PASS | Requests HTTP reales sobre perfil, equipment, grupos, consents, privacidad, rondas; escritura/lectura privada ajena rechazadas en ambas direcciones. No equivale a pentest exhaustivo. |
| Perfil, México → Puebla, preferencias y privacidad cloud | PASS | `MX`/`MX-PUE`, display name y preferencias leídos desde servidor por cliente nuevo y tras logout/login. |
| Username canónico / directorio / sesiones nuevas | PASS | 14 checks reales posteriores a la corrección; Auth metadata vieja no sustituye la fuente canónica, duplicado no sobrescribe otra identidad. |
| Avatar manual guardado / reload / readback cloud | PASS | UI real: piel morena y pelo rizado; la configuración `custom_avatar` y el preview sobreviven reload. No se atribuye a esta prueba una nueva validación exhaustiva de formatos de foto. |
| Backyard Index activación/persistencia | PASS | `BACKYARD` + enabled persistidos/readback/re-login, sin cambiar el motor progresivo. |
| Equipment / bolas / varillas / fitting / snapshots cloud | PASS | 16 checks adicionales reales: CRUD, nueva sesión, Ball Fit del catálogo real (71/71 candidatos), snapshot histórico inmutable tras editar/eliminar equipo. No se afirma medición física de launch monitor. |
| Mi Bolsa: páginas completas / agregar otro / editar / eliminar | PASS | UI autenticada real: Driver, éxito, Agregar otro, Wedge, editar Grip/Notas, reload, cancelar y confirmar delete. API confirma edición y conservación del otro club; 390/430 sin overflow ni errores JS. |
| GHIN oficial | BLOCKED_EXTERNAL | No existe integración autorizada operativa. No se simula GHIN. |
| Amigos, solicitudes, Public/Friends, bloqueo recíproco y PII | PASS | API real de directorio mínimo, friendship permissions, block, privacidad de identidad y datos privados. |
| Grupos como presets / miembros / apuestas / snapshot | PASS | 20 checks: 8 miembros, parejas Match y tres animales; edición sólo ronda vs grupo, cloud fresh session, snapshot histórico inmutable y RLS. Selección 4/5/6 combina dominio real con wizard browser, no se presenta como una llamada servidor distinta. |
| Invitaciones de Grupos en UI | FAIL | `group-builder.tsx` conserva sección pendiente sin flujo relacional conectado. Su mensaje de DB pendiente es obsoleto: la DB QA ya existe. Terminar el flujo sería implementación pendiente, no una migración ausente. |
| Likes/comments/notifications/attest | PASS | 35 checks server/cloud: like único/toggle, comentario propio/no ajeno, preferencias, participante real, no self, no outsider, no duplicate, hash stale ante score material. Like/comment/avatar no invalidan. |
| Logros y Personal Best | PASS | Primera tarjeta sintética 71 no declara récord; baseline revisada 72 y nueva 69 producen una sola tarjeta resumen con récord. Evidencia del API, no de una ronda humana real. |
| Evento automático de campo distinto al Home Club | FAIL | `shareCourses` gobierna la visibilidad del campo en tarjetas, pero no acredita un evento `NEW_COURSE_PLAYED` comparado contra Home Club canónico. No se construyó ese flujo pendiente durante el cierre. |
| Courses: búsqueda/manual/catalog/provider abstraction | PASS | API Preview real La Vista/El Cristo/Puebla y búsqueda inexistente; selección conservada en wizard. No se inventan tees elegibles. |
| Rating/Slope local verificado | PASS | Dos tees de El Cristo elegibles para índice local; La Vista continúa no elegible. No es catálogo Puebla completo ni certificación GHIN. |
| Cobertura nearby ordenada por distancia y GPS real | BLOCKED_EXTERNAL | La consulta válida actual devuelve cero cursos geolocalizados; no hay geometría/distancias reales para demostrar cobertura. Permiso denegado conserva búsqueda manual y GPS muestra carencia explícita. |
| Wizard pasos 1–4, resumen, editar, draft, sin apuestas | PASS | Preview mismo SHA a 390/430: navegación conserva inputs, preflight accionable, 5 jugadores, presets readback, reload y doble start crean una sola ronda. |
| GameScreen captura/hoyo/jugador/reload/resume/finish/history | PASS | 18 checks UI en Preview, fixture guest explícito: score/putts/tee/eventos/notas, cambiar/regresar, guardar, terminar y snapshot histórico único tras reload. Cloud se demuestra separadamente por runners autenticados. |
| Personales separados, gastos, balances y resultados históricos propios | PASS | UI real: 3,200 apuestas, 350 gastos, neto 2,850; balances de participantes + externo suman cero. Match H10 conserva presión H12×4 y eventos animales. |
| Ronda compartida recibida → agregados personales Stats/Index/Balances | FAIL | Se conserva el detalle histórico legítimo, pero el código excluye deliberadamente `shared` de agregados personales. No se declara esta atribución/dedupe como implementada. |
| Motores determinísticos / handicap / presión | PASS | Suite completa ejecutada, fixtures de motores y regresiones. No cambió código de motores. La prueba de todas las combinaciones matemáticas es de motor, no se afirma recorrido UI exhaustivo de cada modalidad. |
| Consentimientos técnicos | PASS | Versionados server-side, aceptar/declinar/revocar/reautorizar, nuevo cliente, onboarding obsoleto no reautoriza; rechazo IA no bloquea cuenta. |
| Consentimientos: clasificación jurídica y textos definitivos | LEGAL_REVIEW_REQUIRED | PASS técnico no constituye aprobación legal. |
| Home / ramas y servicios protegidos | PASS | Ningún cambio visual en Home o Perfil, ni cambios en proveedores/callbacks Auth, main, beta o Production durante este cierre. |

## Auditoría de DB, no rediseño

Consulta de metadatos y advisories de la rama QA real:

- 101 tablas public, todas con RLS; 159 foreign keys.
- Cero índices inválidos y cero perfiles duplicados en las comprobaciones.
- Cero huérfanos comprobados: profile/Auth, equipment/Auth, round-owner/Auth, participant/round y score/participant.
- Una constraint NOT VALID preexistente para provenance legacy; cero filas QA incompatibles. No se reescribió por estética.
- Dominios revisados: identidad/perfil/golf, equipment, social, courses, rounds/snapshots, juegos/settlement, AI/consents, memberships y auditoría/lifecycle. No bases físicas nuevas.
- Advisors: 36 FKs sin índice de cobertura, 13 avisos de policies permisivas múltiples y 56 índices sin uso. No son prueba automática de una vulnerabilidad o cuello de botella; no se creó DDL masivo sin una consulta problemática demostrada.
- Guards SECURITY DEFINER y tablas privadas lifecycle conservan permisos mínimos; no se concedió acceso general a anon o service_role.
- Leaked password protection deshabilitado: hardening pendiente, no causa demostrada del error Google/OTP.

## Auth: hechos, no inferencias de entrega

Callback Google QA: `https://bymeopxkxapfizeeqeyb.supabase.co/auth/v1/callback`.

Site URL QA estable: alias de la rama arriba. Se añadió el callback exacto del Preview auditado a la allow-list QA: cambiar de origen al volver rompe el contexto PKCE. No se modificó Google Cloud, SMTP password ni variables Production. El despliegue final requiere igualmente su URL exacta permitida o el alias estable.

Logs antiguos mostraban `invalid_client`; después existen canjes PKCE 200. No se pide volver a corregir una causa anterior ya superada. También existen `/otp` 422 `Signups not allowed for otp` al solicitar login sin cuenta en QA: no demuestra que Resend rechace su key. QA no contiene automáticamente las cuentas de Production.

Para cerrar Auth físico se necesita login real del owner en este entorno, logout y segundo login por ambos métodos. No se publican emails, OTPs, tokens, IPs o contraseñas en este informe.

## Validación automatizada

- Full suite: **1,892/1,892 PASS**, cero fallos, omitidos o TODO.
- ESLint: **PASS**, exit 0.
- Next build / TypeScript: **PASS**, exit 0.
- Motores incluidos: Conejos, Skins, animales y empates, Monkey, Chicago/Las Vegas, Bola amiga, Loba, Nassau, Dollar a stroke, personales/manuales; HCP/base/80%/presiones/H10 y snapshots existentes dentro de la suite.
- QA browser: 390×844 y 430×932 sobre Preview real; no overflow horizontal ni errores JS en recorridos registrados. Scroll normal sigue siendo necesario; controles se comprobaron después de llevarlos a viewport.
- No se afirma prueba física Safari, proveedor GHIN ni entrega de email por haber pasado Node/Chromium.

## Registro de evidencia reproducible

Artefactos locales ignorados deliberadamente por Git; los privados no deben publicarse. Los reportes sanitizados identifican ambiente, escenario y resultado:

| Evidencia | Reporte / runner |
| --- | --- |
| Perfil/cloud 22, social 35, grupos 20 | `.qa-artifacts/hard-closeout-cloud-social-groups-77.json` |
| Equipment / fitting 16 | `.qa-artifacts/hard-closeout-equipment-fitting-api.json`; run `5b700c46-ad12-4e2e-ba25-04e49e872fe8` |
| Account API 14 | `.qa-artifacts/hard-closeout-account-api.jsonl`; `scripts/qa-preview-account-lifecycle.mjs` |
| Stats API 7 | `.qa-artifacts/hard-closeout-stats-api.jsonl`; `scripts/qa-preview-statistics.mjs` |
| Groups RETURNING real | `.qa-artifacts/hard-closeout-groups-verified.jsonl` |
| Aplicación exacta de policy | `.qa-artifacts/group-owner-returning-apply.json` |
| Metadatos / advisories | `.qa-artifacts/phase2-foundation-audit.json`, `phase2-security-advisors.json`, `phase2-performance-advisors.json` |
| Juego 18 checks UI | `.qa-artifacts/closeout-game-report.json` |
| Avatar y México/Puebla UI/cloud | `.qa-artifacts/hard-profile-readback.json`, `hard-profile-reloaded-393.png` |
| Mi Bolsa UI autenticada | `.qa-artifacts/closeout-bag-report.json` |
| Username real posterior al fix | `.qa-artifacts/hard-closeout-username-cloud-api.json`; run `a796901d-d330-4115-bffe-1c1e1e8e68b6` |
| Username UI posterior al fix | `.qa-artifacts/hard-profile-final-readback.json`, `hard-profile-username-final-393.png` |
| Reset/lifecycle repetidos tras publicar | `.qa-artifacts/closeout-published-stats.jsonl`, `closeout-published-account.jsonl` |
| Ref QA y nearby corregido desplegado | `.qa-artifacts/closeout-deployed-smoke.json` |
| Wizard 390/430, mismo SHA inicial | `.qa-artifacts/wizard-preview-390-report.json`, `wizard430-preview-report.json` |
| Courses/catalog HTTP | `.qa-artifacts/hard-closeout-public.json` |
| Auth sanitizado | `.qa-artifacts/hard-closeout-auth-sanitized.json` |
| Full tests/lint/build | `.qa-artifacts/phase2-hard-closeout-{tests,lint,build}.log` |

Los 77 checks usaron runs `4bc0fc9b-9db3-4490-a806-da9c1131d4b2`, `f7e9c32e-4002-4b4b-b0e0-6aa4ade7148b` y `d9304138-0e5b-4317-b657-153b039af836`. Stats: `b195505a-6277-44e2-88cf-36bc15925e38`; lifecycle: `4f31f752-2e05-4b48-86ba-3c5c66e6114e`. Usuarios sintéticos eliminados mediante lifecycle; archive conserva su fixture de forma intencional. Snapshots ya anonimizados pueden permanecer por el contrato de historial compartido; no se borró indiscriminadamente la DB para limpiar QA.

## Qué todavía requiere intervención / decisión

1. Owner: probar ambos logins en Preview/alias QA y confirmar Home → logout → login. Si no existe cuenta en la DB QA aislada, usar Crear cuenta primero; no se copian cuentas Production.
2. iPhone/Safari físico: teclado, safe-area, restauración de sesión y navegación de cuenta/juego.
3. Revisión legal: textos/obligatoriedad de consentimientos, retención, archive y recuperación.
4. Integraciones de negocio: GHIN y cobertura comercial/global de campos/geometría. No hace falta permiso adicional para las pruebas QA ya ejecutadas.
5. Brechas de producto existentes: invitaciones de Grupos, atribución de agregados de historial compartido y evento de campo distinto al Home Club. No se amplió este cierre con nuevas implementaciones para ocultarlas.

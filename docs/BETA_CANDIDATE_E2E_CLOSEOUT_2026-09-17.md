# The Backyard — Beta Candidate E2E — 17 septiembre 2026

## Veredicto: FAIL para una beta completa sin restricciones

**Todavía no está cerrado todo el recorrido solicitado para abrir una beta general.** El núcleo manual tiene evidencia real de funcionamiento en Preview y Supabase QA: captura 9/18H, persistencia, grupos/plantillas, equipo/fitting, histórico compartido, atribución personal, reset y eliminación completa de cuenta. Permanecen el envío de invitaciones de grupos sin proveedor configurado, un rechazo real del proveedor de configuración AI y validaciones interactivas/dispositivo. No se presenta ninguno como PASS.

No se incorporaron productos nuevos ni se promovió Production. Los cambios son correcciones del corrido y tests. Las sesiones automatizadas se crearon con identidades sintéticas `@example.invalid`: **no demuestran recepción de OTP ni una selección interactiva de Google**. La confirmación previa del owner de que Google/Hotmail/Yahoo funcionan se conserva como antecedente, no se sustituye por una nueva certificación.

## Identidad y congelamiento

| Dato | Valor comprobado |
| --- | --- |
| Rama única | `phase2/full-platform` |
| HEAD inicial real remoto/local | `a32af85f27496337a4a108d134dcdf331191a27b` — posterior al `5574b002` de referencia; working tree inicial limpio |
| Preview inicial inmutable | `https://golf-bets-8zlxqr1f3-saha8.vercel.app` — READY, mismo SHA inicial |
| HEAD final de aplicación probado | `f7a70d49f5b5716bf575f3fb584cc23542b5a320` |
| Preview final de aplicación | **https://golf-bets-48oule36w-saha8.vercel.app** — READY, metadato Git igual al SHA anterior |
| Alias de branch | `https://golf-bets-git-phase2-full-platform-saha8.vercel.app` — mutable, no se usa como evidencia inmutable |
| Supabase | `phase2-full-platform-qa`, ref **`bymeopxkxapfizeeqeyb`** |
| Binding comprobado | Bundle servido: 20 assets; URL QA exacta; clave pública presente; cero secretos detectados. Requests autenticadas y comprobación de issuer JWT también QA. |
| Prohibidos | Sin operaciones sobre main/beta/Production, DB shared, DNS/custom domains ni variables Production. Sin cambio de secretos. |

La revisión documental que contiene este archivo no cambia la aplicación. Su SHA puede obtenerse con `git log -1 --format=%H -- docs/BETA_CANDIDATE_E2E_CLOSEOUT_2026-09-17.md`; el SHA/URL de esa publicación documental se entregan aparte. No se inventa un SHA autorreferencial dentro del propio commit.

Flags leídos en runtime del Preview final: Auth email/Google, cloud y equipment cloud activos; Apple y polla live inactivos. Phase2 activos: social_v2, groups_v2, course_search, gps_v1, shot_tracking_v1, live_rounds, live_leaderboard, notifications_v1, membership_ui, advanced_stats_v2, ai_insights, equipment_v2, admin_v1. Inactivos: score_export, push_notifications, wearable_v1, rangefinder_v1, ghin_integration. **Un flag activo no prueba que exista proveedor externo**. `score_export=false` no elimina los botones de exportación legacy de Histórico; su descarga no quedó certificada.

## Matriz de comportamiento

Cada PASS está acotado a la evidencia indicada. HTTP autenticado contra Preview/DB no equivale a un tap físico en Safari; tests deterministas no equivalen a recorrer todas las modalidades en móvil.

| Área | Estado | Qué se ejecutó | Evidencia | Fix realizado | Pendiente |
| --- | --- | --- | --- | --- | --- |
| Entorno/aislamiento | PASS | Guards ref, bundle, issuer, branch y metadatos READY | Smoke final + guard antes de delete UI | Sólo dos migraciones aditivas QA | Ninguna intervención en Production |
| Auth restauración/dedupe/cambio de usuario | PASS | Login sintético verificado, nuevo contexto, ownership UUID, no perfiles duplicados, datos A/B aislados, vieja sesión eliminada denegada | Profile cloud 22; account 14; UI final vieja sesión 401 | No se alteró OAuth/SMTP | No equivale a entrega OTP |
| Email OTP nuevo/existente/sin cuenta | PENDING_INTERACTIVE_QA | Configuración runtime email=true, signup habilitado, no autoconfirm; flujos sintéticos y regresiones | `/auth/v1/settings` QA 200; suite de Auth | Configuración preservada | Recepción/introducción de OTP y modal sin cuenta con destinatario autorizado en este SHA |
| Google completo | PENDING_INTERACTIVE_QA | Provider runtime habilitado; sesión posterior controlada; callback QA conservado | Antecedente owner positivo, no nueva selección Google en este corrido | Ninguno | Elegir cuenta Google y completar retorno en dispositivo del owner |
| Consentimiento y acceso | PASS | Alta con checks no premarcados; declinar; autorización textual desde Privacidad/IA; readback; revocar; petición con consentimiento revocado 403; uso manual disponible | UI B; profile cloud; AI provider runner | Sin consentimiento no se envía contenido | Wording sujeto a revisión legal |
| Onboarding/perfil/ubicación | PASS | Nombre/apellido/username, MX→Puebla, emoji 😎, guardar, reload/nueva sesión, cambio nombre reflejado en Social | Profile cloud 22 + UI B | Proyección del nombre guardado a identidad social existente | Otros datos opcionales no completados no se certifican individualmente |
| Porcentaje de perfil | PASS | 43→100 con respuestas reales/No aplica/sin HCP, sin GHIN; readback servidor y nuevo contexto, 390/430 sin overflow | Social-play 20 + UI 100% | QR/progreso responsive conservado | No exige índice calculado ni consentimientos opcionales |
| Foto de iPhone/avatar manual exhaustivo | PENDING_DEVICE_QA | Avatar emoji sí probado; no se declara una nueva prueba física de foto, HEIC o todos los rasgos manuales | Evidencia acotada al emoji | Ninguno | Foto real >5MB, teclado y builder físico |
| GHIN | BLOCKED_EXTERNAL | Placeholder visible, no operativo, flag false | UI Índice + flags | Ninguno | Integración oficial autorizada |
| Backyard Index | PASS | Activación/readback/nueva sesión; 0–2 sin índice; confirmed shared B guarda differential propio; no datos tee inventados; reset respetado | Profile cloud; shared 17; motor progresivo en 1,998 tests | Append verificado de evidencia congelada B, sin modificar motor progresivo | Rating/slope sintéticos de test no certifican un tee real |
| Social + / Mi QR | PASS | Tres opciones; QR real, @username/avatar, identidad UUID estable, búsqueda y perfil destino | UI 390; social-play 20 | `minmax(0,1fr)`/min-width/wrapping para username largo | Compartir imagen nativa separado |
| QR desde galería | PASS | PNG sintético válido de amigo, propio e inválido; abre perfil; ya amigos no duplica ni autoacepta | UI galerías synthetic QR | Sin nueva lógica de amistad | Ninguna foto privada usada |
| Cámara QR / compartir QR / guardar imagen | PENDING_DEVICE_QA | Fallback al negar/no disponer cámara visible; canvas QR renderizado | UI cámara no disponible → galería | Sin permisos anticipados | Cámara real, Web Share y guardado iOS |
| Amistades/permisos | PASS | Solicitud/aceptación, dedupe, bloqueo, visibilidad, búsqueda y readback con dos usuarios | Social-play 20; social 35; profile cloud | Ninguno fuera de los fixes compartidos | Recorrido físico de todas las variantes cancelar/rechazar pendiente interactivo |
| Grupos y miembros canónicos | PASS | Crear, buscar cuenta, aceptar por token seguro con identidad verificada, incorrecto rechazado, reload/nueva sesión, privacidad y canonical accountUserId | Group runner 23; grupo UI `Beta QA móvil 17 Sep` | Ninguna conversión de cuenta B en invitado | Token HTTP no demuestra recepción de correo |
| Invitación grupal por correo | BLOCKED_EXTERNAL | Intento UI y API devuelve envío no disponible; retry no duplica; no afirma enviado | 503 `/api/groups/invitations`; `emailDeliveryConfigured=false` | Estado real conservado | Configurar mailer separado de Auth, ver acciones owner |
| Plantillas/apuestas habituales | PASS | Grupo 9H salida10; Skins $75,80%,carry; editar participantes; invalidación accionable; cargar y editar sólo ronda; plantilla intacta | Group runner 23 + UI grupo→wizard→resultado +75/−75 | Preservación de snapshots, no motor paralelo | Todas las combinaciones de todas las apuestas requieren matriz adicional de producto |
| Equipment/cloud/varillas | PASS | Alta Driver catálogo Titleist GT2; Fujikura VENTUS Blue VeloCore+ S60; añadir Wedge manual; editar grip; cancelar y confirmar delete; catálogo actual/histórico; nueva sesión | UI430 + equipment lifecycle16 + equipment/ballfit16 | Ningún modelo/spec inventado | No se certifican imágenes licenciadas ausentes |
| Bolas/fitting guardado/snapshots | PASS | Bola actual/cambio, catálogo paginado completo, fitting readback, refit y delete resultado sin perder bolsa, snapshot de varilla inmutable | Equipment lifecycle16 | Runners con guard real Preview/QA | Recorrido visual individual de cada tipo de bastón/bola no se confunde con cobertura API |
| Ball Fit | PASS | Seis pasos; HCP manual10, score82, driver245 y velocidad desconocida independientes; scroll arriba; Top3; guardar y recargar | UI + API16: universo71 modelos; Snell PR3 98, ZStarDiamond93, ProV1 2025 93 | Se verifica el input/persistencia existentes, sin alterar HCP perfil | No es validación física launch monitor |
| Tres entradas Jugar | PASS | Configurar / sin apuestas / total visibles directamente; borrador no iniciado permite volver a las opciones y continuar configuración | UI último Preview; 1c631e2 | No presentar draft como ronda activa en Home | Hero/layout Home intactos |
| Wizard | PASS | Campo→jugadores→grupales→personales→resumen; back/edit; invalidez de Skins con un solo participante bloquea; HCP0; names largos; datos conservados | UI9Hgrupo + suite de draft/creación | No reescritura de motores | No se afirma exhaustividad de cada modal/modalidad |
| Ronda completa 9H y double submit | PASS | Dos jugadores, salida10; cada score y putt guardado; doble iniciar crea una ronda; finalizar36/37; Skins zero-sum75 | Ronda QA local `lfbizip5`; cloud nueve filas; guardado ACK | Mensaje de cloud sólo tras ACK real | Ninguno para ese escenario |
| Ronda sin apuestas 18H/offline | PASS | Score-only18H; hoyo2 offline editado, reconexión; reload/resume;73; no bets; draft cerrado al terminar | Ronda QA `wlkb1qa7`,18 scores, mode score_only persistido | Se conservó autosave existente | Suspensión real iOS/PWA pendiente |
| Total Score y completar después | PASS | 18H84 sin filas inventadas; guardar una vez; histórico “sólo total”; completar18 scores sobre mismo UUID; comprobar total84; putts no inventados | UI UUID `fb7cab18-7bac-430a-8c8e-8326ba61aeb7`; histórico4 antes/después | Sin histórico paralelo | 9H total36 probado también por social-play20 |
| Game Screen | PASS | Cambiar jugador/hoyo, editar antes de guardar, volver; preflight detecta edits pendientes; guardar y siguiente; reload/nuevo contexto; 9/18H; HCP0 | UI rondas anteriores | No pérdida de edits ni doble creación en recorridos observados | Teclado Safari físico pendiente |
| Motores deterministas/handicap/presiones | PASS | Suite completa de cálculos: mismas entradas/resultados; salida10, handicaps, presiones; Skins real UI/DB zero-sum | 1,998/1,998 + liquidación UI75/−75 | Ninguna fórmula de engine/settlement cambiada | PASS de cálculo, no cobertura móvil completa de cada modalidad |
| Todas las modalidades/modales en UI | PENDING_INTERACTIVE_QA | Muestra real Skins y grupo; suite de Nassau/Foursome/Conejos/animales/etc | Cobertura acotada anterior | Ninguno | Recorrer cada modalidad personal/manual/suplementaria y cada multiplicador en UI |
| Resultados/histórico/guardado | PASS | Resultados, neto, histórico, reload, cloud ACK; 9H no contaminan promedio18H | UI y readback | Copy guardada/sincronizada espera ACK | Archivos exportados separado |
| Compartir externo vs interno | PASS | “Compartir resultado” conserva Web Share; “Compartir con jugadores” visible y usa confirmación canónica | UI/histórico + APIs A/B | Panel reutiliza Social/round links sin términos DB en UX | Descarga/share nativo no certificado |
| Exportar PDF/CSV/imagen | PENDING_INTERACTIVE_QA | Se intentaron botones reales; automatización de descarga devolvió `Download was canceled`; no se obtuvo archivo final verificable | Sesión automatizada de exports; no supuesto PASS | No parche arbitrario ante limitación no atribuida | Guardar/abrir tres archivos y compartir externamente en navegador/dispositivo |
| Shared: confirmación/atestación/read-only | PASS | B sin confirmar excluido; externo403; B confirma; lectura compartida; atesta inmediatamente; nuevo contexto; no edit autorizado | Shared17 + social35 | SELECT RLS SELF_CONFIRMED; reconcile revision antes de attest | No self ni amistad sola permiten attest |
| Shared: Stats/Index/balances B | PASS | A72/B90; B promedio90 no72; balance−100 una vez; gasto de A no atribuido; differential18 congelado; dedup propietario/shared | Shared17, tests explícitos A/B | `participant-history`, proyección personal temporal; snapshot canónico intacto; RPC append CAS | Datos de tee de fixture son sintéticos |
| Shared: reset y delete | PASS | B reset excluye rendimiento anterior sin borrar histórico/A; A delete preserva ronda confirmada B; UI B delete preserva ronda A | Shared17 + UI delete final + account14 | Anonimización y atribución compatibles con lifecycle | Retención definitiva legal pendiente |
| Social feed/likes/comments/notifs/attest | PASS | Like/unlike/dedupe; comentario propio/edit/delete y ajeno denegado; notifs preferencias/owner; stale por cambio material no por like/comment; una tarjeta/logros | Social35, cleanup tres usuarios sintéticos completo | Revisión reconciliada tras confirmación/Index | Push externo no activo |
| Privacidad | PASS | Public/Friends; sharing off; bloqueo; email no listado; no acceso PII/propiedades ajenas; nuevas sesiones | Profile22, social35, RLS9 | No ampliación pública | Decisiones jurídicas separadas |
| NEW_COURSE_PLAYED | PASS | Primer campo canónico distinto HomeClub, ronda completa; no repetir; shareCourses off oculta; HomeClub no evento | Course-event5 real Preview/DB | Evento estructurado dentro de un único resumen, no spam | Sin course/club ID o HomeClub conocido no se fabrica evento |
| Stats/cohortes/tendencias | PASS | Separación9/18; total sin hoyos no inventa GIR/putts; reset→0; nueva18H84 vuelve a alimentar; shared correcto; histórico/balance permanecen | UI promedio84/1×18H; stats7; shared17 | Etiqueta promedio usa cohorte comparable; balance Home usa ledger histórico, no stats filtradas | Métricas no capturadas no se inventan |
| AI readiness/insights/live/scorecard/revoke | PASS | Requests reales con consentimiento sintético explícito; insights200; live200 con dinero indeterminado; canvas9H36 leído; revocar403 | `qa-beta-ai-provider.mjs` | Ningún LLM calcula dinero final | No prueba precisión universal ni fotografía física |
| AI round setup remoto | FAIL | Mismo prompt real retorna502 `canonical_integrity`; guard rechaza transformación no equivalente; no start silencioso | 48oule runtime y UI; runner provider | Fallback local: “hoyo10” y “sin presiones” corregidos y repetidos; no relajar guard | Proveedor debe conservar hechos; configuración compleja requiere edición manual mientras tanto |
| AI reglas | BLOCKED_EXTERNAL | Readiness configured=true pero enabled=false | Endpoint readiness | No se activó flag fuera de scope | Habilitación operativa autorizada si se quiere incluir en beta |
| Courses/proveedores | BLOCKED_EXTERNAL | Búsqueda/catálogo canónico utilizados en rondas; no se inventaron Rating/Slope; abstracción existente | UI LaVista y tests de elegibilidad | Ningún dato comercial nuevo | Cobertura global/GolfAPI/licencia/geometría/tees verificables no completa |
| RLS/DB foundation | PASS | Nueve archivos SQL contra QA real, transacciones rollback; 102 tablas/160FK, constraints válidas, sin duplicados perfil/huérfanos detectados | Resumen DB RLS; profile22/shared17/lifecycle14 | Tests pgTAP no ejecutables reemplazados por comprobaciones SQL reales; no grants amplios | Advisor de índices informativo, sin migraciones especulativas |
| PWA/offline lógico | PASS | Manifest/SW/offline assets; ronda iniciada online→offline edit→online/reload conserva nuevo score y score_only; tests old ACK | UI18H + suite sync | No cambios de SW/ACK por especulación | Instalación/suspensión física separado |
| iPhone/Safari/PWA físico | PENDING_DEVICE_QA | Automatización Chromium viewport390/430; no teléfono conectado | Screenshots y mediciones DOM | QR overflow corregido | Cámara, teclado/barras, instalar/cerrar PWA y volver, Web Share |
| Reset desde interfaz | PASS | Cancelar; ELIMINAR; doble tap una petición; modal cierra; éxito; UI0; reload/nueva sesión0; nueva ronda alimenta | UI390; final stats7 de nuevo en48oule | Balance histórico no se pierde al reset | Cuenta/equipo/grupo preservados |
| Delete desde interfaz/servidor/Auth | PASS | Cancelar conserva sesión; elección eliminar+ELIMINAR; doble tap1request; vuelve al acceso; Auth ausente; token viejo401; perfil/equipo/consent/prefs/Storage0 | `ui-account-delete.json`; screenshot390 | No cambios al flujo ya sano | Destrucción sólo de QA desechable |
| Archive/retry/idempotencia | PASS | Account runner14: archive recuperable, Auth ban, stale JWT denegado, replay seguro; delete retry con proof; token ajeno rechazado | `beta-account-final.jsonl` | Ninguno adicional | Política/plazos legales no aprobados |
| Legal/consent/retención | LEGAL_REVIEW_REQUIRED | Copy temporal claramente identificado; técnica no equivale a aprobación jurídica | Modal delete y consentimientos versionados | No se inventó aprobación | Revisión profesional de textos/plazos/recuperación |
| Runtime/estabilidad observada | PASS | Repetidos Home/Perfil/Social/Grupos/wizard/fitting; grupo creado/configurado; scores guardados; sin unhandled client errors en sesión final | Browser `errors` vacío; logs acotados por deployment | QR y draft/state/copy corregidos | No significa cero fallos en todo dispositivo ni cero5xx: los fallos concretos están arriba |

## Quality gate y pruebas reales

Comandos del script `npm test` ejecutados completos (`tsc -p tsconfig.test.json` y `node --test .test-dist/tests/*.test.js`): **1,998 PASS, 0 FAIL, 0 skipped**. TypeScript `tsc --noEmit`: exit0. ESLint: exit0. Next production build: exit0. Logs locales `beta-final-tests.log`, `beta-final-types.log`, `beta-final-lint.log`, `beta-final-build.log` bajo `.qa-artifacts/`. No son sustitutos de las pruebas UI/HTTP/DB descritas arriba.

| Runner real | Resultado | Run/evidencia local |
| --- | --- | --- |
| Profile/cloud | 22 PASS | `a191f275-9acf-44d9-9650-a3ad4ba0ef6c`, beta-profile-final.jsonl |
| Statistics final48oule | 7 PASS | `5f0cce6e-cb2b-414f-8236-392eb406560e`, beta-stats-release-final.jsonl; cleanup completo |
| Account lifecycle | 14 PASS | `d701f69e-d638-42ae-9854-3f57bccede07`, beta-account-final.jsonl |
| Group mechanics | 23 PASS | `6ac45f21-bff4-430a-85b8-d589de9d60eb`, beta-groups-final.jsonl; **envío de email no configurado** |
| Social/play/progress | 20 PASS | `d312d7ca-2d89-44e3-9996-93792538397d`, beta-social-play-final.jsonl |
| Equipment lifecycle | 16 PASS | `aa87b730-7904-4b17-a166-3f8eaea8ced7`, beta-equipment-lifecycle-final.jsonl |
| Equipment/Ball Fit | 16 PASS | beta-equipment.jsonl; campos82/245/unknown + catálogo real |
| Confirmed shared A/B/C | 17 PASS | `f5a75838-48cc-4135-9451-4609f6c82e8c`, beta-shared-final.jsonl |
| Social persistence/security | 35 PASS | `b386c6aa-b02e-4ad3-afca-7c0d9afd530e`, beta-social-repeat.jsonl; tres cuentas removidas |
| New course event | 5 PASS | beta-course-event.json; primer/no-repeat/HomeClub/privacy |
| AI provider | 4readiness200; revoked403; insights/live/scorecard200; setup502 | beta-ai-provider.json; no se transforma este resultado mixto en PASS global |
| RLS real | 9/9 archivos PASS | equipment_ball_fitting, golf_profile_course_architecture, ai_processing_consents, phase2_social_groups, course_handicap, live_rounds, shots_analytics, statistics_reset, multiuser_authorization |
| UI delete final48oule | PASS | Ver [evidencia servidor](evidence/beta-2026-09-17/ui-account-delete.json) |

Los runners anteriores abarcan revisiones incrementales de este mismo corrido. Profile/group/social/shared fueron repetidos en2km; después se cambiaron únicamente etiqueta de promedio, selección de balance Home, navegación de draft y parser AI. Esos cambios se repitieron específicamente en UI, más gate completo, smoke y reset en48oule. **No se afirma que cada runner haya sido ejecutado nuevamente en cada commit.** Los SQL RLS se repitieron tras ambas migraciones; no hubo migraciones después.

## Migraciones y limpieza QA

Aplicadas sólo a `bymeopxkxapfizeeqeyb`, respetando ledger (31→33):

1. `20260917134241_confirmed_round_history_read.sql`: SELECT acotado a participante canónico SELF_CONFIRMED de ronda completa; no autoriza edición.
2. `20260917140234_confirmed_participant_index_append.sql`: RPC server-only de append congelado con row lock/CAS/dedupe. Service role no recibió UPDATE amplio sobre rounds_cloud.

Última versión real `20260917140234`; ninguna fundacional reaplicada. Los tests de RLS usaron BEGIN/ROLLBACK. Se eliminaron únicamente cuentas/datos sintéticos autorizados. El archivo temprano de shared incluía al organizador en su lista `retainedSyntheticAccounts` aunque el propio runner ya lo había eliminado: se corrigió el reporte del runner para separar eliminados; **ese organizador NO se considera retenido**. Archive QA conserva una fixture recuperable (`3b4d44ee-b7b6-4a75-a623-3673670fb114`) deliberadamente para verificar el contrato, no para afirmar retención legal aprobada.

El delete UI final eliminó `9eb8241b-a51a-4dab-af8b-42af461c0c93`: Auth/perfil/equipo/consents eliminados, preferencias0, Storage0, token viejo401. La cuenta contraparte siguió existiendo y su ronda conservó exactamente sus scores; jugador eliminado sin accountUserId/avatar. No se borró la ronda compartida completa.

## Runtime y limitaciones del corrido

- 2km, ventana acotada4h: tres503 en group invitations (mailer ausente, incluido intento UI) y un502 AI canonical_integrity. No se observó `/api/social/connections`403/404 en los500 registros4xx acotados; sus llamadas positivas funcionaron. No se extrapola esa ausencia a todo el historial de Vercel.
- 48oule/f7a70d4, ventana2h: un502 `/api/backyard-ai/round-setup`, errorCode `canonical_integrity`, latencia2226ms. No se relaja el guard para aceptar instrucciones que cambien hechos. No hubo otros5xx en esa consulta.
- 48oule, consulta final4xx: dos401 `/api/cloud/rounds` y un401 `/api/cloud/sync`, relacionados con las comprobaciones de sesión antigua/eliminada. No aparecieron403/404 de connections en esa ventana.
- 400self-attest,403external-participant,409duplicate/confirmation-required,404foreign-comment y401anon/staleJWT corresponden a negative-path QA intencional y trazable, no se catalogan como rutas rotas.
- Dos pestañas QA con snapshots distintos produjeron un conflicto explícito de cloud: se inspeccionaron ambas, se preservaron copias y se eligió la versión correcta. **No se afirma merge automático de dos instalaciones.** No se observó un bucle continuo después de resolverlo.
- Las descargas de exportación fueron canceladas por la automatización y una sesión del agente dejó de responder; un contexto nuevo funcionó. No hay evidencia suficiente para atribuirlo a freeze del producto ni para certificar las descargas.
- Sin errores JavaScript no manejados en el contexto final. Navegación y crear/configurar grupo/apuesta realmente recorridos; no sólo inspección de componentes.

## Evidencia móvil conservada

Sólo screenshots sintéticos, Chromium390×844/430×932; **no son Safari físico**:

- [QR largo390 sin overflow](evidence/beta-2026-09-17/qr-390.png)
- [Editar Driver/varilla430](evidence/beta-2026-09-17/equipment-430.png)
- [Reset estadísticas390](evidence/beta-2026-09-17/reset-390.png)
- [Confirmar delete390](evidence/beta-2026-09-17/delete-confirm-390.png)
- [Cuenta eliminada/vuelta al acceso390](evidence/beta-2026-09-17/delete-complete-390.png)

## Cambios lógicos publicados

1. `7aef3e8` — atribución personal de shared confirmado + compartir interno + nuevo campo canónico.
2. `4f4a931` — append Index confirmado con RPC acotado, no grant amplio.
3. `3704ce8` — revisión material reconciliada antes de atestar tras confirmación.
4. `1e08a62` — QR móvil contenido y feedback cloud después del ACK.
5. `cfbcc36` — nombre perfil actualizado en identidad social existente.
6. `f491aff` — denominador del promedio corresponde a cohorte9/18H.
7. `1687f7c` — reset deportivo no elimina balance histórico en Home.
8. `fc1ccf0` — runners reales equipo/AI y contratos RLS ejecutables.
9. `1c631e2` — draft no iniciado no bloquea tres entradas Jugar.
10. `f7a70d4` — parser respeta “hoyo10” y negación “sin presiones”; plantilla con presión activa exige corrección, no silencio.

Home hero/assets/layout no cambiaron. Sí cambiaron, de forma reportada, **etiqueta de cohorte en tarjeta de estadísticas** y datos de entrada para balance/draft; se necesitaban para corregir regresiones demostradas. Auth/OAuth/SMTP/configuración/secretos no cambiaron. No se modificaron fórmulas de engine/settlement.

## Acciones externas concretas

1. **Invitaciones de grupo:** en Vercel → proyecto Golf-Bets → Settings → Environment Variables, **Preview con filtro `phase2/full-platform` solamente**, configurar `GROUP_INVITES_RESEND_API_KEY` con una credencial separada autorizada para correo grupal y `GROUP_INVITES_FROM_EMAIL` con remitente verificado. No pegar key en chat ni reutilizar/cambiar SMTP Auth. Redeploy Preview y probar recepción+aceptación con dos destinatarios autorizados. Hasta entonces: BLOCKED_EXTERNAL.
2. **Auth/interacción:** en el Preview final, completar OTP real nuevo/existente/sin cuenta y Google→logout→login con las cuentas de prueba autorizadas; no hace falta volver a cambiar callback ni SMTP. PENDING_INTERACTIVE_QA.
3. **Dispositivo:** iPhone/Safari390/430, teclado/scroll, QR cámara/galería, compartir y guardar imagen/PDF/CSV, instalar/suspender/reabrir PWA. PENDING_DEVICE_QA (exports también PENDING_INTERACTIVE_QA).
4. **Legal:** aprobar textos de consentimiento, retención/archivo/recuperación y obligaciones de datos compartidos. LEGAL_REVIEW_REQUIRED.
5. GHIN/GolfAPI/GPScompleto/push/wearable/rangefinder/TheGrint/imágenes licenciadas no se simulan. No se requiere contratarlos para continuar QA manual, pero no pueden anunciarse disponibles.

No se pide nuevo permiso para QA branch, migraciones ya aplicadas o push Preview. El rechazo remoto AI no requiere una key nueva del owner: permanece un **FAIL técnico de ese escenario**, con fallback/manual seguro disponible, y debe permanecer en la lista de cierre antes de anunciar AI completo.

## Resumen de salida obligatorio

1. HEAD inicial: **a32af85f27496337a4a108d134dcdf331191a27b**.
2. HEAD final de aplicación: **f7a70d49f5b5716bf575f3fb584cc23542b5a320**; publicación documental identificable por `git log -1 --format=%H -- este archivo`.
3. Commits creados: los10 lógicos enumerados, más este reporte/evidencias.
4. Tests: **1998 PASS / 0 FAIL / 0 skipped**.
5. Lint: **PASS**, exit0.
6. TypeScript: **PASS**, exit0.
7. Build: **PASS**, exit0; Preview de aplicación READY.
8. Supabase QA: **bymeopxkxapfizeeqeyb**.
9. Migraciones QA: **20260917134241 y20260917140234**; ledger33.
10. Preview inmutable auditado: **https://golf-bets-48oule36w-saha8.vercel.app**.
11. Runtime errors: **502canonical_integrity**; anteriores **503mailer grupos**. 4xx negativos identificados; no se ocultan.
12. PASS: núcleo manual, cloud, grupos mecánicos, equipo/fitting, shared/Stats/Index/balance, privacidad/RLS, reset/delete y gates, con alcance indicado.
13. FAIL: AI setup remoto del escenario especificado; beta completa no aprobada.
14. BLOCKED_EXTERNAL: mailer grupos; GHIN/proveedores/capacidades externas ausentes; AIreglas desactivado.
15. PENDING_DEVICE_QA: iPhone/Safari/PWA/cámara/teclado/share físico.
16. PENDING_INTERACTIVE_QA: OTP/Google actuales, descargas externas y recorrido visual exhaustivo de todas las modalidades.
17. LEGAL_REVIEW_REQUIRED: consentimientos/privacidad/retención/archivo/recuperación.

**Respuesta: no todavía para una beta general anunciada como completa. Hay un Preview funcional para continuar QA controlado; la evidencia no autoriza declarar cerrados los pendientes anteriores.**

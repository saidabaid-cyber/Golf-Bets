# The Backyard — estado canónico del producto — 2026-09-24

## Propósito y criterio de lectura

Este documento clasifica el producto presente en el worktree de `integration/backyard-current`, creado desde `release/final-candidate-2026-09-23` (`3274c418a27da49ca6acb2ce7d025f4efcd070d3`). Incluye el código recuperado durante la consolidación, las pruebas versionadas, los closeouts de QA, el historial semántico de ramas y el ledger de migraciones.

No se declara un estado global exitoso. Una función puede estar verificada por pruebas automatizadas y, al mismo tiempo, requerir una prueba humana, un dispositivo físico, una migración controlada o una dependencia externa. Tampoco se convierte una especificación, un documento histórico o una interfaz futura en una implementación existente.

Estados permitidos en este documento:

| Estado | Significado |
|---|---|
| `IMPLEMENTED_AND_VERIFIED` | Implementación presente con evidencia automatizada, estructural o de QA acotada. No implica por sí sola despliegue actual ni prueba física. |
| `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | Implementación presente, pero falta recorrerla en el Preview canónico con sesión o interacción real. |
| `BLOCKED_EXTERNAL` | Depende de credenciales, entitlement, proveedor, dominio, dispositivo administrado u otra acción fuera del repositorio. |
| `MISSING_NOT_IMPLEMENTED` | El requisito fue identificado, pero no existe una implementación completa válida. |
| `SUPERSEDED` | Una implementación anterior fue reemplazada por otra posterior y no debe restaurarse. |
| `LEGAL_REVIEW_REQUIRED` | El mecanismo técnico existe o está documentado, pero texto, alcance, licencia, retención o base jurídica requieren revisión competente. |
| `PENDING_CONTROLLED_DB_APPLY` | El SQL existe o requiere reconciliación, pero no fue aplicado ni certificado en la base Preview canónica. |
| `PENDING_DEVICE_QA` | Falta validación en hardware/navegador físico real. |

Fuentes principales: `docs/CONSOLIDATION_MANIFEST_2026-09-24.md`, `docs/CANONICAL_MIGRATION_LEDGER_2026-09-24.md`, los closeouts `docs/qa/P01`–`P05`, `docs/GHIN_POC.md`, los inventarios de `data/qa`, los runbooks de `docs/disaster-recovery`, el código canónico y las pruebas bajo `tests`, `supabase/tests` y `scripts/backup`.

## Validación automatizada final del árbol canónico

| Gate | Resultado |
|---|---|
| Suite completa `pnpm test` | `3,589/3,589 PASS`; 0 fallos y 0 omitidos. |
| ESLint `pnpm lint` | `PASS`; 0 errores. |
| TypeScript `pnpm typecheck` | `PASS`; `next typegen` y `tsc --noEmit` completos. |
| Build `pnpm build` | `PASS`; Next.js 16.3.3, compilación y TypeScript completos, 35/35 páginas estáticas generadas. |
| RLS remoto QA | `17/17 PASS` con transacciones y rollback contra `bymeopxkxapfizeeqeyb`; 0 fixtures residuales del runner. |
| Assets/orígenes | `PASS`; 722 archivos fuente, 14 assets públicos y 30 referencias auditadas, 0 faltantes y 0 URLs activas de previews Vercel aleatorios. |
| Backup / Recovery / Automation / sintaxis QA | `33/33`, `6/6`, `37/37` y `32/32 PASS`, respectivamente. |
| `git diff --check` | `PASS`; sin errores de whitespace (los avisos de conversión LF/CRLF no son errores del diff). |

Estos gates verifican el árbol local y la base QA aislada; no sustituyen el despliegue final, OAuth interactivo, QA física ni los hallazgos abiertos de los advisors de Supabase.

## Estado canónico, entornos y límites

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Única fuente de verdad en `integration/backyard-current` | `IMPLEMENTED_AND_VERIFIED` | La rama canónica existe desde el baseline exacto y el manifiesto demuestra integración semántica de Admin/Courses, GHIN, Full Platform, AI/Games/Offline y backups. | El commit final y su SHA se registran en el informe de entrega, no en este documento mutable. |
| Funciones aceptadas no exclusivas de ramas antiguas | `IMPLEMENTED_AND_VERIFIED` | `docs/CONSOLIDATION_MANIFEST_2026-09-24.md` clasifica las refs y sus destinos funcionales; no se hizo merge ciego de líneas antiguas. | Cualquier feature futura seguirá incompleta hasta volver a la rama canónica. |
| Production sin cambios | `IMPLEMENTED_AND_VERIFIED` | Se aplicaron cuatro migraciones revisadas únicamente a la rama QA aislada `bymeopxkxapfizeeqeyb`: GHIN/provider, guard Feedback, ingest legal transaccional y hardening Realtime de Polla. Hubo cero escrituras a Production, Auth de Production, Storage de Production, DNS de Production o usuarios reales. | Production permanece fuera de alcance; no promover ni aplicar nada desde este trabajo. |
| Origen público estable en código | `IMPLEMENTED_AND_VERIFIED` | `lib/app-origin.ts`, `.env.example`, `lib/auth-flow.ts`, `lib/social-connections.ts` y `tests/app-origin.test.ts` fijan `https://dev.thebackyard.com.mx`, preservan localhost y fallan cerrado ante previews remotos ambiguos. | El Branch Domain ya está enlazado; falta que el DNS externo resuelva ese origen. |
| Configuración Auth de Supabase QA | `IMPLEMENTED_AND_VERIFIED` | En esta consolidación se actualizó en QA el `site_url` y la allowlist de redirects para `https://dev.thebackyard.com.mx` y localhost; no se modificó Auth de Production. | Confirmar el retorno real con Google y OTP en el deployment canónico. |
| Branch Domain, DNS y deployment canónico | `BLOCKED_EXTERNAL` | Vercel tiene `dev.thebackyard.com.mx` enlazado exclusivamente a `integration/backyard-current`, y un deployment de la rama quedó `Ready`; la resolución pública sigue en `NXDOMAIN` porque falta el CNAME externo `dev` indicado por Vercel. | Publicar en DNS el CNAME exacto mostrado por Vercel con proxy desactivado, esperar propagación y comprobar URL→SHA. No usar URLs aleatorias `*.vercel.app` para owner QA. |
| Browser QA del deployment final | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | Sobre el artefacto Preview de la rama pasaron health, landing/login/legal, protección Admin/GHIN, viewports 390×844 y 430×932, consola/logs y assets públicos sin errores. El origen aleatorio falla cerrado para OAuth por diseño. | Cuando resuelva la URL fija, ejecutar Google/OTP y recorridos autenticados de perfil, cursos, ronda, equipo y social; comprobar callback, sesión y URL→SHA. |
| iPhone/Safari/PWA físico | `PENDING_DEVICE_QA` | Hay pruebas de viewport y contratos móviles (`mobile-stability`, `iphone-capture`, `service-worker`). | Cámara, geolocalización, teclado, safe areas, Web Share, instalación, suspensión y reapertura en iPhone físico. |

## Auth y ciclo de cuenta

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Google OAuth: inicio, selector de cuenta y callback PKCE | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | `app/components/account-provider.tsx`, `app/auth/callback`, `lib/auth-flow.ts`, `lib/oauth-callback-once.ts`, `tests/auth-flow.test.ts` y `tests/oauth-profile.test.ts`; el callback se deriva del origen estable. | Completar Google→callback→Home con cuenta autorizada en `dev.thebackyard.com.mx`. No se declara Google validado en el Preview canónico. |
| Email/OTP para usuario nuevo y existente | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | Envío/verificación, cooldown, intención de alta/entrada, recuperación y errores están cubiertos por `lib/auth-flow.ts`, `lib/email-login-recovery.ts`, `tests/auth-flow.test.ts` y `tests/account-entry.test.ts`. | Recibir e introducir OTP real para alta, regreso y correo sin cuenta en la URL fija. |
| Callback, sesión persistente y refresh | `IMPLEMENTED_AND_VERIFIED` | Persistencia seleccionable, validación de sesión, refresh deduplicado, cambio de identidad y fallo transitorio están probados en `auth-flow`, `account-sync-closure` y `account-access`. | Revalidar continuidad después del OAuth real y recarga del Preview. |
| Logout y aislamiento entre cuentas | `IMPLEMENTED_AND_VERIFIED` | `closeAuthSession`, limpieza de workspace por usuario y tests de cambio/cierre impiden reutilizar datos de otra cuenta. | Smoke humano de logout→login con dos cuentas QA. |
| Usuarios nuevos, existentes y reanudación de onboarding | `IMPLEMENTED_AND_VERIFIED` | `lib/account-entry.ts`, `lib/account-lifecycle.ts`, APIs de account y suites `account-entry`, `account-lifecycle`, `account-onboarding`. | Recorrido autenticado actual en Preview. |
| Eliminación, pausa de sync y recuperación ante fallo parcial | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | API owner-auth, intención idempotente, limpieza local posterior a confirmación y recuperación fail-closed están en `app/api/account/delete`, `lib/account-deletion*` y sus tests. | Ejecutar sólo con cuentas sintéticas en DB aislada; revisión jurídica de retención más abajo. |
| Sign in with Apple | `BLOCKED_EXTERNAL` | El cliente sólo habilita el botón si Supabase informa proveedor listo; `docs/SETUP_APPLE_AUTH.md` evita inventar credenciales. | Team ID, Service ID, Key ID, llave `.p8`, configuración del proveedor y prueba real. |
| Callbacks o links basados en un Preview aleatorio | `SUPERSEDED` | `resolveBrowserAppOrigin` y el auditor de assets/orígenes rechazan esa arquitectura. | No reintroducir redirects o QR con dominios históricos. |

## Onboarding

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Setup inicial y consentimiento de acceso | `IMPLEMENTED_AND_VERIFIED` | `account-consent-checkpoint`, `onboarding-checkpoint`, documentos legales versionados y pruebas de deadline/estado. | Revisión legal de textos y evidencia durable se clasifica en Legal. |
| Configuración rápida y completa | `IMPLEMENTED_AND_VERIFIED` | `beta-onboarding-flow`, `lib/beta-onboarding.ts` y pruebas cubren ambos caminos y reanudación. | Recorrido autenticado actual en la URL fija. |
| Campo, handicap, mano dominante y perfil básico | `IMPLEMENTED_AND_VERIFIED` | Componentes de onboarding y suites `beta-onboarding`, `ux-round-onboarding`, `profile-details`, `handicap-source-location-ui`. | Confirmar datos persistidos contra la DB Preview final. |
| Permisos antes de Home Club, sin repetición | `IMPLEMENTED_AND_VERIFIED` | P01 consolidó una única decisión opcional y tests prueban no duplicarla ni pedir permisos anticipados. | Prompt y revocación reales en dispositivo. |
| Progressive disclosure y primera ronda | `IMPLEMENTED_AND_VERIFIED` | `lib/round-first-experience.ts`, `tests/round-first-experience.test.ts` y el port de Full Platform difieren grupos/apuestas hasta el momento correcto. | Recorrido visual owner en Preview. |
| No mostrar grupos/apuestas prematuramente | `IMPLEMENTED_AND_VERIFIED` | Contratos de onboarding/primera ronda y regresiones de `beta-onboarding`/`ux-round-onboarding`. | Ninguno de código; sólo QA visual final. |
| Onboarding opcional de Mi Bolsa | `IMPLEMENTED_AND_VERIFIED` | `equipment-onboarding.tsx` permite completar u omitir clubs y bola sin bloquear la cuenta. | QA táctil física. |

## Perfil, Settings y permisos

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Nombre, identidad OAuth y avatar manual | `IMPLEMENTED_AND_VERIFIED` | `oauth-profile`, `manual-avatar`, `profile-avatar`, `avatar-creation-panel` y suites de persistencia/reload. El SVG manual se valida por re-render canónico. | Foto HEIC/cámara/galería real se separa abajo. |
| Foto de perfil, resize y sync | `PENDING_DEVICE_QA` | Procesamiento, privacidad, cola y sync tienen tests (`profile-image-processing`, `profile-avatar-sync`, `photo-sync-multiphoto`). | Cargar fotos reales, incluida HEIC/imagen grande, en iPhone y reabrir en otro dispositivo. |
| Username, normalización y disponibilidad | `IMPLEMENTED_AND_VERIFIED` | UI, normalización, unicidad lógica y `tests/profile-username.test.ts` existen. En QA, los statements remotos, cuerpo de función y ACL de `202609230001 profile_username_availability` coinciden con el contrato canónico; no se reparó ni reejecutó el ledger. | Probar dos cuentas concurrentes en el Preview canónico. |
| Handicap manual y Backyard Index | `IMPLEMENTED_AND_VERIFIED` | `handicap-source`, `backyard-index*`, cálculo/snapshots y tests de preferencias, auto-capture e historial. | GHIN sigue separado y desactivado. |
| Handicap GHIN en perfil | `BLOCKED_EXTERNAL` | Placeholder seguro y adaptador read-only están presentes; no se crea vínculo sin lookup real. | Credenciales/entitlement y QA humana autorizada. |
| Home Course, tee preferido y mano dominante | `IMPLEMENTED_AND_VERIFIED` | Perfil, picker de club, preferencias y selección estable por IDs tienen cobertura automatizada. | Readback autenticado de la DB Preview final. |
| Completitud de perfil | `IMPLEMENTED_AND_VERIFIED` | `lib/profile-completion.ts`, anillo UI, endpoint y `PROFILE_COMPLETION_V1`/tests distinguen faltantes reales. | Revisión visual final. |
| Ubicación de perfil | `IMPLEMENTED_AND_VERIFIED` | Catálogo geográfico, selección ISO, cache/sync y privacidad están probados. | Permiso GPS físico no se infiere de la ubicación declarada. |
| Privacidad/visibilidad de perfil | `IMPLEMENTED_AND_VERIFIED` | `profile-visibility`, API privacy, UI y pruebas de directorio/RLS separan público, amigos y privado. | Multiusuario real en el Preview final. |
| QR y link de perfil con origen canónico | `IMPLEMENTED_AND_VERIFIED` | `social-connections.ts`, `social-qr.tsx` y `app-origin.test.ts` generan/aceptan sólo el origen estable del entorno y un UUID válido. | Cámara/share/guardado físico se clasifica en Social. |
| Preferencias, Notificaciones, Cuenta y Privacidad separadas | `IMPLEMENTED_AND_VERIFIED` | `profile-account-panel.tsx`, `account-settings.ts` y `release-settings` mantienen destinos distintos sin duplicar persistencia. | Smoke visual en 390/430 y dispositivo físico. |
| Menús duplicados de Settings | `SUPERSEDED` | El panel actual remonta por destino y las tarjetas abren la sección específica; el menú genérico anterior dejó de ser la implementación vigente. | No restaurar el panel antiguo. |
| Alto contraste | `IMPLEMENTED_AND_VERIFIED` | Activo por defecto, respeta opt-out y sincroniza preferencia; `cloud-sync` y `device-permissions-owner` cubren ambos estados. | Revisión de contraste visual/lector de pantalla en dispositivo. |
| Unidades yardas/metros sin mutar históricos | `IMPLEMENTED_AND_VERIFIED` | `lib/account-ui-preferences.ts` convierte sólo presentación; Settings y tests preservan yardas almacenadas. | QA visual. |
| Español | `IMPLEMENTED_AND_VERIFIED` | La interfaz canónica y los textos operativos están implementados en `es-MX`. | Ninguno para el alcance actual. |
| Inglés u otro idioma seleccionable | `MISSING_NOT_IMPLEMENTED` | La opción English está deshabilitada como “Próximamente”; no hay catálogo completo de traducciones. | Diseñar i18n y traducir producto, errores, emails, legal y accesibilidad. |
| Estado de permisos de ubicación/notificaciones | `IMPLEMENTED_AND_VERIFIED` | `device-permissions.tsx`, Settings y tests diferencian unavailable/default/granted/denied y no disparan prompts fuera de una acción. | Verificar prompts/revocación en iOS/Android. |
| Permisos reales de cámara, ubicación y notificaciones | `PENDING_DEVICE_QA` | Existe UI/fallback, no evidencia física actual. | Probar aceptación, rechazo, revocación y retorno desde Settings del sistema. |
| Avisos dentro de la app | `IMPLEMENTED_AND_VERIFIED` | Eventos/preferencias internas y `internal-notifications` tienen dominio, UI, storage aislado y tests. | Multiusuario y read-state en Preview. |
| Envío push | `BLOCKED_EXTERNAL` | Preferencia y provider interface existen, pero el provider concreto queda unavailable y el texto no afirma entrega. | VAPID/proveedor, política, permisos y prueba de entrega. |
| Envío de notificaciones por email | `BLOCKED_EXTERNAL` | La preferencia se guarda sin afirmar envío. | Proveedor transaccional y reglas/consentimiento de entrega. |

## Social, amigos y grupos

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Buscar usuarios por username/nombre con privacidad | `IMPLEMENTED_AND_VERIFIED` | APIs Social, normalización owner search, `social-directory-privacy` y SQL/RLS impiden enumeración indiscriminada; la migración de disponibilidad de username ya fue reconciliada por statements/objeto/ACL en QA. | Prueba A/B con dos cuentas sintéticas en el Preview canónico. |
| Solicitudes, aceptar amistad y bloquear | `IMPLEMENTED_AND_VERIFIED` | `social-connections-panel`, rutas de connections y tests de servicio/HTTP/autorización. | Prueba A/B en el Preview final. |
| QR: generar, copiar, escanear galería | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | Canvas QR, decodificación local y validación de origen/UUID están implementados; fixtures previos validaron generación/galería. | Recorrer con dos cuentas en el dominio canónico. |
| QR: cámara, Web Share y guardar imagen | `PENDING_DEVICE_QA` | Fallback y límites de archivo existen. | Cámara real, permisos, share sheet y descarga en Safari/iOS. |
| Grupos, roles, plantillas y selección para ronda | `IMPLEMENTED_AND_VERIFIED` | `features/groups`, `group-builder`, presets, editor completo y suites de grupos/plantillas. | Readback multiusuario en DB final. |
| Invitaciones internas y retorno del owner | `IMPLEMENTED_AND_VERIFIED` | Migraciones, API, sync e idempotencia tienen tests y evidencia de ledger en QA. | Prueba actual con dos cuentas sintéticas. |
| Invitaciones grupales por correo | `BLOCKED_EXTERNAL` | El flujo conserva estado de fallo y no afirma envío; la URL del mailer exige el origen fijo. | Credencial dedicada, remitente verificado y prueba autorizada de recepción. |
| Feed, actividad, comentarios, likes y notices | `IMPLEMENTED_AND_VERIFIED` | Rutas Social, reconciliación desde ronda canónica, privacidad, comentarios/likes y tests de publication boundary. | Smoke A/B del Preview actual. |
| Links de perfil sin dominio Preview aleatorio | `SUPERSEDED` | El helper actual exige el origen estable y rechaza otros entornos. | No recuperar links históricos hardcodeados. |
| Social completo con cuentas reales del Preview | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | Código y pruebas automatizadas presentes. | Búsqueda, amistad, grupo, actividad, privacidad y logout con dos usuarios sintéticos. |

## Rondas, ronda activa, scoring, historial y estadísticas

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Setup completo de ronda | `IMPLEMENTED_AND_VERIFIED` | Wizard, preflight, curso→tee único, jugadores, HCP, apuestas y drafts están cubiertos por `round-setup-wizard`, `round-wizard-*` y P01. | Recorrido final en el Preview canónico. |
| Ronda sin apuestas / score-only | `IMPLEMENTED_AND_VERIFIED` | El primer experience y P01 prueban que score-only no muestra configuración de apuestas. | Smoke autenticado. |
| Captura de score total | `IMPLEMENTED_AND_VERIFIED` | `total-score-entry`, `total-score-round` y persistencia/historial integrados. | Recorrido humano y export posterior. |
| Score hoyo por hoyo | `IMPLEMENTED_AND_VERIFIED` | `round-capture-v2`, `score-capture`, validación de hoyo, scorecard completa y engine regression. | Device/touch QA. |
| Ronda activa, salir y continuar | `IMPLEMENTED_AND_VERIFIED` | Navegación, draft restoration, checkpoint por hoyo y P01 restauran campo, tee, jugadores, orden y hoyo siguiente. | Reload/background en dispositivo real. |
| Iniciar nueva ronda con una activa | `IMPLEMENTED_AND_VERIFIED` | `new-round-safety`, unfinished-round y diálogos evitan sobrescritura silenciosa. | Confirmar UX final. |
| Cerrar, cancelar o borrar ronda | `IMPLEMENTED_AND_VERIFIED` | `round-lifecycle`, `round-completion`, `round-editing`, history deletion y pruebas de confirmación. | QA interactiva de cada salida. |
| Historial, detalle y recap | `IMPLEMENTED_AND_VERIFIED` | `round-history-save`, detalle/recap históricos, filtros, resultados y snapshots tienen suites dedicadas. | Readback cloud multi-dispositivo. |
| Selección de jugadores y grupos | `IMPLEMENTED_AND_VERIFIED` | Group selector, player limit, guests y owner identity cubiertos por tests. | Multiusuario real. |
| Selección de tee y hoyo de salida | `IMPLEMENTED_AND_VERIFIED` | P01 deja una sola selección de tee y `StartHoleSelector` conserva orden circular e identidades reales. | Interacción táctil/viewport. |
| 9/18 hoyos y salida H10/shotgun | `IMPLEMENTED_AND_VERIFIED` | Tests de 9H, Polla, Nassau, round-half y course flow conservan el número físico de hoyos. | Ninguno de motor; QA visual final. |
| Snapshot congelado de campo, tee, HCP y equipo | `IMPLEMENTED_AND_VERIFIED` | Persistencia completa y snapshots inmutables impiden que cambios futuros de catálogo/perfil reescriban historia. | Readback cloud final. |
| HCP nulo permanece nulo | `IMPLEMENTED_AND_VERIFIED` | Normalizadores, provider adapter y round-player handicap distinguen ausencia de cero. | GHIN live no cambia esta regla. |
| Persistencia local-first y offline | `IMPLEMENTED_AND_VERIFIED` | `offline-store`, cola, checkpoint, service worker, hotfixes de captura y suites `offline-store-recovery`, `supabase-offline-repair`, `polla-offline`. | Ciclo físico airplane/offline→online. |
| Sync cloud, conflictos y dos dispositivos | `IMPLEMENTED_AND_VERIFIED` | Ciclo de sync, versionado, tombstones, resolución y `two-device-sync`/`cloud-hardening`. | Ejecutar contra la DB Preview final con dos sesiones. |
| Publicación/compartir ronda | `IMPLEMENTED_AND_VERIFIED` | El panel de sharing y Social sólo publican hechos derivados de ronda canónica y aplican privacidad/attestation. | QA A/B interactiva. |
| Estadísticas, filtros, tendencias y achievements | `IMPLEMENTED_AND_VERIFIED` | `advanced-stats`, `golf-insights`, dashboard, achievements y tests de agregados/reliability. | Readback con dataset sintético final. |
| Reset de estadísticas idempotente | `IMPLEMENTED_AND_VERIFIED` | Dos migraciones QA documentadas, endpoint y tests verifican boundary monotónico sin borrar historia. | QA interactiva sobre fixtures desechables. |
| Exportar ronda a PDF/CSV/imagen | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | Generadores y `round-export-generation.test.ts` existen. | Descargar, abrir y compartir cada formato en navegador/dispositivo; una descarga cancelada por automatización no prueba fallo ni éxito. |
| Polla Live: motor, agrupación, score y privacidad | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | Código/API/tests y `docs/POLLA_LIVE.md` conservan sólo datos deportivos. La migración QA-only `20260924235945` retiró scores/grupos raw de Realtime y dejó sólo `tournament_leaderboard_events`; el contrato RLS Polla pasó remoto. `POLLA_LIVE_RELEASED` sigue cerrado. | Probar scorer/viewer/admin, tarjeta confirmada y polling/Realtime en runtime antes de abrir el release lock. |
| Integridad relacional/auditoría completa de Polla | `MISSING_NOT_IMPLEMENTED` | La auditoría final encontró FKs independientes que no impiden todas las combinaciones cross-tournament; el audit actual registra INSERT y cambios de score, no DELETE ni UPDATE sin cambio de score. El feature permanece apagado. | Diseñar migración reconciliada y tests de datos existentes antes de endurecer constraints/audit; no activar Polla mientras siga abierto. |

## Betting y settlement

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Ronda sin apuestas como camino válido | `IMPLEMENTED_AND_VERIFIED` | Boundary de apuestas y setup permiten cero apuestas sin afectar scoring. | Smoke final. |
| Registro canónico de apuestas | `IMPLEMENTED_AND_VERIFIED` | `lib/bets/registry.ts` define 23 contratos compartidos por setup, AI, captura, historia y presentación. | Mantener el engine determinista como autoridad. |
| Conejos, Skins, Unidades/Copas y Monkey | `IMPLEMENTED_AND_VERIFIED` | Engines, carries, eventos firmados y matrices de juegos tienen pruebas golden/regresión. | Recorrido UI exhaustivo. |
| Foursome, Bola Amiga, Loba y equipos | `IMPLEMENTED_AND_VERIFIED` | Generador/segmentos/parejas, handicap, presiones y resultados se cubren en `engine`, `foursome-generator`, `games-engine-matrix`. | Recorrido UI con cambios de equipo. |
| Polla primera, segunda, total y Mini Polla | `IMPLEMENTED_AND_VERIFIED` | Engine, salidas H10, 9H/18H y tests Polla/Nassau. | Recorrido UI. |
| Víboras, Camellos y Peces | `IMPLEMENTED_AND_VERIFIED` | Captura condicional de putts/bunkers/penalty area y counters deterministas. | Recorrido UI y accesibilidad. |
| Personales, sliding y Nassau individual | `IMPLEMENTED_AND_VERIFIED` | Migración canónica, componentes ida/vuelta/total, rival history y protección ante datos corruptos. | Recorrido de múltiples rivales. |
| Dollar a Stroke, presiones individuales/equipos, Chicago, Vegas y mínimo de putts | `IMPLEMENTED_AND_VERIFIED` | `supplemental-bets`, validación zero-sum y matrices de games cubren cálculo y snapshots. | Recorrido UI exhaustivo. |
| Apuestas manuales de suma cero | `IMPLEMENTED_AND_VERIFIED` | Registry, validadores y settlement rechazan configuraciones no balanceadas. | QA visual. |
| Configuración histórica y plantillas frecuentes | `IMPLEMENTED_AND_VERIFIED` | Snapshots versionados, presets, group template editor y migradores conservan rondas anteriores. | Readback cloud final. |
| Settlement e integridad de saldos | `IMPLEMENTED_AND_VERIFIED` | `balance-ledger`, `settlement-integrity`, engine y tests Excel/golden verifican sumas y resultados deterministas. | QA interactiva de presentación, no recálculo ad hoc. |
| Mitades/front-back por orden de juego | `IMPLEMENTED_AND_VERIFIED` | `lib/round-half.ts` y `round-half-hotfix.test.ts` manejan H10 y orden circular. | Ninguno de motor. |
| Todas las modalidades recorridas visualmente | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | La cobertura de engine es extensa, pero no sustituye abrir cada modal, toggle, presión, equipo y resultado en el Preview final. | Recorrido owner completo en 390/430 y desktop. |

## Campos, cursos, tees, Rating/Slope y geolocalización

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Catálogo provider-based, paginado y buscable | `IMPLEMENTED_AND_VERIFIED` | APIs/provider, directorio, picker y tests de búsqueda normalizada por nombre/alias. | Validar contra proyección final de la DB canónica. |
| Búsqueda La Vista y clubes Puebla | `IMPLEMENTED_AND_VERIFIED` | P02 prueba La Vista, Vista, Campestre, La Huerta, El Cristo y Las Fuentes sin depender de mayúsculas/acentos. | Smoke final de selección y arranque. |
| Nearby por distancia real y clubes distintos | `IMPLEMENTED_AND_VERIFIED` | Haversine, radio, orden y dedupe por `clubId` tienen pruebas para ocho regiones; no hay ranking hardcodeado. | GPS físico y permiso real. |
| Geolocalización México con evidencia | `IMPLEMENTED_AND_VERIFIED` | P03 elevó QA a 150/153 clubes geolocalizados sin alterar identidades; evidencia/versiones están en `data/qa`. | Tres identidades siguen sin punto exacto demostrable. |
| Geolocalización real del dispositivo | `PENDING_DEVICE_QA` | Resolver compartido maneja opt-in, permiso, cache de cinco minutos, timeout, revocación y respuestas tardías. | Probar prompt, orden nearby y revocación en iPhone físico. |
| Identidades separadas de club/recorrido/tee | `IMPLEMENTED_AND_VERIFIED` | IDs estables, joins y publication guards evitan mezclar clubes, generaciones o tees. La proyección player-safe ya existe en QA bajo su versión remota histórica reconciliada. | Readback autenticado en el Preview canónico. |
| La Vista normal Par 72 y layout temporal Par 69 | `IMPLEMENTED_AND_VERIFIED` | El catálogo canónico conserva `course-la-vista` y `lavista-temporal-white` como identidades separadas; P02, el directorio y sus pruebas verifican Par 72 frente a Par 69 sin copiar Rating/Slope. | Verificar selector/readback autenticado contra la DB final. |
| Layout temporal La Vista Par 70 | `MISSING_NOT_IMPLEMENTED` | Una búsqueda exhaustiva del árbol y del historial, seguida de readback directo de la QA `bymeopxkxapfizeeqeyb`, no encontró catálogo, configuración, scorecard ni código que implemente un layout Par 70. La mención anterior en P05 no tenía respaldo ejecutable ni de datos. | Requiere tarjeta/fuente autoritativa y una identidad, hoyos, tees y evidencia separados; no derivar ni copiar valores del Par 72 o Par 69. |
| Yardas, Par y Stroke Index por hoyo | `IMPLEMENTED_AND_VERIFIED` | Resolver exige set exacto de hoyos, Par/SI válidos y yardas positivas antes de publicar. | Obtener fuente exacta para las tarjetas aún incompletas. |
| Campos físicos de 9 hoyos permanecen 9 | `IMPLEMENTED_AND_VERIFIED` | P01/P02/P04 prueban que no se fabrican otros nueve ni se mezclan loops incompatibles. | Ninguno de código. |
| Scorecards incompletos ocultos/bloqueados | `IMPLEMENTED_AND_VERIFIED` | P04 conserva 758 completas y 11 incompletas; no une generaciones, tees o fuentes contradictorias. | Evidencia primaria exacta para las 11 tarjetas. |
| Rating/Slope con procedencia, categoría y autoridad | `IMPLEMENTED_AND_VERIFIED` | P05 versiona 811 evidencias; mantiene múltiples categorías por tee, front/back independientes, conflictos y URLs de autoridad. | La existencia de evidencia no habilita uso automático. |
| Categoría no inferida y uso automático cerrado | `IMPLEMENTED_AND_VERIFIED` | Ninguna categoría se deriva de color/yardaje/Par/Rating/Slope; 769 capturas históricas permanecen sin clasificar y cero evidencias se autoaplican. | Política/categoría exacta por jugador y fuente primaria. |
| Cobertura completa de Rating/Slope oficial | `LEGAL_REVIEW_REQUIRED` | Sólo 39 evidencias tienen categoría explícita verificada; El Cristo conserva publicación de club y conflictos sin presentarse como autoridad WHS/GHIN/FMG. | Validar derechos, autoridad, vigencia y categoría exacta antes de ampliar uso. |
| Course/tee player-safe projection | `IMPLEMENTED_AND_VERIFIED` | El remoto `20260923051051 owner_course_catalog_player_read` fue inspeccionado: statements, función viva y ACL corresponden al contrato canónico de `20260922230000`; no se reejecutó ni se fabricó el timestamp local. | Readback autenticado y QA runtime de búsqueda/selección en el Preview fijo. |
| Solicitar campo/tee faltante | `IMPLEMENTED_AND_VERIFIED` | Feedback incluye COURSE/TEE, contexto y persistencia privada; la migración base tiene presencia exacta en QA. | QA en el deployment final. |
| Catálogo nacional/global completo y proveedor comercial | `BLOCKED_EXTERNAL` | La app falla cerrado y ofrece solicitud/manual; `GolfAPI` es una abstracción, no una integración activa. | Licencia, credenciales, cobertura y datos verificables de un proveedor autorizado. |

## GHIN

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Cliente GHIN read-only y server-side | `IMPLEMENTED_AND_VERIFIED` | `lib/ghin/client.ts`, credenciales/runtime server-only, límites/TTL y suites `ghin-client`, `ghin-config`, `ghin-core`. | No habilitar live sin los gates siguientes. |
| Abstracción de auth y HandicapProvider | `IMPLEMENTED_AND_VERIFIED` | Adapter y mappings preservan manual/Backyard Index; null no se transforma en cero. La fundación provider quedó aplicada sólo en QA y vacía. | Mantener los flags live apagados hasta QA externa autorizada. |
| Golfer lookup y Score History | `BLOCKED_EXTERNAL` | Superficie y parsers existen, pero nunca se obtuvo bearer token real. | `GHIN_TEST_LOGIN`, `GHIN_TEST_PASSWORD`, autorización y prueba de GHIN `11103349`. |
| Course Data/TeeSetRatings | `BLOCKED_EXTERNAL` | Cliente, comparación y dry-run de mappings existen. | Entitlement/contrato del endpoint y lectura real de La Vista/tees. |
| Comparación Backyard vs GHIN | `IMPLEMENTED_AND_VERIFIED` | `course-comparison` clasifica match/conflicto/faltantes sin escribir catálogo. | Alimentarla con respuesta real autorizada. |
| Página diagnóstica Admin protegida | `IMPLEMENTED_AND_VERIFIED` | Ruta/cliente Admin, scope, preview-only gates y `ghin-route-security.test.ts`. | QA interactiva sólo después de credenciales autorizadas. |
| Feature flags live apagados | `IMPLEMENTED_AND_VERIFIED` | Flag público y switches server-side separados quedan `false`; Production tiene lock adicional. | Mantenerlos apagados hasta QA autorizada. |
| Migración provider mappings/snapshots | `IMPLEMENTED_AND_VERIFIED` | Tras probar que el esquema faltaba y validar dependencias, `20260924010000_ghin_provider_foundation.sql` se aplicó sólo a QA como remoto `20260924233419`; su contrato RLS transaccional pasó y las tres tablas provider permanecen vacías. | No promover a Production ni habilitar GHIN live; falta QA externa con credenciales/entitlement. |
| Vincular GHIN al perfil | `BLOCKED_EXTERNAL` | El diseño exige lookup real exitoso y revisión humana. | No crear asociación con datos simulados. |
| Autenticación GHIN real | `BLOCKED_EXTERNAL` | No ejecutada. | Credenciales autorizadas y entitlement. |
| Lookup real de golfer `11103349` | `BLOCKED_EXTERNAL` | No ejecutado. | Autenticación real. |
| Score History real | `BLOCKED_EXTERNAL` | No ejecutado. | Autenticación real. |
| Course Data real | `BLOCKED_EXTERNAL` | No ejecutado. | Entitlement y autenticación real. |
| Publicación de scores a GHIN | `MISSING_NOT_IMPLEMENTED` | No existe endpoint de posting y el alcance canónico lo prohíbe. | Debe permanecer sin implementar en esta consolidación. |

## Equipment, clubs, balls, shafts e imágenes

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Mi Bolsa como experiencia canónica | `IMPLEMENTED_AND_VERIFIED` | Página completa, onboarding, resumen de perfil y tests `equipment-full-page-flow`, `equipment-owner-review`, `equipment-ui-contract`. | QA táctil y cloud final. |
| Duplicado “Mi equipo” | `SUPERSEDED` | La navegación actual usa Mi Bolsa y una sola fuente de perfil/equipo. | No restaurar el acceso duplicado. |
| Catálogo de bastones actuales e históricos | `IMPLEMENTED_AND_VERIFIED` | Provider runtime contiene 1,276 modelos: 242 activos y 1,034 históricos, con IDs, aliases, procedencia y paginación. | Las especificaciones ausentes permanecen desconocidas. |
| Detalle, edición y eliminar bastón | `IMPLEMENTED_AND_VERIFIED` | Ficha por bastón, confirmación in-app, borrado en cascada de distancias y preservación de snapshots históricos. | QA interactiva. |
| Acción destructiva “Mover a anterior” | `SUPERSEDED` | Los tests exigen que no aparezca; histórico/actual pertenece al catálogo, no a una mutación destructiva de la bolsa. | No reintroducirla. |
| Distancias manuales | `IMPLEMENTED_AND_VERIFIED` | Carry/total, unidades, validación owner y edición/borrado se prueban en `golf-equipment` y `equipment-ui-contract`. | Sync/device QA final. |
| Putter excluido de distancias | `IMPLEMENTED_AND_VERIFIED` | UI y contratos impiden carry/total/GPS para putter. | Ninguno de código. |
| Distancia automática GPS/Shot Tracking en Mi Bolsa | `MISSING_NOT_IMPLEMENTED` | El modelo reserva source `GPS` y existe Shot Tracking, pero la UI declara que el cálculo automático aún no está disponible. | Diseñar autorización, mínimo de muestras, cálculo y revisión del usuario. |
| Captura manual si un bastón/bola/varilla no aparece | `IMPLEMENTED_AND_VERIFIED` | Editores conservan `USER_ENTERED`, no inventan specs y excluyen esos datos de recomendaciones automáticas. | Ninguno de código. |
| Catálogo de bolas, generaciones y aliases | `IMPLEMENTED_AND_VERIFIED` | Runtime normalizado: 314 bolas, 88 activas y 226 históricas; identidad marca+modelo+generación, aliases y snapshots. | Revisar conflictos legacy de generaciones sin autoarchivar. |
| Marcas verificadas publicadas | `IMPLEMENTED_AND_VERIFIED` | 19 marcas: Bridgestone, Callaway, Cut, Kirkland Signature, Maxfli, Mizuno, Nike, Nitro, OnCore, Pinnacle, PXG, Seed, Snell, Srixon, TaylorMade, Titleist, Vice, Volvik y Wilson. | No convertir presencia en afirmación de specs completas. |
| PXG, Pinnacle y Nitro recientes | `IMPLEMENTED_AND_VERIFIED` | Cuatro adiciones OEM están en el seed público; compresión desconocida sigue `null` y no entra a Ball Fit. | Ninguno para identidad; specs sólo con fuente futura. |
| Top-Flite | `MISSING_NOT_IMPLEMENTED` | `data/qa/ball-catalog-diff.json` documenta discovery/conforming list, pero no una fuente de producto del fabricante inequívoca aceptable. | Importar sólo cuando exista procedencia suficiente; mientras tanto usar captura manual. |
| Amazon Basics | `MISSING_NOT_IMPLEMENTED` | No se encontró una página oficial estable con identidad/procedencia suficiente. | Mismo criterio fail-closed; no inventar catálogo. |
| Synthetic QA/fixtures fuera del catálogo público | `IMPLEMENTED_AND_VERIFIED` | `ball-catalog-public-safety.test.ts` prueba exclusión de search, facets, pinned IDs y Ball Fit; la evidencia QA interna se conserva. | Mantener segregación en cualquier proveedor futuro. |
| Ball Fit con universo completo y datos trazables | `IMPLEMENTED_AND_VERIFIED` | Provider falla cerrado, separa `bagEligible`/`fitEligible` y pruebas cubren storage, handicap y ranking. | QA interactiva de resultados; no rankear páginas incompletas. |
| Catálogo de varillas e imports | `IMPLEMENTED_AND_VERIFIED` | 474 familias runtime: 203 activas y 271 históricas; master 467/467 aceptado, 41 aliases y 80 elegibles para fitting. | Muchos pesos/flex/specs históricos siguen desconocidos por diseño. |
| Peso, flex, uso, OEM/aftermarket y aliases de varillas | `IMPLEMENTED_AND_VERIFIED` | `shaft-master-closeout` preserva nomenclaturas como 5.5/F4/M4/SF505, generaciones y stock OEM separados. | QA visual de búsqueda/filtros. |
| Imágenes licenciadas de balls/clubs/shafts | `BLOCKED_EXTERNAL` | Cobertura medida: 0/314 bolas, 0/1,276 bastones y 0/474 varillas con `imageUrl + imageSourceUrl + imageLicense`; una licencia de datos no prueba derechos de imagen. | Manifest oficial/licenciado y revisión de redistribución/hotlink por asset. No scrapear ni adivinar. |
| Fallback visual cuando falta imagen | `IMPLEMENTED_AND_VERIFIED` | `CatalogProductMedia` usa fallback limpio y falla seguro ante URL rota; la UI comunica “Sin imagen con licencia verificada”. | Sustituir sólo con assets autorizados. |
| Assets públicos runtime | `IMPLEMENTED_AND_VERIFIED` | Auditoría del working tree, incluidos catálogos/seed bajo `data/`, enlaces Markdown relativos, archivos texto/configuración en la raíz y fuentes de generadores bajo `scripts/`: 722 archivos fuente, 14 assets públicos y 30 referencias; cero archivos faltantes, cero URLs Vercel activas y cero unreferenced inexplicados. Cuatro assets legacy/históricos tienen explicación explícita; tres fixtures automatizados cubren referencias relativas, raíz presente y assets ausentes. | Repetir `npm run audit:assets` después del commit final y contra el deployment. |
| Recuperación cross-branch de imágenes | `IMPLEMENTED_AND_VERIFIED` | La auditoría no halló un blob runtime válido/referenciado ausente del canónico; screenshots históricos permanecen evidencia QA, no assets de producto. | El gap real es licencia/procedencia externa, no un cherry-pick pendiente. |
| 404 de assets en el deployment final | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | Imports locales están limpios; eso no prueba CDN/red en el Preview aún no verificado. | Recorrer UI y revisar Network en la URL fija. |
| UI/UX premium de Equipment | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | Flujos full-page, cards, búsqueda progresiva, feedback y estados vacíos están en código/tests. | Revisión owner en iPhone/desktop del Preview canónico. |

## Admin, AI y feedback

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Admin protegido por membresía/scope | `IMPLEMENTED_AND_VERIFIED` | `admin-access`, rutas server-side y tests rechazan acceso público o scope insuficiente. | Verificar roles reales en QA. |
| Admin Control Center, review y publicación | `IMPLEMENTED_AND_VERIFIED` | Código y 12 migraciones Admin forman una cadena de revisiones, previews, hashes, guards, schedule y player-safe payloads. El ledger remoto QA contiene sus 12 versiones exactas y el archivo RLS Admin pasó en la ejecución transaccional actual. | QA runtime con rol Admin real y revisión de los findings del advisor. |
| Separación de datos QA/operacionales | `IMPLEMENTED_AND_VERIFIED` | Provider/runtime clasifica fuentes y bloquea fixtures/synthetic en proyecciones públicas; tests `admin-data-environment` y closeouts P01–P05. La inspección viva confirmó columnas, constraints, guards/RPCs, 24 filas de auditoría de clasificación y cero publicaciones QA no operacionales inseguras. | Mantener el readback/no-leak como gate de cualquier import o publicación futura. |
| Migración de separación Admin | `IMPLEMENTED_AND_VERIFIED` | El remoto `20260924140818 20260924010936_admin_data_environment_separation` contiene los statements y objetos/datos equivalentes al archivo canónico; no se reejecutó `20260924010936`. | No fabricar alineación de timestamps; repetir RLS/readback después de cualquier cambio de catálogo. |
| Imports controlados y catálogos | `IMPLEMENTED_AND_VERIFIED` | Contratos, previews, validación de payload, procedencia, documentos y tests de catalog admin. | Probar con fixture QA, nunca Production. |
| Métricas/analytics agregados | `IMPLEMENTED_AND_VERIFIED` | Admin metrics, `product_usage_events_v2` y scopes sustituyen el export PII antiguo. | Validar dataset/retención y scopes en Preview. |
| Export/Admin antiguo con PII | `SUPERSEDED` | Production-hardening antiguo fue rechazado; el Control Center y exports acotados modernos son la implementación vigente. | No aplicar su migración RLS obsoleta. |
| Feature flags internos/externos | `IMPLEMENTED_AND_VERIFIED` | Registry distingue defaults por ambiente y dependencias externas; GHIN queda production-locked. | Verificar valores exactos del deployment final. |
| Rules AI: índice/búsqueda local y evidencia | `IMPLEMENTED_AND_VERIFIED` | Índice versionado, navegación, documentos, OCR fixture y tests funcionan sin inventar respuesta externa. | Mantener atribución/licencias de documentos. |
| Rules AI con proveedor generativo live | `BLOCKED_EXTERNAL` | Config/rate limit/fallback existen, pero el flag/keys autorizados no están acreditados para el Preview canónico. | Habilitación explícita, credenciales server-only y QA de respuesta/fallback. |
| AI structured actions para round setup | `IMPLEMENTED_AND_VERIFIED` | Schemas versionados, parser, clarifications, guard canónico y executor están cubiertos por suites `backyard-ai-*`. | Provider live y recorrido humano del review. |
| Boundary determinista AI→engine | `IMPLEMENTED_AND_VERIFIED` | La AI sólo propone acciones; canonical guard, validadores y review impiden mutar hechos/stakes no confirmados. | Mantener revisión humana. |
| Consentimiento AI y revalidación | `IMPLEMENTED_AND_VERIFIED` | Onboarding/settings, endpoint, cross-device y tests de acceso/consent; migración documentada en QA. | Revisión legal del copy y prueba final autenticada. |
| Scorecard vision: pipeline y revisión/corrección | `IMPLEMENTED_AND_VERIFIED` | Límites, extractor, matching, confianza, validator, telemetry y review humano tienen pruebas `scorecard-vision-v1`/`backyard-ai-scorecard`. | No implica que el proveedor de visión esté activo. |
| Scorecard vision live | `BLOCKED_EXTERNAL` | Flag externo, consentimiento de imagen y proveedor son obligatorios; por defecto queda apagado. | Credencial/modelo autorizados y QA con tarjetas sintéticas, no datos reales no consentidos. |
| AI insights, memoria y recap | `IMPLEMENTED_AND_VERIFIED` | Agregados estructurados, memoria privada opt-in, learning events y recap tienen suites dedicadas. | Provider live, revisión legal y multi-dispositivo. |
| Launch monitor por cámara/provider | `BLOCKED_EXTERNAL` | UI/schema/capture y fallbacks existen, pero no hay integración de hardware/proveedor declarada como operativa. | Dispositivo/provider autorizado y QA física. |
| Ayuda y feedback central | `IMPLEMENTED_AND_VERIFIED` | Más→Soporte, diálogo con cierre protegido, idempotencia y recibo interno; tests verifican que mailto no sea el camino principal. | Smoke final. |
| Solicitud de campo, tee, bastón, bola, varilla, apuesta, bug y sugerencia | `IMPLEMENTED_AND_VERIFIED` | `lib/feedback.ts` define las ocho categorías y campos específicos; validación/tests cubren ciudad, marca/modelo, reglas y ejemplos. | QA en Preview. |
| Persistencia privada, attachment y no-leak | `IMPLEMENTED_AND_VERIFIED` | DB-first, bucket privado, MIME+firma, límite 2 MiB, retry e idempotencia; el guard lifecycle de Feedback fue aplicado QA-only. `feedback_requests_rls.sql` comprueba grants, policy owner-only, RPC sólo `service_role`, bucket/policy privados, aislamiento A/B y rollback. Formó parte del runner remoto **17/17**; el readback confirmó 0 fixtures del runner y preservó las 13 solicitudes QA/internas existentes. | QA runtime de upload/read/delete con dos cuentas sintéticas; repetir RLS sólo si cambia schema, grants o policies. |
| Email secundario de feedback | `BLOCKED_EXTERNAL` | El receipt DB no depende del mailer y registra provider unavailable sin deshacer la solicitud. | Credencial/remitente dedicado y prueba autorizada. |

## Legal, exportación y eliminación

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Terms, Aviso Simplificado e Integral actuales | `IMPLEMENTED_AND_VERIFIED` | `lib/legal-documents.ts`, rutas `/legal/*`, hashes y versiones incluyen Terms v2 y Privacy v6 recuperados de la línea legal. | Aprobación jurídica independiente más abajo. |
| Navegación legal | `IMPLEMENTED_AND_VERIFIED` | Links desde acceso/cuenta, layouts dedicados y retorno controlado están en código/tests. | QA visual final. |
| Consentimientos separados: términos, edad, financiero, AI, marketing | `IMPLEMENTED_AND_VERIFIED` | Checkpoint, manager, betting gate, AI consent y marketing opt-in no premarcado preservan finalidades separadas; el wiring local registra sólo decisiones legalmente mapeadas en el ledger append-only. | QA autenticada de cada decisión en el Preview y revisión jurídica del copy/finalidad. |
| Evidencia legal versionada, hashed, append-only e idempotente | `IMPLEMENTED_AND_VERIFIED` | `lib/legal-evidence.ts`, la API y la cola cliente implementan texto elegido por servidor, hash reproducible y owner-auth. El RPC QA `record_legal_evidence_batch` es `SECURITY INVOKER`, sólo `service_role`, serializa por owner/entorno, limita inserts, deduplica la última decisión semántica y conserva transiciones/revocaciones; su contrato remoto pasó. | Falta QA interactiva del flujo completo y revisión jurídica; el PASS técnico no aprueba textos/finalidades. |
| Migración canónica de evidencia legal | `IMPLEMENTED_AND_VERIFIED` | Statements/objetos vivos de `20260908195537` prueban equivalencia semántica con la tabla recuperada en `20260924220041`; el hardening incremental `20260924235930` sí fue aplicado QA-only como remoto `20260925012322`. El test RLS/RPC legal pasó. | Mantener ambos mappings explícitos y no reparar timestamps por estética. |
| Wiring de consentimientos actuales al ledger legal | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | El wiring moderno, la cola idempotente/retry y los receipts fueron integrados y verificados localmente sin restaurar el `account-provider` histórico. | Probar aceptación, revocación, retry y sincronización multi-tab autenticados en el Preview; someter finalidades/textos a revisión legal. |
| Copia técnica limitada owner-auth | `IMPLEMENTED_AND_VERIFIED` | `/api/account/export`, `buildLimitedAccountExport`, botón en Legal y tests proyectan campos explícitos, límite 500 y headers privados; excluyen tokens, secretos, otras personas y columnas internas. | QA de descarga en Preview; fuentes ausentes se marcan unavailable y no se presenta como export completo. |
| Exportación completa de nube, fotos, grupos, rondas y datos locales | `MISSING_NOT_IMPLEMENTED` | La UI/JSON dice expresamente `completeCloudExport: false`; no se afirma portabilidad total. | Diseñar inventario completo, autorización, formatos, archivos y derechos de terceros antes de ofrecerlo. |
| Derechos ARCO | `LEGAL_REVIEW_REQUIRED` | Contacto de privacidad y copia técnica limitada existen, pero la herramienta no sustituye un proceso formal ARCO. | Definir procedimiento, identidad, plazos, alcance, excepciones y evidencia de respuesta. |
| Eliminación de cuenta y datos permitidos | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | API/UX, leases, archive/delete policy, cleanup y recovery están implementados/testeados. | Cuenta sintética en DB aislada, verificación de Storage/social/history y readback post-delete. |
| Textos legales, edad, datos financieros, social, geolocalización, AI y retención | `LEGAL_REVIEW_REQUIRED` | El repositorio marca copy y políticas técnicas; no existe aprobación profesional registrada. | Revisión jurídica mexicana y de cualquier jurisdicción/mercado objetivo antes de salida externa. |
| Retención/archivo/recuperación y backups con PII | `LEGAL_REVIEW_REQUIRED` | Políticas y mecanismos técnicos existen, pero los plazos son guía y no una decisión legal vigente. | Aprobar plazos, legal holds, borrado de backups y responsabilidades de custodios/proveedores. |

## Supabase, RLS, migraciones, sync, seguridad y Vercel

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Cliente/browser y servidor Supabase separados | `IMPLEMENTED_AND_VERIFIED` | `lib/supabase/client.ts`, `server.ts`, `server-auth.ts` y rutas elevadas mantienen service key fuera del frontend. | Verificar variables del deployment sin imprimir valores. |
| Auth, Database y Storage privados | `IMPLEMENTED_AND_VERIFIED` | Esquema, policies, buckets privados, URLs firmadas/servidor y tests SQL cubren los dominios principales. La ejecución remota final fue exclusivamente contra QA aislada y terminó **17/17** con rollback y 0 fixtures del runner. | Revisar los 23 findings del security advisor y completar QA runtime; esto no autoriza cambios en Production. |
| Ledger canónico de migraciones | `IMPLEMENTED_AND_VERIFIED` | `docs/CANONICAL_MIGRATION_LEDGER_2026-09-24.md` inventaría **51** archivos canónicos y **58** registros remotos QA, documenta dependencias/divergencias, tres equivalencias históricas y cuatro applies QA-only de este ciclo. | Mantenerlo ligado al SHA final; no usar repair, `db pull` ciego ni `--include-all` para alinear timestamps. |
| Cadena Admin exacta en QA | `IMPLEMENTED_AND_VERIFIED` | Las 12 versiones `20260922132057`–`20260922163818` aparecen exactamente en el ledger remoto QA y el test RLS Admin pasó en la ejecución transaccional actual. | QA runtime/readback con roles reales y triage de findings del advisor. |
| Migraciones GHIN, separación Admin, proyección player y legal | `IMPLEMENTED_AND_VERIFIED` | En QA: course player, separación Admin y la tabla legal ya existían como equivalentes semánticos; GHIN y tres hardenings incrementales fueron los cuatro applies controlados. No se afirma igualdad byte a byte para equivalencias. | No replay/repair. Mantener GHIN/Polla live apagados y completar runtime/advisor QA. |
| Migración username | `IMPLEMENTED_AND_VERIFIED` | Direct inspection de `202609230001 profile_username_availability` confirmó nombre, statements, función viva y ACL del contrato canónico. | Prueba concurrente con dos cuentas sintéticas en Preview. |
| Versiones de producto remote-only posteriores | `IMPLEMENTED_AND_VERIFIED` | `20260923051051` corresponde semánticamente a la proyección owner-course y `20260924140818` a separación Admin; las cuatro versiones QA-only nuevas quedan identificadas en el ledger. Los demás registros históricos permanecen dependencias de recovery, no candidatos de replay. | Preservar los 58 registros remotos y sus objetos en DR; no fabricar timestamps locales. |
| RLS actual de QA | `IMPLEMENTED_AND_VERIFIED` | La ejecución remota transaccional ejecutó los **17** archivos contra `bymeopxkxapfizeeqeyb`: 17/17 pasaron, incluidos legal RPC/lifecycle, Feedback A/B/RPC/Storage y Polla owner/publication/lifecycle. El readback confirmó 0 fixtures fijos del runner en Auth, tablas o Storage; las 13 solicitudes internas Feedback preexistentes se conservaron. Production no fue consultada ni modificada. | Completar readbacks runtime y conservar la barrera Production. |
| Runner RLS canónico | `IMPLEMENTED_AND_VERIFIED` | `scripts/run-preview-rls-tests.mjs` fija las refs exactas, exige TLS verificado y enumera exactamente los **17/17** archivos `*_rls.sql`; su test impide omisiones/duplicados. El conjunto completo pasó en QA aislada. | Conservar la barrera Production y repetir tras cualquier cambio de esquema/policy. |
| Migraciones aplicadas en esta consolidación | `IMPLEMENTED_AND_VERIFIED` | Cuatro, sólo QA: GHIN `20260924233419`, Feedback lifecycle `20260925010316`, legal ingest `20260925012322` y Polla Realtime `20260925012920`. No se usó repair, pull ciego ni `--include-all`. | Cero apply pendiente por semántica canónica en esta QA; cualquier futuro cambio exige plan controlado separado. |
| Cloud sync y offline | `IMPLEMENTED_AND_VERIFIED` | Esquemas, cycle/gate, conflictos, tombstones, media sync, local-first y service worker tienen pruebas extensas. | QA de red real, background y dos dispositivos. |
| Health/runtime identity sanitizado | `IMPLEMENTED_AND_VERIFIED` | `/api/health`, `lib/server-runtime.ts` y tests exponen únicamente metadata de liveness/runtime, versión y SHA sanitizados, sin secretos ni afirmaciones de capacidad funcional. | Verificar respuesta del deployment final contra SHA esperado; no usar health como sustituto de smoke funcional. |
| Secrets server-only y sanitización | `IMPLEMENTED_AND_VERIFIED` | GHIN, Supabase admin, AI y mailers no usan variables públicas; rutas limitan bodies, orígenes, tiempos y errores. La publishable key y `SUPABASE_SECRET_KEY` de QA quedaron limitadas en Vercel al scope Preview y a `integration/backyard-current`; no se seleccionó Production. | Repetir auditoría de variables/logs tras cualquier cambio de entorno; no exponer ni copiar valores a documentación o frontend. |
| Security scan de repositorio/backups | `IMPLEMENTED_AND_VERIFIED` | Scanner y gates de backup buscan material prohibido; workflow fija toolchain/CA y tests ejercitan fallos seguros. El advisor QA devolvió 23 hallazgos de seguridad (17 `WARN`, 6 `INFO`) y 125 de rendimiento (14 `WARN`, 111 `INFO`); no se convierten en PASS por documentarlos. | Triar/remediar o justificar individualmente los findings antes del cierre de seguridad/rendimiento. |
| Vercel sólo despliega la rama canónica relevante | `IMPLEMENTED_AND_VERIFIED` | `vercel.json` habilita `integration/backyard-current` y bloquea ramas de backup/hotfix incluidas; la configuración remota y el Branch Domain fueron comprobados. | Mantener el mapping exclusivo y no promover a Production. |
| URL fija y binding a SHA | `BLOCKED_EXTERNAL` | Código, runners y docs esperan `https://dev.thebackyard.com.mx`; el Branch Domain ya apunta exclusivamente a `integration/backyard-current` y el Preview de la rama desplegó correctamente. DNS público aún devuelve `NXDOMAIN`, por lo que la URL no es utilizable hasta crear el CNAME externo requerido. | Configurar el CNAME, esperar propagación y registrar URL→SHA del deployment final. |
| Cero URLs Preview hardcodeadas activas | `IMPLEMENTED_AND_VERIFIED` | El auditor cubrió raíces runtime/config/data/docs/scripts y referencias Markdown/script: 30 referencias, 0 archivos faltantes y 0 URLs Vercel hardcodeadas activas. | Los closeouts históricos pueden conservar URLs como evidencia, no como destino operativo; repetir el gate tras el commit/deploy final. |
| Console/network QA del Preview final | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | En el artefacto de rama: 0 errores/warnings de consola, 0 errores/fatal en logs Vercel, 38 assets renderizados y 17 estáticos con 0 fallos, APIs públicas sanas y rutas Admin/GHIN protegidas. El catálogo público no filtró fixtures sintéticos. | Repetir en `dev.thebackyard.com.mx` y completar auth, perfil, cursos/nearby autenticado, ronda, equipo y social con cuentas QA. |

## Backups, disaster recovery y continuidad

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Automatización de backup offsite | `IMPLEMENTED_AND_VERIFIED` | Workflow, inventario, dump PostgreSQL 17, Storage, manifest, packaging y safety gates recuperados selectivamente de main; tests de backup/automation versionados. | Implementación de código no prueba un backup real. |
| Cifrado de DB/Storage y checksum | `IMPLEMENTED_AND_VERIFIED` | Envelope authenticated-encryption, decrypt, manifest y verificador tienen pruebas; docs aclaran que el tar exterior/metadata no se afirman cifrados. | Revalidar custodia/rotación real de la llave y probar su uso en un restore aislado. |
| Google Drive offsite, chunks/retry/resume | `IMPLEMENTED_AND_VERIFIED` | Cliente, Shared Drive root exacto, retry budget, chunks replayables, redirects/resume y diagnostics están integrados con tests; el run programado observado terminó verde. | Revalidar permisos y custodia en consola sólo durante una ventana operativa autorizada; no lanzar otro backup para demostrar código. |
| Backup offsite real observado | `IMPLEMENTED_NEEDS_INTERACTIVE_QA` | Workflow activo `365582254`; run programado `35979285016` exitoso sobre SHA `2c15c9a`; artifact `10798973211` de 24,437,675 bytes con expiración 2026-10-01. Esto acredita publicación de un paquete, no recuperación. | Owner debe verificar custodia/legibilidad del par remoto y ejecutar un restore drill desechable; no se disparó un nuevo run durante esta consolidación. |
| Retention planner dry-run | `IMPLEMENTED_AND_VERIFIED` | Daily/weekly/monthly, pares package+checksum y fail-closed; apply destructivo permanece `false`. | Aprobar política antes de trash/borrado real. |
| Aplicar retención real | `LEGAL_REVIEW_REQUIRED` | Los plazos son guía técnica y tocarían copias con PII. | Aprobación legal/owner, legal holds, rollback y evidencia de operación. |
| Runbooks completos de DR | `IMPLEMENTED_AND_VERIFIED` | Arquitectura, Auth, DNS, GitHub, Supabase, Storage, Vercel, provider migration y restore-from-zero están recuperados. | Revisar contra cuentas/owners reales sin ejecutar cambios. |
| Restore drill end-to-end | `BLOCKED_EXTERNAL` | No existe evidencia de restaurar DB/Auth/Storage en un target aislado ni RTO/RPO medido. | Proveer snapshot completo, llave separada, target desechable y autorización; nunca ensayar sobre Production. |
| RPO/RTO garantizados | `MISSING_NOT_IMPLEMENTED` | Los runbooks sólo proponen objetivos; sin restore drill no pueden garantizarse. | Medir pérdida/tiempo en ejercicios repetibles y registrar resultados. |
| Recovery de Auth/OAuth/email | `BLOCKED_EXTERNAL` | Runbooks preservan orden y prohíben consentir usuarios automáticamente. | Acceso a consolas, signing keys/config, dominios y destinatarios autorizados. |

## Capacidades adicionales descubiertas

| Requisito | Estado | Evidencia actual | Pendiente real |
|---|---|---|---|
| Membership UI Free/Pro | `IMPLEMENTED_AND_VERIFIED` | Registry, beneficios y página de membership existen sin cobrar ni bloquear Beta. | No interpretar UI como suscripción activa. |
| Cobros/paywall | `MISSING_NOT_IMPLEMENTED` | No hay checkout/proveedor de pagos activado como parte de la app canónica. | Diseño comercial, proveedor, impuestos, legal y seguridad antes de implementar. |
| Shot Tracking y GPS domain | `IMPLEMENTED_AND_VERIFIED` | Dominios/migración QA documentada, snapshots de palo y tests de shots/analytics. | Captura física y proveedor GPS se validan por separado. |
| Wearable | `BLOCKED_EXTERNAL` | Existe interface fail-closed, no SDK/device operativo. | Acuerdo/SDK, privacidad y hardware. |
| Rangefinder | `BLOCKED_EXTERNAL` | Existe interface fail-closed, no SDK/API operativo. | Proveedor autorizado y hardware. |
| TheGrint u otra integración no versionada | `MISSING_NOT_IMPLEMENTED` | Sólo aparece como requisito/antecedente; no hay cliente canónico válido. | No afirmar integración sin contrato/código. |

## Pendientes que impiden un cierre global

1. Publicar el CNAME externo `dev` indicado por Vercel, con proxy desactivado, y confirmar su propagación. El Branch Domain ya está enlazado exclusivamente a `integration/backyard-current` y el Preview de la rama despliega; Production permanece intacto.
2. Cuando `https://dev.thebackyard.com.mx` resuelva, ejecutar Google y OTP reales, browser smoke autenticado completo, console/network y validación URL→SHA en ese único origen.
3. Revisar/remediar o justificar los 23 findings de seguridad y 125 de rendimiento del advisor y completar readbacks runtime. El runner RLS canónico ya pasó 17/17 en QA aislada con rollback/0 fixtures fijos; cuatro migraciones fueron aplicadas sólo a QA y quedaron registradas exactamente.
4. Mantener GHIN live apagado hasta contar con credenciales/entitlement autorizados; autenticación, golfer lookup, Score History y Course Data continúan sin demostración real, y score posting debe permanecer ausente.
5. Validar interactivamente en Preview el wiring legal ya integrado y verificado localmente; someter textos, finalidades, retención, ARCO y licencias a revisión jurídica.
6. Completar QA física de iPhone/Safari/PWA, cámara QR, geolocalización, fotos, share/download y ciclo offline/background.
7. Obtener un manifest autorizado de imágenes de producto. Top-Flite y Amazon Basics permanecen fuera hasta contar con procedencia suficiente.
8. Verificar la custodia/legibilidad del backup offsite observado y ejecutar un restore drill en un ambiente desechable; un artifact verde no equivale a recuperación operativa.
9. Implementar el layout temporal La Vista Par 70 sólo si se obtiene una tarjeta/fuente autoritativa, con identidad, hoyos, tees y evidencia propios; hoy está `MISSING_NOT_IMPLEMENTED` y no debe derivarse de los layouts Par 72 o Par 69.

Hasta resolver estos puntos, el documento conserva estados granulares y no convierte build, tests locales, una rama histórica o un Preview anterior en evidencia de cierre total.

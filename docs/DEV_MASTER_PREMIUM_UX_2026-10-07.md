# The Backyard — Master Premium UX: implementación y evidencia DEV

Fecha: 7 oct 2026. Rama: `integration/backyard-current`. URL canónica: **https://dev.thebackyard.com.mx**.

INITIAL HEAD: `5114642548d1e2f7b5da86748bd5fa9e03c52e0c`, árbol limpio. HEAD de producto validado: `17c02e07403c23ac833ef3b657a6e86536af5894`. FINAL HEAD es el commit que guarda este reporte; su SHA exacto se entrega en el mensaje de cierre. El reporte agrega documentación al mismo código validado y constituye una base para integrar después GPS desde su rama aislada.

**PASS**: implementación, validación técnica y recorridos con datos disponibles. **PENDING_DEVICE_QA**: iPhone físico. **PENDING_INTERACTIVE_QA**: únicamente capturas avanzadas de hoyo y golpes GPS reales ausentes en las cuentas revisadas. No se fabricó actividad para obtener esas capturas.

Este documento actualiza la evidencia de la pasada anterior [DEV_GOLF_NAVIGATION](DEV_GOLF_NAVIGATION_2026-10-07.md). Su pendiente anterior de notificaciones recibidas queda resuelto con historial real ya existente en DEV.

## Referencias y alcance preservado

Se inspeccionaron los diez adjuntos nuevos: TheGrint Navigation 1–3, Scorecard 1–3, Backyard Current QA 1–3 y Target Ecosystem. TheGrint aporta profundidad y facilidad de regreso; The Backyard aporta la dirección visual. Los screenshots secuenciales sustituyen los videos que el usuario confirmó que no pudo adjuntar. Las referencias anteriores también se conservaron. Los datos de las imágenes no se incorporaron al producto.

La implementación continúa sobre el DEV actual. No hubo reset, revert, merge de GPS, cambio de framework, proveedor, fuentes ni dependencias. La cuenta, las tarjetas, preferencias, vínculos GHIN e históricos principales se revisaron sin modificarlos.

## Arquitectura anterior y nueva

La base inicial ya tenía la navegación global, cinco sub vistas de Carrera, el stack de objetos de la primera pasada, lectores sociales autenticados y controles de participación. Esta pasada conserva esa arquitectura. Persistían cuatro problemas visibles: ronda dominada por una tabla, ruta compartida con experiencia distinta, historial de notificaciones condicionado por preferencias de entrega y filas de Carrera que reutilizaban el grid numerado de las últimas 20 tarjetas.

Ahora la ronda abre **Resumen / Tarjeta**, con **Participación** adicional cuando se entra desde una ronda compartida. El resumen muestra resultados calculados, mitades y momentos reales; la tarjeta tiene su propio contexto; el hoyo profundiza en hechos capturados. Las opciones históricas se abren como otro objeto y no finalizan una ronda simplemente por visitarlas. Notificaciones mantiene el historial recibido aunque ya esté leído o la entrega esté pausada. Carrera usa filas flexibles y abre Historial antes de Evolución.

El stack conserva los módulos y frames anteriores montados y ocultos. Back restaura selección, datos cargados y scroll. La navegación inferior sigue reflejando el módulo padre. Los parámetros de URL seleccionan destinos, nunca conceden acceso a datos.

## Route map final

Las URLs existentes permanecen válidas. Las selecciones conservan `screen`, `home`, `career` y `careerDetail` según el módulo.

| Destino | Selección |
| --- | --- |
| Inicio | `screen=welcome&home=feed/friends/add-friends` |
| Carrera | `screen=career&career=summary/achievements/rivalries/rounds/tournaments` |
| Jugador | `object=player&objectId=<UUID>` |
| Ronda | `object=round&objectId=<referencia>&objectSource=activity/history/shared` |
| Hoyo | Ronda más `object=hole&hole=1..18` |
| Campo | Ronda más `object=course` |
| Opciones propias | `object=round-options&objectSource=history&objectId=<snapshot>` |
| Equipo | `object=equipment&objectId=<actividad>&item=<equipo real>` |
| Logro | `object=achievement&objectId=<actividad>&item=<logro ganado>` |
| Leaderboard de ronda | `object=leaderboard&objectId=<actividad>` |
| Actividad notificada | `object=activity&objectId=<actividad>` |
| Mis estadísticas | `object=statistics&objectId=mine` |
| Análisis histórico existente | `object=analysis&objectId=mine` |
| My Coach contextual | `object=coach&objectId=mine&category=<categoría>&metric=<métrica>&period=<periodo>` |
| Reglas contextual | `object=rules&objectId=mine` |
| HCP | `screen=career&career=summary&careerDetail=index` |
| Últimas 20 / Atest | `screen=career&career=summary&careerDetail=attest` |
| QR / amistad | Enlace público existente `/?friend=<UUID>` |

Resumen/Tarjeta/Participación y las mitades son estados de la vista de ronda preservada en el stack; no expanden hoyos en el Feed. Las entradas existentes de notificaciones, Play, My Coach y Reglas se conservan.

## Component map

| Responsabilidad | Componentes / lector |
| --- | --- |
| Stack y regreso | `golf-object-navigation`, `GolfObjectViews`, `GolfDetailHeader`, contexto de datos |
| Feed y acciones | `CloudSocialActivity`, componentes sociales existentes, `social-activity.server` |
| Perfil y bolsa | `GolfPlayerProfile`, `EquipmentList`, `GolfEquipmentMedia`, `GolfEventDetail` |
| Ronda / tarjeta / hoyo | `GolfRoundDetailView`, `PremiumScorecard`, `ScoreSymbol`, `GolfHoleDetailView` |
| Datos capturados | `capturedHoleFacts`, `historyGolfDetail`, `safeSocialRoundCard`, `participantCard` |
| Participación / opciones | `RoundParticipationCard`, `HistoricalRoundDetail` en su propia vista |
| Amigos / QR | `FriendsHub`, `SocialConnectionsPanel`, generador y scanner existentes |
| Notificaciones | `NotificationCenter`, `NotificationRow`, presentación y lector existentes |
| Carrera / índices | `CareerRounds`, `GhinImportHistory`, `CareerIndexPanel`, vistas HCP/Atest existentes |
| Estadísticas / mejora | `PremiumGolfStatistics`, `GolfCoachMetricContext`, My Coach y Rules existentes |
| Navegación global | Header/wordmark oficiales y `AppBottomNav` con Play central |

## Cambios por módulo

| Módulo | Cambio concreto |
| --- | --- |
| Navegación | Opciones de ronda dedicadas; shared round usa Summary/Card; Back conserva frame, tab y contexto |
| Feed | Equipamiento con fotografía o asset de categoría; eventos y métricas reales, sin tabla de 18 hoyos inline |
| Perfiles | Cinco sub vistas conservadas; bolsa con equipo real y destino por elemento; privacidad preservada |
| Rondas | Resumen con distribución eagle/birdie/par/bogey/dobles, front/back/total y momentos reales |
| Scorecard | Forma + color accesibles, par/score/+−/putts; sólo accuracy y penalidades explícitamente capturadas |
| Hoyos | Resultado visual, datos propios, club/distancia/unidad cuando existen; empty state de golpes verdadero |
| Equipo | Fotografía real primero; corte monocromo del asset propio como referencia de categoría identificada; sin emoji infantil |
| Notificaciones | Historia recibida retenida, orden cronológico, punto verde unread, badge sólo unread, read persistido antes del destino |
| Carrera | Historial primero; Evolución separada; layout de campo/score flexible; cinco tabs y ausencia del hero preservadas |
| HCP | Fuente activa correcta conservada; low HCP en español; no percentil ni timeline inventados |
| Atest | Últimas 20 reales; 5% por tarjeta atestada; pendientes y espacios ausentes distinguibles |
| Stats / Coach | Cohortes reales; payload category/metric/period y unidades existentes; sin IA o drills ficticios |
| Microcopy | Tarjeta, equipo, resultados, logros y estados en español; términos universales de golf conservados |

## Integridad, infraestructura y privacidad

**Schema/migrations: ninguna.** Se reutilizan tablas, RLS, ownership, timestamps, `read_at`, índices y APIs existentes. No hubo apply DB, backfill, usuarios nuevos ni feed events artificiales. No se cambiaron preferencias de entrega para producir notificaciones.

Los hechos avanzados pasan por una allowlist y validación de tipo/rango. Dirección al centro no prueba FIR; score/par no prueba GIR; lie no prueba OB. Cero explícito se distingue de ausencia. Notas privadas, coordenadas y detalles de otros jugadores se excluyen de la proyección social. Shared rounds sólo exponen al participante su captura avanzada y su tee, preferentemente desde la asignación congelada propia. El tee actual del perfil no reemplaza el de la ronda.

Las unidades se leen de la preferencia existente para presentación. Las distancias almacenadas no se reescriben. No se cambia la abstracción ni el proveedor GPS. Las vistas sociales no exponen posiciones privadas. Los detalles propios muestran golpes existentes sólo cuando están disponibles y autorizados.

Abrir opciones históricas no ejecuta una finalización automática. La sincronización de cierre existente requiere la acción contextual explícita. Corrección, participación, exportación y controles existentes se conservan.

## Cuentas y datos reales comprobados

| Cuenta | Datos guardados / fuente actual |
| --- | --- |
| `el_mongas@yahoo.com.mx` | 27 filas propias; 24 snapshots de histórico al excluir 3 live; 23 completed; 21 elegibles para el cálculo Backyard; últimas 20, mejores 8 → **5.5 calculado** |
| Mongas: selección activa | Backyard deshabilitado, fuente **GHIN**, asociación verificada, índice **30.8**, revisión 8 jun 2023. No se activó Backyard para obtener una captura |
| Mongas: Atest | 20 tarjetas reales, 10 atestadas → **50%**. Atest Backyard no es certificación GHIN/WHS |
| `said_aba@hotmail.com` | GHIN verificado **7.9**, revisión 24 sep 2026; 3 filas propias, 1 snapshot de histórico, 0 completed/elegibles Backyard |
| `@qa_carlos_fairway` | Cuenta QA existente: ronda 4 sep 2026, 83/+11, 35 putts; Front 44/+8/17 putts; Back 39/+3/18 putts |
| Carlos: resultados | 1 birdie, 7 pars, 8 bogeys, 2 dobles; H15=4/par5/2 putts, H2=5/par3/2 putts; promedio score 81.3 y putting 35.3/8 rondas comparables |
| `@qa_diego_green` | Ronda 5 oct: 84/+12, 6 pars, 12 bogeys; perfil, actividad y logros existentes |
| Mongas: Amigos | Tres relaciones existentes: Carlos, Diego y Said At |
| Said At `@saidabaid` | Amigo distinto de `said_aba`; nueve elementos de bolsa reales. Fotografías específicas no disponibles: assets de categoría declarados |
| Carlos: notificaciones | 25 eventos recibidos autorizados visibles. Lectura de uno y mark-all conservan las 25 filas; nueva sesión confirma 25 visibles y 0 unread en la vista |

El audit read-only de las cuentas principales volvió a producir hashes idénticos al baseline:

- Mongas: `84714bf4dde3ef5dbfd8254ce36848efe68a3123d225293ea0b023b294847091`.
- Said: `e844feb0b282ddd5e52cb10de36c2892c388facfafe58bf599e48c5e8d585374`.

El cálculo Backyard de Mongas tiene dos puntos reales (5 y 6 oct → 5.5), pero su fuente activa sigue siendo GHIN. No se afirma que toda la corrida previa de 20 tarjetas se hubiera completado. Sólo se reporta lo guardado y elegible. La comparación incluye tarjetas, preferencias de índice y registros GHIN. Los logins de QA no enviaron correos ni cambiaron contraseñas. Únicamente se guardó lectura de notificaciones existentes de la cuenta QA Carlos para verificar el comportamiento solicitado; no se atestaron o corrigieron tarjetas.

## Tests y verificaciones

| Verificación | Estado | Resultado |
| --- | --- | --- |
| `pnpm test` | PASS | **4,707 app + 117 scripts = 4,824**, cero fallos/skips |
| `pnpm typecheck` | PASS | Next typegen y TypeScript |
| `pnpm lint` | PASS | ESLint |
| `pnpm build` | PASS | Next 16.3.3; 41 páginas generadas |
| `git diff --check` | PASS | Sin errores de whitespace; avisos LF/CRLF de la configuración existente |
| Integridad principal | PASS | Hashes sin cambios; fuente GHIN/Backyard conservada |

Logs locales: `tmp/master-premium-{tests,typecheck,lint,build}.log`. La suite de scripts requiere sus fixtures locales de Git y HTTP; se ejecutó con esa capacidad y pasó completa. Se corrigió el tipado del nuevo fixture de tees antes de repetir todos los checks.

Tests añadidos en esta pasada: siete en `golf-premium-depth.test.ts`, dos en `notification-history-ui.test.ts` y uno adicional en `golf-object-navigation.test.ts` (**10 adicionales** sobre los 4,697 de app iniciales). Cubren ausencia/cero, no inferencia FIR/GIR/OB, ownership de hechos y tee, unidades sin mutación, fotografía/fallback, destino por hoyo, layout GHIN, shared Summary/Card/Participation, 51 notificaciones paginadas retenidas tras leer/mark-all, cronología y solicitudes resueltas, opciones/back. Las pruebas existentes de símbolos eagle/birdie/par/bogey/doble y front/back/total siguen pasando.

## Runtime QA en DEV

| Recorrido / estado | Resultado |
| --- | --- |
| Feed → Diego → Logros/Rondas → ronda → Tarjeta → hoyo → Back | PASS; tarjeta y tab Rondas retenidas; regreso a Feed conserva scroll (823 px observados) |
| Amigos → Said At → Equipo → Putter → Back | PASS; Equipo permanece seleccionado |
| Agregar amigos → búsqueda Said → resultados / Mi QR | PASS; búsqueda y QR reales; cámara física pendiente |
| Carrera → Rondas | PASS; campos largos y scores sin traslapes en 390/393/430 px |
| Carlos: ronda 4 sep → Front/Back → H15 birdie / H2 doble | PASS; datos propios, símbolos y putts reales |
| Shared round → Resumen → Tarjeta → Participación → hoyo → Back | PASS; score propio 83/35 putts; tarjeta seleccionada al volver, controles de participación existentes preservados |
| Hole → Reglas → mismo Hole | PASS; módulo contextual y regreso preservados |
| Carrera → HCP → últimas 20 → tarjeta 103 → Opciones → Back | PASS; GHIN 30.8, Atest 50%; opciones separadas, sin finalización automática |
| Stats → Putting → My Coach | PASS; 35.3, 8 rondas comparables, periodo y categoría reales |
| Notificación → lectura guardada → actividad real → Back | PASS; misma fila recibida permanece, sólo pierde estado unread |
| Mark all / historial pausado / nueva sesión | PASS; 25 filas visibles conservadas; badge visible unread cero |
| Hoyo sin GPS / métricas ausentes | PASS; empty state, sin mapa, club, FIR/GIR u OB inventados |
| Capturas avanzadas y golpes GPS reales | PENDING_INTERACTIVE_QA; ausentes en cuentas revisadas, no espera la rama GPS |
| Safari/PWA, Dynamic Island, safe areas, cámara QR y lectura táctil real | PENDING_DEVICE_QA; viewport Chromium no demuestra comportamiento físico iOS |

Responsive: 390×844, 393×852, 430×932. Anchos de documento observados 375/378/415 con scrollbar de escritorio, todos dentro del viewport; sin overflow horizontal. Capturas reales de filas/HCP en las tres dimensiones. Semántica, labels, focus, targets y score shapes conservados/verificados por componentes y tests. No se aceptaron permisos de cámara/ubicación ni se simuló proximidad.

## Performance y límites prácticos

Feed con cursor/límite 30; caché de actividad de sesión 48 entradas/60 s con deduplicación; stack limitado y carga lazy; historial y notificaciones paginados. Nuevos campos se proyectan en la lectura existente, sin una query por hoyo o jugador. Shared round obtiene la tarjeta autorizada completa al abrir cada objeto: no hay 18 lecturas por tarjeta, aunque el lector shared aún no usa la caché coalescida de actividad. No se añadió prefetch indiscriminado ni imágenes enormes externas.

No hubo benchmark de FPS en iPhone físico ni load test de una comunidad grande. La suite y los recorridos desktop no sustituyen esas mediciones. Un timeline GHIN no puede reconstruirse desde una única revisión; se muestra el estado insuficiente. Equipment usa referencia visual de categoría cuando no existe foto del modelo. Proximidad y métricas avanzadas no se inventan.

## Commits de esta pasada

1. `377faeb` — profundizar ronda/hoyo/equipo, Carrera y hechos capturados.
2. `6938593` — conservar historial recibido y lectura de notificaciones.
3. `9b9a84d` — shared rounds con Resumen/Tarjeta/Participación.
4. `0a7a58d` — selección Historial/Evolución de Carrera.
5. `17c02e0` — tee congelado propio en shared rounds y test de tees mixtos.
6. Commit de este documento — evidencia final y mapa de implementación.

Todos continúan sobre `5114642`, en la misma rama DEV, con push explícito a `integration/backyard-current`. La documentación no modifica el bundle funcional.

## Archivos modificados

37 archivos de producto/tests y este reporte: **38**.

Componentes:
`app/page.tsx`; `app/components/career-hub.module.css`, `career-index-panel.tsx`, `career-rounds.tsx`, `cloud-social-activity.module.css`, `cloud-social-activity.tsx`, `ghin-import-history.module.css`, `ghin-import-history.tsx`, `golf-equipment-media.module.css`, `golf-equipment-media.tsx`, `golf-object-data.tsx`, `golf-object-views.tsx`, `golf-object.module.css`, `golf-player-profile.tsx`, `golf-round-detail.tsx`, `group-invitations.tsx`, `historical-round-detail.tsx`, `notification-center.module.css`, `notification-center.tsx`, `premium-scorecard.tsx`.

Contratos/lectores:
`features/notifications/presentation.ts`; `lib/golf-captured-hole-facts.ts`, `golf-object-navigation.ts`, `golf-scorecard-presentation.ts`, `round-achievements.ts`, `shared-round-participants.ts`, `social-activity-contract.ts`, `social-activity.server.ts`, `social-round-card.ts`.

Tests:
`tests/career-rounds.test.ts`, `golf-object-navigation.test.ts`, `golf-premium-depth.test.ts`, `group-library-draw-ux.test.ts`, `home-social-ui.test.ts`, `notification-center.test.ts`, `notification-history-ui.test.ts`, `notification-list-service.test.ts`.

## Capturas grandes

[Galería completa local](../.qa-artifacts/master-premium-ux/gallery.html): una pantalla legible por sección, sin mosaico de thumbnails. Archivos locales fuera de Git/bundle. La galería incluye referencia visual del ecosistema, screenshots disponibles y los pendientes declarados.

| Nº | Captura real / estado |
| --- | --- |
| 1 | [Feed](../.qa-artifacts/master-premium-ux/01-feed.jpg) |
| 2 | [Perfil](../.qa-artifacts/master-premium-ux/02-player-profile.jpg) |
| 3 | [Perfil → Logros](../.qa-artifacts/master-premium-ux/03-profile-achievements.jpg) |
| 4 | [Perfil → Equipo](../.qa-artifacts/master-premium-ux/04-profile-equipment.jpg) |
| 5 | [Round Summary](../.qa-artifacts/master-premium-ux/05-round-summary.jpg) |
| 6 | [Front 9](../.qa-artifacts/master-premium-ux/06-scorecard-front.jpg) |
| 7 | [Back 9](../.qa-artifacts/master-premium-ux/07-scorecard-back.jpg) |
| 8 | [Birdie](../.qa-artifacts/master-premium-ux/08-birdie.jpg) |
| 9 | [Bogey](../.qa-artifacts/master-premium-ux/09-bogey.jpg) |
| 10 | [Doble bogey](../.qa-artifacts/master-premium-ux/10-double-bogey.jpg) |
| 11 | [Hole Detail](../.qa-artifacts/master-premium-ux/11-hole-detail.jpg) |
| 12–14 | PENDING_INTERACTIVE_QA; sin captura avanzada real de Tee/FIR, GIR o Penalty/OB |
| 15 | PENDING_INTERACTIVE_QA; sin GPS real. [Empty state validado](../.qa-artifacts/master-premium-ux/15-shots-empty.jpg) |
| 16 | [Notifications unread](../.qa-artifacts/master-premium-ux/16-notifications-unread.jpg) |
| 17 | [Notification read](../.qa-artifacts/master-premium-ux/17-notification-read.jpg) |
| 18 | [Notifications history](../.qa-artifacts/master-premium-ux/18-notifications-history.jpg) |
| 19 | [HCP Detail](../.qa-artifacts/master-premium-ux/19-hcp-detail.jpg) |
| 20 | [Últimas 20](../.qa-artifacts/master-premium-ux/20-latest-cards.jpg) |

Complementos: [Amigos](../.qa-artifacts/master-premium-ux/friends.jpg), [Agregar](../.qa-artifacts/master-premium-ux/add-friends.jpg), [Carrera resumen](../.qa-artifacts/master-premium-ux/career-summary.jpg), [Filas corregidas](../.qa-artifacts/master-premium-ux/career-history-rows.jpg), [Stats](../.qa-artifacts/master-premium-ux/statistics.jpg), [Coach](../.qa-artifacts/master-premium-ux/coach-context.jpg), [Equipo detalle](../.qa-artifacts/master-premium-ux/equipment-detail.jpg), [Shared Summary](../.qa-artifacts/master-premium-ux/shared-round-summary.jpg).

Evaluación visual: PASS para jerarquía, símbolos, campos/score legibles, bolsa con assets limpios y notificaciones retenidas. Evaluación de interacción: PASS para destinos y regreso disponibles; los pendientes físicos y de datos se enumeran explícitamente. Las capturas de carga se excluyeron de la entrega final. No se editaron screenshots para aparentar contenido.

## Entornos

DEV Supabase: `bymeopxkxapfizeeqeyb`. Deploy de producto `dpl_ANeXZhkcAMMSK84EcWoJ35sL2AtB`, READY, SHA `17c02e07403c23ac833ef3b657a6e86536af5894`, alias DEV, target Vercel `null`. Su ronda compartida se comprobó en runtime con tee BLANCAS y datos propios. La identidad exacta y el SHA del despliegue canónico final del reporte se comprueban y entregan con el cierre.

Referencias protegidas sin cambios: local main `09de83f69ad80116fda83abb4abd1e0a08660ef1`, origin/main `a1b33ddfad905e0d45bcfe0848916ba19ceed0af`, origin/beta `c9a9d3550a0feb39fdeda82fcc79ab6eddb1a582`.

DEV: MODIFIED

main: NOT TOUCHED

beta: NOT TOUCHED

Production: NOT TOUCHED

app.thebackyard.com.mx: NOT TOUCHED

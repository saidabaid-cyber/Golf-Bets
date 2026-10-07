# The Backyard — implementación y QA DEV

Scope: `integration/backyard-current`, canonical QA `https://dev.thebackyard.com.mx`.
Protected starting HEAD: `5b946739913954770e5c0362bf5f170f1c9712fb`, clean worktree.

## Evidence and baseline

All eight conceptual JPG references were inspected, including the ten-screen ecosystem map. The three chronological TheGrint navigation sheets and `Backyard_current_DEV_1.jpg` supplement them. The user confirmed the videos could not be attached. `Backyard_current_DEV_2.jpg` is not present in the supplied files.

Before: root app-local screen router; social Home subviews; inline social scorecard; a limited Friends identity view; dedicated legacy historical detail; five Career subviews; premium Index/Atest details. Backend already owns social events, comments, likes, friendship requests, notifications, equipment and participant confirmation. GPS abstractions and captured shots already exist; map imagery is not available through the current historical reader.

After: a bounded browser-history object stack above the preserved module. Module and preceding object components stay mounted and hidden while deeper views are shown. URL selections do not confer data access. Back restores the previous frame's scroll, filters and loaded data. Bottom navigation retains the parent module; contextual Coach and Rules use their respective global active state.

## Route map

Existing URLs and QR `/?friend=<UUID>` remain valid. Object URLs retain `screen`, `home`, `career` and `careerDetail` context.

| Destination | Selection |
| --- | --- |
| Player | `object=player&objectId=<UUID>` |
| Round | `object=round&objectId=<reference>&objectSource=activity/history/shared` |
| Hole | round selection plus `object=hole&hole=1..18` |
| Course | round selection plus `object=course` |
| Equipment | `object=equipment&objectId=<activity UUID>&item=<real item ID>` |
| Achievement | `object=achievement&objectId=<activity UUID>&item=<actual earned label>` |
| Round leaderboard | `object=leaderboard&objectId=<activity UUID>` |
| Notification activity | `object=activity&objectId=<activity UUID>` |
| Premium statistics | `object=statistics&objectId=mine` |
| Index / last 20 | `screen=career&career=summary&careerDetail=index/attest` |
| Full statistics | `object=analysis&objectId=mine` |
| Coach from statistics | `object=coach&objectId=mine&category=<category>&metric=<metric>&period=<period>` |
| Rules from an object | `object=rules&objectId=mine` |

## Component map

Reused: PrimaryHeader/BackyardWordmark, AppBottomNav/official Play, ProfileAvatarMedia, ScoreSummary, SocialRoundActivityCard and all social mutations, FriendsHub, real QR/scanner, CareerHub/IndexPanel, canonical StatsDashboard/RulesPanel/MyCoach, RoundParticipationCard and legacy historical options.

Added: GolfNavigationContext/useGolfObjectNavigation, GolfObjectViews, bounded activity reader, GolfDetailHeader/EmptyState/Skeleton, GolfPlayerProfile/EquipmentList/EventDetail, GolfRoundDetailView/HoleDetailView/CourseDetailView, PremiumScorecard/ScoreSymbol, PremiumGolfStatistics/GolfCoachMetricContext.

## Data boundaries

No schema, migration, dependency, font or GPS-provider change. The existing authenticated activity reader gains an author filter after the existing viewer RLS selection. Existing privacy/hash/source checks still run. Social hole details project only the authorized author's captured score, par, putts, FIR, GIR, penalties and permitted yardage. They omit private notes, GPS coordinates and other players' private data.

Private history uses the existing historical recap and personal participant perspective locally. Shots remain in that authorized history. Unknown facts remain absent; incomplete captures do not produce complete totals. Profiles expose only permitted identity and activity; no guessed city, HCP, mutual-friend count, achievement, percentile, proximity or location. Own index uses the existing verified GHIN/Backyard/no-index resolution. Coach context carries a category, metric and period; values are recalculated from real history rather than read from URL claims. There is no fabricated AI recommendation or drill.

## Validation

Código de producto verificado: `34bd261d06abcca0cbc6827d37ea795fd92fdb1f`. DEV canónico: **https://dev.thebackyard.com.mx**. Deployment preview `dpl_J599cPK9HRP2JGaAT7MUQVy4vdN5`, READY, target `null`, alias DEV. El guard de QA confirmó el SHA del bundle y el proyecto Supabase DEV `bymeopxkxapfizeeqeyb` antes de utilizar las cuentas existentes. Las cuatro APIs de sync, actividad, conexiones y Atest devolvieron 200. No se enviaron correos ni se crearon usuarios. El commit de este reporte sólo añade documentación al mismo código de producto.

El cierre visual, la implementación, la validación técnica y los recorridos disponibles tienen **PASS**. Sólo los recorridos con notificaciones recibidas y golpes GPS quedan **PENDING_INTERACTIVE_QA** por ausencia de datos confirmados. La validación física iOS queda **PENDING_DEVICE_QA**. Conforme a la última instrucción del usuario, estos pendientes no bloquean la entrega visual ni esperan la rama aislada de GPS.

| Comprobación | Estado | Evidencia |
| --- | --- | --- |
| Unit/integration suite `pnpm test` | PASS | 4,697 tests de app + 117 de scripts = **4,814**, cero fallos/skips |
| Typecheck `pnpm typecheck` | PASS | Next typegen y TypeScript sin errores |
| Lint `pnpm lint` | PASS | ESLint sin warnings nuevos |
| Build `pnpm build` | PASS | 41 páginas generadas, sin fallos |
| Integridad de fuente GHIN/Backyard/Atest, ownership, privacidad, datos ausentes | PASS | Suite existente + nuevas proyecciones y lectores autorizados |
| Feed → jugador → ronda → hoyo → regreso | PASS | Navegación real en DEV; Feed 583 → perfil 64 → ronda 0 → Back 0 / 64 / 583; Rondas sigue seleccionada |
| Amigos → jugador → regreso | PASS | Se conserva el filtro `Diego` |
| Leaderboard → jugador; logro → detalle | PASS | Resultado real de Diego abre su perfil; “Sin doble bogey” abre Logro y su ronda |
| Hoyo → Reglas → mismo hoyo | PASS | Hoyo 15 mantiene su contexto; Reglas tiene back superior y foco accesible |
| Buscar / agregar / cancelar solicitud | PASS | Carlos → Mariana, solicitud real y cancelación; estado de amistad restaurado |
| Like / quitar like / abrir comentarios | PASS | Mongas → publicación de Diego, contador 0 → 1 → 0; editor real abierto sin publicar texto artificial |
| Aceptar / ignorar solicitudes, Atest y compartir | PASS | Contratos, handlers e integración existentes conservados y cubiertos por la suite; no se atestaron rondas artificialmente |
| QR de perfil | PASS | Código real, lector y enlace existentes; sin exponer contactos privados |
| Carrera y sus cinco sub vistas | PASS | Resumen/Logros/Rivalidades/Rondas/Torneos conservados; sin hero antiguo |
| HCP → 20 tarjetas → ronda; back de 20 → HCP | PASS | Detalles dedicados y regreso por browser history; links directos regresan dentro de Carrera |
| Stats → My Coach → regreso | PASS | Putting 35.3 / 18 H, ocho rondas reales; category/metric/period/holes conservados; sin recomendación artificial |
| Centro de notificaciones | PASS | Centro y filtros reales, estado vacío “Todo al día”; fixtures en pausa conservadas; handlers de destinos cubiertos por tests |
| Notificación real → objeto | PENDING_INTERACTIVE_QA | Fixtures revisadas con avisos en pausa; la sesión del usuario muestra “Todo al día”. No se cambiaron preferencias ni crearon eventos artificiales |
| Hoyo sin golpes GPS | PASS | Score/par/putts y empty state real; sin mapa ni secuencia inventados |
| Golpes GPS reales → detalle | PENDING_INTERACTIVE_QA | No hay una cuenta confirmada con registros. GPS se desarrolla en otra sesión/rama y no se integró ni se esperó |
| Cuentas indicadas: datos guardados y fuente activa | PASS | Lecturas DEV de Mongas y said_aba; solver y timeline existentes; hashes idénticos antes/después |
| Cámara QR, Safari/PWA, Dynamic Island, geolocation, accesibilidad iOS física | PENDING_DEVICE_QA | Requiere dispositivo/permisos reales. Viewport Chromium no equivale a esta validación |

Logs finales locales: `tmp/golf-navigation-final-tests.log`, `tmp/golf-navigation-final-typecheck.log`, `tmp/golf-navigation-final-lint.log`, `tmp/golf-navigation-final-build.log`. El aviso `Warning: Indexing all PDF objects` proviene de fixtures PDF preexistentes; no apareció un warning nuevo de lint/build. Git advierte conversión LF/CRLF según la configuración existente.

## Cambios visuales e interacción

- Feed: header canónico sin acciones administrativas; tres tabs coherentes; tarjetas editoriales, métricas sólo cuando existen, hitos dorados reales, bolsa con assets/fallback y destinos propios. Se eliminó la tabla de hoyos inline. Atest conserva sus acciones y ayuda contextual; su detalle sigue visible en la ronda.
- Amigos: buscador, conteos reales, filas compactas y perfil completo al tocar. Solicitudes conservan aceptar/ignorar. Discovery por club se identifica como **En tu club**, nunca como distancia/GPS.
- Agregar amigos: búsqueda soportada por nombre/@/email exacto, sugerencias reales, QR y pendientes. Teléfono no se anuncia porque el lector actual no lo soporta. No se añadieron filtros ni localizaciones ficticias.
- Perfil: Actividad/Rondas/Logros/Campos/Equipo, estado de amistad operativo y paginación. Los campos se derivan de las rondas compartidas cargadas; no se afirman totales privados completos. Foto o iniciales reales; sin portada de jugador inventada.
- Ronda/hoyo: scorecard accesible con forma y color, front/back/total, destino por hoyo y métricas capturadas. GPS/shot sequence sólo con datos propios autorizados. Reglas y estadísticas tienen destinos claros. Opciones históricas, confirmación y exportación existentes permanecen disponibles.
- Carrera/HCP/20: cinco tabs visibles al entrar a Carrera; detalles con su propio header y back, sin header/submenú duplicados. Fuente fail closed; GHIN sólo con asociación verificada. Atest cuenta las últimas 20 reales a 5% cada una. Pendientes doradas, atestadas verdes, espacios sin tarjeta grises. Una columna en teléfono; dos cuando hay ancho suficiente.
- Stats/Coach: cohortes reales por longitud y periodo, datos ausentes identificados, métricas operativas que abren My Coach con contexto verificable. GIR/FIR nuevos cuentan sólo booleanos explícitos del jugador autorizado. Score y putts no prueban GIR. Carlos muestra `— / 0 hoyos` en esos dos indicadores; conserva score promedio 81.3 y putting 35.3 de ocho rondas. El análisis histórico existente conserva su metodología de GIR inferido y su lógica; no se lo etiqueta como GIR capturado en las vistas nuevas. Análisis completo y herramientas de Coach existentes se conservan.

## Performance, responsive y estados

Lectores de perfil independientes en paralelo, activity con cursor y límite 30, caché de sesión bounded a 48 entradas/60 s con deduplicación, stack máximo 12 vistas y carga lazy. No se añadieron imágenes, fonts, dependencias ni proveedores. No se añadió una query por cada jugador/fila. Sin benchmark de FPS en iPhone físico; queda dentro de PENDING_DEVICE_QA.

Pruebas de viewport Chromium 390×844, 393×852 y 430×932: dimensiones efectivas comprobadas; ancho de documento igual al client width (375/378/415 con scrollbar de escritorio), sin overflow horizontal. Los indicadores y listas respetan datos/espacios ausentes; nav mantiene el módulo padre. Touch targets, labels de score, focus y reduced motion cubiertos por implementación/suite. El encabezado recibe foco al terminar la carga lazy sin mover el scroll. Skeletons estructurados; estados empty/retry en Feed/perfil/ronda/hoyo/índice/estadísticas y notificaciones. Errores cubiertos mediante lectores y tests, sin provocar una caída del backend DEV para obtener una imagen. La consola IAB final no registró errores/warnings. Chrome registró cuatro mensajes iguales de canal de listener cerrado, sin stack de aplicación; se reportan y no se atribuyen a producto sin evidencia. No se observaron errores de API ni fallos del recorrido correspondientes.

## Auditoría de las cuentas indicadas y diferencias de datos

- Cuenta indicada `el_mongas`: 27 filas propias, 24 snapshots de histórico al excluir tres rondas live, 23 marcados como completed y 23 con evidencia congelada. El solver existente encuentra **21 rondas elegibles**, utiliza las últimas **20** y las mejores **8**, y calcula **Backyard Index 5.5**. La serie real contiene dos puntos: 5 oct 2026 → 5.5 y 6 oct 2026 → 5.5. Esto demuestra lo que quedó guardado; no se afirma que toda la corrida anterior se haya completado.
- La fuente activa de Mongas sigue siendo **GHIN 30.8**, asociación **VERIFIED**, revisión **8 jun 2023** y última sincronización correcta **7 oct 2026 UTC**. La preferencia Backyard está deshabilitada. La asociación verificada mantiene GHIN como fuente activa: no se cambió la preferencia ni se desvinculó GHIN para obtener una captura numérica Backyard. La UI respeta 30.8 y no presenta el cálculo local 5.5 como índice activo.
- Cuenta indicada `said_aba`: asociación GHIN **VERIFIED**, índice real **7.9**, revisión **24 sep 2026**, última sincronización correcta **5 oct 2026 UTC**. Tres filas propias, una de histórico al excluir dos live, sin evidencia Backyard elegible. El 7.9 se verificó en el registro real de esta cuenta; no se tomó del mockup. Esta comprobación fue de lectura en DEV; la sesión Chrome usada para equipo/notificaciones pertenece a otro perfil y no se confunde con said_aba.
- Integridad: los hashes SHA-256 de snapshots propios, timestamps, preferencias de índice y registro GHIN coinciden antes/después para ambas cuentas. Evidencia: [auditoría guardada](../.qa-artifacts/golf-navigation/saved-account-audit.json). No se editaron tarjetas, índices, vínculos, históricos ni preferencias; no se ejecutó refresh/import/unlink GHIN. El timeline local se verificó con datos guardados mediante la misma función usada por Carrera.
- El lector GHIN disponible no aporta una serie histórica oficial: estado de histórico insuficiente **PASS**. Carlos tiene Backyard seleccionado sin evidencia elegible suficiente: `—`, 11 tarjetas aplicables y nueve espacios vacíos, estado vacío **PASS**. No se activó un índice distinto para completar el diseño.
- Mongas aporta 20 tarjetas reales en la ventana Atest, 10 atestadas = **50%**; no se aplicó el 85%/17 del mockup. Elegibilidad de índice, histórico guardado y ventana Atest son conjuntos distintos y se respetan sus reglas existentes.
- Hay publicación real de equipo, logro “Sin doble bogey” y leaderboard real de una ronda, con destinos verificados. No hay un evento de torneo de temporada disponible para una captura; se conserva la experiencia existente y su estado vacío, sin inventar resultados. Sólo notificaciones recibidas y golpes GPS quedan **PENDING_INTERACTIVE_QA**. Los estados vacíos correspondientes tienen **PASS**.
- Las referencias tienen fotos/estadísticas completas. Los usuarios revisados conservan iniciales, campos privados, datos ausentes y fallbacks cuando esa es su información real. No se copiaron fotografías ni el branding de TheGrint.
- No se adjuntaron videos. Las tres secuencias cronológicas TheGrint y Backyard_current_DEV_1 se revisaron como pidió el complemento. Backyard_current_DEV_2 sigue sin archivo disponible.

## Commits

1. `7f24102` navegación por objetos y lectores autorizados.
2. `39b7803` experiencias de jugador/ronda/hoyo/estadísticas/Coach.
3. `acec3c7` conservación del shell de Carrera y header canónico.
4. `3e34b26` pruebas de navegación, símbolos y destinos.
5. `ad9ebff` ajuste del harness de menú administrativo.
6. `bc19040` densidad del Feed y ayuda Atest contextual.
7. `de38311` header dedicado HCP y regreso natural.
8. `3c96cf4` responsive/ocultación efectiva de tabs en detalle.
9. `34bd261` GIR/FIR exclusivamente capturados, foco tras lazy load y regreso contextual desde Reglas.
10. Commit que contiene este reporte: documentación final de implementación, pruebas y QA.

El error HTTP 500 temporal de GitHub se resolvió sin force push, reset ni cambios en ramas protegidas. El commit inicial sigue siendo ancestro del HEAD.

## Archivos modificados

API: `app/api/social/activity/route.ts`.

Presentation: `app/page.tsx`, `app/globals.css`; `app/components/{career-hub.module.css,career-hub.tsx,career-shared.tsx,career-index-panel.module.css,cloud-social-activity.module.css,cloud-social-activity.tsx,golf-detail-ui.tsx,golf-object-data.tsx,golf-object-navigation.tsx,golf-object-views.tsx,golf-object.module.css,golf-player-profile.tsx,golf-round-detail.tsx,my-coach.tsx,notification-center.tsx,premium-golf-statistics.tsx,premium-scorecard.tsx,primary-header.tsx,round-participation-card.tsx,social-connections-panel.tsx,use-screen-navigation.ts}`.

Contracts/readers: `lib/{golf-coach-context.ts,golf-object-navigation.ts,golf-scorecard-presentation.ts,shared-round-participants.ts,social-activity-contract.ts,social-activity.server.ts,social-round-card.ts}`.

Tests: nuevos `golf-object-navigation.test.ts`, `golf-notification-destinations.test.ts`, `premium-scorecard.test.ts`; actualizados `career-friends-hub`, `career-subviews`, `home-social-ui`, `page-bottom-back-navigation`, `product-major`, `saved-round-navigation`, `settings-privacy-closeout`, `ux-round-onboarding`, `v3-closure` y `helpers/social-ui`. 23 nuevas pruebas respecto al baseline. Casos nuevos: stack/scroll/deep links, fuente de Coach, exclusión de GIR inferido, ocho resultados de score, front/back/total incompletos, destinos de hoyo, privacidad de scorecard, par personal del participante y tres destinos de notificación.

Total: **45 archivos** afectados desde el commit inicial protegido, incluyendo este reporte.

Schema/migrations: **ninguna**. Este reporte: `docs/DEV_GOLF_NAVIGATION_2026-10-07.md`.

## Evidencia visual

Capturas reales y [galería comparativa](../.qa-artifacts/golf-navigation/comparison.html) en `.qa-artifacts/golf-navigation/` (artefactos locales, fuera del bundle y de Git). La galería muestra referencia y DEV lado a lado. Las secuencias complementarias se revisaron en las imágenes del chat; sus rutas Downloads no existen localmente para copiarlas a la galería. Los ocho mockups sí se incluyen como referencias locales de QA, sin incorporarlos al producto.

| Pantalla | Captura real |
| --- | --- |
| Feed / publicación de score | [Feed](../.qa-artifacts/golf-navigation/feed-390.jpg) |
| Player Profile | [Perfil](../.qa-artifacts/golf-navigation/player-profile-390.jpg) |
| Round Detail | [Ronda](../.qa-artifacts/golf-navigation/round-detail-390.jpg) |
| Hole Detail | [Hoyo](../.qa-artifacts/golf-navigation/hole-detail-390.jpg) |
| Mis estadísticas | [Stats](../.qa-artifacts/golf-navigation/statistics-390.jpg) |
| Friends | [Amigos](../.qa-artifacts/golf-navigation/friends-390.jpg) |
| Add Friends | [Agregar amigos](../.qa-artifacts/golf-navigation/add-friends-390.jpg) |
| Carrera Resumen | [Carrera](../.qa-artifacts/golf-navigation/career-summary-390.jpg) |
| HCP GHIN verificado | [Índice GHIN](../.qa-artifacts/golf-navigation/hcp-ghin-390.jpg) |
| Últimas 20 | [20 tarjetas](../.qa-artifacts/golf-navigation/latest-20-390.jpg) |
| HCP Backyard sin valor elegible | [Índice Backyard](../.qa-artifacts/golf-navigation/hcp-backyard-390.jpg) |
| Menos de 20 | [11 tarjetas y nueve espacios](../.qa-artifacts/golf-navigation/latest-less-20-390.jpg) |
| Logro real en Feed | [Achievement](../.qa-artifacts/golf-navigation/feed-achievement-390.jpg) |
| Equipo real en Feed | [Bolsa](../.qa-artifacts/golf-navigation/feed-equipment-390.jpg) |
| Loading real | [Skeleton de perfil](../.qa-artifacts/golf-navigation/profile-loading.jpg) |
| Empty real | [Sin logros](../.qa-artifacts/golf-navigation/profile-empty-achievements.jpg) |
| Stats → Coach | [Putting](../.qa-artifacts/golf-navigation/coach-context.jpg) |
| QR real | [QR](../.qa-artifacts/golf-navigation/qr-real.jpg) |
| Notificaciones vacías | [Todo al día](../.qa-artifacts/golf-navigation/notifications-empty.jpg) |

La prueba de regreso está en `navigation-proof.json`; las dimensiones efectivas y Carrera activa en `responsive-proof.json`. Las capturas llamadas `feed-loading.jpg` y `round-loading.jpg` de un intento anterior mostraban contenido ya cargado y **se excluyen como evidencia de loading**. La carga acreditada es `profile-loading.jpg`.

## Entornos protegidos

**DEV: MODIFIED**

**main: NOT TOUCHED** — local `09de83f69ad80116fda83abb4abd1e0a08660ef1`, remote `a1b33ddfad905e0d45bcfe0848916ba19ceed0af`.

**beta: NOT TOUCHED** — remote `c9a9d3550a0feb39fdeda82fcc79ab6eddb1a582`.

**Production: NOT TOUCHED**

**app.thebackyard.com.mx: NOT TOUCHED**

Sólo se publicó `integration/backyard-current` mediante preview DEV. No se aplicaron migraciones, se promovió deployment ni se cambiaron variables/DNS/producción.

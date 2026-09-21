# QA final / preparación de release — 2026-09-21

## Decisión

Listo para continuar QA del Product Owner en Preview, **no aprobado para Production**. El corrido automatizado no sustituye Google/OTP humano, Safari/PWA físico ni aprobación jurídica. No se añadieron funcionalidades ni se rediseñaron módulos.

## Identidad y límites

- Repositorio: `saidabaid-cyber/Golf-Bets`.
- Rama: `phase2/course-catalog-feedback`.
- SHA inicial, local y remoto tras fetch: `18efd5f92a81fa60071b246d66985bdec586413e` (worktree inicialmente limpio).
- Preview inicial: `https://golf-bets-2yxxgmw49-saha8.vercel.app`.
- Corrido remoto principal después del fix de estado: `d8d63e75edbbdbb33b6a41c87ef5773dba603d9f`, `https://golf-bets-7tqsm5wmy-saha8.vercel.app`, deployment `dpl_78Kx86VHaP4daSveq7jmXdYL3xL5`, Preview READY.
- La URL inmutable y SHA publicados después del último ajuste visual se entregan en el handoff; se repiten allí los runners de readback y el smoke. No se presenta la URL anterior como ese deployment final.
- Supabase exclusivo: `bymeopxkxapfizeeqeyb`. Verificación del bundle efectivo antes de requests autenticados.
- No se modificaron main, beta, Production, dominios, DNS, secretos, configuración Auth ni motores de apuestas/HCP. Ninguna migración aplicada.
- Fixtures: identidades sintéticas existentes `@example.invalid`. Ningún correo enviado. Sin eliminación de cuentas. Los nueve scripts SQL RLS corrieron dentro de transacciones con rollback; los cinco UUID de Auth temporales no quedaron en DB.

## Correcciones demostradas

1. Los accesos Preferencias / Notificaciones / Privacidad del Perfil llevaban al mismo panel de Cuenta. Separamos el contenido mediante cuatro destinos del panel existente, sin duplicar APIs ni persistencia.
2. El primer Preview reveló además estado React retenido: el componente Perfil/Cuenta conservaba la sección anterior. La identidad del panel incluye ahora cuenta y destino. Se reprodujo y verificó Perfil → Preferencias en Preview; abre contraste, no acciones destructivas.
3. Mi QR exponía la URL técnica en un input. Ahora conserva el canvas, Web Share y enlaces estables por UUID, pero ofrece Copiar enlace de perfil. En browser: mensaje Enlace copiado, canvas presente, sin `vercel.app` en texto visible.
4. Membresías tenía un regreso azul sin estilo (`legalTopbar` inexistente). Reutiliza el CTA secundario y tokens existentes, con safe-area. Sin cambios en entitlements, cobros ni beneficios.

## Matriz de evidencia

| Área | Estado | Evidencia ejecutada / límite |
|---|---|---|
| Preview → QA aislado | PASS | Bundle y ref exactos verificados por `qa-release-readback.mjs`; nunca se usan credenciales QA en otro origen. |
| Auth sintético / sesión / dedupe | PASS | Login password de fixtures, `/api/account/entry`, un perfil canónico, logout y nueva sesión, mismos IDs. Cuenta A no recibe datos privados B. Esto no prueba entrega OTP ni OAuth humano. |
| Google / email reales | PENDING_INTERACTIVE_QA | Google/email habilitados en settings QA. Guard de inicio OAuth y PKCE single-use revisados; tests de efecto simultáneo y fallo pasan. Falta selector Google → Home, logout → Google, recepción/verificación OTP y correo sin cuenta con destinatario humano. Configuración preservada. |
| Apple | BLOCKED_EXTERNAL | `external.apple=false`; permanece Próximamente, no se simuló proveedor. |
| Onboarding rápida / completa | PENDING_INTERACTIVE_QA | Tests de ambos recorridos incluyen Campo/Index/permisos; checkpoint completo existente releído desde QA. No se presenta como dos altas nuevas completas por OTP ejecutadas en este corrido. |
| Alto contraste | PASS | Suite conserva default true sin preferencia, y false explícito. Fixture con elección false se mantiene al autenticar nuevamente; no se fuerza un cambio. |
| Completitud Perfil / Home | PASS | Modal real a 390; fixture 71% → 100% marcando Bola/Fitting No aplica, sin GHIN. 100% leído en sesión nueva y porcentaje visual oculto. Opciones restauradas; después fitting real guardado eleva a 86%. Una API de completitud para ambas vistas. |
| Perfil / ubicación / Backyard Index | PASS | Readback cloud del perfil, activación previamente guardada y checkpoint. Edición de perfil accesible; no se sobreescribió índice desde fitting. Unicidad y ownership cubiertos por RLS/tests. |
| Configuración separada | PASS | Preferencias, Notificaciones, Cuenta y Privacidad tienen contenido propio. Browser 390/430 y tests de render/handlers. Remount del destino validado contra Preview. |
| Permisos reales iOS | PENDING_DEVICE_QA | Controles muestran estado y no asumen permisos ni consentimiento. Solicitudes y revocación en Safari físico pendientes. |
| Tres entradas Jugar | PASS | Browser: configuración completa, sin apuestas y total visibles directamente. No se añadió hub alterno. |
| Ronda completa / score-only / total | PASS | Nueve fixtures reales readback: cada modo × 9H/1, 9H/10, 18H. Tees por jugador, snapshots, sesión nueva e IDs únicos; total no inventa scores por hoyo. Configuración completa y comienzo también ejecutados desde UI. |
| Score-only sin apuestas | PASS | UI de 9H/10 con propietario + invitado hasta revisión; sin HCP de apuestas ni pasos grupales/personales. Guardar/salir conserva draft. Suite garantiza que las 13 familias de cálculo no se invocan en score-only. |
| Salir / continuar / nueva ronda | PASS | UI con activa `53a8qhja`, score 5 y putts 2 en hoyo 10. Cancelar modal no cambia; Continuar abre su hoyo. Nueva `mahvrf7u` creada con ID distinto, posteriormente cerrada por confirmación. Readback: anterior live con score/putts/mode intactos, nueva cancelled; no DELETE ni completado ficticio. |
| Cancelar/cerrar / reanudar persistencia | PASS | Seguir jugando cancela el cierre; confirmar espera Ronda cerrada. Runner del fixture lifecycle existente valida sesión nueva, mismo ID/hoyo/scores y B denegado. Las rondas cerradas conservan datos recuperables. |
| Catálogo / cercanos | PASS | API autenticada, La Vista y Campestre, tee selector. Diez ubicaciones simuladas producen tres clubes distintos; Puebla: La Vista 1.4km, Campestre 1.8km, Las Fuentes 7.8km. Cálculo local; no son distancias de manejo ni permiso físico probado. |
| Social / amigos / grupos seguridad | PASS | Nueve scripts DB/RLS incluyen aceptación interna y autorización multiusuario. Feed sin actividad no inventa publicaciones. Navegación Social/+ visible; no se enviaron invitaciones por correo. |
| Recorrido social/grupos exhaustivo | PENDING_INTERACTIVE_QA | No se repitieron todas las combinaciones de amistad, bloqueo, invitación y cada editor de apuesta desde dos teléfonos. |
| Mi QR / enlace | PASS | Canvas real, username, copia de enlace, UUID independiente del username; 390/430 sin overflow. No URL temporal hardcodeada en app/lib/features/public. |
| QR cámara / galería física / Web Share | PENDING_DEVICE_QA | Se conserva el flujo existente. No se afirma cámara, imagen de galería real ni guardar imagen iOS. |
| Mi Bolsa / varillas | PASS | Equipo QA sobrevive reload y nueva sesión. Edición abre wedge 58°, selector de marca de varilla con resultados reales y manual fallback. Salir no modificó el wedge ni sus snapshots. Suite completa y RLS equipment ejecutados. |
| Equipment alta/reemplazo exhaustivo | PENDING_INTERACTIVE_QA | En este corrido no se repitieron todas las categorías/variantes, reemplazos e históricos desde UI; no se confunde la suite con ese recorrido completo. |
| Ball Fit | PASS | Seis pasos: manual7, score82, driver245 y velocidad UNKNOWN; atrás/salida disponibles, Top3 real (71 modelos evaluados según resultado), guardar y reload. DB `lastBallFit.input` confirma valores. No se cambia HCP del perfil. Recomendación orientativa, no fitting físico. |
| Snapshots / datos históricos | PASS | Readback de 18 snapshots previos sin cambios; nueve fixtures de modos/tees y nuevas sesiones; pruebas de inmutabilidad incluidas en suite. |
| Stats sin datos elegibles | PASS | UI real sin rondas completas no inventa métricas. No se afirma que una tarjeta incompleta sea elegible. |
| Stats / resultados / balances completos | PENDING_INTERACTIVE_QA | Suite determinística completa PASS sin modificar motores y readback de fixtures; no sustituye el recorrido visual completo con tarjetas terminadas en este corrido. |
| Apuestas y modales exhaustivos | PENDING_INTERACTIVE_QA | El recorrido completo de cada modalidad y liquidación visual requiere una pasada de producto adicional. |
| PWA técnico | PASS | Manifest/iconos, service worker activo en Preview y limpieza de listeners revisada. Tests offline/local-first/ACK incluidos en suite. |
| PWA físico / background / teclado | PENDING_DEVICE_QA | Instalar, cerrar/reabrir, cortar red durante captura y recuperar, teclado nativo/safe areas deben verificarse en iPhone. Emulación Chromium no equivale a Safari. |
| UI móvil inspeccionada | PASS | Home, perfil/modal completitud, cuatro settings, Campo/Jugar, game, Mi Bolsa/edición, Ball Fit resultado, Social/QR, Más, Reglas, Stats vacío, Histórico y Membresías; capturas 390/430. Sin overflow horizontal observado ni excepciones de cliente. |
| Consistencia visual completa / aprobación | PENDING_INTERACTIVE_QA | No se declara aprobación premium de cada estado de onboarding, resultado, Coach/insights, objetivos y todos los modales sólo por CSS compartido. Hace falta revisión visual del Owner, sobre todo con datos completos y dispositivo real. |
| GHIN / servicios externos | BLOCKED_EXTERNAL | GHIN, Apple, push y otras integraciones no habilitadas siguen sin simularse. No se añadieron proveedores, imágenes licenciadas ni pagos. |
| Legal | LEGAL_REVIEW_REQUIRED | Términos, privacidad, retención/archive, social/shared, IA y permisos requieren aprobación jurídica. No se cambió su estado legal. |

## Quality gates

- Inicial: 2,137 tests. Final de código: **2,146/2,146 PASS**, cero fail, skipped o cancelled.
- `npm run lint`: PASS.
- `tsc --noEmit`: PASS.
- `npm run build`: PASS (build de distribución, no deployment Production).
- Nueve scripts QA RLS: PASS: equipment_ball_fitting, golf_profile_course_architecture, ai_processing_consents, phase2_social_groups, phase2_course_handicap, phase2_live_rounds, phase2_shots_analytics, user_statistics_reset, phase2_multiuser_authorization.
- `qa-release-readback.mjs`: 17 comprobaciones PASS, cero mutaciones/correos.
- `qa-course-catalog-live.mjs --verify-created`: nueve fixtures, diez ciudades, 18 snapshots inmutables, cero escrituras históricas.
- `qa-ux-round-onboarding.mjs --verify-browser-lifecycle`: cinco comprobaciones PASS.
- Runtime de `dpl_78Kx86VHaP4daSveq7jmXdYL3xL5`: sin 5xx en ventana consultada de dos horas; errores de browser vacíos. 401 anónimo y 400 selector de enumeración fueron pruebas negativas deliberadas.
- Una medición de navegación cacheada Chromium dio DOMContentLoaded 105.4ms; **no** es benchmark de red fría, rendimiento iPhone ni presupuesto completo de bundle.
- Los skills React/Next orientaron la revisión a estado retenido, controles accesibles y cambios mínimos; no se reemplazaron arquitecturas sanas.

## Seguridad y riesgos antes de Production

Advisors QA sin hallazgos ERROR en la revisión. Tablas privadas con RLS sin policy conservan deny-default. RPC SECURITY DEFINER revisadas: guard autenticado, status basado en auth.uid y métricas administrativas con guard; no se abrieron permisos para silenciar warnings. Se verificó rechazo al usuario ordinario en tests DB.

Advertencia pendiente de configuración: protección de contraseñas filtradas deshabilitada en Auth QA. No se cambió Auth; revisar si se habilita password login para usuarios finales antes de Production. No es evidencia de fallo de OTP/Google.

Catálogo real: 153 clubes / 176 recorridos / 769 tees; 91 geolocalizados y 758 tarjetas completas. Restan 62 ubicaciones y 11 tarjetas sin evidencia; no se inventaron ni se aplicaron datos nuevos en este bloque. Categorías de rating no verificadas conservan sus restricciones. Licencia/reutilización comercial: LEGAL_REVIEW_REQUIRED.

URLs públicas: origin canónico preparado `https://app.thebackyard.com.mx`; enlaces QA usan deliberadamente su origen QA hasta cutover. Cambiar publicación/origen y configurar el entorno de destino requiere instrucción posterior, no se hizo aquí.

## Evidencia reproducible

Artifacts locales ignorados (sin commitear credenciales): `release-readback-report.json`, `catalog-applied-cloud-report.json`, `release-qa-tests.log`, `release-qa-lint.log`, `release-qa-build.log` dentro de `.qa-artifacts/`.

Capturas locales de este corrido, en `.agent-browser/tmp/screenshots/`: `1789988758755` (completitud390), `1789988910635` (preferencias430), `1789989162485` (Jugar430), `1789989738813` (Top3 Ball Fit430), `1789989968721` (QR430), `1789990073741` (Reglas390), `1789990113051` (Stats390), `1789990133354` (Histórico390). Son screenshots, no evidencia de dispositivo físico.

Fallos de automatización identificados: una espera intentó localizar Mi Bolsa justo después de reload, que vuelve a Inicio; se navegó nuevamente al módulo y se comprobó readback. No se etiquetó como data loss. La primera prueba de nueva ronda no esperó ACK; se repitió con `mahvrf7u` y readback explícito, que es la evidencia citada.

## Pendientes concretos

1. Owner: usar el Preview final con dos cuentas/teléfonos para Google/OTP, onboarding nuevo rápida/completa y revisión visual exhaustiva. No se necesitan secretos por chat.
2. iPhone Safari/PWA: cámara, galería, compartir/guardar, teclado, permisos, safe areas y background/offline/reopen.
3. Aprobación jurídica y verificación de configuración de seguridad del entorno que se publicará; no autorizar Production todavía.
4. Resolver proveedores/datos/licencias faltantes por sus canales antes de ofrecer esas capacidades como disponibles.

Ningún PASS de este informe implica aprobación global de release ni autorización de cutover.

# The Backyard — Beta Major Build

Última actualización: 2026-09-06. Este archivo describe el estado comprobado; una existencia parcial de código no se registra como funcionalidad terminada.

## DONE — núcleo y milestones verificados localmente

- Protección de entorno: rama activa `beta`; no se ha cambiado `main`, el tag estable ni producción.
- Inspección de arquitectura, dependencias, autenticación, almacenamiento local, sincronización, APIs, PWA, migraciones y motor de apuestas.
- Línea base previa al milestone: lint correcto, 609 tests correctos y build Next.js correcto.
- Núcleo existente conservado: invitado/cuenta, login OTP/Google condicionado a configuración, perfiles básicos, jugadores invitados, plantillas de grupos, rondas de 9/18 hoyos, HCP, score, resultados, histórico, exportación, reglas y apuestas actuales.
- Durabilidad local existente: autosave, snapshot en IndexedDB, fallback verificado en `localStorage`, outbox idempotente, reintento y resolución explícita de conflictos cloud.
- Ciclo de vida local de ronda versionado de forma aditiva: `draft` antes del primer score confirmado, `live` después de capturar, `completed` al quedar pendiente de revisión o entrar a Histórico y `cancelled` en el respaldo recuperable de una ronda reemplazada. Los históricos anteriores sin el campo se leen como `completed` sin reescribirlos.
- PWA existente: manifest, iconos, modo standalone, service worker y fallback de navegación offline.
- Polla Live permanece deshabilitado en la navegación principal con la etiqueta “Próximamente”.
- Navegación mobile-first de cinco destinos: Inicio, Jugar, Grupos, Social y Perfil, con sección activa accesible y safe area inferior.
- Home con identidad/HCP manual, ronda abierta o revisión pendiente como acción dominante, última tarjeta completa, accesos rápidos, grupos, balance y actividad real del espacio local.
- Hub Jugar con retorno seguro a configuración/score/resultados, atajos contextuales de ronda y acceso conservado a Histórico, Personales, Stats, Campos, Grupos y Reglas.
- Perfil autenticado con edición persistente y Cuenta separada. El modo invitado conserva golf/Stats locales sin presentarse falsamente como identidad persistente. Los fallos de validación o guardado se anuncian como errores accesibles.
- Stats permite elegir una cohorte real de 9H o 18H cuando ambas existen y alternar la gráfica entre Gross y vs Par; todos los promedios, tendencia y rondas recientes respetan esa selección.
- Perfil de golf ampliado compatible con cachés anteriores: nombre, apellidos, usuario, ubicación, club, tee, mano, bio y privacidad se editan y recuperan localmente sin guardar tokens ni fabricar una identidad para invitado. Nombre/HCP/avatar conservan su escritura cloud existente; los campos nuevos quedan honestamente marcados como locales hasta disponer de esquema Beta aislado.
- Onboarding de equipo posterior al perfil básico, sólo para cuentas nuevas y completamente opcional: permite agregar bastones, omitir la bolsa, elegir/no fijar/omitir bola y aceptar o rechazar el Ball Fit sin bloquear la entrada a la app. Las cuentas existentes no son obligadas a repetir onboarding y encuentran el módulo dentro de Perfil.
- Perfil de equipo unido al mismo `userId` autenticado: “Mi bolsa” permite catálogo o marca/modelo manual, múltiples maderas/híbridos/wedges, composición de set de hierros, specs opcionales, edición, eliminación y cambio entre actual/anterior. “Mi bola” permite catálogo o captura manual, edición, eliminación, historial y reactivar una bola anterior.
- The Backyard Ball Fit rápido conserva borrador por identidad, precarga HCP/bola cuando existen y produce hasta tres recomendaciones ordenadas con Match Score, cobertura de datos, motivos, comparación contra la bola actual y atributos verificados. Los datos no confirmados se muestran como “Sin dato verificado” y el resultado se identifica expresamente como orientativo, no oficial de una marca.
- Captura opcional de launch monitor preparada para Driver, hierro 7, pitching wedge y medio wedge: admite múltiples golpes, excluir/reactivar golpes y resume muestras válidas mediante medianas y promedio resistente. Estos datos se conservan como contexto; todavía no alteran el ranking mediante ventanas propietarias.
- Catálogos estructurados fuera de React e importables: 11 marcas/11 modelos de bolas, 15 marcas/17 modelos de bastones y 5 marcas/5 familias de shafts. Cada modelo incluido conserva URL oficial y fecha de verificación; compresión u otros atributos ausentes permanecen `null`.
- Tarjeta con captura `Rápida` (score y putts exigidos por apuestas) o `Estadísticas` opcionales. Fairway, GIR y penalidades se guardan sin cambiar scores ni motores de apuestas; Stats e Histórico muestran únicamente datos capturados, sin completar huecos.
- Actividad personal derivada sólo de rondas y grupos guardados. No se presenta como un feed compartido ni se publica a terceros.
- El centro de actividad permite marcar cada aviso local como leído/no leído, conserva pulsaciones consecutivas y deduplica eventos exactos para que el badge no se infle. Los controles funcionan tanto para avisos navegables como informativos.
- Biblioteca de campos con búsqueda tolerante a acentos, favoritos, recientes, creación/edición manual y selección explícita. Editar catálogo no cambia silenciosamente el campo del draft.
- Preferencias de campos aisladas por identidad y eliminadas al borrar la cuenta local.
- Contratos tipados `CourseDataProvider`, `HandicapProvider`, `GolfProfileProvider`, `GolfMapProvider` y `DistanceProvider`; el único proveedor activo busca sin red sobre `Course[]` existentes.
- Read model formal y validado para `courses`, `tees`, `holes` y yardajes por tee. IDs, Par, numeración y SI ambiguos fallan cerrados; rating, slope y yardaje sólo se muestran cuando provienen de datos válidos capturados.
- Minimum Putts usa la duración explícita de ronda: H1–9 y H10–18 liquidan correctamente en rondas de 9; snapshots válidos de 18 conservan su comportamiento.
- Importes ordinarios de apuestas se limitan a cero o más en captura; Manuales conserva deliberadamente importes firmados.
- Las configuraciones activas de apuestas pasan por un validador puro compartido y fail-closed antes de guardar, iniciar o liquidar: participantes, equipos, bases HCP, carry/press, IDs y valores no finitos quedan bloqueados con reparación explícita, sin convertir una configuración inválida en un resultado de `$0`.
- Ledger histórico derivado exclusivamente de resultados persistidos: totales por jugador, transferencias sugeridas por ronda y cara a cara bilateral. No registra pagos, no edita resultados y separa identidades autenticadas de invitados por ronda.
- Home convierte sus métricas en acciones accesibles hacia Histórico, Stats, Balances y Grupos, y separa hoyos confirmados del hoyo que se está editando.
- Histórico deduplica snapshots por ID, valida fechas calendario y conserva registros dañados sólo en la vista sin filtros para permitir inspección/eliminación segura.
- Recuperación offline compara IndexedDB y fallback, conserva el snapshot más reciente, usa ACK durable y CAS para que una confirmación o reintento antiguo no borre una edición de score nueva.
- Grupos locales preservan la identidad estable de cuentas vinculadas y reparan duplicados por cuenta o nombre antes de crear jugadores de ronda; el editor falla cerrado y muestra un error explícito.
- Scorecard en vivo muestra Par, SI, yardaje y tee únicamente cuando el campo los contiene. Cada jugador recibe una vista previa determinística de golpes de HCP y neto al guardar; HCP/score ausentes permanecen pendientes y las bases propias de apuestas no se reinterpretan.
- Polla Live falla cerrada también ante valores desconocidos del flag: sólo `1`, `true`, `on` o `yes` pueden habilitar su backend. En esta iteración permanece deshabilitada y no se instancian sus clientes, incluida la service role, con el flag ausente o falso.
- QA integral más reciente del código de este milestone: lint sin errores, TypeScript de app/tests correcto, 931/931 tests y build Next.js 16.3.3 correcto con 19/19 rutas.

## PARTIAL — útil, pero todavía no cumple el modelo final

- Perfil ampliado ya es persistente y recuperable en el dispositivo. Su sincronización multi-dispositivo, unicidad de username y aplicación remota de privacidad siguen pendientes de esquema Beta/RLS; favoritos permanecen en la biblioteca de campos y Stats se deriva del histórico en vez de duplicarse en el perfil.
- Grupos son plantillas privadas robustas con identidad estable, creación/edición/sorteo/carga a ronda; todavía no son comunidades remotas con admin, invitaciones y membresías.
- Campos conservan persistencia legacy `Course` por tee. El read model formal ya separa entidades en memoria, pero su persistencia normalizada requiere una migración aditiva en una base Beta aislada.
- Social es un feed y centro de avisos privado local con estado leído; amigos, solicitudes, bloqueo, feed compartido y reacciones requieren backend multiusuario.
- Live score y sync multi-dispositivo funcionan para el workspace de una misma cuenta; faltan participantes con permisos individuales y edición por jugador.
- El histórico conserva snapshots completos y ya normaliza estados `draft/live/completed/cancelled` localmente; el lifecycle cloud todavía no los expone como entidades colaborativas consultables porque falta el esquema Beta aislado.
- Equipo, bola y Ball Fit funcionan local-first en el dispositivo. La ruta autenticada `/api/equipment`, el contrato de sincronización, compare-and-swap y resolución explícita de conflicto están implementados, pero la réplica multi-dispositivo permanece deshabilitada hasta aplicar la migración en una base Beta aislada y activar deliberadamente `EQUIPMENT_CLOUD_ENABLED` sólo allí.
- Los catálogos se administran hoy como seeds versionados e importables. La migración autoriza alta/actualización/desactivación a un rol admin emitido en `app_metadata`, pero todavía no existe una pantalla administrativa ni se han cargado esos seeds a una base remota.
- El launch monitor ya captura y resume datos robustamente; todavía no utiliza esas mediciones para modificar el Top 3, por lo que se presenta como preparación/contexto y no como fitting avanzado de precisión.

## BLOCKED — sin detener el trabajo no dependiente

- Migraciones de nuevas funciones sociales: existe un solo proyecto Supabase y no tiene branch Beta. Aplicar DDL allí implicaría riesgo real para producción.
- Amigos persistentes, solicitudes, bloqueo, grupos sociales con membresías/admin, feed compartido y notificaciones: requieren esquema, grants, RLS y pruebas de aislamiento multiusuario en una base Beta.
- Edición multi-dispositivo de rondas privadas: requiere permisos por participante y una política de conflictos probada en backend.
- Integraciones TheGrint, GHIN u otros proveedores: no hay autorización, contrato ni credenciales. No se hará scraping ni uso de APIs privadas.
- GPS/mapa/distancias: no existe una fuente autorizada de geometría o coordenadas. Solo puede prepararse el contrato y un flag oculto.
- Pagos, planes y suscripciones: requieren decisión comercial/proveedor; no se activarán ni se inventarán precios.
- Aplicación de nuevas variables o migrations en Beta: pendiente de un entorno de datos aislado. Variables Production quedan fuera de alcance.
- Persistencia cloud de equipo y bola: la migración aditiva está lista, pero aplicarla al único proyecto Supabase disponible podría escribir sobre el entorno compartido/producción. El flag permanece ausente y falla cerrado.

## Base de datos en esta iteración

- Migración aditiva creada: `supabase/migrations/20260906193435_equipment_ball_fitting.sql`.
- Migraciones aplicadas remotamente: ninguna. La migración de equipo **no fue aplicada** porque no existe una base Supabase Beta aislada.
- Tablas preparadas (9): `golf_ball_catalog`, `golf_club_catalog`, `golf_shaft_catalog`, `player_equipment_profiles`, `player_clubs`, `player_balls`, `ball_fit_sessions`, `ball_fit_recommendations` y `launch_monitor_shots`.
- RLS preparada: las 9 tablas habilitan RLS y la migración declara 27 policies. Los catálogos permiten lectura autenticada y escritura únicamente al rol admin en `app_metadata`; las seis entidades de jugador permiten `select/insert/update` sólo al propio `auth.uid()`.
- Grants preparados: `anon` no recibe privilegios; clientes autenticados no reciben `DELETE`; `service_role` recibe sólo `select/insert/update` explícitos para que las rutas server-only funcionen también con el opt-in de Data API de Supabase 2026. El historial se conserva mediante estados/filas actuales y los borrados deliberados se resuelven desde el snapshot canónico cuando la nube llegue a habilitarse.
- Prueba SQL de aislamiento creada: `supabase/tests/equipment_ball_fitting_rls.sql`; pruebas de contrato verifican RLS, grants, owner checks y ausencia de autorización mediante `user_metadata`.
- Cambios al proyecto Supabase alojado: ninguno.

La ausencia de una base Beta separada se trata como barrera de seguridad, no como motivo para modificar el proyecto compartido.

La revisión read-only detectó drift/riesgos en ACL y grants históricos, `SECURITY DEFINER`, pertenencia compuesta de entidades Polla, publicaciones Realtime demasiado amplias, un bucket temporal público, restricciones de consentimientos y protección de contraseñas filtradas. Se documentan en `BETA_ARCHITECTURE.md`; no se alteró ninguno en el proyecto compartido.

## Bugs encontrados y tratamiento

Corregidos:

- Continuar con jugadores pero sin campo podía abrir scorecard sobre un campo predeterminado.
- Stats mezclaba gross/putts de 9 y 18 hoyos.
- Editar o borrar desde biblioteca podía cambiar el campo activo sin intención explícita.
- Favoritos/recientes podían sobrevivir a la eliminación local de una cuenta.
- El resultado accesible de búsqueda de campos anunciaba tarjetas completas y algunos targets medían menos de 44 px.
- Minimum Putts de 18 nunca cerraba dentro de una ronda de 9 hoyos.
- Stakes negativos podían invertir liquidaciones en inputs ordinarios.
- Configuraciones activas incompletas podían llegar a inicio o liquidación y aparecer como un resultado de `$0`.
- La migración de Nassau suplementario podía resolver al owner antes de disponer de la identidad autenticada.
- IDs externos con espacios y estados Manuales sin nombre podían producir identidades o resultados ambiguos.
- En modo invitado, comparar IDs ausentes podía marcar erróneamente a todos los jugadores como “tú” en Balances.
- Una confirmación cloud o reintento antiguo podía borrar una edición de score más nueva; ahora el ACK usa watermark y compare-and-swap.
- Perfiles renombrados vinculados a una cuenta podían duplicarse dentro de una plantilla de grupo; ahora se deduplican por identidad estable antes de cargar la ronda.
- Valores desconocidos de `POLLA_LIVE_ENABLED` podían interpretarse de forma permisiva; ahora el flag falla cerrado.
- Eventos internos idénticos podían duplicar avisos y badges; ahora se deduplican y el estado leído admite cambios consecutivos.
- Un cierre de Ball Fit podía afirmar que guardó aunque `localStorage` fallara; ahora mantiene el flujo abierto y muestra un error recuperable.
- Una recuperación técnica de equipo podía sobrevivir a la eliminación local de la cuenta; ahora utiliza una llave determinista que también se elimina.
- La escritura cloud podía aceptar campos truncados durante normalización; ahora exige equivalencia canónica completa y rechaza la operación.

Pendientes y aislados para un milestone colaborativo:

- La nube persiste snapshots/resultados calculados por cliente; una futura ronda colaborativa exige validación/liquidación autoritativa server-side.
- El abandono/DNF de Presiones por pareja necesita semántica de ronda explícita; no se debe fabricar un score gross ni contaminar Stats para completar esa liquidación.

## Despliegue

- Rama objetivo: `beta`.
- El último SHA publicado y verificado anterior a este milestone es `8023cee7928ca47963c296ad5a7e780a0896de4d`.
- El Preview anterior verificado es `https://golf-bets-1ps4i70si-saha8.vercel.app`, deployment `dpl_ByuS4LnsGYXFv8Pn3nsH1TNjh7py`, READY, target Preview, source Git, ref `beta` y SHA exacto `8023cee7928ca47963c296ad5a7e780a0896de4d`.
- Commit funcional del milestone: `c8b285e5212d568558cc5b1d11bf78d6df34dea2` — `feat(beta): add equipment profile and Backyard Ball Fit`. Push y nuevo Preview todavía pendientes al momento de este registro previo a publicación.
- Alias Preview de rama: `https://golf-bets-git-beta-saha8.vercel.app`.
- El HTML remoto responde 200, referencia los assets del build, incluye `viewport-fit=cover` y el bundle publicado contiene Inicio, Jugar, Grupos, Social, Perfil, Nueva ronda, Continuar ronda, Histórico, Stats, Amigos, Reglas y Balances.
- No se hizo merge, promoción a Production, despliegue `--prod` ni cambio de variables Production.

## QA ejecutado

- `eslint .`: correcto, cero errores.
- `tsc --noEmit`: correcto.
- `tsc -p tsconfig.test.json`: correcto.
- `node --test .test-dist/tests/*.test.js`: 931 tests, 931 pass, 0 fail/skip/todo.
- `next build`: correcto; 19 rutas estáticas/dinámicas generadas sin error, incluida `/api/equipment`.
- Pruebas nuevas cubren normalización/persistencia de equipo por usuario, club manual y bolsa completa, bola fija/no fija, borrador de Ball Fit, ranking Top 3, datos incompletos, catálogo/fuentes, seguridad de sync/CAS, contrato de UI y migración/RLS.
- Browser QA local: Home a 320/375/390/430 y Jugar/Campos/Setup/Grupos/Social/Perfil/Stats a 390; cero overflow y cero errores de consola.
- Cobertura existente conservada: Auth, guests, grupos locales, ronda 9/18, HCP 0, score/edit/save/reopen, apuestas, histórico, IndexedDB/outbox/reconnect, PWA y reglas.
- Preview remoto funcional: estado READY para `1c770b8`; `/` responde 200 y el HTML contiene `viewport-fit=cover`. El service worker usa `/` como fallback offline y evita cachear APIs.
- El pase visual automatizado de este milestone no pudo abrir una superficie de navegador en este host; se conservan las verificaciones móviles registradas previamente y no se afirma una nueva certificación de Mi bolsa/Ball Fit en Safari o iPhone físico.

## NEXT — diez trabajos recomendados

1. Crear una branch/proyecto Supabase exclusivo para Beta y verificar su ref antes de cualquier DDL.
2. Corregir ACL/grants y drift del esquema en esa base, aplicar `20260906193435_equipment_ball_fitting.sql` y ejecutar su prueba RLS con al menos dos usuarios y un admin.
3. Importar los tres seeds verificados de equipo/bola/shafts y habilitar `EQUIPMENT_CLOUD_ENABLED` únicamente en Preview/Beta después de validar rollback y aislamiento.
4. Añadir administración protegida para alta, corrección y desactivación de modelos sin borrar equipos antiguos.
5. Incorporar las mediciones robustas de launch monitor al recomendador sólo cuando exista una heurística pública, documentada y validable.
6. Diseñar la semántica explícita de abandono/DNF sin inventar score de golf.
7. Diseñar y migrar amistades con unicidad, estados, bloqueo y una proyección pública mínima de perfil.
8. Convertir plantillas de grupos en grupos sociales persistentes sin romper compatibilidad local.
9. Modelar invitaciones, roles, permisos de score y conflictos multi-dispositivo por participante.
10. Verificar onboarding, Mi bolsa, Ball Fit, instalación PWA y recuperación local en iPhone/Android físicos.

Punto exacto de continuidad: provisionar y verificar primero una branch/proyecto Supabase exclusivo para Beta. Allí se debe aplicar y probar la migración de equipo, cargar los seeds y validar sincronización multi-dispositivo antes de activar el flag. Hasta entonces el módulo funciona honestamente local-first y no declara sincronización remota.

## Confirmación de producción

Hasta esta actualización no se ha ejecutado ningún merge o push a `main`, no se ha promovido ningún deployment, no se han cambiado variables Production y no se ha aplicado DDL al Supabase compartido. `https://app.thebackyard.com.mx` permanece fuera de toda acción de escritura de esta sesión.

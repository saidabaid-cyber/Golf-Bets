# The Backyard Beta — arquitectura

Estado documentado: 2026-09-06. Rama de trabajo: `beta`.

## Límites de entorno

- `main`, el tag estable y `https://app.thebackyard.com.mx` son producción y quedan fuera del alcance de escritura.
- Todo cambio de esta iteración vive en `beta`. Su despliegue debe ser Preview/Beta; nunca debe promoverse a Production.
- El único proyecto Supabase encontrado es `zhqmlpljloumldaczcfp` (`The Backyard`) y no tiene branches de base de datos. Por tanto puede contener datos de producción y no es un destino seguro para DDL de Beta.
- No se aplicarán migraciones ni cambios de variables Production hasta disponer de una base/branch Beta aislada y verificar explícitamente su referencia.

## Aplicación actual

The Backyard usa Next.js 16 App Router, React 19 y TypeScript. La experiencia privada principal es una SPA cliente en `app/page.tsx`, separada en componentes para cuenta, grupos, scorecard, apuestas, resultados, reglas y Polla Live. La navegación interna se modela como estados de pantalla y conserva integración con el historial del navegador.

Los Route Handlers bajo `app/api` atienden cuenta, sincronización cloud, reglas y la infraestructura de Polla Live. La lógica determinística de HCP, apuestas y liquidación vive en `lib`; la IA de reglas está separada de esos cálculos y no puede cambiar scores ni balances.

## Identidad y autorización

- La app funciona en modo invitado sin Supabase.
- Cuando Supabase está configurado, admite sesión persistente, email OTP y Google si el proveedor está habilitado.
- El navegador usa únicamente la llave pública `anon`/`publishable`.
- La service role se limita a código de servidor y no debe exponerse con prefijo `NEXT_PUBLIC_`.
- Las APIs cloud validan el usuario y las rutas de Polla validan sesión/rol o acceso invitado antes de operaciones privilegiadas.
- Los consentimientos legales y de datos de apuestas se conservan; el texto del Aviso de Privacidad no se modifica en esta iteración.

## Ronda privada y persistencia

`RoundSnapshot` es el snapshot histórico persistido y versionado de una ronda cerrada. Incluye campo, jugadores, HCP usado, scores, estadísticas opcionales, configuración y resultados de apuestas, gastos, balances, eventos, lifecycle y metadatos de cierre. Puede actualizarse deliberadamente mediante el flujo de edición histórica conservando el mismo ID; el catálogo editable nunca altera por sí solo su `courseSnapshot`.

La persistencia es local-first:

1. `localStorage` mantiene compatibilidad y acceso inmediato a borrador, histórico, campos, jugadores frecuentes, grupos frecuentes, rivales y preferencias.
2. IndexedDB guarda una copia durable por identidad y una outbox idempotente.
3. Si IndexedDB falla, se usa un fallback verificado en `localStorage`.
4. Al reconectar, la cola reintenta con espera exponencial acotada.
5. La nube confirma el fingerprint exacto antes de retirar una mutación pendiente.
6. La sincronización usa timestamps, compare-and-swap, tombstones y conflictos explícitos para evitar sobrescrituras silenciosas o resurrección de datos borrados.

Los “grupos” actuales son plantillas locales/frecuentes de jugadores. Todavía no equivalen a grupos sociales persistentes con admin, membresías e invitaciones.

## Validación y liquidación determinística

`lib/bet-config-validation.ts` centraliza la validación fail-closed de apuestas activas. Setup, restauración de drafts, inicio de ronda y liquidación comparten los mismos invariantes para participantes, equipos, rivales, bases HCP, valores finitos, carry y press. Una configuración legacy inválida se conserva para poder repararla, pero no se ejecuta silenciosamente.

El motor sigue siendo determinístico y separado de IA. Balances usa resultados históricos persistidos como ledger derivado: no muta snapshots, no acepta edición arbitraria, no registra pagos y no afirma que una sugerencia de liquidación sea una deuda pagada. Los invitados usan identidad acotada a la ronda; las cuentas estables requieren un ID persistido no ambiguo.

La Scorecard calcula una vista previa de neto a HCP de ronda al 100% exclusivamente para contexto de golf. Acepta HCP cero, plus y ciclos adicionales por encima de 18; si falta HCP o score no fabrica un neto. Este helper no entra al motor de apuestas: cada modalidad conserva su propia base y porcentaje.

`lifecycleState` añade `draft`, `live`, `completed` y `cancelled` de forma compatible. Las rondas legacy sin estado se leen como `completed` sin migración destructiva. La captura avanzada es opcional: `scoreCaptureMode` y `advancedStats` se persisten con la ronda, pero nunca alimentan el motor de apuestas.

El perfil ampliado normaliza username, ubicación, club, tee, mano, bio y visibilidad en la caché local por identidad. “Mi juego” añade score típico, distancia/velocidad de driver, trayectoria, tendencia, tipo de greens, prioridad y sensibilidad al precio reutilizando el HCP y la mano existentes. Nombre, HCP y avatar conservan el write cloud existente; los campos nuevos no se presentan como sincronizados hasta contar con columnas y RLS en una base Beta aislada.

Perfil y Cuenta son vistas distintas. Sólo una sesión autenticada puede editar la identidad persistente; un workspace invitado conserva rondas y estadísticas locales, pero no se etiqueta como cuenta ni perfil sincronizable. Los errores de formulario/guardado usan estados accesibles separados del éxito.

Social y notificaciones son actualmente una proyección privada de actividad local. El estado leído se guarda por identidad en el dispositivo, deduplica eventos exactos y no crea una relación social remota. Los avisos compartidos seguirán bloqueados hasta disponer de tablas, RLS y pruebas multiusuario en Beta.

## Perfil de equipo, bola y Ball Fit

El equipo extiende la identidad autenticada existente; no crea una segunda cuenta ni un segundo jugador. `EquipmentProfile` es un documento de esquema v2 por `userId` que contiene bastones, bolas, distancias y el resumen del último fit. Conserva la llave descubrible `the-backyard:equipment-profile:v1:<userId>` para migrar tolerante y localmente los documentos v1 antes de exigir v2 en escrituras cloud. El borrador del cuestionario se guarda por separado en `the-backyard:ball-fit-draft:v1:<userId>` para poder cerrar y reabrir la PWA sin perder respuestas.

El flujo opcional se integra después de completar el perfil básico de una cuenta nueva. Cada etapa permite omitir y las cuentas existentes acceden directamente desde Perfil, sin ser forzadas a un nuevo onboarding. “Mi bolsa” y “Mi bola” consumen el mismo store local-first: una entrada puede referir a catálogo o usar `customBrand`/`customModel`; todos los datos técnicos adicionales son opcionales. Un cambio de modelo cierra la etapa actual con `stoppedUsingAt` y crea la nueva con `startedUsingAt`; `isCurrent=false` conserva equipo/bolas anteriores y la UI también permite eliminación explícita por decisión del usuario.

Los catálogos no están hardcodeados en componentes React. `lib/golf-equipment-catalog.ts` carga tres seeds JSON versionados e importables:

- bolas: 11 marcas y 11 modelos;
- bastones: 15 marcas y 17 modelos;
- shafts: 5 marcas y 5 familias de modelos.

Cada registro aceptado conserva fuente oficial y `verifiedAt`. `equipmentCatalogDatabaseSeed()` proyecta los contratos a columnas SQL `snake_case`, incluida la correspondencia explícita `officialUrl → source_url`, para un futuro `upsert` idempotente en una base Beta elegida deliberadamente. Los atributos cualitativos se normalizan a `VERY_LOW`, `LOW`, `MID`, `HIGH` o `VERY_HIGH`; compresión y cualquier otro dato no confirmado permanecen `null`. Los modelos antiguos pueden mantenerse con `active=false` en lugar de borrarse.

Los componentes no importan esos seeds. `lib/equipment-catalog-provider.ts` define un contrato paginado y `lib/equipment-catalog-provider.server.ts` encapsula el proveedor interno con `server-only`; `/api/catalog/equipment` entrega como máximo una página pequeña, admite búsqueda/categoría/cursor e IDs fijados para resolver selecciones archivadas. El hook cliente aplica debounce, `AbortController` y una generación monotónica para impedir que respuestas antiguas contaminen una consulta nueva.

`PlayerClubDistance` cuelga del mismo `PlayerClub` y guarda carry/total, unidad, fuente, muestras y confianza. La primera UI escribe sólo fuente `MANUAL`; los enums reservan `ROUND_ESTIMATE`, `LAUNCH_MONITOR`, `GPS` e `IMPORT` sin afirmar que ya se estén calculando.

`lib/ball-fitting.ts` implementa un recomendador determinístico y explicable, separado de apuestas, scores e IA. `/api/ball-fitting` ejecuta ese motor server-side sobre el catálogo activo completo hasta un techo explícito de 2,000 candidatos; si el proveedor informa un alcance incompleto, responde fail-closed y no publica un ranking parcial. El cliente recibe sólo el registro actual y Top 3. El transporte sustituye la identidad real y la identidad de la sesión de launch monitor por un scope opaco, sin modificar el input local que se persiste. Una falta de evidencia reduce cobertura o produce “Sin dato verificado”; el producto nunca se presenta como fitting oficial de un fabricante.

El launch monitor es una captura estructurada opcional para Driver, hierro 7, pitching wedge y medio wedge. Admite múltiples golpes, exclusión/reactivación de mishits y resume sólo muestras incluidas mediante mediana y promedio resistente. El protocolo visible guía 3 golpes por categoría, pero los resúmenes todavía no cambian el ranking: no se han inventado ventanas ni algoritmos propietarios.

### Persistencia y sincronización de equipo

El guardado confirmado es local-first. La UI expone estados de carga, guardado local, sincronizando, sincronizado, offline, pendiente, conflicto y error. Cambiar de dispositivo requiere la ruta autenticada `/api/equipment`, que valida el token con Supabase, obliga a que el snapshot pertenezca a `auth.uid()`, limita el payload, exige normalización canónica sin truncamientos y usa mutation ID, versión y compare-and-swap. Fechas iguales con payload distinto son conflicto explícito; ninguna versión gana silenciosamente. La cola deduplica fingerprints reales, permite una reversión A→X→A y acota cada operación a `{generation,userId,accessToken}`; tras un refresh/logout una respuesta anterior no puede tocar refs ni UI.

La frontera cloud falla cerrada mediante `EQUIPMENT_CLOUD_ENABLED`: sólo un valor afirmativo explícito habilita la ruta y `/api/features` informa esa capacidad al cliente. El flag permanece ausente/deshabilitado porque la migración todavía no se ha aplicado en una base Beta aislada. Por tanto, el comportamiento realmente disponible en este milestone es persistencia local por identidad; la réplica multi-dispositivo está implementada y probada por contrato, pero no activa.

La API guarda el snapshot canónico en `player_equipment_profiles`. Las demás tablas de la migración preparan proyecciones normalizadas para catálogo, historial, fits/recomendaciones y golpes de launch monitor; este milestone no afirma que esas proyecciones se estén poblando remotamente.

## Supabase existente

Las migraciones ya versionadas en `supabase/migrations` cubren, entre otras entidades:

- perfiles, preferencias, aceptaciones legales y migración de cuenta;
- snapshots cloud de rondas, jugadores, scores, campos, grupos frecuentes y rivales;
- configuración/resultados de apuestas, gastos, campo y reglas locales por ronda;
- tombstones, estado de nube y fotos privadas de scorecard;
- infraestructura de torneos/Polla Live, acceso, grupos, miembros, scores, auditoría, premios, Oyes e invitaciones;
- rate limiting persistente para IA de reglas.

Las tablas expuestas cuentan con RLS en las migraciones y políticas basadas en `auth.uid()` o propiedad indirecta. Funciones privilegiadas tienen grants explícitos. Antes de ampliar el modelo deben verificarse tanto grants como RLS en una base Beta aislada y ejecutar pruebas de dos usuarios/roles y los advisors de seguridad y rendimiento.

La inspección read-only del proyecto alojado encontró drift y riesgos que deben corregirse primero en una base aislada, nunca directamente sobre el proyecto compartido:

- privilegios predeterminados y ACL históricos más amplios que los contratos actuales de las migraciones;
- una función `is_polla_admin` con `SECURITY DEFINER` que requiere revisar su superficie de ejecución;
- relaciones de Polla cuya pertenencia al mismo torneo no está reforzada en todos los casos mediante claves compuestas;
- canales Realtime que publican filas más amplias que la señal/leaderboard sanitizado descrito por el código actual;
- un bucket temporal de marketing con capacidad de carga pública que requiere confirmar necesidad y límites;
- `profiles` limitado al propio usuario, por lo que una búsqueda de amigos no debe abrir la tabla completa: necesita una proyección pública mínima y autorizada;
- restricciones de consentimientos legales distintas entre esquema vivo y migraciones versionadas;
- protección de contraseñas filtradas deshabilitada en Auth.

Estas observaciones no implicaron DDL ni cambios de configuración. El orden seguro es: capturar baseline/drift, cerrar ACL/grants, probar RLS con dos usuarios y sólo después añadir perfiles públicos mínimos, amistades, grupos y permisos de ronda.

Se creó, pero **no se aplicó remotamente**, la migración aditiva `20260906193435_equipment_ball_fitting.sql`. Prepara 9 tablas: `golf_ball_catalog`, `golf_club_catalog`, `golf_shaft_catalog`, `player_equipment_profiles`, `player_clubs`, `player_balls`, `ball_fit_sessions`, `ball_fit_recommendations` y `launch_monitor_shots`. Todas habilitan RLS y en conjunto declaran 27 policies:

- los tres catálogos permiten lectura autenticada y `insert/update` sólo cuando `app_metadata.role = admin`;
- las seis tablas de jugador permiten `select/insert/update` únicamente cuando `user_id = auth.uid()`;
- `anon` no recibe grants, los clientes autenticados no reciben `DELETE` y `service_role` obtiene explícitamente sólo `select/insert/update` para las rutas server-only;
- triggers validan identidad consistente, timestamps/versiones y compare-and-swap del snapshot canónico.

`supabase/tests/equipment_ball_fitting_rls.sql` prepara verificación transaccional de aislamiento. Las pruebas TypeScript inspeccionan además grants, owner checks y que `user_metadata` no participe en autorización. Ejecutar esta migration/prueba contra Supabase permanece bloqueado hasta disponer de una base Beta separada; el proyecto alojado no fue modificado.

La segunda migración aditiva `20260906211937_golf_profile_course_architecture.sql`, también preparada y **no aplicada remotamente**, añade los campos opcionales de “Mi juego”, fortalece historia/procedencia del equipo y crea 12 tablas: dos marcas canónicas, pruebas de bola, distancias por bastón, clubs, courses, tees, holes, yardajes por tee, geo-features, favoritos y recientes. Extiende el puente `courses_cloud` sin modificar snapshots de ronda. Declara 37 policies y 40 índices para owner, admin, búsqueda trigram, marca/modelo, proveedor/ID externo, recencia y búsqueda geográfica futura.

`supabase/tests/golf_profile_course_architecture_rls.sql` incluye casos conductuales dentro de una transacción para usuario A, usuario B, no-admin y admin. Las pruebas estáticas verifican además FKs, constraints, grants y propagación transaccional al renombrar una marca canónica. No se ejecutó SQL real por no existir Supabase local, `psql`, Docker o una base Beta aislada.

`/admin` es una superficie compacta para marcas/modelos de bola, marcas/modelos de bastón, shafts, clubs, courses, tees y holes. Su Route Handler falla cerrado antes de construir clientes si el feature de equipo no está habilitado, vuelve a validar el JWT y sólo confía en `app_metadata.role = admin`. La administración pagina/busca, limita payloads y archiva (`active=false`) en vez de borrar; nunca autoriza por ocultar el botón ni por `user_metadata`. Las cargas usan abort + generación + contexto, y guardar/archivar permanece ligado al recurso original para que respuestas antiguas no crucen IDs entre catálogos.

## Proveedores de golf

`lib/golf-providers.ts` define contratos tipados para:

- `CourseDataProvider`
- `HandicapProvider`
- `GolfProfileProvider`
- `GolfMapProvider`
- `DistanceProvider`

`InternalCourseProvider` es el proveedor concreto inicial. Implementa `searchCourses`, `nearbyCourses`, `getCourse`, `getTees`, `getHoles` y `getGeoFeatures` sobre un directorio interno provider-neutral. No hace fetch externo, scraping ni crea coordenadas. Cualquier futuro GolfAPI/Google Places/proveedor autorizado podrá implementar el mismo contrato sin cambiar la UI.

`lib/golf-course-directory.ts` construye entidades separadas `GolfClub`, `GolfCourse`, `GolfCourseTee`, `GolfHole`, yardaje y `GolfHoleGeoFeature`, y proyecta selecciones legacy para no reescribir drafts o históricos. El seed QA contiene cuatro clubs/courses, siete tees y 72 hoyos basados en el catálogo ya existente y páginas oficiales; las coordenadas no verificadas permanecen `null`. `lib/course-catalog.ts` valida ID/nombre/tee, 9/18 hoyos completos, Par y SI únicos; metadatos opcionales inválidos se omiten con warnings.

`lib/course-distance.ts` mantiene Haversine y orden de cercanía separados del navegador. Nueva Ronda solicita geolocalización únicamente por acción explícita, explica que es opcional y mantiene búsqueda manual cuando se rechaza o falla. Sin coordenadas verificadas el estado cercano queda honestamente vacío; las pruebas usan coordenadas sintéticas y no presentan La Vista/Campestre/El Cristo/Cola de Lagarto a distancias inventadas.

La UI debe distinguir siempre el HCP manual/de juego de cualquier índice oficial. Una futura integración solo podrá etiquetarse como oficial si el proveedor y la autorización correspondientes lo permiten.

## PWA y offline

La app ya dispone de manifest, iconos normales/maskable, Apple touch icon, modo standalone y service worker. El worker precachea el shell/activos estáticos, evita cachear APIs y usa navegación network-first con fallback local. La durabilidad de score depende del flujo local-first, no de cachear respuestas privadas.

El store offline lee tanto IndexedDB como el fallback verificado en `localStorage` y selecciona el snapshot/outbox más reciente. Un watermark de ACK más compare-and-swap transaccional impide que respuestas o reintentos antiguos eliminen una mutación nueva; un guardado local-only nunca borra por accidente una cola cloud pendiente.

## Feature flags

Flags de servidor existentes:

- `CLOUD_ENABLED`
- `EQUIPMENT_CLOUD_ENABLED`
- `POLLA_LIVE_ENABLED`
- `AUTH_SOCIAL_ENABLED`
- `RULES_AI_ENABLED`

Polla Live debe permanecer visible solo como “Próximamente” y deshabilitado en esta iteración. `POLLA_LIVE_ENABLED` falla cerrado: únicamente los valores normalizados `1`, `true`, `on` y `yes` habilitan el backend; ausente, vacío, falso o desconocido impide instanciar también el cliente con service role. `EQUIPMENT_CLOUD_ENABLED` usa el mismo criterio explícito y permanece deshabilitado mientras no exista una base Beta con las migraciones aplicadas. La proximidad local no necesita proveedor ni flag; mapas/geometría, integraciones de campos/HCP/perfil, pagos, suscripciones y módulos incompletos sí permanecen ocultos o protegidos y no generan botones muertos.

## Flujo de despliegue seguro

1. Confirmar `git branch --show-current` = `beta`.
2. Ejecutar lint, typecheck/pruebas y build.
3. Crear commits pequeños de milestone en `beta`.
4. Hacer push solo a `origin/beta` para obtener Preview.
5. Verificar que la URL Preview esté READY, responda 200 y corresponda al SHA de `origin/beta`.
6. Confirmar por metadata Git/deployment que `main`, el tag estable y Production no cambiaron, sin navegar ni modificar producción.

Nunca usar merge a `main`, despliegue `--prod`, promoción de deployment ni variables Production para cerrar un milestone Beta.

# The Backyard Beta — Overnight Log

Fecha: 2026-09-06. Hora aproximada de cierre: 01:45, zona `America/Mexico_City` (UTC−06).

## Estado inicial registrado al cierre del primer bloque (histórico; publicación ya resuelta)

- Rama activa y única rama modificada: `beta`.
- `beta` local: `e7da2b2685b28c77203be3d1b076d4888a67ab29`.
- `origin/beta`: `b2d10bb125bdba4b3a716ceb11dd3f170a68cf93`.
- Estado en ese momento: `beta` local estaba tres commits adelante de `origin/beta`.
- `main` y `origin/main`: `6ceea3f4f9ccfe474f3cd2f804b1ee3e88cb59f4`.
- El tag `stable-2026-09-05` continúa apuntando a `6ceea3f`.
- No se hizo merge a `main`, promoción a Production ni cambio de tag estable.

## Commits locales

### 1. `23598e2` — `feat(beta): build mobile golf platform foundation`

Creado aproximadamente a las 01:32.

- Reorganiza la navegación mobile-first en cinco áreas: Inicio, Jugar, Grupos, Social y Perfil.
- Añade Home, hub Jugar, biblioteca de campos, actividad privada, Stats y navegación inferior accesible.
- Usa identidad, rondas, grupos, campos e histórico reales del workspace local; no agrega datos ficticios ni publica actividad.
- Añade favoritos y recientes de campos aislados por identidad, con limpieza al eliminar el workspace local.
- Añade contratos tipados para datos de campos, HCP, perfil de golf, mapas y distancias. El único proveedor concreto busca sin red sobre el catálogo `Course[]` ya existente.
- Calcula estadísticas únicamente desde tarjetas completas y separa cohortes de 9 y 18 hoyos.
- Corrige Minimum Putts para que una ronda de 9 hoyos cree/restaure una apuesta de 9 hoyos, incluyendo salidas por H1 o H10, sin modificar la fórmula ni reinterpretar snapshots válidos de 18 hoyos.
- Conserva el núcleo existente de Auth, cuentas, guests, apuestas, resultados, histórico, sincronización, offline, PWA, Reglas e infraestructura deshabilitada de Polla Live.

El commit contiene 24 archivos modificados, con los nuevos componentes y pruebas de la base de plataforma.

### 2. `c0a7b5d` — `fix(beta): reject negative wager stakes`

Creado aproximadamente a las 01:37.

- Establece `min={0}` en el wrapper monetario general `MoneyInput`.
- Establece `min={0}` en el wrapper monetario suplementario `MoneyField`.
- Mantiene deliberadamente `SignedMoneyInput` sin mínimo para que Apuestas Manuales acepte ganancias y pérdidas firmadas.
- No cambia fórmulas, motores de liquidación ni snapshots históricos.
- Añade una prueba de contrato y comportamiento para el límite ordinario y la excepción firmada.

### 3. `e7da2b2` — `docs(beta): record architecture and build status`

Creado aproximadamente a las 01:42.

- Añade `BETA_ARCHITECTURE.md` con límites de entorno, arquitectura local-first, Auth, sync, Supabase, providers, PWA, flags y flujo seguro de despliegue.
- Añade `BETA_BUILD_STATUS.md` con funcionalidades completas/parciales/bloqueadas, QA, riesgos, decisiones y siguientes trabajos.
- Registra que no hubo migraciones nuevas o aplicadas, tablas/RLS nuevos ni cambios al proyecto Supabase alojado.

## Validaciones ejecutadas

- `eslint .`: correcto, sin errores.
- Compilación TypeScript de la suite: correcta.
- Suite completa: 623 tests ejecutados, 623 correctos, 0 fallos, 0 omitidos y 0 pendientes.
- `next build`: correcto con Next.js 16.3.3; las 18 rutas estáticas/dinámicas se generaron sin error.
- QA visual local de Home en 320, 375, 390 y 430 px.
- QA local de Jugar, Campos, Setup, Grupos, Social, Perfil y Stats a 390 px.
- En el QA visual registrado no hubo overflow horizontal ni errores de consola.
- Se verificó localmente que Polla Live continúa deshabilitado como “Próximamente”.
- Se verificó que los cambios de Minimum Putts cubren 9 hoyos H1–9, 9 hoyos H10–18, captura incompleta, empate total, empate dividido, 18 hoyos y conservación del snapshot de 18.
- Se verificó que los importes ordinarios se limitan a cero y que Manuales conserva captura negativa.

Estas validaciones corresponden a los commits locales. No equivalen a una verificación del nuevo código en Preview/Beta remoto mientras los commits no estén publicados.

## Bloqueo inicial de publicación (resuelto)

El remoto configurado es el repositorio público `https://github.com/saidabaid-cyber/Golf-Bets.git`. En el primer bloque, el push de `beta` quedó bloqueado por el control de seguridad del entorno. La autorización posterior permitió publicar exclusivamente `origin/beta`; este apartado se conserva como historia del incidente, no como estado actual.

Consecuencias comprobadas en ese momento:

- no se ejecutó un push efectivo;
- `origin/beta` permanecía en `b2d10bb`;
- los tres commits existían únicamente en la rama `beta` local;
- el alias Preview de rama todavía servía el último commit remoto, no `e7da2b2`;
- no se había iniciado un deployment nuevo y no se había tocado Production.

La publicación se resolvió posteriormente mediante `git push origin beta`, sin merge a `main`, `--prod` ni promoción manual. El resultado actual está registrado al final de este log.

## Decisiones técnicas

- Se trabajó de forma incremental sobre la arquitectura existente; no se reescribió el motor ni la persistencia.
- Home, Stats y actividad consumen datos persistidos reales. Cuando faltan datos completos muestran estados vacíos o parciales y no inventan métricas.
- Social se presenta como actividad privada local hasta contar con un modelo multiusuario autorizado.
- Los grupos existentes siguen siendo plantillas privadas; no se presentan como comunidades con membresías que aún no existen.
- El catálogo interno es la única fuente activa de campos. Los adapters externos son contratos sin fetch, scraping, credenciales ni afirmaciones de integración.
- El HCP mostrado continúa siendo manual/de juego; no se afirma que The Backyard emita un índice oficial.
- Minimum Putts recibe la duración de ronda de forma explícita al crear, cambiar o restaurar el draft. La liquidación matemática quedó intacta y el camino de 18 hoyos conserva su configuración histórica.
- Los montos ordinarios se restringen en la frontera de captura UI. Manuales conserva su semántica firmada y no se migraron ni reescribieron valores históricos.
- La persistencia continúa local-first con `localStorage`, IndexedDB, outbox idempotente, fingerprints, tombstones y conflictos explícitos.
- No se aplicó DDL porque el único proyecto Supabase inspeccionado no dispone de una branch Beta aislada. Las funciones sociales y multi-dispositivo que requieren tablas/RLS permanecen bloqueadas.
- No se cambiaron variables Production, secretos, proveedores externos ni configuración de cobros.
- Polla Live, GPS, integraciones externas, pagos y suscripciones permanecen deshabilitados u ocultos según el alcance existente.

## Handoff seguro inicial (completado)

1. Se obtuvo autorización para escribir únicamente en `origin/beta`.
2. Se hizo push fast-forward sin modificar `main`.
3. Vercel generó un Preview READY para el SHA publicado.
4. Se verificaron HTTP, manifest, metadata de deployment y assets del bundle.
5. Antes de nuevas migraciones sigue siendo obligatorio crear o asignar una base Supabase aislada para Beta y verificar su referencia.

## Reanudación — lifecycle local de rondas

- Se continuó desde `8d355c2` sobre `beta`, sin cambiar `main`, Production ni dominios.
- Se añadió metadata aditiva `lifecycleState` a drafts y snapshots: `draft`, `live`, `completed` y `cancelled`.
- Los scores temporales sin confirmar no convierten la ronda en `live`; el cambio ocurre al persistirse un score confirmado.
- “Terminar ronda” conserva el draft durable como `completed` pendiente de revisión; guardarlo en Histórico genera un snapshot `completed`.
- Al confirmar una nueva ronda, la anterior se copia como `cancelled` en el respaldo recuperable y solo después se limpia el slot activo.
- Históricos antiguos sin estado se interpretan como `completed` en memoria, sin migración destructiva ni reescritura masiva.
- QA: lint correcto, TypeScript correcto, 724/724 pruebas y build optimizado de Next.js correcto.
- Publicación en ese punto de la reanudación: todavía pendiente; quedó resuelta al cierre consolidado descrito abajo.

## Reanudación — captura rápida y estadísticas opcionales

- Se añadió un selector por ronda entre captura `Rápida` y `Estadísticas`; cambiarlo no enfoca campos ni altera score o apuestas.
- El modo rápido conserva el flujo previo. Putts continúa apareciendo y siendo obligatorio únicamente cuando Mínimo de Putts lo requiere.
- El modo Estadísticas permite capturar putts, fairway (solo Par 4/5), GIR y golpes de penalidad por jugador/hoyo. Todos son opcionales y distinguen valor ausente de `false` o cero explícitos.
- `scoreCaptureMode` y `advancedStats` se normalizan y persisten en draft v9, autosave, IndexedDB/outbox, snapshot de Histórico, recarga, undo y edición de una ronda guardada.
- Stats agrega porcentajes solo sobre intentos capturados y penalidades registradas; Histórico identifica cuántos hoyos contienen al menos un dato avanzado.
- Compatibilidad: rondas anteriores sin estos campos abren en modo rápido y no se reescriben. Ninguna fórmula de apuesta recibe los nuevos datos.
- QA: lint correcto, TypeScript correcto, 730/730 pruebas, build correcto y HTTP local 200 con contenido de The Backyard.
- Límite visual de ese pase: no había ejecutable `agent-browser` disponible. Después se completó QA local en viewports móviles para las vistas indicadas en el cierre consolidado; Safari/iPhone físico sigue pendiente.

## Reanudación — perfil de golf ampliado local

- Se extendió el perfil de cuenta de forma aditiva con nombre, apellidos, username, ciudad, estado, país, club, tee, mano, bio y privacidad.
- Los cachés legacy se normalizan con campos vacíos y privacidad privada; no se reescriben datos históricos ni se inventan identidades para invitado.
- El guardado es local-first y nunca serializa `accessToken` ni proveedores de Auth. Los campos base conservan su escritura Supabase existente.
- El formulario comunica que los datos ampliados quedan locales hasta que exista un esquema/RLS Beta aislado; no declara sincronización remota inexistente.
- QA: lint correcto, TypeScript correcto, 734/734 tests y build optimizado de Next.js correcto.
- QA visual en ese punto: pendiente. Después se verificó localmente el formulario en el navegador disponible; no se certifica Safari/iPhone físico.

## Commits adicionales consolidados

- `87420c8` — `docs(beta): add overnight milestone log`.
- `d615c20` — `fix(beta): validate active bets before settlement`.
- `3efa6e1` — `fix(beta): preserve owner during Nassau migration`.
- `6f6071c` — `fix(beta): align wager identity and manual states`.
- `8d355c2` — `feat(beta): add historical balance ledger`.
- `18977c7` — `feat(beta): persist round lifecycle states`.
- `58c9d3a` — `feat(beta): add optional advanced score capture`.
- `ae3de0a` — `feat(beta): persist extended golf profile locally`.
- `752edb9` — `docs(beta): record overnight resumption handoff`.

## Cierre consolidado y publicación verificada

- Push: `b2d10bb..752edb9 beta -> beta`.
- SHA verificado en `origin/beta`: `752edb9b3c3afca8b63b09624479f799d05130ae`.
- Preview: `https://golf-bets-idkeq8epx-saha8.vercel.app`.
- Deployment: `dpl_63VyHZRp47wCcE3dui6rWSdUedqh`, estado READY, target Preview, source Git y ref `beta`.
- Alias de rama: `https://golf-bets-git-beta-saha8.vercel.app`.
- Verificación remota: `/` HTTP 200, manifest HTTP 200 y assets Next publicados. El bundle contiene la navegación Inicio/Jugar/Grupos/Social/Perfil y las acciones principales de Home.
- QA reproducido en el SHA publicado: lint limpio, TypeScript limpio, 734/734 pruebas y build correcto con 18/18 rutas.
- QA visual local acumulado: Home a 320/375/390/430 px y Jugar/Campos/Setup/Grupos/Social/Perfil/Stats/Balances a 390 px, sin overflow horizontal ni errores de consola en los pases registrados.
- No se crearon/aplicaron migrations, tablas ni policies; no se tocaron variables Production.

## Punto exacto de continuación

- Amistades persistentes sigue siendo el siguiente hito bloqueado por infraestructura: necesita una base Supabase Beta aislada, proyección pública mínima y pruebas RLS de dos usuarios. No se simuló una amistad local como si fuera compartida.
- Mientras se provisiona esa base, el siguiente trabajo seguro es cerrar semántica versionada de HCP plus, empates finales y abandono/DNF, seguido de PWA/offline en dispositivos físicos.
- `main`, el tag estable y Production no se tocaron.

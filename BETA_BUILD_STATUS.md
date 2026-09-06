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
- Perfil con resumen de golf real y Stats separada. Promedio, mejor score, tendencia y putts nunca mezclan tarjetas de 9 y 18 hoyos; la UI declara la cohorte utilizada.
- Actividad personal derivada sólo de rondas y grupos guardados. No se presenta como un feed compartido ni se publica a terceros.
- Biblioteca de campos con búsqueda tolerante a acentos, favoritos, recientes, creación/edición manual y selección explícita. Editar catálogo no cambia silenciosamente el campo del draft.
- Preferencias de campos aisladas por identidad y eliminadas al borrar la cuenta local.
- Contratos tipados `CourseDataProvider`, `HandicapProvider`, `GolfProfileProvider`, `GolfMapProvider` y `DistanceProvider`; el único proveedor activo busca sin red sobre `Course[]` existentes.
- Minimum Putts usa la duración explícita de ronda: H1–9 y H10–18 liquidan correctamente en rondas de 9; snapshots válidos de 18 conservan su comportamiento.
- Importes ordinarios de apuestas se limitan a cero o más en captura; Manuales conserva deliberadamente importes firmados.
- QA local del último milestone: lint sin errores, TypeScript correcto, 724/724 tests y build Next.js 16.3.3 correcto. El QA visual previo a 320/375/390/430 px permanece vigente; el nuevo cambio es de persistencia y no altera layout.

## PARTIAL — útil, pero todavía no cumple el modelo final

- Perfil persistente sigue limitado a nombre, email/avatar de Auth y HCP Index manual. Username, ubicación, club, tee, mano, bio, favoritos y privacidad necesitan esquema Beta/RLS.
- Grupos siguen siendo plantillas privadas de jugadores con creación/edición/sorteo/carga a ronda; no son aún comunidades con admin, invitaciones y membresías.
- Campos conservan el modelo legacy `Course`/tee con 18 hoyos. La biblioteca mejora el uso real, pero la normalización Course/Tees/Holes requiere una migración aditiva en Beta.
- Social es un feed privado local; amigos, solicitudes, bloqueo, feed compartido y reacciones requieren backend multiusuario.
- Live score y sync multi-dispositivo funcionan para el workspace de una misma cuenta; faltan participantes con permisos individuales y edición por jugador.
- El histórico conserva snapshots completos y ya normaliza estados `draft/live/completed/cancelled` localmente; el lifecycle cloud todavía no los expone como entidades colaborativas consultables porque falta el esquema Beta aislado.

## BLOCKED — sin detener el trabajo no dependiente

- Migraciones de nuevas funciones sociales: existe un solo proyecto Supabase y no tiene branch Beta. Aplicar DDL allí implicaría riesgo real para producción.
- Amigos persistentes, solicitudes, bloqueo, grupos sociales con membresías/admin, feed compartido y notificaciones: requieren esquema, grants, RLS y pruebas de aislamiento multiusuario en una base Beta.
- Edición multi-dispositivo de rondas privadas: requiere permisos por participante y una política de conflictos probada en backend.
- Integraciones TheGrint, GHIN u otros proveedores: no hay autorización, contrato ni credenciales. No se hará scraping ni uso de APIs privadas.
- GPS/mapa/distancias: no existe una fuente autorizada de geometría o coordenadas. Solo puede prepararse el contrato y un flag oculto.
- Pagos, planes y suscripciones: requieren decisión comercial/proveedor; no se activarán ni se inventarán precios.
- Aplicación de nuevas variables o migrations en Beta: pendiente de un entorno de datos aislado. Variables Production quedan fuera de alcance.

## Base de datos en esta iteración

- Migraciones nuevas creadas: ninguna.
- Migraciones aplicadas: ninguna.
- Tablas nuevas: ninguna.
- Políticas RLS nuevas: ninguna.
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

Pendientes y aislados para un milestone de cálculo versionado:

- HCP plus (“+1.2”) se conserva en cuenta, pero algunos cálculos/leaderboard legacy todavía lo limitan a cero.
- Empates finales abiertos en ciertas Presiones individuales/por pareja necesitan un contrato de cierre y auditoría uniforme.
- Configuraciones activas inválidas (participantes/equipos incompletos) pueden terminar como resultado `$0`; deben bloquear inicio/cierre con un validador puro compartido.
- La nube persiste snapshots/resultados calculados por cliente; una futura ronda colaborativa exige validación/liquidación autoritativa server-side.

## Despliegue

- Rama objetivo: `beta`.
- Alias Preview de rama activo: `https://golf-bets-git-beta-saha8.vercel.app`.
- Deployment remoto observado antes de estos commits: `https://golf-bets-ernyj25ny-saha8.vercel.app`, commit `b2d10bb`.
- Dominio Beta: `https://beta.thebackyard.com.mx`; DNS/TLS/HTTP 200 activos y el set de assets coincide con el alias de rama.
- Commits locales listos: `23598e2` y `c0a7b5d`.
- El push a `https://github.com/saidabaid-cyber/Golf-Bets.git` requiere aprobación explícita del control de seguridad del entorno. Hasta obtenerla, el dominio sirve el último commit remoto y estas funciones no se declaran desplegadas.

## QA ejecutado

- `eslint .`: correcto, cero errores.
- `tsc -p tsconfig.test.json`: correcto.
- `node --test .test-dist/tests/*.test.js`: 623 tests, 623 pass, 0 fail/skip/todo.
- `next build`: correcto; 18 rutas estáticas/dinámicas generadas sin error.
- Browser QA local: Home a 320/375/390/430 y Jugar/Campos/Setup/Grupos/Social/Perfil/Stats a 390; cero overflow y cero errores de consola.
- Cobertura existente conservada: Auth, guests, grupos locales, ronda 9/18, HCP 0, score/edit/save/reopen, apuestas, histórico, IndexedDB/outbox/reconnect, PWA y reglas.
- Preview/Beta remoto y comprobación posterior de producción se registrarán después del push Git autorizado de estos commits.

## NEXT — diez trabajos recomendados

1. Crear una branch/proyecto Supabase exclusivo para Beta y verificar su ref antes de cualquier DDL.
2. Corregir ACL/grants y drift del esquema en esa base, con pruebas RLS de dos usuarios.
3. Añadir validador puro de configuraciones de apuestas y versionar el tratamiento de HCP plus/empates finales.
4. Diseñar y migrar amistades con unicidad, estados, bloqueo y una proyección pública mínima de perfil.
5. Convertir plantillas de grupos en grupos sociales persistentes sin romper compatibilidad local.
6. Modelar invitaciones, roles, permisos de score y conflictos multi-dispositivo por participante.
7. Formalizar courses, tees y holes mediante migración aditiva y herramienta manual autorizada.
8. Completar perfil persistente y preferencias de privacidad; después construir feed/notificaciones.
9. Mover validación/liquidación de rondas colaborativas a una frontera autoritativa de servidor.
10. Verificar instalación PWA y recuperación offline en iPhone/Android físicos con red intermitente.

## Confirmación de producción

Hasta esta actualización no se ha hecho merge a `main`, no se ha promovido ningún deployment, no se han cambiado variables Production y no se ha aplicado DDL al Supabase compartido. `main`, `origin/main` y el tag estable continúan en `6ceea3f`; `https://app.thebackyard.com.mx` permanece fuera de toda acción de escritura.

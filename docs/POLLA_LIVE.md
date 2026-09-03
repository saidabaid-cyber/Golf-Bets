# Polla Live

Polla Live comparte únicamente identidad deportiva del torneo, grupos, HCP, scores, leaderboard, premios y Oyes. Nunca publica Conejos, Skins, Foursome, Unidades, Bola Amiga, Personales, gastos, balances privados, emails, PINs o tokens.

## Crear e invitar

El OWNER autenticado crea el torneo, campo/snapshot, salida H1/H10, 9/18 hoyos, formato, HCP, Oyes, premios y grupos de 3–5. Admite captura manual o CSV `name,handicap,group,startHole,teeTime`, hasta 100 jugadores.

Se generan UUID público, código corto aleatorio, enlace y QR. Mientras el dominio futuro no está conectado se comparte la URL actual. Cada participante recibe un PIN aleatorio de cuatro dígitos mostrado al admin; la base conserva solamente bcrypt. Los intentos fallidos están limitados por hash de solicitante.

## Roles

- **OWNER:** creador; configura, agrega/revoca administradores, corrige, confirma/reabre y regenera PIN.
- **ADMIN:** administración delegada del torneo asignado; corrige, confirma/reabre, cambia scorer y regenera PIN.
- **SCORER:** captura exclusivamente los jugadores de su grupo mientras la tarjeta está abierta.
- **VIEWER/PLAYER:** consulta, no modifica scores.

Los permisos se vuelven a validar en API/SQL. Ocultar un botón no concede seguridad.

## Captura, offline y conflictos

Cada grupo tiene scorer principal. La tarjeta inicia cada score en el Par real. **Guardar hoyo** guarda la intención primero en cola local cuando no hay red o el servidor falla, muestra pendientes y reintenta al evento `online`. Al reabrir, la UI superpone la cola sobre la copia cloud.

La cola deduplica torneo/jugador/hoyo. Cada cambio incluye la versión conocida (`updated_at`); si cloud ya cambió, la API responde 409 y conserva el pendiente. No se sobrescribe silenciosamente: un admin revisa/corrige.

Cerrar tarjeta exige confirmación, conexión y cola vacía. Después el scorer pierde edición; admin puede reabrir o corregir.

## Realtime y leaderboard

Una sola suscripción por torneo escucha `tournament_leaderboard_events`, que solo publica una revisión sanitizada; después el cliente hace un fetch agregado. Polling de 15–20 s sirve de respaldo y se limpia al salir.

El servidor consulta jugadores y scores por torneo en datasets completos y calcula en O(scores + jugadores), sin fetch por jugador. La tabla muestra Pos, Jugador, HCP, Thru, Gross, Neto y +/- Par, con General/Gross/Neto, H1–9, H10–18 y Mi grupo. Soporta progreso desigual y F.

Oyes se normaliza a metros y se muestra por hoyo. El audit log conserva score anterior/nuevo, identidad disponible, fecha y motivo opcional.

## Ronda privada vinculada

“Vincular ronda a Polla Live” requiere acción explícita y coincidencia única por nombre dentro del grupo. Al guardar un hoyo privado se encolan **solo** `{tournament, group, player, hole, score, version}`. No se envía configuración ni resultado de apuestas.

## Desarrollo

`tests/fixtures/polla-live-60.ts` genera 60 jugadores, 15 grupos de 4 y 1,080 scores de 18 hoyos. Nunca se inserta automáticamente en producción.

Sin variables/flags de nube, Polla Live muestra configuración pendiente y la ronda privada continúa completamente local.

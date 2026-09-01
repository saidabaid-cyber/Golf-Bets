# Polla Live

Polla Live es independiente de las apuestas privadas. Solo sincroniza identidad del torneo, grupos, HCP y scores; nunca publica Conejos, Skins, Foursome, Unidades, Bola Amiga, Personales, gastos o balances privados.

## Flujo

1. El administrador inicia sesión por magic link, crea torneo, importa jugadores manualmente/CSV y asigna grupos de 3–5.
2. Se genera un ID público, código corto, QR y PIN individual de 4 dígitos. Solo se muestra el PIN al crear; la base conserva un hash.
3. Un jugador abre el link, elige su nombre, introduce el PIN y obtiene una sesión revocable de scorer para su grupo.
4. El scorer captura el grupo completo. Cada hoyo se guarda inmediatamente; sin conexión se conserva en la cola local.
5. Al volver la conexión, la cola compara la versión conocida. Un conflicto se muestra y no sobrescribe silenciosamente.
6. El leaderboard público consulta datos sanitizados y usa polling como respaldo de Realtime.
7. Al cerrar la tarjeta el scorer pierde edición; el administrador conserva corrección y cada cambio queda en `score_audit_log`.

## Escala y seguridad

Los scores se consultan por torneo/grupo, no con un fetch por jugador. Existen índices para torneo-grupo, jugador-hoyo y actividad. La publicación Realtime agrupa cambios de scores y no crea una suscripción por participante.

RLS está activado en todas las tablas. La service role vive solo en endpoints servidor. El acceso público no tiene SELECT directo a jugadores o scores; el endpoint de leaderboard devuelve exclusivamente nombre, HCP y agregados deportivos.

## Modo sin nube

Sin las variables de Supabase, Polla Live muestra “Configura la nube para activar Polla Live”. Toda la ronda privada y el buscador manual de reglas permanecen disponibles.

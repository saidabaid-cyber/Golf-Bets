# Revisión manual GHIN — el_mongas

Usar exclusivamente **https://dev.thebackyard.com.mx** e iniciar sesión como **el_mongas@yahoo.com.mx**. No usar Production ni la cuenta Said. No publicar tarjetas manualmente para resolver un bloqueo de QA.

## Checkpoint real actual

**BLOCKED_EXTERNAL, no DONE:** el fix de hidratación está probado localmente y publicado en DEV (`a3a6e12`). Falta certificar el login en una sesión limpia antes de importar/publicar GHIN. La nueva pestaña normal de Chrome reutilizó storage previo y mostró 14 conflictos; no se eligió ni sobrescribió una copia. Se observó un GET inicial, cero POST y cero retries, pero esa sesión no acredita el smoke limpio. Abrir una sesión independiente; no limpiar ni descartar los conflictos de la sesión anterior a ciegas.

- GHIN pertenece al vínculo VERIFIED de el_mongas; número enmascarado `****3351`.
- Último Handicap Index persistido: **30.8**, VERIFIED, sync exitoso `2026-10-06T19:40:10.015Z`. La sesión upstream no se volvió a consultar en esta continuación; reautorizar sólo si responde REAUTH_REQUIRED.
- Backyard Index: **5.5**, separado del provider y conservado.
- 22 rondas Backyard completadas, QA22 cancelada, QA24 activa y dos parciales antiguas conservadas.
- Atest últimas 20: **11/20, 55%**. GHIN-only no modifica este porcentaje.
- Scoring record upstream: **cantidad aún no comprobada**, porque el flujo devolvió REAUTH_REQUIRED.
- Tarjetas GHIN importadas hasta este checkpoint: **0**. No hay tarjeta publicada ni provider score ID de posting.
- No se hizo cleanup ni publicación. Todos los scores siguen iguales. QA21 cambió versión 10 → 11 solamente por `updatedAt`, demostrado contra su versión anterior auditada; no se revirtió. QA24 sigue versión 4 intacta.

## Qué revisar

1. En Perfil, abrir la sección GHIN. Debe mostrar vínculo, Index y última actualización. Si pide renovación, introducir las credenciales propias directamente en esa UI; no enviarlas al agente.
2. El Index GHIN mostrado actualmente es 30.8. Después de una consulta real puede cambiar: registrar el valor recibido, no imponer 30.8 como resultado esperado.
3. En Carrera → Resumen/Índice, revisar que Backyard Index 5.5 sigue visible por separado. GHIN VERIFIED es la fuente primaria existente para nuevas configuraciones; QA24 conserva su freeze previo.
4. “Ver scoring record” consulta al provider. “Sincronizar tarjetas GHIN” guarda las tarjetas normalizadas privadas y muestra nuevas/vinculadas/en revisión. No hay sincronización periódica.
5. Registrar la cantidad upstream real antes de importar: todavía no está disponible en esta corrida.
6. Registrar la cantidad después de importar. La segunda importación debe indicar **0 nuevas** sin duplicados.
7. Las tarjetas importadas deben seguir siendo de sólo lectura y mostrar fecha, campo, tee y scores disponibles. No deben contener estadísticas inventadas.
8. Una tarjeta vinculada debe aparecer como **BACKYARD + GHIN**, con una sola entrada física y las acciones Backyard originales.
9. Una tarjeta sin coincidencia debe aparecer como **GHIN**, de sólo lectura.
10. No se publicó ninguna ronda en este checkpoint: no existe ronda ni provider score ID que revisar como posting real.
11. El posting sigue apagado. Ninguna de las tarjetas actuales tiene los dos mappings GHIN confirmados necesarios. No repetir intentos ni enviar tarjetas alternativas a ciegas.
12. En Carrera → Rondas y Histórico, revisar el origen y el orden por fecha. Las tarjetas importadas se paginan de 20 en 20.
13. Para comprobar dedupe, buscar el provider score ID y el ID Backyard vinculado: debe haber una sola entrada combinada. Esta verificación real está pendiente de importación.
14. En Carrera, conservar Resumen/Logros/Rivalidades/Rondas/Torneos. GHIN no debe añadir rivalidades, Atest, bets ni logros por hoyo. Torneos sigue vacío si no existen torneos reales.
15. Las 22 completadas existentes siguen siendo **Backyard-only** mientras no exista una reconciliación real comprobada.
16. En Inicio debe seguir apareciendo “Continuar ronda” para QA24: ID canónico `16e2c462-e6c3-4d5d-80d4-b68f6fc25a2d`, local `rrouggse`, La Vista Blancas, H1 **5/6**, pendiente H2. No cerrarla ni cancelarla.
17. Cualquier **MATCH_REVIEW_REQUIRED** debe conservar ambas tarjetas. La lista real de ambigüedades se llenará después de consultar GHIN; no hay una lista upstream verificada todavía.

## Pendientes reales

- Certificar el smoke real de hidratación tras el fix: sesión limpia, login manual/OTP directo en DEV, dos minutos sin acciones, cero POST/409/retries/idle calls. La reproducción y los 16 tests locales nuevos pasan; no reemplazan esta certificación. No repetir emails/OTP ni compartirlos en chat.
- Scoring record real, primera y segunda importación, QA visual con los datos oficiales y relogin limpio posterior.
- Candidato con mappings confirmados antes de habilitar cualquier transport de posting.
- Post → verificación provider → reimport → dedupe → segundo intento bloqueado: **no ejecutado**.

Esta guía describe un checkpoint incompleto. No acredita PASS del ciclo GHIN completo.

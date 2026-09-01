# Arquitectura V3

## Privado/local

El motor de apuestas y la ronda privada permanecen locales. Scores, apuestas, gastos, borrador, rivales y favoritos se guardan en el dispositivo. Ningún dato de Conejos, Skins, Foursome, Unidades, Bola Amiga o Personales se envía a Polla Live.

La Vista Temporal y los campos personalizados son editables. El histórico guarda una copia del campo y de la tarjeta, por lo que editar el catálogo no modifica rondas cerradas.

## Reglas

`lib/rules-catalog.ts` ofrece búsqueda determinista con números y enlaces oficiales curados. `/api/rules/ask` es una mejora opcional, exclusivamente servidor, respaldada por un Vector Store privado.

## Polla Live/cloud

La jerarquía es torneo → grupos → jugadores/scorer → scores. Los endpoints servidor validan sesión de administrador o token invitado antes de usar la service role. La cola offline conserva el último cambio por jugador/hoyo, compara `updated_at` y muestra conflictos en vez de sobrescribirlos silenciosamente.

La migración incluye perfiles, campos versionados, torneos, grupos, miembros, scores, auditoría, premios, Oyes normalizados, invitaciones, accesos, rondas cloud y links compartidos. Los índices principales evitan fetch por jugador y permiten 60–100 participantes sin suscripciones individuales.

## Límites de la revisión local

Sin un proyecto Supabase no se pueden ejecutar pruebas de integración RLS/Realtime ni validar entrega de magic links. Sin un Vector Store no se puede ejecutar una respuesta real de IA. Ambos módulos degradan de forma explícita y no bloquean build, pruebas o rondas privadas.

# Play, tarjetas compartidas y GPS — evidencia del 9/10 de octubre de 2026

## Entorno y alcance

- Base real: `96df8b2c5a16720de58f6dfd4f07c5ef894d848a`.
- Única rama publicada: `integration/backyard-current`.
- Único destino: `https://dev.thebackyard.com.mx`.
- Commits: `f229ed3` (captura canónica), `c917365` (Play/GPS/tarjeta), `45492e7` (CAS restringido en DEV) y el commit de cierre que contiene este documento (continuidad del mapa y salida con ACK).
- No se modificaron fórmulas de apuestas, Course Master, datos de El Mongas, conexiones GHIN, producción ni beta. Las escrituras de QA corresponden únicamente a nuevas rondas identificadas de los fixtures persistentes Diego/Carlos/Fernanda.
- El video `ScreenRecording_10-09-2026 9-57-39 p.m._1.mp4` no estaba disponible en los adjuntos accesibles. No se afirma haberlo revisado.

## Operación implementada

1. Play mantiene inicio solo, grupos y apuestas opcionales. El selector de captura permite elegir organizador o cada cuenta vinculada.
2. El modo por jugador crea una sola fila `rounds_cloud`, con los IDs de cuenta, tees y snapshot originales. Un enlace `/?sharedRound=<UUID>` permite abrirla; el servidor exige pertenencia real.
3. Cada participante guarda explícitamente su score/putts, sin esperar a los demás. Los invitados siguen bajo captura del organizador. Cambiar de hoyo no escribe scores y el hoyo visible es local a cada sesión.
4. Los parches conservan autor, identidad de operación y revisión por celda. Diferentes celdas se fusionan; una revisión antigua del mismo score devuelve conflicto. Reintentar la misma operación no duplica su efecto.
5. La captura pendiente queda localmente por cuenta/ronda y se limpia únicamente tras ACK. Guardar y salir sincroniza en lotes de hasta 25 celdas; un fallo conserva los pendientes y mantiene visible el panel de captura. No se anuncia un guardado remoto fallido.
6. Score y tarjeta compartida se abren sobre la misma instancia GPS. La renovación de token de la misma cuenta revalida el lector privado sin desmontar el mapa; cambiar de cuenta oculta la proyección anterior.
7. GPS directo: `https://dev.thebackyard.com.mx/?screen=gps`. No necesita ronda, participantes ni GHIN. Los accesos desde ronda usan el mismo componente y conservan contexto.
8. El modo original del organizador conserva la captura completa de apuestas y estadísticas. En la captura por jugador actualmente se editan score y putts; si una apuesta exige hechos adicionales todavía no capturados, la liquidación queda bloqueada explícitamente, sin inventarlos.

## Persistencia y autorización comprobadas en DEV

La base enlazada a DEV es la rama QA no predeterminada `phase2-full-platform-qa`, ref `bymeopxkxapfizeeqeyb`. Se comprobó su separación de la base predeterminada protegida antes de aplicar la única migración aditiva `20261010050000_shared_round_live_cas.sql`.

El primer guardado real detectó `42501`: `service_role` carecía de UPDATE en `rounds_cloud`. Se conservó esa restricción. La nueva función `shared_round_live_cas_v1` tiene ejecución exclusiva del servidor, fila bloqueada, revisión esperada, contexto inmutable, actor perteneciente a la ronda y las validaciones de captura del endpoint. `authenticated` y `anon` no tienen EXECUTE. No se desactivó RLS ni se concedió UPDATE general.

Pruebas con dos clientes autenticados independientes contra el DEV publicado, usando fixtures persistentes y respuestas reales:

| Caso | Resultado |
| --- | --- |
| B se une a la misma ronda de A | PASS |
| A=4 y B=5 en H1, guardados simultáneos desde la misma revisión inicial | PASS |
| Ambos recuperan la misma tarjeta en sesiones autenticadas nuevas | PASS |
| A guarda H2 aunque B no lo capturó | PASS |
| Reintento de operación deduplicado | PASS |
| B no modifica el score de A; A no modifica el de B en modo self | PASS |
| Persona no seleccionada no accede ni reclama tarjeta | PASS |
| Revisión antigua del mismo score rechazada | PASS |
| Tarjeta incompleta no se finaliza | PASS |
| Ambos encuentran la ronda al regresar a Play | PASS |
| Ambos reciben la misma proyección GPS almacenada sin consulta al proveedor | PASS |
| Modo organizador permite capturar el score de otro participante parcialmente | PASS |
| Cancelación conserva scores y deja de listar la ronda como activa | PASS |
| Tarjeta completa canónica guardada una vez | PASS |
| Participante no confirmado excluido de atribución personal | PASS |
| Autoconfirmación y reintento mantienen una sola tarjeta atribuible, con su score | PASS |

Rondas QA conservadas:

- Compartida, H1 A=4/B=5: `d2c94f7c-aac9-4ec7-adb1-79ca6f13e677`.
- Organizador, cancelada sin borrar tarjeta: `0f16e71a-2014-4417-902e-5804e3eeb7a5`.
- Finalizada y confirmada: `6f9e4f01-4c40-4e7d-b8fe-d01d5c1cb825`.

Estos clientes HTTP demuestran persistencia y autorización reales; no sustituyen dos teléfonos ni dos sesiones de navegador interactivo.

## Verificación visual y consumo

En el navegador del DEV publicado, a 390×844 y 430×932:

- Satélite real, green frente/centro/fondo, HUD compacto y controles visibles.
- Objetivo colocado y arrastrado; la distancia objetivo→centro pasó de 60 a 88 yd. Son mediciones de exploración, no ubicación física del teléfono.
- Pan posterior del mapa y zoom conservaron el objetivo; la cámara cambió sin recentrado automático.
- Hoyo 1→2→3→1 cambió los puntos y el encuadre sin pedir ni guardar scores.
- Cambio de unidades y tamaño de viewport sin nueva instancia. A 390 px, ancho de documento y body: 390 px, sin overflow horizontal.
- Activar ubicación mostró búsqueda y Detener GPS; el navegador terminó en timeout con distancias del teléfono no disponibles. Detener cambió efectivamente a GPS detenido. No se presentó ninguna posición ficticia como real.

Inicializaciones Google observadas antes del cierre: **2**, a `04:56:40Z` y `05:07:40Z` del 10/oct. La segunda permitió descubrir el desmontaje por renovación de token, corregido en el cierre. La revalidación de la publicación final se registra aparte en `.qa-artifacts/play-shared-gps-20261009/browser-evidence.json`; el techo acumulativo es 10. No se hicieron llamadas nuevas a GolfAPI ni Mapbox, ni se cambiaron planes o facturación. Google utiliza su producto de mapas existente; no es el caché de datos de GolfAPI.

## Pruebas locales

- Suites dirigidas de captura, participantes, recuperación, GPS, distancia y CAS: PASS (103 y 90 casos en las tandas registradas; contienen casos repetidos, no se suman).
- SQL real en PGlite: permisos, CAS, contexto inmutable y lifecycle PASS.
- Test del componente compartido con respuestas/ubicación de prueba: score propio explícito, ausencia de autoguardado, mapa montado bajo score/tarjeta, salida con ACK y conservación tras fallo PASS. No valida geografía ni gestos físicos.
- Pruebas offline de importación/almacenamiento: 11/11 PASS fuera del sandbox, cero solicitudes de proveedor.
- Typecheck, lint y build: PASS. Logs completos en el directorio de evidencia privado.
- Suite general ejecutada: 4818/4822. Los cuatro fallos son aserciones de texto de UI en `master-implementation` (2), `onboarding-integral-corrections` (1) y `p02-puebla-course-catalog` (1); los mismos cuatro se reprodujeron con el código de BASE_SHA mediante lectura aislada, sin restaurar archivos. No se desactivaron. La tanda posterior de scripts del comando general no se ejecutó, porque el comando se detuvo en esos fallos.

## Pendientes específicos

| Pendiente | Estado y acción necesaria |
| --- | --- |
| Dos navegadores/teléfonos mostrando simultáneamente la tarjeta, alta solo y retorno en la UI de QA | PENDING_INTERACTIVE_QA. Los navegadores disponibles estaban autenticados como El Mongas. Se preservó esa sesión: su logout existente revoca otras sesiones. Abrir una sesión QA Diego/Carlos permite completar la prueba interactiva sin tocar Mongas. Las dos sesiones servidor sí se probaron. |
| Sesión real Said | PENDING_INTERACTIVE_QA. No estaba disponible; no se cambió su cuenta ni sus permisos. |
| Pan/pinch físico en Safari y precisión en campo | PENDING_DEVICE_QA. Probar sobre los mismos objetivos identificados; no comparar centro contra bandera del día. |
| Notificaciones internas de inicio/tarjeta | BLOCKED_EXTERNAL. En DEV `service_role` no tiene SELECT de preferencias ni INSERT de eventos. No se eludieron preferencias ni ampliaron privilegios globales; la ronda continúa accesible en Play y el historial. Se necesita una operación de notificación autorizada y restringida compatible con esa política. No se enviaron emails ni mensajes externos. |
| Liquidación de apuestas con hechos adicionales en modo self | La captura nueva ofrece score/putts. Una liquidación que requiera otros hechos conserva la ronda abierta y explica el faltante; no inventa resultados. La captura completa del organizador se preservó. |
| La Vista Par 70 | Falta tarjeta temporal comprobada con orden y par de posiciones 1–18. Ventajas y yardajes por tee faltan para sus funciones específicas; tampoco existe mapping temporal→hoyo físico. Se conserva la selección y se ofrece elegir explícitamente una configuración completa disponible. No se reemplazó por Par 72. Ver el diagnóstico existente `docs/course-data/LA_VISTA_PAR70_GPS_DATA_AUDIT_20261009.md`. |
| Encuadre de salida a green | No se recibieron coordenadas de tees ni doglegs en las respuestas originales guardadas. Se muestran los greens disponibles y se permite explorar libremente; no se afirma que el encuadre sea un trazado completo. |

## Ruta de prueba

GPS independiente: Play → GPS → La Vista → Usar mi ubicación → colocar/arrastrar objetivo → hoyos 1/2/3/1.

Ronda: Play → Nueva ronda → campo/recorrido completo/tee → iniciar solo o añadir cuentas → elegir modo de captura → GPS → Anotar → Guardar mi captura → Tarjeta → Volver al GPS → Guardar y salir → Play → continuar. En modo compartido, la cuenta seleccionada abre el enlace de la MISMA ronda y se une con su sesión.

No se declara GPS físicamente validado ni aceptación interactiva global completa.

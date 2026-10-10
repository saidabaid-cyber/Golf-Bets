# DEV · Recuperación de tarjetas al recargar · 2026-10-10

Base limpia: `e9a77afc3c6b87acf843df6fec00496dc5a9de23`. Rama: `integration/backyard-current`. Punto de recuperación local: `recovery/pre-round-reload-e9a77af`.

## Incidencia y evidencia

El informe anterior `shared-round-ui-20261010.md` documenta intervención manual: **Recuperar rondas sin terminar → Reanudar r39pyo6x**. No fue recuperación automática normal. La tarjeta canónica conservaba sus scores; faltaba su selección como ronda activa.

En esta corrida se creó desde la interfaz la tarjeta QA `9t8eoyik`, se guardó H1 Diego=4/Carlos=5 y se salió. Antes de la corrección, la recarga volvió a la tarjeta anterior `r39pyo6x`. La consulta de solo lectura mostró `user_cloud_state.active_draft.roundId=r39pyo6x` (versión 28, 15:03:16.967 UTC), mientras `9t8eoyik` seguía completa en `rounds_cloud` para los scores capturados. Había varias pestañas de Diego abiertas con la tarjeta anterior. El guardado local comprobaba cuenta y revisión del render, pero no comprobaba que otra pestaña hubiese cambiado la ronda activa.

Esto demuestra la reversión de la selección activa y la ausencia de la protección entre pestañas. No quedó registrado cuál pestaña hizo la escritura inicial del informe anterior; esa atribución exacta permanece incierta.

Además, una nueva pestaña A quedó en “Recuperando tu ronda guardada…” durante la comprobación. El código esperaba las operaciones IndexedDB sin plazo y dejaba algunas conexiones abiertas. Se corrigió esa espera, aunque no se pudo determinar si aquella suspensión concreta provenía de IndexedDB o del navegador. La sesión volvió a funcionar al recargar con la corrección publicada.

## Correcciones

- `b9e062572c86a0b7bef960136955f2c7004cac33`: comprobar el estado almacenado antes de autosave, salida y checkpoints; reconciliar los cambios del mismo round contra la base real de cada pestaña; conservar en el archivo de conflictos las capturas incompatibles antes de adoptar otra tarjeta. Si no se puede verificar ese respaldo, no reemplazar la captura. Play espera la hidratación de la cuenta. “Guardar y salir” utiliza el guardado explícito existente.
- `88ce2a315081c4e96dc8f116be9cc32f7d04f227`: limitar a cuatro segundos cada espera de IndexedDB, liberar conexiones y usar la copia local verificada existente cuando el almacenamiento no responde. No cambia esquema ni elimina datos.

No se modificaron motores, permisos de captura, GHIN, Course Master ni APIs de proveedores. Sin migraciones ni escrituras SQL manuales. Todas las mutaciones de QA se hicieron desde la interfaz con las cuentas existentes Diego/Carlos; las consultas SQL posteriores fueron de solo lectura en DEV aislado.

## Verificación desde las interfaces publicadas

A: QA Diego Green en navegador interno; B: QA Carlos Fairway en Chrome. No se crearon cuentas nuevas. Se conservaron las otras pestañas y los históricos reales.

| Modo / acción | Resultado |
|---|---|
| Organizador, tarjeta anterior: Volver a ronda → Guardar y salir → recargar → CONTINUAR RONDA → Tarjeta | PASS. H1 Diego=4/Carlos=5; H2 Carlos=3. Regresa al hoyo 3 sin pulsar Recuperar/Reanudar después de recargar. |
| Organizador, tarjeta reciente | Se seleccionó `9t8eoyik` una vez para preparar la prueba; el diálogo conservó `r39pyo6x` como tarjeta pendiente. Después Guardar y salir → recargar → CONTINUAR RONDA → Tarjeta: PASS, H1=4/5 y hoyo 2 conservados. No recuperación manual después de esa recarga. |
| Pendiente local de la tarjeta reciente | Se introdujo Diego=7 en H2 sin guardar el hoyo. Guardar y salir → recargar → CONTINUAR RONDA mantuvo 7 en captura. Tarjeta conserva H1=4/5 y H2 sin confirmar. PASS. |
| Cada jugador en su teléfono, B | Guardar mi captura había indicado “No hay cambios para guardar” para su 5 ya guardado. Guardar y salir a Play → recargar → Abrir ronda compartida → Tarjeta: PASS, misma ronda `3568b699-c64c-484a-b5a1-c5f02dd5ccb1`, H1=4/5 y H2 Diego=4/Carlos=—, revisión 5. Repetido tras el cambio del almacenamiento local porque ese cambio afecta el arranque. |

Las lecturas finales de DEV confirmaron: `9t8eoyik` sigue `live`, modo `owner`, versión 2, con H1=4/5; su active draft mantiene H2 Diego=7 en `scoreEdits`, separado de `scores` (versión 38, 15:48:13.656 UTC). `r39pyo6x` sigue `live`, modo `owner`, con H1=4/5 y H2 Carlos=3. La individual sigue `live`, versión 5, H1=4/5 y H2 Diego=4. Ninguna de estas tarjetas incompletas se finalizó para generar estadísticas definitivas.

Una comprobación de B devolvió transitoriamente una pantalla de configuración. Al volver a Play, esperar su listado y seleccionar explícitamente el artículo La Vista, el regreso funcionó en las dos recargas posteriores. No se atribuye ese episodio a un defecto de navegación demostrado ni se cambió ese flujo sin evidencia.

## Pruebas de código y publicación

- 84/84 pruebas dirigidas: restauración, cancelación, navegación, merge, checkpoints, shared/CAS y regresión de captura. Log: `.qa-artifacts/round-reload-tests-20261010.txt`.
- 6/6 de la protección entre pestañas tras añadir la comprobación del respaldo: `.qa-artifacts/round-reload-boundary-final.txt`.
- 17/17 de almacenamiento/recuperación/protección tras añadir los plazos. Incluyen apertura, lectura y escritura sin respuesta, cierre tardío, fallback, ACK, scores y pendientes conservados. Log: `.qa-artifacts/offline-timeout-tests-20261010.txt`. Estas suites se solapan; no se suman como pruebas únicas.
- Typecheck, lint completo y build: PASS. Logs finales en `.qa-artifacts/round-reload-{typecheck,lint,build}-final.txt`. No se ejecutó otra suite completa ajena al cambio.
- Código verificado en `https://dev.thebackyard.com.mx`: Vercel READY `dpl_2kXArEAvBqRHYWqWTKqUSR2MF58u`, rama exacta, alias DEV. `/api/health`: HTTP 200, buildSha `88ce2a315081c4e96dc8f116be9cc32f7d04f227`.

Este informe no añade cambios funcionales. Su commit de cierre se publica por el mismo pipeline DEV, sin promover a Production ni modificar alias.

## Evidencia durable

JPEG reales y snapshots DOM en:

`C:/Users/said_/.codex/visualizations/2026/10/03/01a1039a-6144-7c61-ae88-7601acdff261/round-reload-20261010/`

- `a-owner-play-despues-recargar.txt` y `a-owner-tarjeta-despues-recargar.{txt,jpg}`: ronda anterior recuperada automáticamente.
- `a-owner-pendiente-7-despues-recargar.{txt,jpg}` y `a-owner-reciente-tarjeta-despues-recargar.{txt,jpg}`: tarjeta reciente, pendiente separado y resultados guardados.
- `b-individual-build-final.{txt,jpg}`: tarjeta individual después de recargar el build final funcional.

Son archivos locales de evidencia, no enlaces públicos de iPhone. Las capturas de esta corrida son de navegador; no se presentan como prueba física.

## Acceso de Said y pendientes separados

Entrada general: `https://dev.thebackyard.com.mx/?screen=play`, sin identificador de ronda QA.

- GPS: Play → GPS → LA VISTA COUNTRY CLUB → Usar mi ubicación. “Detener GPS” termina el seguimiento.
- Tarjeta propia: Play → CONTINUAR RONDA → Tarjeta. Volver a ronda → Guardar y salir; recargar → CONTINUAR RONDA → Tarjeta.
- Individual: Configurar ronda completa → campo/recorrido/tee → Jugadores → revisión → Cada jugador en su teléfono → Iniciar ronda → Copiar enlace para jugadores. El participante vinculado abre el enlace, pulsa Unirme a esta ronda, Anotar → Guardar mi captura → Tarjeta. Después Guardar y salir a Play → Abrir ronda compartida.

Sesión real de Said: **PENDING_INTERACTIVE_QA**; no se sustituyó su sesión por la de QA. GPS físico y precisión en campo: **PENDING_DEVICE_QA**. Par 70 mantiene sus faltantes de datos. Apuestas especiales no comprobadas interactivamente mantienen **PENDING_INTERACTIVE_QA**, según la tabla del informe anterior; esta corrección no afirma que estén liquidadas.

Consumo de esta corrida: GolfAPI **0**, Mapbox **0**, Google **0** inicializaciones adicionales. Acumulado Google **7/10**. No se abrieron mapas para repetir pruebas aprobadas ni se cambió facturación.

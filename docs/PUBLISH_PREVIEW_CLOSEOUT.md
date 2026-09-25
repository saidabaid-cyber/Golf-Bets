# Publicación de Phase 2 — evidencia de cierre

> **EVIDENCIA HISTÓRICA — NO EJECUTAR COMO RUNBOOK.** No publicar ni revisar las ramas/URLs de este corte. El único flujo vigente está en [activación canónica](./PREVIEW_CONTROLLED_ACTIVATION.md) y la [matriz de producto](./CANONICAL_PRODUCT_STATUS_2026-09-24.md).

Fecha: 2026-09-15. Rama exclusiva: `phase2/full-platform`.

## Base auditada

- HEAD remoto y local inicial: `9bdba1a564d517f73a7fd3454403fbf134c8c320`; árbol limpio.
- Preview conocido: `351c32a4e798aeead6c748194ea844ce34aba1b0`, `https://historical-preview-url-retired.invalid`. **No contiene este cierre y no es una DB aislada validada.**
- Los cinco commits Bolsa/Social `84be96f`, `0f864a9`, `5a65c39`, `d43ee7a`, `9bdba1a` ya estaban en remoto; se reutilizaron.
- Único Supabase visible: `zhqmlpljloumldaczcfp`, The Backyard; sin ramas. No se aplicó SQL ni se crearon/eliminaron cuentas remotas.
- Vercel CLI sin sesión; el login de dispositivo iniciado caducó sin autorización. Tampoco existe navegador conectado con una sesión disponible.

## Cambios implementados en esta ejecución

1. `6fd0751`: reset vinculado a ref/URL exactas de Preview, rechazo de la DB compartida, mensajes de usuario y pruebas SQL de persistencia.
2. `d777068`: corrige colisión real de nombres de constraints que impedía aplicar el catálogo en una DB vacía; no altera datos existentes.
3. `b38c441`: runner de QA remoto de estadísticas, con destino validado y cuentas desechables propias.
4. `a55c83b`: cierre de cuenta duradero, transacción de relaciones, Auth/Storage server-side, archivo y barreras contra JWT antiguos.
5. `e7e40b2`: elección de datos y comprobante de recuperación persistentes; reintento aun después de revocar Auth; validación estricta de éxito antes de purgar localmente.
6. `5d178ad`: organizador participante puede atestar al compañero; permisos explícitos del servicio Social; aislamiento y errores sanitizados.
7. `fe857af`: runner real de Auth/borrado/archivo/ronda compartida y comandos de pruebas descubribles.

El cierre Auth/Storage no se presenta como una única transacción PostgreSQL: es una operación duradera por etapas con lease, SQL atómico, Auth al final y reintento del mismo request. No hay éxito HTTP hasta completar Auth. El comprobante aleatorio sólo permite reanudar esa operación ya autenticada, nunca acceder al historial ni crear otra solicitud. Un 401/409 ambiguo conserva la barrera de sync.

Eliminar datos preserva las rondas compartidas, anonimiza identidad vinculada por ID y mantiene los scores de los demás. Tombstones impiden que una copia offline restaure después nombre/avatar/ID eliminados. Archivar conserva datos y preferencias, bloquea acceso normal y registra `archived`, no `deleted`. Recuperación futura requiere política y proceso controlado; **LEGAL_REVIEW_REQUIRED**, sin prometer retención indefinida.

## Evidencia ejecutada

- Suite completa: **1,686 tests PASS**, cero fallos, cero omitidos.
- ESLint completo: **PASS**.
- Next build completo: **PASS**.
- `node scripts/test-statistics-reset-db.mjs`: PostgreSQL local; cero estadísticas, idempotencia, datos previos, readback, cutoff, histórico/cuenta/grupo intactos, rollback y RLS.
- `node scripts/test-account-lifecycle-db.mjs`: aplica la cadena real completa de migraciones a PostgreSQL local; cuentas vacías, cascadas Auth simuladas SQL, ronda compartida, lectura RLS del compañero, rollback inyectado, archivo, lease/reintento, JWT contextual bloqueado y sync offline anonimizado.
- `node scripts/test-social-activity-db.mjs`: PostgreSQL local; likes/comments/notificaciones, privacidad, participantes reales vinculados, no-self, no-amigo-ajeno, revisión material y permisos mínimos del servicio.
- Navegador local 390×844: acceso carga, sin errores de consola. No se aceptaron términos en nombre del usuario ni se usó una cuenta real/DB compartida. Esto no acredita QA autenticado remoto.
- Bolsa conserva la evidencia local previa 390/393/430 de pantallas completas, alta, agregar otro, edición, cancelación/eliminación y recarga. No se cambió su UI en este cierre.
- Home: sin diff de componentes, CSS, imágenes ni hero respecto del HEAD inicial.

**PostgreSQL local y transporte simulado no equivalen a Supabase Auth/Storage/PostgREST remoto.** Los runners `qa-preview-statistics.mjs` y `qa-preview-account-lifecycle.mjs` se validaron con tests y `--help`; no se ejecutó `--run` contra una DB remota.

## Reporte de aceptación

`FAIL` en los contratos cloud significa que el criterio end-to-end aún no está demostrado, no que exista sólo un botón. El código, las migraciones y las pruebas locales sí están implementados.

| Requisito | Estado | Evidencia / pendiente exacto |
|---|---|---|
| PREVIEW_DB_ISOLATED | CONTROLLED_DB_ACTION_REQUIRED | No existe rama aislada; confirmar organización/cotización y crearla sin datos. |
| STATS_RESET_MIGRATION | CONTROLLED_DB_ACTION_REQUIRED | Aplicada sólo en PostgreSQL local, no Supabase Preview. |
| STATS_RESET_ZERO_ACCOUNT | FAIL | Contrato SQL local PASS; falta API/Auth Preview real. |
| STATS_RESET_REAL_DATA | FAIL | Reset/cutoff local PASS; falta ejecución remota. |
| STATS_HISTORY_PRESERVED | FAIL | Histórico/cutoff local PASS; falta readback y recarga remotos. |
| ACCOUNT_DELETE_GRAPH | CONTROLLED_DB_ACTION_REQUIRED | Grafo/rollback/cascadas local PASS; falta migración y prueba remotas. |
| ACCOUNT_DELETE_AUTH | CONTROLLED_DB_ACTION_REQUIRED | Orquestación lista; no se ha eliminado un usuario Supabase Auth real. |
| ACCOUNT_DELETE_SHARED_ROUND_INTEGRITY | FAIL | SQL y RLS locales PASS; falta caso compartido en Preview. |
| ACCOUNT_ARCHIVE_KEEP_HISTORY | LEGAL_REVIEW_REQUIRED | Código y SQL local PASS; Auth ban/recuperación remotos y política legal pendientes. |
| BAG_FULL_PAGE_FLOW | PASS | Componente y flujo local existentes reutilizados; sin modal largo. |
| BAG_ADD_ANOTHER | PASS | Regresa a categorías y conserva equipo local. |
| BAG_EDIT | PASS | Edición/eliminación confirmada y recarga local. |
| SHAFTS | PASS | Catálogo y entrada manual conservados; campos específicos por categoría. |
| EQUIPMENT_ACTIVITY | FAIL | Trigger y privacidad SQL local PASS; persistencia cloud no verificada. |
| PERSONAL_BEST | PASS | Motor probado con baseline comparable; primera ronda no inventa récord. |
| ROUND_ACHIEVEMENTS | PASS | Datos suficientes y resumen único; no se inventa GIR sin captura. |
| ROUND_SOCIAL_CARD | FAIL | UI/motor/proyección probados localmente; falta tarjeta desde DB Preview. |
| LIKES | FAIL | Unique/toggle/RLS SQL PASS; falta API y reload remotos. |
| COMMENTS | FAIL | Ownership y CRUD SQL PASS; falta API y reload remotos. |
| NOTIFICATIONS | FAIL | Triggers/preferencias SQL PASS; falta entrega/lectura remotas. |
| ATTEST_PARTICIPANT_ONLY | FAIL | Contrato local PASS; falta demostrar participantes Auth en Preview. |
| ATTEST_NO_SELF | FAIL | Rechazo SQL/servidor local PASS; falta API remota. |
| ATTEST_SERVER_VALIDATION | FAIL | Validación implementada y probada; migración/API Preview no aplicadas/probadas. |
| ATTEST_REVISION_INVALIDATION | FAIL | Hash material/local SQL PASS; falta actualización real cloud. |
| PRIVACY | FAIL | Defaults privados/RLS/preferencias locales PASS; falta verificación remota. |
| TESTS | PASS | 1,686 / 1,686. |
| LINT | PASS | ESLint completo. |
| BUILD | PASS | Next build completo. |
| HOME_UNCHANGED | PASS | Diff vacío del Home aprobado. |

## Pendientes reales, sin ocultarlos

1. [Activación controlada ejecutable de Supabase y Vercel Preview](PREVIEW_CONTROLLED_ACTIVATION.md). La DB compartida se mantiene excluida por código.
2. Ejecutar los dos runners remotos y el recorrido móvil con cuentas QA aisladas. El runner de cuentas deja intencionalmente un fixture archivado y reporta sus IDs; no lo borra saltándose la elección de conservación.
3. QA remoto Social API: like/unlike, crear/editar/borrar propio, rechazo ajeno, attest/no-self/no-participante y stale tras score. Los runners nuevos no afirman cubrir este contrato HTTP completo; SQL local sí lo cubre.
4. `NEW_COURSE_PLAYED` como evento diferenciado de Home Club no está implementado: `homeClub/homeClubId` no tienen sincronización canónica completa. Se muestran campos de rondas terminadas según privacidad; no se inventó un Home Club para generar actividad.
5. Plazos/copy de retención y UX de recuperación futura: `LEGAL_REVIEW_REQUIRED`. Esto no impide QA técnico aislado.

No se modificó main, beta, Production, dominios ni datos compartidos. No hubo merge, force push ni rebase.

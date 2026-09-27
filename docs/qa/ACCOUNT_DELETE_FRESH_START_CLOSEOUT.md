# Account Delete / Fresh Start — closeout DEV/QA

Fecha de cierre técnico: 2026-09-27  
Alcance: eliminación de cuenta, conservación de historial y alta posterior con el mismo correo, exclusivamente en DEV/QA.

## Estado de cierre

| Área | Estado | Evidencia resumida |
| --- | --- | --- |
| Saga server-side `delete_golf_data` | **PASS** | El `DELETE /api/account/delete` del ciclo sintético terminó en HTTP 200; Auth, datos privados y Storage quedaron en estado final confirmado. |
| Fresh start con el mismo correo | **PASS** | La cuenta recreada recibió un UUID nuevo, onboarding inicial, cero estadísticas y ninguna vinculación con los datos de la identidad eliminada. |
| `retain_history` / archivo | **PASS** | El flujo se probó por separado y conserva su contrato distinto de eliminación total. |
| Histórico compartido | **PASS** | Ronda y grupo sobrevivieron anonimizados; scores, putts y nombres ajenos/de entidad se conservaron; el UUID eliminado no quedó referenciado. |
| UI visual e IndexedDB en navegador real | **PENDING_INTERACTIVE_QA** | Hay cobertura automatizada de limpieza y cierre de sesión, pero no se ejecutó una inspección visual manual ni una prueba live de IndexedDB en un navegador con estado previo. |
| Política jurídica de eliminación/retención | **LEGAL_REVIEW_REQUIRED** | La implementación técnica distingue eliminación y archivo; Legal aún debe ratificar plazos, textos y mínimos históricos conservables. |

El núcleo Auth + DB + Storage + fresh start queda **PASS en DEV/QA**. No se extiende ese PASS a las dos áreas expresamente pendientes indicadas arriba.

## Identidad de la ejecución

| Dato | Valor |
| --- | --- |
| Repositorio / rama | `saidabaid-cyber/Golf-Bets` / `integration/backyard-current` |
| SHA base recibido | `07b0e287080005d15c77609094dcc98c723f9f7a` |
| SHA de runtime probado | `16569f169e1df9549411a61a62cf7f643a235e5d` |
| SHA final funcional | `088787f22e562349116f3c25d49dcd1cdae602c0` (incluye el ajuste del harness PGlite; el commit posterior sólo versiona este closeout) |
| Deployment probado | `dpl_9Ayz4ttSh4hSy6ys7RA82xWxdLCS` |
| URL probada | `https://dev.thebackyard.com.mx` |
| Proyecto Supabase autorizado | `bymeopxkxapfizeeqeyb` (QA) |
| Proyecto Production prohibido | `zhqmlpljloumldaczcfp` — **sin lecturas mutantes, migraciones ni writes** |

Los UUID de fixtures se registran por prefijo seguro, tal como aparecen en la evidencia operativa, sin tokens, correo sintético ni secretos:

| Evidencia | Identificador |
| --- | --- |
| E2E run | `ef30e10b…` |
| Usuario eliminado | `00f10018…` |
| Usuario recreado con el mismo correo | `2eb105cf…` |
| Request de eliminación | `20699f42…` |
| Fixture archivado | `89f60018…` |

## Causa raíz exacta del 503

La saga sí alcanzaba la etapa `deleteAuth`; no era una ausencia global de RPC ni un fallo genérico de Supabase. La eliminación de la identidad en Auth devolvía HTTP 500 porque PostgreSQL rechazaba el borrado con `SQLSTATE 23503`:

- constraint: `admin_memberships_created_by_fkey`;
- relación bloqueante: `public.admin_memberships.created_by`;
- semántica de la FK: `ON DELETE RESTRICT`;
- consecuencia: el usuario todavía era referenciado como creador de una membresía Admin cuando el servicio intentaba eliminar `auth.users`.

La ruta anterior reducía prácticamente cualquier error interno distinto de `23505` a `ACCOUNT_OPERATION_PENDING`, y el log `account_lifecycle { code: '' }` no exponía la etapa segura necesaria para diagnosticar. Por eso el síntoma visible era un 503 sin causa operativa accionable.

La corrección prepara y reconcilia primero todas las referencias de identidad bajo un lease válido, y sólo después revoca/suspende sesión y elimina Auth. `admin_memberships.created_by` se anonimiza sin borrar la membresía de otro usuario. El registro estructurado ahora identifica `stage`, operación, clase/código de error y status seguro, sin tokens, correos, secretos ni datos personales crudos.

## Cambios implementados

### Aplicación y contrato API

- `app/api/account/delete/route.ts`: mantiene 200 únicamente para estado final confirmado y conserva errores seguros diferenciados.
- `lib/account-lifecycle.server.ts` y `lib/account-lifecycle.ts`: añaden la etapa explícita `reconcile`, recuperación idempotente y diagnóstico por etapa.
- `lib/supabase/server.ts`: mantiene la operación privilegiada exclusivamente server-side.
- `lib/account-workspace.ts`, `app/components/account-provider.tsx`, `app/components/account-panel.tsx` y `app/components/profile-account-panel.tsx`: cierre de sesión, limpieza por identidad, progreso, bloqueo de doble envío y retorno a la pantalla inicial.

### Migraciones

| Archivo canónico local | Versión aplicada en QA | Propósito |
| --- | --- | --- |
| `supabase/migrations/20260925043503_account_delete_fresh_start_reconciliation.sql` | `20260927040953` | Reconciliar el grafo de datos vigente, liberar FKs restrictivas, separar `delete_golf_data` de `retain_history`, eliminar datos privados y anonimizar históricos compartidos. |
| `supabase/migrations/20260927045252_account_delete_round_player_tombstones.sql` | `20260927061653` | Sustituir UUIDs residuales por tombstones estables por contenedor, proteger escrituras futuras, preservar payload histórico válido y ejecutar backfill/postcondiciones. |

La diferencia entre timestamp local y versión remota queda registrada deliberadamente; ambas migraciones están aplicadas sólo a QA. No se editó ni reejecutó una migración histórica aplicada como sustituto de la corrección.

La nueva RPC `public.account_lifecycle_reconcile_identifiers(operation_id, lease)` valida operación, lease, política y etapa; se revoca a `public`, `anon` y `authenticated`, y sólo `service_role` puede ejecutarla. La reconciliación falla cerrada ante un identificador ambiguo en vez de borrar o reasignar a ciegas.

### Ajuste de harness PGlite

La suite completa expuso que dos harnesses PGlite sólo simulaban `extensions.digest(text,text)`, mientras la migración usa también el overload real `extensions.digest(bytea,text)` después de `convert_to(...)`. Se añadió ese overload únicamente al bootstrap de:

- `scripts/test-group-email-invitations-db.mjs`;
- `scripts/test-group-owner-returning-db.mjs`.

Es una corrección de fidelidad del entorno de prueba; no altera lógica de producto ni el esquema remoto.

### Archivos modificados en el bloque Account Delete / Fresh Start

- API/UI y sesión: `app/api/account/delete/route.ts`, `app/components/account-panel.tsx`, `app/components/account-provider.tsx`, `app/components/profile-account-panel.tsx`.
- Lifecycle y estado local: `lib/account-lifecycle.server.ts`, `lib/account-lifecycle.ts`, `lib/account-workspace.ts`, `lib/supabase/server.ts`.
- Migraciones y QA: las dos migraciones anteriores, `scripts/qa-preview-account-lifecycle.mjs`, `scripts/test-account-lifecycle-db.mjs` y los dos harnesses PGlite citados.
- Pruebas: `tests/account-deletion-client.test.ts`, `tests/account-deletion-preflight.test.ts`, `tests/account-deletion-ui-cleanup.test.ts`, `tests/account-lifecycle.test.ts`, `tests/account-sync-closure.test.ts` y `tests/preview-account-lifecycle-qa.test.ts`.

Los commits GHIN que ya coexistían en la rama se preservaron sin modificación y no forman parte de este cierre.

## Inventario dinámico de identidad

No se reutilizó como verdad absoluta la lista histórica del lifecycle. El barrido del catálogo actual en QA identificó:

- **109 columnas de identidad en 86 tablas**, cubriendo nombres como `user_id`, `owner_id`, `profile_id`, `actor_id`, `author_id`, `created_by`, `updated_by`, `inviter_id`, `linked_user_id`, `confirmed_by`, `entered_by` y equivalentes;
- **51 columnas JSONB en 43 tablas**, auditadas además por UUID, claves de jugador, `accountUserId`/marcadores equivalentes y PII incrustada.

El preflight comprueba el grafo actual y bloquea una referencia restrictiva no manejada. No se introdujo un `CASCADE` genérico.

### Estrategia final

**Eliminar**

- identidad de Auth para `delete_golf_data`;
- perfil y datos privados de onboarding;
- equipo, bola, distancias y preferencias personales;
- consentimientos y permisos persistidos;
- rondas privadas, proyecciones privadas, estadísticas y agregados propios;
- invitaciones/conexiones privadas y objetos sociales exclusivamente propios cubiertos por el grafo;
- cursos/clubes manuales privados y sus dependencias;
- uploads privados y scorecards del usuario en Storage;
- email de waitlist cuando coincide con la identidad eliminada.

**Anonimizar**

- participación necesaria en rondas, grupos y torneos compartidos;
- referencias de actor/creador que no pueden sobrevivir como UUID personal;
- snapshots y claves de jugador mediante tombstone estable de 36 caracteres por contenedor;
- nombre del participante eliminado como `Jugador eliminado`, sin email, username, avatar, profile ID ni UUID de Auth;
- payloads y revisiones Admin vinculados, recalculando sus hashes cuando el payload cambia.

**Preservar**

- scores, putts, apuestas/configuración histórica y demás hechos deportivos compartidos no personales;
- participantes y datos pertenecientes a otros usuarios;
- nombre del campo, nombre del grupo y metadatos de la entidad que no sean PII del usuario eliminado;
- historial técnico mínimo de la saga, sin conservar PII innecesaria;
- todo el historial permitido por `retain_history`, que continúa siendo un contrato independiente.

No se transfiere propiedad silenciosamente. Cuando un objeto compartido puede sobrevivir sin owner, se libera la referencia; cuando el contrato exige resolver owner o integridad, la preparación actúa explícitamente o falla cerrada.

## Corrección de UUIDs residuales

Antes del segundo hardening existían **89** referencias a UUIDs de identidades Auth ya eliminadas:

| Superficie | Antes | Después |
| --- | ---: | ---: |
| `rounds_cloud.snapshot` | 66 | 0 |
| `cloud_record_versions.previous_snapshot` | 18 | 0 |
| `groups_v2.default_template` | 1 | 0 |
| `round_players_cloud.local_player_id` | 4 | 0 |
| **Total** | **89** | **0** |

La búsqueda posterior fue case-insensitive y cubrió tanto UUIDs crudos como claves compuestas. Los guards de escritura evitan que una sincronización offline vuelva a insertar una identidad ya eliminada. La sustitución conserva valores no personales: las pruebas de regresión preservan, por ejemplo, `La Vista Country Club`, rating `72.4` y el nombre de grupo `Weekend Group`, mientras eliminan la procedencia personal correspondiente.

## Ciclo E2E sintético real

La ejecución `ef30e10b…` corrió contra el deployment indicado y el Supabase QA autorizado. No utilizó mocks para la eliminación final ni cuentas del owner.

1. Se creó una cuenta QA sintética desechable (`00f10018…`).
2. Se poblaron onboarding/perfil, username, handicap, home course, mano dominante, equipo/bola, preferencias, consentimiento, ronda, scores, estadísticas, grupo/social de fixture y Storage.
3. Se confirmó estado previo no vacío, incluidas estadísticas no cero.
4. Se llamó la misma ruta pública `DELETE /api/account/delete` con request `20699f42…`.
5. La respuesta final fue HTTP 200 y el job terminó completado, sin lease pendiente.
6. La identidad `00f10018…` dejó de existir en Auth.
7. Perfil, datos privados, equipo, preferencias, consentimientos, rondas/estadísticas privadas y objetos Storage propios quedaron en cero.
8. La ronda y el grupo compartidos permanecieron: scores y putts se conservaron, los nombres de entidad/otros participantes no cambiaron, el participante borrado quedó anonimizado y el UUID antiguo no apareció en campos relacionales ni JSON.
9. Se creó otra cuenta con exactamente el mismo correo, que recibió el UUID distinto `2eb105cf…`.
10. La cuenta recreada abrió como usuario nuevo: onboarding inicial, estadísticas `0`, sin rondas anteriores, sin bolsa/bola/handicap/home course, sin preferencias, consentimientos, avatar, username ni caché cloud anterior.
11. El fixture `89f60018…` ejercitó por separado `retain_history`; el archivo completó sin convertirse en fresh start ni mezclarse con `delete_golf_data`.

Resultado del runner: **41/41 checks PASS**.

La verificación global posterior al E2E confirmó que la base quedó sin residuos ni sagas atascadas:

| Postcondición global | Resultado |
| --- | ---: |
| `residual_total` | 0 |
| `deleted_auth_residuals` | 0 |
| leases activos | 0 |
| leases vencidos aún retenidos | 0 |
| jobs en `requested` / `data_prepared` | 0 |
| jobs `completed` que aún conservan lease | 0 |

### Evidencia por capa

| Capa | Resultado |
| --- | --- |
| Auth | Usuario eliminado ausente; mismo correo recreado con UUID nuevo. |
| Datos privados | Conteos finales del usuario anterior: 0. |
| Estadísticas | No cero antes de eliminar; 0 después de recrear. |
| Equipment / preferencias / consentimientos | Sin filas vinculadas a la identidad anterior y sin restauración por email/username. |
| Storage | Objetos privados del fixture: 0; borrado normal de scorecard verificado live. |
| Compartidos | Ronda y grupo preservados y anonimizados; scores/putts y nombres no personales intactos; UUID anterior ausente. |
| Idempotencia | Job completado, lease liberado y reintento del mismo request resuelto sin crear una saga incompatible. |
| Archivo | Flujo separado completado y contrato de conservación mantenido. |

## Runtime y contrato HTTP

La muestra de runtime correlacionada con QA no contiene 5xx inesperados:

- `7 × 200` en operaciones válidas/completadas;
- `2 × 400` de probes negativos esperados por contrato;
- `1 × 401` de probe sin autenticación esperado;
- `0 × 5xx` durante el happy path final.

El 200 de la eliminación se observó después de DB + Storage + Auth, no por adelantado. Los 400/401 anteriores son pruebas negativas deliberadas y no fallos del flujo feliz.

## Quality gates

| Gate | Resultado |
| --- | --- |
| Suite completa | **3616/3616 PASS** |
| TypeScript / typecheck | **PASS** |
| ESLint | **PASS** |
| Build de producción | **PASS** |
| Grafo DB / lifecycle PGlite | **PASS** |
| `git diff --check` | **PASS** |
| E2E DEV/QA | **41/41 PASS** |
| Runtime happy path | **0 errores 5xx** |

No se eliminó ni deshabilitó ninguna prueba para alcanzar PASS.

## Límites de cobertura y pendientes reales

1. **PENDING_INTERACTIVE_QA — navegador:** la limpieza por identidad de localStorage/sessionStorage/cachés y la inaccesibilidad del estado antiguo tienen cobertura automatizada. No se ejecutó una inspección visual manual del modal/progreso ni una prueba live con un IndexedDB previamente poblado en navegador.
2. **Cobertura social live parcial:** likes, comments y attest no formaron parte del fixture live. El inventario/preflight y las pruebas DB cubren el contrato general, pero no se atribuye evidencia E2E live específica a esas tres superficies.
3. **Admin document compartido:** el contrato de rehome, hashes y transacción se validó en PGlite/pruebas. No se realizó un rehome live de documento Admin compartido porque los grants de QA están cerrados; el borrado live de un scorecard normal sí fue PASS.
4. **LEGAL_REVIEW_REQUIRED:** Legal debe confirmar que la retención mínima del histórico compartido, el texto `Jugador eliminado`, los plazos y el comportamiento de `retain_history` coinciden con Terms/Privacy y obligaciones aplicables.

Estos puntos no ocultan un fallo conocido de Auth/DB/Storage/fresh start; delimitan exactamente qué no fue probado de forma interactiva/live.

## Advisors de Supabase

La revisión posterior conservó hallazgos preexistentes fuera del alcance de este hotfix, entre ellos avisos sobre RLS sin policy en tablas privadas, exposición/ejecución de funciones `SECURITY DEFINER`, protección de contraseñas filtradas y, en rendimiento, FKs sin índice, RLS initplans, índices sin uso y políticas permisivas múltiples. No se ampliaron grants para silenciarlos y no se modificó infraestructura ajena al account lifecycle.

Referencias oficiales de remediación para un hardening separado y controlado:

- [RLS habilitado sin policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [SECURITY DEFINER ejecutable por anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [SECURITY DEFINER ejecutable por authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Protección contra contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [Foreign keys sin índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- [Policies permisivas múltiples](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)

No se mezclan esos hallazgos preexistentes con la causa raíz ya resuelta del 503.

## Confirmación de aislamiento

- Todas las migraciones y fixtures remotos se limitaron a `bymeopxkxapfizeeqeyb`.
- No se aplicó migración ni se escribió dato alguno en `zhqmlpljloumldaczcfp`.
- No se modificaron `main`, Production, `app.thebackyard.com.mx`, `beta.thebackyard.com.mx`, DNS, GHIN, Campos, catálogos, apuestas, Equipment global ni Social global.
- Sólo se tocaron datos de cuentas sintéticas QA y las referencias compartidas creadas específicamente por sus fixtures.

**Producción permanece intacta.**

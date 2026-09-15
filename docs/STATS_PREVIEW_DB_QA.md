# Stats reset — DB Preview aislada y QA pendiente

Estado 2026-09-15: `phase2/full-platform` HEAD inicial `5e36754d58911c5db78cadd13c5b1c4c7447fce4`, árbol limpio. El único proyecto visible es `zhqmlpljloumldaczcfp` («The Backyard», compartido); `list_branches` devolvió `[]`. No hay base aislada ni autorización económica final. **No se aplicó SQL remoto.** Los tests locales y PGlite no acreditan persistencia cloud.

## Barrera de infraestructura

1. Obtener del propietario confirmación del ID de organización `wrogzsycxchwakaglbpm` para consultar `get_cost`. Repetir al propietario la cotización específica, incluyendo que una rama paga Compute/Disk/Egress/Storage y no está cubierta por Spend Cap. `confirm_cost` y creación requieren afirmación expresa separada.
2. Crear, sólo entonces, una rama Preview **sin Include data**. No copiar usuarios, Auth, Storage ni rondas de Production. Registrar `project_ref`/URL/estado propios; comprobar que ref y URL difieren de `zhqmlpljloumldaczcfp` antes de cualquier DDL o test con escrituras.
3. Verificar el ledger de migraciones de la rama antes de aplicar. El proyecto base registra 13 migraciones hasta `20260908195537`; los archivos locales antiguos usan timestamps distintos. Nunca ejecutar `db push --include-all` ni repetir los 13 históricos. La rama puede aplicar migrations automáticamente por integración Git, por lo que cada archivo siguiente se ejecuta sólo si falta y las dependencias existen.

## Orden aditivo previsto (rama aislada solamente)

1. `20260906193435_equipment_ball_fitting.sql`
2. `20260906211937_golf_profile_course_architecture.sql`
3. `20260908134650_ai_processing_consents.sql`
4. `202609100001_phase2_social_groups_memberships.sql`
5. `202609100002_phase2_course_handicap_gps.sql`
6. `202609100003_phase2_live_rounds_notifications.sql`
7. `202609100004_phase2_shots_analytics.sql` — crea `product_usage_events_v2`.
8. `20260913175810_group_round_presets.sql` — depende de grupos/miembros Phase 2.
9. `20260913205122_user_statistics_reset.sql` — depende del ledger de eventos del paso 7.
10. `20260915114707_user_statistics_reset_idempotency.sql` — depende del reset del paso 9; revoca escritura REST directa y RPC antiguo, crea reset idempotente.

Aplicar de uno en uno con historial de migración en la **ref nueva**, listar ledger y consultar objetos/RLS/grants tras cada paso. Detenerse si una migración falla; no reparar ni volver a aplicar en el proyecto compartido. Antes de habilitar REST, verificar el cambio de [Data API autoexposure](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically): RLS y `GRANT` explícito no garantizan por sí solos que la tabla sea alcanzable por PostgREST. Ejecutar advisors y revisar el RPC `SECURITY DEFINER` (dueño, `auth.uid()`, search path fijo, EXECUTE sólo authenticated) antes de habilitar clientes.

## Contrato real de 0 Stats

Con usuarios Preview exclusivos A y B, Auth real y misma ref aislada:

1. A guarda una ronda completa con score, putts, tee shot, bunker, penalty/OB, apuestas y balance. Confirmar que GET `/api/account/statistics` responde `{resetAt:null,strategy:"RESET_FROM_DATE"}` (estado cliente `ready` sin reset) y Stats muestra métricas sólo de esa ronda; Histórico y Balances contienen el registro.
2. A escribe exactamente `ELIMINAR` y envía un UUIDv4. Sólo 2xx confirmado + fila canonical/request/audit en la rama permite declarar reset. Doble submit y timeout/retry con **el mismo** UUID producen una sola solicitud/auditoría y frontera monotónica. Otro UUID avanza la frontera.
3. Refresh, cerrar sesión y volver a entrar: GET autoritativo devuelve frontera persistida, Stats deportivos quedan 0/sin promedios ni capturas antiguas, Histórico y Balances mantienen ronda/apuesta/resultado. Corregir la ronda histórica después del reset no debe cambiar `date/startedAt/completedAt` deportivos ni resucitar métricas.
4. B no puede leer ni mover marcador/requests/audit de A; REST INSERT/UPDATE directo del canonical y request INSERT, y RPC texto-only antiguo, deben fallar. Probar roles anon/authenticated y RLS de las otras tablas con identidades separadas. Un 5xx/timeout GET nunca se representa como «sin reset».
5. Ejecutar `pnpm test:stats:db` (PostgreSQL WASM local) y `pnpm test` para regresión. `supabase/tests/user_statistics_reset_rls.sql` añade 16 contratos pgTAP de tablas, owner RLS, RPC y revocación REST al runner `pnpm test:rls:preview`. Éste exige `psql` y `SUPABASE_PREVIEW_PROJECT_REF`, `SUPABASE_PRODUCTION_PROJECT_REF`, `SUPABASE_PREVIEW_DB_URL`; comprueba destino distinto pero `psql` no está instalado en este runtime. Instalar un cliente PostgreSQL aislado o ejecutar los contratos SQL mediante MCP en la ref Preview, nunca en la base compartida. PGlite usa una conexión serial; race multi-conexión queda obligatoria en la rama real.

Sólo después de ese contrato puede apuntarse **Vercel Preview de esta rama** a credenciales de la rama DB nueva y redesplegar. No modificar Production ni los dominios personalizados.

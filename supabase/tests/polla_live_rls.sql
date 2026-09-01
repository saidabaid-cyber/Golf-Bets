-- Ejecutar en un proyecto de prueba después de la migración.
-- Debe fallar: un usuario autenticado no puede crear un torneo para otro usuario.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.tournaments(created_by, short_code, name, tournament_date, course_name, course_snapshot, holes, start_hole, format)
values('00000000-0000-0000-0000-000000000002', 'DENY1', 'Debe fallar', current_date, 'Campo', '[]', 18, 1, 'both');
rollback;

-- Validaciones manuales adicionales requeridas:
-- 1. El scorer no puede escribir fuera de su group_id por /api/polla/scores.
-- 2. El scorer no puede modificar una tarjeta confirmed.
-- 3. Un anónimo no puede SELECT tournament_scores ni tournament_players.
-- 4. El endpoint público no devuelve pin_hash, token_hash, score_audit_log ni rondas privadas.
-- 5. Cada UPDATE de tournament_scores agrega old_score/new_score a score_audit_log.

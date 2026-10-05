-- Controlled DEV application only. Read-only columns for Carrera's authenticated server projection.
-- Polla release flag, data, policies, RLS and browser roles remain unchanged.
-- No access to PIN hashes, entry tokens or write columns.
begin;
set local lock_timeout = '5s';
grant select (id, tournament_id, profile_id, name, handicap, created_at)
  on public.tournament_players to service_role;
grant select (id, public_id, short_code, name, tournament_date, course_name, holes,
  start_hole, format, status, course_snapshot, hcp_pct, handicap_mode, public_leaderboard, created_by)
  on public.tournaments to service_role;
grant select (tournament_id, user_id, expires_at, revoked_at)
  on public.tournament_access to service_role;
grant select (tournament_id, player_id, hole, score)
  on public.tournament_scores to service_role;
commit;
-- Operator rollback: REVOKE SELECT for these same columns FROM service_role.

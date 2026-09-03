-- Reconcile the documented manual hardening. No rows are changed/deleted.
-- On an existing project, inspect function_privileges_check.sql before applying.
-- Reapplying ONLY this migration is safe; do not rerun the three old migrations.
begin;

alter function public.join_polla(uuid, uuid, text) set search_path = public, extensions;
alter function public.add_tournament_player(uuid, uuid, text, numeric, text, boolean) set search_path = public, extensions;
alter function public.resolve_polla_access(text) set search_path = public, extensions;
alter function public.set_tournament_player_pin(uuid, text) set search_path = public, extensions;

-- Supabase may explicitly grant anon/authenticated through default privileges:
-- revoking PUBLIC alone does not revoke those direct grants.
revoke all on function public.join_polla(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.join_polla_secure(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.resolve_polla_access(text) from public, anon, authenticated;
revoke all on function public.add_tournament_player(uuid, uuid, text, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.set_tournament_player_pin(uuid, text) from public, anon, authenticated;
revoke all on function public.record_tournament_oyes(uuid, smallint, uuid, numeric, uuid, boolean) from public, anon, authenticated;
grant execute on function public.join_polla(uuid, uuid, text), public.join_polla_secure(uuid, uuid, text, text),
  public.resolve_polla_access(text), public.add_tournament_player(uuid, uuid, text, numeric, text, boolean),
  public.set_tournament_player_pin(uuid, text), public.record_tournament_oyes(uuid, smallint, uuid, numeric, uuid, boolean)
to service_role;

-- Trigger entry points are not client RPCs. Trigger execution does not require
-- the caller of the underlying INSERT/UPDATE to have function EXECUTE.
revoke all on function public.audit_score_change(), public.handle_backyard_user_profile(),
  public.touch_tournament_score(), public.sync_tournament_leaderboard_event(), public.signal_leaderboard_change()
from public, anon, authenticated;
grant execute on function public.audit_score_change(), public.handle_backyard_user_profile(),
  public.touch_tournament_score(), public.sync_tournament_leaderboard_event(), public.signal_leaderboard_change()
to service_role;

-- Required by the delegated-admin RLS policies; takes no user-id argument and
-- derives identity exclusively from auth.uid(). Revoking authenticated breaks
-- legitimate SELECTs. SECURITY DEFINER avoids recursive access-table policies.
revoke all on function public.is_polla_admin(uuid) from public, anon;
grant execute on function public.is_polla_admin(uuid) to authenticated, service_role;

-- No direct client reads OR writes, even if a future policy is added by mistake.
revoke all on table public.polla_join_attempts from public, anon, authenticated;
revoke all on sequence public.polla_join_attempts_id_seq from public, anon, authenticated;
grant all on table public.polla_join_attempts to service_role;
grant usage, select on sequence public.polla_join_attempts_id_seq to service_role;

commit;

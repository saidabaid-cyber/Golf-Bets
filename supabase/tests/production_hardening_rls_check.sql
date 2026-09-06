-- Run after production_hardening_v1 on an isolated Supabase branch/staging DB.
-- Read-only assertions; raises when the authorization contract is incomplete.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.analytics_events'::regclass) then raise exception 'analytics_events RLS disabled'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.app_errors'::regclass) then raise exception 'app_errors RLS disabled'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analytics_events' and policyname='analytics_events_insert_self') then raise exception 'analytics self insert missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analytics_events' and policyname='analytics_events_read_admin') then raise exception 'analytics admin read missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_errors' and policyname='app_errors_read_admin') then raise exception 'errors admin read missing'; end if;
  if has_table_privilege('anon', 'public.analytics_events', 'SELECT') then raise exception 'anonymous analytics read granted'; end if;
  if has_table_privilege('anon', 'public.app_errors', 'SELECT') then raise exception 'anonymous errors read granted'; end if;
  if has_table_privilege('authenticated', 'public.app_errors', 'SELECT') and not private.current_user_is_backyard_admin() then raise exception 'normal user can read app errors'; end if;
  if has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then raise exception 'authenticated may elevate profile role'; end if;
end $$;

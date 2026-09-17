-- RLS enabled is a table property, not row_security_active() of a bypass runner.
begin;
do $$
declare t text;
begin
  foreach t in array array['round_participants_v2','live_round_operations_v2','round_activity_v2',
    'notification_preferences_v2','notification_events_v2'] loop
    if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity) then
      raise exception 'missing table or RLS: %',t;
    end if;
    if has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'anonymous access to %',t;
    end if;
  end loop;
end;
$$;
rollback;

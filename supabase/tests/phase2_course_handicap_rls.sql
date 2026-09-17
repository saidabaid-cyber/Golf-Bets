-- Isolated Preview; no pgTAP/schema installation required.
begin;
do $$
declare t text; p record;
begin
  foreach t in array array['player_course_tee_preferences','round_course_handicap_snapshots'] loop
    if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity) then
      raise exception 'missing table or RLS: %',t;
    end if;
  end loop;
  for p in select * from (values
    ('player_course_tee_preferences','tee preferences select own','SELECT'),
    ('player_course_tee_preferences','tee preferences update own','UPDATE'),
    ('round_course_handicap_snapshots','course handicap snapshots select own','SELECT'),
    ('round_course_handicap_snapshots','course handicap snapshots insert own','INSERT')
  ) as expected(tab,policy,command) loop
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=p.tab
      and policyname=p.policy and cmd=p.command and permissive='PERMISSIVE'
      and (coalesce(qual,'')||coalesce(with_check,'')) like '%auth.uid()%') then
      raise exception 'missing or unsafe owner policy: %',p.policy;
    end if;
  end loop;
end;
$$;
rollback;

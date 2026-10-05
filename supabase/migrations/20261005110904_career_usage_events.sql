-- DEV only: additive event allowlist extension. Keeps all previously accepted events,
-- permissions, RLS, columns, indexes and existing rows. No product data migration.
set lock_timeout = '5s';
do $career$
declare previous_check text;
begin
  select pg_get_constraintdef(oid) into previous_check
  from pg_constraint where conrelid='public.product_usage_events_v2'::regclass
    and conname='product_usage_events_v2_event_name_check' and contype='c';
  if previous_check is null then raise exception 'Existing analytics event constraint is required'; end if;
  execute format('alter table public.product_usage_events_v2 add constraint product_usage_events_v2_career_check check (%s OR event_name = ANY (ARRAY[''career_opened'',''career_tab_viewed'',''achievement_opened'',''rivalry_opened'',''round_opened'',''tournament_opened'']::text[])) not valid',substring(previous_check from 7));
  alter table public.product_usage_events_v2 validate constraint product_usage_events_v2_career_check;
  alter table public.product_usage_events_v2 drop constraint product_usage_events_v2_event_name_check;
  alter table public.product_usage_events_v2 rename constraint product_usage_events_v2_career_check to product_usage_events_v2_event_name_check;
end $career$;

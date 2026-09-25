-- Canonical Preview hardening for Polla Live realtime.
-- Clients subscribe only to the sanitized revision signal. Raw score/group
-- rows remain server-side and must not be replicated through Realtime.
-- Do not apply to Production during consolidation.

begin;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tournament_scores'
    ) then
      alter publication supabase_realtime drop table public.tournament_scores;
    end if;

    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tournament_groups'
    ) then
      alter publication supabase_realtime drop table public.tournament_groups;
    end if;

    if to_regclass('public.tournament_leaderboard_events') is not null
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'tournament_leaderboard_events'
      ) then
      alter publication supabase_realtime add table public.tournament_leaderboard_events;
    end if;
  end if;
end;
$$;

comment on table public.tournament_leaderboard_events is
  'Sanitized Polla Live revision signal. Realtime clients refetch authorized API projections; raw groups and scores are not published.';

commit;

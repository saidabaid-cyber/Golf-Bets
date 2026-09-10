-- Phase 2D: optional shot tracking, privacy-minimized analytics and aggregate-only admin metrics.
-- Additive only. Apply after 202609100001 and 202609100003 in a controlled non-Production environment.
begin;

create table if not exists public.round_shots_v2 (
  id uuid primary key,
  round_id uuid not null references public.rounds_cloud(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  player_key text not null,
  hole integer not null check (hole between 1 and 18),
  sequence integer not null check (sequence >= 1),
  club_id text,
  club_snapshot jsonb not null,
  start_location jsonb,
  end_location jsonb,
  distance_yards integer check (distance_yards is null or distance_yards between 0 and 700),
  source text not null check (source in ('MANUAL', 'GPS', 'WATCH', 'RANGEFINDER', 'IMPORT')),
  started_at timestamptz not null,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  operation_id uuid not null,
  unique (owner_id, operation_id),
  unique (round_id, player_key, hole, sequence),
  constraint round_shots_club_snapshot_check check (jsonb_typeof(club_snapshot) = 'object'),
  constraint round_shots_start_location_check check (start_location is null or jsonb_typeof(start_location) = 'object'),
  constraint round_shots_end_location_check check (end_location is null or jsonb_typeof(end_location) = 'object')
);
create index if not exists round_shots_v2_round_player_idx on public.round_shots_v2(round_id, player_key, hole, sequence);
create index if not exists round_shots_v2_owner_started_idx on public.round_shots_v2(owner_id, started_at desc);

create table if not exists public.product_usage_events_v2 (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{12,100}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (event_name in (
    'signup_completed','round_created','round_completed','group_created','friend_added',
    'ai_round_setup','card_ai_used','game_used','gps_used','shot_recorded','ball_fit_completed',
    'course_selected','round_invite_sent','round_invite_accepted','membership_benefits_viewed','ai_insight_viewed'
  )),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists product_usage_events_v2_owner_time_idx on public.product_usage_events_v2(owner_id, occurred_at desc);
create index if not exists product_usage_events_v2_name_time_idx on public.product_usage_events_v2(event_name, occurred_at desc);

alter table public.round_shots_v2 enable row level security;
alter table public.product_usage_events_v2 enable row level security;
revoke all on public.round_shots_v2, public.product_usage_events_v2 from public, anon, authenticated;
grant select, insert, update, delete on public.round_shots_v2 to authenticated;
grant insert on public.product_usage_events_v2 to authenticated;

create policy "round shots participant read" on public.round_shots_v2 for select to authenticated
  using (private.is_round_participant(round_id));
create policy "round shots authorized insert" on public.round_shots_v2 for insert to authenticated
  with check (owner_id = (select auth.uid()) and private.can_edit_round_player(round_id, player_key, false));
create policy "round shots owner update" on public.round_shots_v2 for update to authenticated
  using (owner_id = (select auth.uid()) and private.can_edit_round_player(round_id, player_key, false))
  with check (owner_id = (select auth.uid()) and private.can_edit_round_player(round_id, player_key, false));
create policy "round shots owner delete" on public.round_shots_v2 for delete to authenticated
  using (owner_id = (select auth.uid()) and private.can_edit_round_player(round_id, player_key, false));
create policy "usage events self insert" on public.product_usage_events_v2 for insert to authenticated
  with check (owner_id = (select auth.uid()));

create or replace function public.phase2_admin_aggregate_metrics()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare result jsonb;
begin
  if not private.is_app_admin() then raise insufficient_privilege using message = 'ADMIN_REQUIRED'; end if;
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'activeUsers', (select count(distinct owner_id) from public.product_usage_events_v2 where occurred_at >= now() - interval '30 days'),
    'rounds', (select count(*) from public.rounds_cloud),
    'groups', (select count(*) from public.groups_v2),
    'plans', coalesce((select jsonb_object_agg(plan_id, total) from (select plan_id, count(*) as total from public.feature_entitlements group by plan_id) p), '{}'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('name', event_name, 'count', total)) from (select event_name, count(*) as total from public.product_usage_events_v2 group by event_name order by event_name) e), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(jsonb_build_object('code', metadata->>'errorCode', 'count', total)) from (select metadata, count(*) as total from public.product_usage_events_v2 where metadata ? 'errorCode' group by metadata) x), '[]'::jsonb),
    'generatedAt', now()
  ) into result;
  return result;
end;
$$;
revoke all on function public.phase2_admin_aggregate_metrics() from public, anon;
grant execute on function public.phase2_admin_aggregate_metrics() to authenticated;

comment on table public.round_shots_v2 is 'Optional shots with immutable club snapshots; location requires product/legal review before release.';
comment on table public.product_usage_events_v2 is 'Privacy-minimized product events; no prompts, images, names, emails or coordinates.';
comment on function public.phase2_admin_aggregate_metrics() is 'Explicit-admin aggregate counts only; never returns private round payloads.';

commit;

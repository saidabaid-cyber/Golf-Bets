-- Phase 2C: provider-neutral live round operation log and private notifications.
-- Additive only. Realtime delivery uses private channels; this migration does
-- not expose live tables through a public publication.

begin;

create table if not exists public.round_participants_v2 (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds_cloud(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  guest_player_id uuid references public.guest_players_v2(id) on delete set null,
  player_key text,
  role text not null check (role in ('ORGANIZER', 'SCOREKEEPER', 'PLAYER', 'VIEWER')),
  joined_at timestamptz not null default now(),
  constraint round_participant_identity_check check ((user_id is not null)::integer + (guest_player_id is not null)::integer = 1)
);
create unique index if not exists round_participants_v2_user_uidx on public.round_participants_v2(round_id, user_id) where user_id is not null;
create unique index if not exists round_participants_v2_guest_uidx on public.round_participants_v2(round_id, guest_player_id) where guest_player_id is not null;

create table if not exists public.live_round_operations_v2 (
  id uuid primary key,
  round_id uuid not null references public.rounds_cloud(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null check (operation_kind in ('SCORE_SET', 'PUTTS_SET', 'STAT_PATCH', 'ROUND_SETTINGS_PATCH')),
  player_key text,
  hole integer check (hole is null or hole between 1 and 18),
  payload jsonb not null,
  base_version bigint not null check (base_version >= 0),
  resulting_version bigint not null check (resulting_version > base_version),
  created_at timestamptz not null default now(),
  constraint live_round_operation_shape check (
    (operation_kind = 'ROUND_SETTINGS_PATCH' and hole is null)
    or (operation_kind <> 'ROUND_SETTINGS_PATCH' and hole is not null and player_key is not null)
  )
);
create index if not exists live_round_operations_v2_round_version_idx on public.live_round_operations_v2(round_id, resulting_version);

create table if not exists public.round_activity_v2 (
  id uuid primary key,
  round_id uuid not null references public.rounds_cloud(id) on delete cascade,
  group_id uuid references public.groups_v2(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('SCORE_RECORDED', 'HOLE_COMPLETED', 'ROUND_STARTED', 'ROUND_FINISHED', 'BIRDIE')),
  player_key text,
  hole integer check (hole is null or hole between 1 and 18),
  visibility text not null check (visibility in ('ROUND', 'GROUP')),
  created_at timestamptz not null default now()
);
create index if not exists round_activity_v2_round_created_idx on public.round_activity_v2(round_id, created_at desc);
create index if not exists round_activity_v2_group_created_idx on public.round_activity_v2(group_id, created_at desc) where group_id is not null;

create table if not exists public.notification_preferences_v2 (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('friend_request', 'friend_accepted', 'group_invite', 'round_invite', 'round_started', 'round_finished', 'scorecard_ready')),
  in_app boolean not null default true,
  push boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_type)
);

create table if not exists public.notification_events_v2 (
  id uuid primary key,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  resource_type text not null check (resource_type in ('FRIEND', 'GROUP', 'ROUND', 'SCORECARD')),
  resource_id text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, id)
);
create index if not exists notification_events_v2_recipient_idx on public.notification_events_v2(recipient_id, created_at desc);

create or replace function private.is_round_participant(target_round_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists(select 1 from public.rounds_cloud where id = target_round_id and owner_id = (select auth.uid()))
    or exists(select 1 from public.round_participants_v2 where round_id = target_round_id and user_id = (select auth.uid()));
$$;
create or replace function private.can_edit_round_player(target_round_id uuid, target_player_key text, settings_operation boolean)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists(select 1 from public.rounds_cloud where id = target_round_id and owner_id = (select auth.uid()))
    or exists(
      select 1 from public.round_participants_v2
      where round_id = target_round_id and user_id = (select auth.uid())
        and (role = 'SCOREKEEPER' or (not settings_operation and role = 'PLAYER' and player_key = target_player_key))
    );
$$;
revoke all on function private.is_round_participant(uuid), private.can_edit_round_player(uuid, text, boolean) from public, anon;
grant execute on function private.is_round_participant(uuid), private.can_edit_round_player(uuid, text, boolean) to authenticated;

alter table public.round_participants_v2 enable row level security;
alter table public.live_round_operations_v2 enable row level security;
alter table public.round_activity_v2 enable row level security;
alter table public.notification_preferences_v2 enable row level security;
alter table public.notification_events_v2 enable row level security;

revoke all on public.round_participants_v2, public.live_round_operations_v2, public.round_activity_v2, public.notification_preferences_v2, public.notification_events_v2 from anon, authenticated;
grant select, insert, update, delete on public.round_participants_v2 to authenticated;
grant select, insert on public.live_round_operations_v2, public.round_activity_v2 to authenticated;
grant select, insert, update, delete on public.notification_preferences_v2 to authenticated;
grant select, update on public.notification_events_v2 to authenticated;

create policy "round participants read authorized" on public.round_participants_v2 for select to authenticated using (private.is_round_participant(round_id));
create policy "round participants owner insert" on public.round_participants_v2 for insert to authenticated with check (exists(select 1 from public.rounds_cloud where id = round_id and owner_id = (select auth.uid())));
create policy "round participants owner update" on public.round_participants_v2 for update to authenticated using (exists(select 1 from public.rounds_cloud where id = round_id and owner_id = (select auth.uid()))) with check (exists(select 1 from public.rounds_cloud where id = round_id and owner_id = (select auth.uid())));
create policy "round participants owner delete" on public.round_participants_v2 for delete to authenticated using (exists(select 1 from public.rounds_cloud where id = round_id and owner_id = (select auth.uid())));

create policy "live operations participant read" on public.live_round_operations_v2 for select to authenticated using (private.is_round_participant(round_id));
create policy "live operations authorized insert" on public.live_round_operations_v2 for insert to authenticated with check (actor_id = (select auth.uid()) and private.can_edit_round_player(round_id, player_key, operation_kind = 'ROUND_SETTINGS_PATCH'));
create policy "round activity participant read" on public.round_activity_v2 for select to authenticated using (private.is_round_participant(round_id) and (group_id is null or private.is_group_member(group_id)));
create policy "round activity actor insert" on public.round_activity_v2 for insert to authenticated with check (actor_id = (select auth.uid()) and private.is_round_participant(round_id));

create policy "notification preferences self select" on public.notification_preferences_v2 for select to authenticated using (user_id = (select auth.uid()));
create policy "notification preferences self insert" on public.notification_preferences_v2 for insert to authenticated with check (user_id = (select auth.uid()));
create policy "notification preferences self update" on public.notification_preferences_v2 for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notification preferences self delete" on public.notification_preferences_v2 for delete to authenticated using (user_id = (select auth.uid()));
create policy "notification events recipient select" on public.notification_events_v2 for select to authenticated using (recipient_id = (select auth.uid()));
create policy "notification events recipient update" on public.notification_events_v2 for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

comment on table public.live_round_operations_v2 is 'Immutable idempotent operations. Realtime transport is provider-neutral and private.';
comment on table public.notification_events_v2 is 'Private event references only; push delivery is separately configured and disabled by default.';

commit;

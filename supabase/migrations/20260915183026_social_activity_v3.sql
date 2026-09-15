-- SocialActivity V3. Source facts are canonical persisted snapshots. No shared
-- round, profile or equipment rows are deleted or rewritten by this migration.
begin;

create table if not exists public.social_activity_preferences_v3 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  share_rounds boolean not null default false,
  share_achievements boolean not null default false,
  share_equipment boolean not null default false,
  share_courses boolean not null default false,
  notify_like boolean not null default true,
  notify_comment boolean not null default true,
  notify_attest boolean not null default true,
  notify_friend_achievement boolean not null default false,
  notify_equipment boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.social_activities_v3 (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  event_kind text not null check (event_kind in ('ROUND_COMPLETED','ACHIEVEMENT','EQUIPMENT_UPDATED')),
  source_round_id uuid references public.rounds_cloud(id) on delete cascade,
  source_equipment_user_id uuid references auth.users(id) on delete cascade,
  local_round_id text,
  source_version bigint not null check (source_version > 0),
  -- Provisional database revision token, replaced with the TS whitelist SHA-256
  -- before a card/action is returned by the server. Never a client-authored key.
  material_hash text not null check (material_hash ~ '^[0-9a-f]{32}([0-9a-f]{32})?$'),
  audience text not null default 'OWNER' check (audience in ('OWNER','FRIENDS')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_activity_one_source_check check (
    ((source_round_id is not null)::integer + (source_equipment_user_id is not null)::integer) = 1
  )
);
create unique index if not exists social_activities_v3_round_kind_uidx
  on public.social_activities_v3(source_round_id,event_kind,author_id) where source_round_id is not null;
create unique index if not exists social_activities_v3_equipment_kind_uidx
  on public.social_activities_v3(source_equipment_user_id,event_kind) where source_equipment_user_id is not null;
create index if not exists social_activities_v3_author_created_idx on public.social_activities_v3(author_id,created_at desc,id desc);
create index if not exists social_activities_v3_feed_idx on public.social_activities_v3(created_at desc,id desc) where active;
create index if not exists social_activities_v3_local_round_idx on public.social_activities_v3(author_id,local_round_id) where source_round_id is not null;

create table if not exists public.social_round_account_links_v3 (
  round_id uuid not null references public.rounds_cloud(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_key text not null check (length(trim(player_key)) between 1 and 120),
  verified_by text not null check (verified_by in ('ROUND_OWNER','SELF_CONFIRMED')),
  confirmed_at timestamptz not null default now(),
  primary key(round_id,user_id),
  unique(round_id,player_key)
);
create index if not exists social_round_account_links_v3_user_idx on public.social_round_account_links_v3(user_id,round_id);

create table if not exists public.social_likes_v3 (
  activity_id uuid not null references public.social_activities_v3(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expected_hash text not null,
  created_at timestamptz not null default now(),
  primary key(activity_id,user_id)
);
create index if not exists social_likes_v3_activity_created_idx on public.social_likes_v3(activity_id,created_at desc);

create table if not exists public.social_comments_v3 (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.social_activities_v3(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 500),
  expected_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_comments_v3_activity_created_idx on public.social_comments_v3(activity_id,created_at desc,id desc);
create index if not exists social_comments_v3_author_idx on public.social_comments_v3(author_id,created_at desc);

create table if not exists public.social_round_attestations_v3 (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.social_activities_v3(id) on delete cascade,
  round_id uuid not null references public.rounds_cloud(id) on delete cascade,
  attester_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  expected_version bigint not null check (expected_version > 0),
  expected_hash text not null,
  created_at timestamptz not null default now(),
  constraint social_attestation_no_self check (attester_id <> target_user_id),
  constraint social_attestation_once_per_revision unique(activity_id,attester_id,target_user_id,expected_hash)
);
create index if not exists social_round_attestations_v3_activity_hash_idx
  on public.social_round_attestations_v3(activity_id,expected_hash,created_at desc);
create index if not exists social_round_attestations_v3_target_idx
  on public.social_round_attestations_v3(target_user_id,created_at desc);

-- A DB trigger cannot run the deterministic TypeScript achievement/material
-- helper. It atomically publishes a private base reference after the canonical
-- snapshot/version write; the server derives and CAS-stores the definitive
-- material fingerprint before returning any card or allowing mutations.
create or replace function private.publish_social_round_v3()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  principal jsonb;
  completed boolean;
  sharing boolean;
begin
  completed := new.snapshot ->> 'lifecycleState' = 'completed'
    and nullif(new.snapshot ->> 'completedAt','') is not null;
  select coalesce(p.share_rounds,false) into sharing
    from public.social_activity_preferences_v3 p where p.user_id = new.owner_id;
  sharing := coalesce(sharing,false);

  if completed then
    select player.value into principal
      from jsonb_array_elements(
        case when jsonb_typeof(new.snapshot -> 'players') = 'array'
          then new.snapshot -> 'players' else '[]'::jsonb end
      ) as player(value)
      where player.value ->> 'id' = new.snapshot ->> 'ownerId'
        and player.value ->> 'accountUserId' = new.owner_id::text
      limit 1;
    if principal is not null then
      insert into public.social_round_account_links_v3(round_id,user_id,player_key,verified_by)
      values(new.id,new.owner_id,principal ->> 'id','ROUND_OWNER')
      on conflict(round_id,user_id) do update
        set player_key = excluded.player_key, verified_by = 'ROUND_OWNER';
    end if;
  end if;

  insert into public.social_activities_v3(
    author_id,event_kind,source_round_id,local_round_id,source_version,
    material_hash,audience,active
  ) values(
    new.owner_id,'ROUND_COMPLETED',new.id,new.local_round_id,new.version,
    md5(new.snapshot::text),
    case when sharing and exists(
      select 1 from public.profiles profile
      where profile.id = new.owner_id and profile.social_privacy = 'FRIENDS'
    ) then 'FRIENDS' else 'OWNER' end,
    completed
  )
  on conflict(source_round_id,event_kind,author_id) where source_round_id is not null
  do update set
    local_round_id = excluded.local_round_id,
    source_version = excluded.source_version,
    material_hash = excluded.material_hash,
    audience = excluded.audience,
    active = excluded.active,
    updated_at = now()
  where public.social_activities_v3.source_version <= excluded.source_version;
  -- A confirmed participant's private/public card follows the same frozen
  -- source transaction. Its audience still belongs to that account's privacy.
  update public.social_activities_v3 activity
    set source_version = new.version, material_hash = md5(new.snapshot::text),
      active = completed and exists(
        select 1 from public.social_round_account_links_v3 link
        join jsonb_array_elements(
          case when jsonb_typeof(new.snapshot -> 'players') = 'array'
            then new.snapshot -> 'players' else '[]'::jsonb end
        ) as player(value) on player.value ->> 'id' = link.player_key
          and player.value ->> 'accountUserId' = link.user_id::text
        where link.round_id = new.id and link.user_id = activity.author_id
      ), updated_at = now()
    where activity.source_round_id = new.id and activity.event_kind = 'ROUND_COMPLETED'
      and activity.author_id <> new.owner_id and activity.source_version <= new.version;
  return new;
end;
$$;
revoke all on function private.publish_social_round_v3() from public, anon, authenticated;
drop trigger if exists social_round_publish_v3 on public.rounds_cloud;
create trigger social_round_publish_v3
after insert or update of snapshot,version on public.rounds_cloud
for each row execute function private.publish_social_round_v3();

create or replace function private.publish_social_equipment_v3()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  sharing boolean;
begin
  select coalesce(p.share_equipment,false) into sharing
    from public.social_activity_preferences_v3 p where p.user_id = new.user_id;
  insert into public.social_activities_v3(
    author_id,event_kind,source_equipment_user_id,source_version,
    material_hash,audience,active
  ) values(
    new.user_id,'EQUIPMENT_UPDATED',new.user_id,new.version,
    md5(new.snapshot::text),
    case when coalesce(sharing,false) and exists(
      select 1 from public.profiles profile
      where profile.id = new.user_id and profile.social_privacy = 'FRIENDS'
    ) then 'FRIENDS' else 'OWNER' end,
    true
  )
  on conflict(source_equipment_user_id,event_kind) where source_equipment_user_id is not null
  do update set source_version = excluded.source_version,
    material_hash = excluded.material_hash,
    audience = excluded.audience,
    created_at = case when public.social_activities_v3.updated_at < now() - interval '30 minutes'
      then now() else public.social_activities_v3.created_at end,
    updated_at = now()
  where public.social_activities_v3.source_version <= excluded.source_version;
  return new;
end;
$$;
revoke all on function private.publish_social_equipment_v3() from public, anon, authenticated;
drop trigger if exists social_equipment_publish_v3 on public.player_equipment_profiles;
create trigger social_equipment_publish_v3
after insert or update of snapshot,version on public.player_equipment_profiles
for each row execute function private.publish_social_equipment_v3();

create or replace function private.can_read_social_activity_v3(target_activity_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.social_activities_v3 activity
    where activity.id = target_activity_id and activity.active
      and length(activity.material_hash) = 64
      and (activity.source_round_id is null or exists(
        select 1 from public.rounds_cloud round
        join public.social_round_account_links_v3 link
          on link.round_id = round.id and link.user_id = activity.author_id
        where round.id = activity.source_round_id
          and round.version = activity.source_version
          and round.snapshot ->> 'lifecycleState' = 'completed'
          and exists(select 1 from jsonb_array_elements(
            case when jsonb_typeof(round.snapshot -> 'players') = 'array'
              then round.snapshot -> 'players' else '[]'::jsonb end
          ) as player(value) where player.value ->> 'id' = link.player_key
            and player.value ->> 'accountUserId' = activity.author_id::text)
      ))
      and (activity.source_equipment_user_id is null or exists(
        select 1 from public.player_equipment_profiles equipment
        where equipment.user_id = activity.source_equipment_user_id
          and equipment.version = activity.source_version
      ))
      and (
        activity.author_id = (select auth.uid())
        or (
          activity.audience = 'FRIENDS'
          and exists(select 1 from public.profiles profile
            where profile.id = activity.author_id and profile.social_privacy = 'FRIENDS')
          and exists(select 1 from public.social_activity_preferences_v3 pref
            where pref.user_id = activity.author_id
              and case activity.event_kind
                when 'ROUND_COMPLETED' then pref.share_rounds
                when 'ACHIEVEMENT' then pref.share_achievements
                when 'EQUIPMENT_UPDATED' then pref.share_equipment
                else false end)
          and exists(select 1 from public.friendships friendship
            where friendship.user_a_id = least(activity.author_id,(select auth.uid()))
              and friendship.user_b_id = greatest(activity.author_id,(select auth.uid())))
          and not exists(select 1 from public.blocked_connections blocked
            where (blocked.owner_id = activity.author_id and blocked.blocked_user_id = (select auth.uid()))
               or (blocked.owner_id = (select auth.uid()) and blocked.blocked_user_id = activity.author_id))
        )
      )
  );
$$;
create or replace function private.can_mutate_social_activity_v3(target_activity_id uuid, expected_hash text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.can_read_social_activity_v3(target_activity_id)
    and exists(select 1 from public.social_activities_v3 activity
      where activity.id = target_activity_id and activity.active
        and activity.material_hash = expected_hash
        and length(expected_hash) = 64);
$$;
create or replace function private.can_confirm_social_round_link_v3(target_round_id uuid, target_player_key text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.rounds_cloud round
    where round.id = target_round_id
      and round.snapshot ->> 'lifecycleState' = 'completed'
      and nullif(round.snapshot ->> 'completedAt','') is not null
      -- The account holder's explicit SELF_CONFIRMED write is the proof.
      -- Organizer-only round_participants_v2 rows are not an independent
      -- identity attestation and are not required for this flow.
      and exists(select 1 from jsonb_array_elements(
        case when jsonb_typeof(round.snapshot -> 'players') = 'array'
          then round.snapshot -> 'players' else '[]'::jsonb end
      ) as player(value)
        where player.value ->> 'id' = target_player_key
          and player.value ->> 'accountUserId' = (select auth.uid())::text)
  );
$$;
create or replace function private.can_attest_social_round_v3(
  target_activity_id uuid, target_user_id uuid, expected_hash text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and target_user_id <> (select auth.uid())
    and private.can_mutate_social_activity_v3(target_activity_id,expected_hash)
    and exists(
      select 1
      from public.social_activities_v3 activity
      join public.rounds_cloud round on round.id = activity.source_round_id
      join public.social_round_account_links_v3 mine
        on mine.round_id = round.id and mine.user_id = (select auth.uid())
      join public.social_round_account_links_v3 target
        on target.round_id = round.id and target.user_id = target_user_id
      where activity.id = target_activity_id
        and activity.event_kind = 'ROUND_COMPLETED'
        and activity.author_id = target_user_id
        and activity.active
        and round.snapshot ->> 'lifecycleState' = 'completed'
        and nullif(round.snapshot ->> 'completedAt','') is not null
        -- Both account links remain tied to the CURRENT canonical player IDs.
        and exists(select 1 from jsonb_array_elements(
          case when jsonb_typeof(round.snapshot -> 'players') = 'array'
            then round.snapshot -> 'players' else '[]'::jsonb end
        ) as player(value) where player.value ->> 'id' = mine.player_key
          and player.value ->> 'accountUserId' = mine.user_id::text)
        and exists(select 1 from jsonb_array_elements(
          case when jsonb_typeof(round.snapshot -> 'players') = 'array'
            then round.snapshot -> 'players' else '[]'::jsonb end
        ) as player(value) where player.value ->> 'id' = target.player_key
          and player.value ->> 'accountUserId' = target.user_id::text)
    );
$$;
revoke all on function private.can_read_social_activity_v3(uuid),
  private.can_mutate_social_activity_v3(uuid,text),
  private.can_confirm_social_round_link_v3(uuid,text),
  private.can_attest_social_round_v3(uuid,uuid,text)
  from public, anon;
grant execute on function private.can_read_social_activity_v3(uuid),
  private.can_mutate_social_activity_v3(uuid,text),
  private.can_confirm_social_round_link_v3(uuid,text),
  private.can_attest_social_round_v3(uuid,uuid,text)
  to authenticated;

alter table public.social_activity_preferences_v3 enable row level security;
alter table public.social_activities_v3 enable row level security;
alter table public.social_round_account_links_v3 enable row level security;
alter table public.social_likes_v3 enable row level security;
alter table public.social_comments_v3 enable row level security;
alter table public.social_round_attestations_v3 enable row level security;
revoke all on public.social_activity_preferences_v3,public.social_activities_v3,
  public.social_round_account_links_v3,public.social_likes_v3,
  public.social_comments_v3,public.social_round_attestations_v3
  from anon,authenticated;
grant select,insert,update on public.social_activity_preferences_v3 to authenticated;
grant select on public.social_activities_v3 to authenticated;
grant select,insert,delete on public.social_round_account_links_v3 to authenticated;
grant select,insert,delete on public.social_likes_v3 to authenticated;
grant select,insert,update,delete on public.social_comments_v3 to authenticated;
grant select,insert,delete on public.social_round_attestations_v3 to authenticated;

create policy social_prefs_owner_read_v3 on public.social_activity_preferences_v3
  for select to authenticated using (user_id = (select auth.uid()));
create policy social_prefs_owner_insert_v3 on public.social_activity_preferences_v3
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy social_prefs_owner_update_v3 on public.social_activity_preferences_v3
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy social_activity_audience_read_v3 on public.social_activities_v3
  for select to authenticated using (private.can_read_social_activity_v3(id));
create policy social_round_link_self_read_v3 on public.social_round_account_links_v3
  for select to authenticated using (user_id = (select auth.uid()));
create policy social_round_link_self_confirm_v3 on public.social_round_account_links_v3
  for insert to authenticated with check (
    user_id = (select auth.uid()) and verified_by = 'SELF_CONFIRMED'
      and private.can_confirm_social_round_link_v3(round_id,player_key));
create policy social_round_link_self_revoke_v3 on public.social_round_account_links_v3
  for delete to authenticated using (user_id = (select auth.uid()) and verified_by = 'SELF_CONFIRMED');

create policy social_like_audience_read_v3 on public.social_likes_v3
  for select to authenticated using (private.can_read_social_activity_v3(activity_id));
create policy social_like_author_insert_v3 on public.social_likes_v3
  for insert to authenticated with check (
    user_id = (select auth.uid())
      and private.can_mutate_social_activity_v3(activity_id,expected_hash));
create policy social_like_author_delete_v3 on public.social_likes_v3
  for delete to authenticated using (user_id = (select auth.uid()));

create policy social_comment_audience_read_v3 on public.social_comments_v3
  for select to authenticated using (private.can_read_social_activity_v3(activity_id));
create policy social_comment_author_insert_v3 on public.social_comments_v3
  for insert to authenticated with check (
    author_id = (select auth.uid())
      and private.can_mutate_social_activity_v3(activity_id,expected_hash));
create policy social_comment_author_update_v3 on public.social_comments_v3
  for update to authenticated using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid())
    and private.can_mutate_social_activity_v3(activity_id,expected_hash));
create policy social_comment_author_delete_v3 on public.social_comments_v3
  for delete to authenticated using (author_id = (select auth.uid()));

create policy social_attest_audience_read_v3 on public.social_round_attestations_v3
  for select to authenticated using (private.can_read_social_activity_v3(activity_id));
create policy social_attest_actor_insert_v3 on public.social_round_attestations_v3
  for insert to authenticated with check (
    attester_id = (select auth.uid()) and attester_id <> target_user_id
      and private.can_attest_social_round_v3(activity_id,target_user_id,expected_hash));
create policy social_attest_actor_delete_v3 on public.social_round_attestations_v3
  for delete to authenticated using (attester_id = (select auth.uid()));

-- A direct Data API caller cannot forge timestamps, owner links, revisions or
-- a cross-activity round_id even if they bypass the Next route handler.
create or replace function private.guard_social_mutation_v3()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  activity public.social_activities_v3%rowtype;
  source public.rounds_cloud%rowtype;
begin
  if tg_table_name = 'social_round_account_links_v3' then
    select * into source from public.rounds_cloud where id = new.round_id for share;
    if not found then raise exception using errcode='23503',message='social_round_missing'; end if;
    if new.verified_by = 'SELF_CONFIRMED' then
      if new.user_id <> (select auth.uid())
        or not private.can_confirm_social_round_link_v3(new.round_id,new.player_key) then
        raise exception using errcode='42501',message='social_round_link_not_self_confirmed';
      end if;
    elsif new.verified_by = 'ROUND_OWNER' then
      if new.user_id <> source.owner_id
        or new.player_key <> source.snapshot ->> 'ownerId'
        or not exists(select 1 from jsonb_array_elements(
          case when jsonb_typeof(source.snapshot -> 'players') = 'array'
            then source.snapshot -> 'players' else '[]'::jsonb end
        ) as player(value) where player.value ->> 'id' = new.player_key
          and player.value ->> 'accountUserId' = new.user_id::text) then
        raise exception using errcode='42501',message='social_round_owner_link_invalid';
      end if;
    else
      raise exception using errcode='42501',message='social_round_link_kind_invalid';
    end if;
    new.confirmed_at := now();
    return new;
  end if;
  -- rounds_cloud UPDATE takes source then activity via its publication trigger.
  -- Attestation must take the same lock order to avoid source/activity deadlock.
  if tg_table_name = 'social_round_attestations_v3' then
    select * into source from public.rounds_cloud where id = new.round_id for share;
    if not found or source.snapshot ->> 'lifecycleState' <> 'completed' then
      raise exception using errcode='40001',message='social_round_no_longer_completed';
    end if;
  end if;
  select * into activity from public.social_activities_v3 where id = new.activity_id for share;
  if not found or not activity.active then
    raise exception using errcode='42501',message='social_activity_unavailable';
  end if;
  if new.expected_hash <> activity.material_hash or length(activity.material_hash) <> 64 then
    raise exception using errcode='40001',message='social_stale_revision';
  end if;
  if tg_table_name = 'social_likes_v3' then
    if new.user_id <> (select auth.uid()) or
      not private.can_mutate_social_activity_v3(new.activity_id,new.expected_hash) then
      raise exception using errcode='42501',message='social_like_not_authorized';
    end if;
  end if;
  if tg_table_name = 'social_round_attestations_v3' then
    if new.attester_id <> (select auth.uid())
      or not private.can_attest_social_round_v3(new.activity_id,new.target_user_id,new.expected_hash) then
      raise exception using errcode='42501',message='social_attest_not_authorized';
    end if;
    if new.round_id <> activity.source_round_id or new.target_user_id <> activity.author_id then
      raise exception using errcode='42501',message='social_attest_round_identity_mismatch';
    end if;
    new.expected_version := source.version;
  elsif tg_table_name = 'social_comments_v3' then
    if new.author_id <> (select auth.uid())
      or not private.can_mutate_social_activity_v3(new.activity_id,new.expected_hash) then
      raise exception using errcode='42501',message='social_comment_not_authorized';
    end if;
    if tg_op = 'UPDATE' and (new.id <> old.id or new.activity_id <> old.activity_id
      or new.author_id <> old.author_id or new.expected_hash <> old.expected_hash) then
      raise exception using errcode='42501',message='social_comment_identity_immutable';
    end if;
    new.body := trim(new.body);
    if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_social_mutation_v3() from public,anon,authenticated;
drop trigger if exists social_round_link_guard_v3 on public.social_round_account_links_v3;
create trigger social_round_link_guard_v3 before insert on public.social_round_account_links_v3
  for each row execute function private.guard_social_mutation_v3();
create or replace function private.publish_social_participant_v3()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  source public.rounds_cloud%rowtype;
  sharing boolean;
begin
  if new.verified_by <> 'SELF_CONFIRMED' then return new; end if;
  select * into source from public.rounds_cloud where id = new.round_id;
  if not found or source.snapshot ->> 'lifecycleState' <> 'completed' then return new; end if;
  select coalesce(p.share_rounds,false) into sharing from public.social_activity_preferences_v3 p
    where p.user_id = new.user_id;
  insert into public.social_activities_v3(
    author_id,event_kind,source_round_id,local_round_id,source_version,
    material_hash,audience,active)
  values(new.user_id,'ROUND_COMPLETED',source.id,source.local_round_id,
    source.version,md5(source.snapshot::text),
    case when coalesce(sharing,false) and exists(
      select 1 from public.profiles profile where profile.id = new.user_id
        and profile.social_privacy = 'FRIENDS') then 'FRIENDS' else 'OWNER' end,true)
  on conflict(source_round_id,event_kind,author_id) where source_round_id is not null
  do update set source_version=excluded.source_version,
    material_hash=excluded.material_hash,audience=excluded.audience,
    active=true,updated_at=now()
  where public.social_activities_v3.source_version <= excluded.source_version;
  return new;
end;
$$;
revoke all on function private.publish_social_participant_v3() from public,anon,authenticated;
drop trigger if exists social_participant_publish_v3 on public.social_round_account_links_v3;
create trigger social_participant_publish_v3
  after insert on public.social_round_account_links_v3
  for each row execute function private.publish_social_participant_v3();
create or replace function private.revoke_social_participant_v3()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.verified_by = 'SELF_CONFIRMED' then
    update public.social_activities_v3
      set active=false,updated_at=now()
      where source_round_id=old.round_id and author_id=old.user_id;
  end if;
  return old;
end;
$$;
revoke all on function private.revoke_social_participant_v3() from public,anon,authenticated;
drop trigger if exists social_participant_revoke_v3 on public.social_round_account_links_v3;
create trigger social_participant_revoke_v3
  after delete on public.social_round_account_links_v3
  for each row execute function private.revoke_social_participant_v3();
drop trigger if exists social_like_guard_v3 on public.social_likes_v3;
create trigger social_like_guard_v3 before insert on public.social_likes_v3
  for each row execute function private.guard_social_mutation_v3();
drop trigger if exists social_comment_guard_v3 on public.social_comments_v3;
create trigger social_comment_guard_v3 before insert or update on public.social_comments_v3
  for each row execute function private.guard_social_mutation_v3();
drop trigger if exists social_attest_guard_v3 on public.social_round_attestations_v3;
create trigger social_attest_guard_v3 before insert on public.social_round_attestations_v3
  for each row execute function private.guard_social_mutation_v3();

create or replace function private.notify_social_reaction_v3()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  recipient uuid;
  actor uuid;
  event_name text;
  permitted boolean;
begin
  if tg_table_name = 'social_likes_v3' then
    event_name := 'like';
    actor := new.user_id;
    select author_id into recipient from public.social_activities_v3 where id = new.activity_id;
  elsif tg_table_name = 'social_comments_v3' then
    event_name := 'comment';
    actor := new.author_id;
    select author_id into recipient from public.social_activities_v3 where id = new.activity_id;
  else
    event_name := 'attest';
    actor := new.attester_id;
    recipient := new.target_user_id;
  end if;
  if recipient is null or recipient = actor then return new; end if;
  select case
    when event_name = 'like' then p.notify_like
    when event_name = 'comment' then p.notify_comment
    else p.notify_attest end into permitted
    from public.social_activity_preferences_v3 p where p.user_id = recipient;
  if coalesce(permitted,true) then
    insert into public.notification_events_v2(
      id,recipient_id,event_type,resource_type,resource_id)
    values(gen_random_uuid(),recipient,event_name,'ROUND',new.activity_id::text);
  end if;
  return new;
end;
$$;
revoke all on function private.notify_social_reaction_v3() from public,anon,authenticated;
drop trigger if exists social_like_notify_v3 on public.social_likes_v3;
create trigger social_like_notify_v3 after insert on public.social_likes_v3
  for each row execute function private.notify_social_reaction_v3();
drop trigger if exists social_comment_notify_v3 on public.social_comments_v3;
create trigger social_comment_notify_v3 after insert on public.social_comments_v3
  for each row execute function private.notify_social_reaction_v3();
drop trigger if exists social_attest_notify_v3 on public.social_round_attestations_v3;
create trigger social_attest_notify_v3 after insert on public.social_round_attestations_v3
  for each row execute function private.notify_social_reaction_v3();

-- Optional achievement/equipment notifications are generated only after the
-- canonical TypeScript materializer has stored a definitive SHA revision.
-- This table is private and enforces idempotence across retries.
create table if not exists private.social_fanout_dedupe_v3 (
  recipient_id uuid not null references auth.users(id) on delete cascade,
  activity_id uuid not null references public.social_activities_v3(id) on delete cascade,
  event_type text not null check(event_type in ('friend_achievement','equipment')),
  material_hash text not null,
  created_at timestamptz not null default now(),
  primary key(recipient_id,activity_id,event_type,material_hash)
);
create index if not exists social_fanout_dedupe_v3_window_idx
  on private.social_fanout_dedupe_v3(recipient_id,activity_id,event_type,created_at desc);
revoke all on private.social_fanout_dedupe_v3 from public,anon,authenticated;

create or replace function private.fanout_social_activity_v3()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  candidate uuid;
  event_name text;
  eligible boolean;
  inserted uuid;
begin
  if not new.active or new.audience <> 'FRIENDS' or length(new.material_hash) <> 64
    or new.event_kind not in ('ACHIEVEMENT','EQUIPMENT_UPDATED') then return new; end if;
  if new.source_round_id is not null and not exists(
    select 1 from public.rounds_cloud round
    join public.social_round_account_links_v3 link
      on link.round_id=round.id and link.user_id=new.author_id
    where round.id=new.source_round_id and round.version=new.source_version
      and round.snapshot ->> 'lifecycleState'='completed'
      and exists(select 1 from jsonb_array_elements(
        case when jsonb_typeof(round.snapshot -> 'players')='array'
          then round.snapshot -> 'players' else '[]'::jsonb end
      ) as player(value) where player.value ->> 'id'=link.player_key
        and player.value ->> 'accountUserId'=new.author_id::text)
  ) then return new; end if;
  if new.source_equipment_user_id is not null and not exists(
    select 1 from public.player_equipment_profiles equipment
    where equipment.user_id=new.source_equipment_user_id
      and equipment.version=new.source_version
  ) then return new; end if;
  if not exists(select 1 from public.profiles profile where profile.id = new.author_id
    and profile.social_privacy = 'FRIENDS') then return new; end if;
  event_name := case when new.event_kind = 'ACHIEVEMENT'
    then 'friend_achievement' else 'equipment' end;
  for candidate in
    select case when friendship.user_a_id = new.author_id then friendship.user_b_id
      else friendship.user_a_id end
    from public.friendships friendship
    where friendship.user_a_id = new.author_id or friendship.user_b_id = new.author_id
  loop
    if exists(select 1 from public.blocked_connections blocked
      where (blocked.owner_id = new.author_id and blocked.blocked_user_id = candidate)
        or (blocked.owner_id = candidate and blocked.blocked_user_id = new.author_id))
      then continue; end if;
    select case when event_name = 'friend_achievement'
      then pref.notify_friend_achievement and author_pref.share_achievements
      else pref.notify_equipment and author_pref.share_equipment end into eligible
      from public.social_activity_preferences_v3 pref
      join public.social_activity_preferences_v3 author_pref
        on author_pref.user_id = new.author_id
      where pref.user_id = candidate;
    if not coalesce(eligible,false) then continue; end if;
    if event_name = 'equipment' and exists(
      select 1 from private.social_fanout_dedupe_v3 prior
      where prior.recipient_id=candidate and prior.activity_id=new.id
        and prior.event_type='equipment' and prior.created_at>now()-interval '30 minutes'
    ) then continue; end if;
    insert into private.social_fanout_dedupe_v3(
      recipient_id,activity_id,event_type,material_hash)
    values(candidate,new.id,event_name,new.material_hash)
    on conflict do nothing returning recipient_id into inserted;
    if inserted is not null then
      insert into public.notification_events_v2(
        id,recipient_id,event_type,resource_type,resource_id)
      values(gen_random_uuid(),candidate,event_name,'ROUND',new.id::text);
    end if;
    inserted := null;
  end loop;
  return new;
end;
$$;
revoke all on function private.fanout_social_activity_v3() from public,anon,authenticated;
drop trigger if exists social_activity_fanout_v3 on public.social_activities_v3;
create trigger social_activity_fanout_v3
  after insert or update of material_hash,audience,active,source_version
  on public.social_activities_v3
  for each row execute function private.fanout_social_activity_v3();

-- Sharing toggles and profile privacy are immediately reflected in stored
-- audience. RLS additionally checks live prefs/privacy for fail-closed revoke.
create or replace function private.sync_social_audience_v3(target_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.social_activities_v3 activity
    set audience = case when exists(
      select 1 from public.profiles profile
      join public.social_activity_preferences_v3 pref on pref.user_id=profile.id
      where profile.id=target_user_id and profile.social_privacy='FRIENDS'
        and case activity.event_kind
          when 'ROUND_COMPLETED' then pref.share_rounds
          when 'ACHIEVEMENT' then pref.share_achievements
          when 'EQUIPMENT_UPDATED' then pref.share_equipment
          else false end
    ) then 'FRIENDS' else 'OWNER' end,
    updated_at=now()
    where activity.author_id=target_user_id;
end;
$$;
revoke all on function private.sync_social_audience_v3(uuid) from public,anon,authenticated;
create or replace function private.sync_social_pref_audience_v3()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform private.sync_social_audience_v3(new.user_id); return new; end; $$;
revoke all on function private.sync_social_pref_audience_v3() from public,anon,authenticated;
drop trigger if exists social_pref_audience_v3 on public.social_activity_preferences_v3;
create trigger social_pref_audience_v3
  after insert or update of share_rounds,share_achievements,share_equipment
  on public.social_activity_preferences_v3
  for each row execute function private.sync_social_pref_audience_v3();
create or replace function private.sync_social_profile_audience_v3()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform private.sync_social_audience_v3(new.id); return new; end; $$;
revoke all on function private.sync_social_profile_audience_v3() from public,anon,authenticated;
drop trigger if exists social_profile_audience_v3 on public.profiles;
create trigger social_profile_audience_v3
  after update of social_privacy on public.profiles
  for each row execute function private.sync_social_profile_audience_v3();

-- Existing recipient-only notification RLS is not enough after an author
-- revokes sharing: direct Data API reads must hide stale Social resource IDs.
create policy social_notification_live_audience_v3
  on public.notification_events_v2 as restrictive for select to authenticated
  using (
    event_type not in ('like','comment','attest','friend_achievement','equipment')
    or case when resource_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then private.can_read_social_activity_v3(resource_id::uuid)
      else false end
  );

comment on table public.social_activities_v3 is
  'Central, durable source references. Feed materialization uses canonical persisted snapshots and a deterministic TS whitelist hash.';
comment on table public.social_round_account_links_v3 is
  'Non-owner account participation requires self-confirmation and matching canonical round player ID; organizer invitations alone are not evidence.';
comment on table public.social_round_attestations_v3 is
  'Only two self/owner-verified account links to the same completed canonical round can attest a current material revision.';
commit;

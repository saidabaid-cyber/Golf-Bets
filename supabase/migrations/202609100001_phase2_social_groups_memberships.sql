-- Phase 2A: additive social, group and entitlement foundation.
-- Do not apply to a shared/Production project without a controlled review.
begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon;

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists social_privacy text not null default 'PRIVATE';
alter table public.profiles drop constraint if exists profiles_social_privacy_check;
alter table public.profiles add constraint profiles_social_privacy_check check (social_privacy in ('PRIVATE', 'FRIENDS')) not valid;
alter table public.profiles validate constraint profiles_social_privacy_check;
create unique index if not exists profiles_username_normalized_uidx
  on public.profiles (lower(regexp_replace(username, '^@+', '')))
  where username is not null and length(trim(username)) > 0;

create table if not exists public.social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null default 'Golfista',
  avatar_url text,
  handicap numeric(5,1),
  club_name text,
  privacy text not null default 'PRIVATE' check (privacy in ('PRIVATE', 'FRIENDS')),
  updated_at timestamptz not null default now(),
  constraint social_profiles_username_check check (username ~ '^[a-z0-9][a-z0-9._]{1,39}$'),
  constraint social_profiles_handicap_check check (handicap is null or handicap between -15 and 36)
);
create unique index if not exists social_profiles_username_uidx on public.social_profiles(lower(username));

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'PENDING' check (state in ('PENDING', 'ACCEPTED', 'REJECTED', 'BLOCKED', 'CANCELLED')),
  operation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_distinct_users check (requester_id <> addressee_id),
  constraint friend_requests_operation_unique unique (requester_id, operation_id)
);
create unique index if not exists friend_requests_open_pair_uidx
  on public.friend_requests (least(requester_id, addressee_id), greatest(requester_id, addressee_id))
  where state = 'PENDING';
create index if not exists friend_requests_addressee_state_idx on public.friend_requests(addressee_id, state, created_at desc);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid references public.friend_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint friendships_sorted_pair_check check (user_a_id::text < user_b_id::text),
  constraint friendships_unique_pair unique (user_a_id, user_b_id)
);

create table if not exists public.blocked_connections (
  owner_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, blocked_user_id),
  constraint blocked_connections_distinct_users check (owner_id <> blocked_user_id)
);

create table if not exists public.recent_players (
  owner_id uuid not null references auth.users(id) on delete cascade,
  peer_user_id uuid not null references auth.users(id) on delete cascade,
  rounds_count integer not null default 1 check (rounds_count >= 1),
  last_played_at timestamptz not null,
  primary key (owner_id, peer_user_id),
  constraint recent_players_distinct_users check (owner_id <> peer_user_id)
);

create table if not exists public.groups_v2 (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 100),
  image_url text,
  privacy text not null default 'MEMBERS' check (privacy in ('PRIVATE', 'MEMBERS')),
  default_course_id text,
  default_template jsonb,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists groups_v2_owner_idx on public.groups_v2(owner_id, updated_at desc);

create table if not exists public.guest_players_v2 (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  handicap numeric(5,1) check (handicap is null or handicap between -15 and 36),
  linked_user_id uuid references auth.users(id) on delete set null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_memberships_v2 (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups_v2(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  guest_player_id uuid references public.guest_players_v2(id) on delete cascade,
  role text not null default 'MEMBER' check (role in ('ADMIN', 'MEMBER')),
  display_name_snapshot text not null,
  joined_at timestamptz not null default now(),
  constraint group_membership_identity_check check ((user_id is not null)::integer + (guest_player_id is not null)::integer = 1)
);
create unique index if not exists group_memberships_v2_user_uidx on public.group_memberships_v2(group_id, user_id) where user_id is not null;
create unique index if not exists group_memberships_v2_guest_uidx on public.group_memberships_v2(group_id, guest_player_id) where guest_player_id is not null;

create table if not exists public.group_memories_v2 (
  group_id uuid not null references public.groups_v2(id) on delete cascade,
  memory_key text not null check (memory_key in ('DEFAULT', 'LAST_ROUND', 'LAST_SUNDAY')),
  template jsonb not null,
  source_round_id uuid references public.rounds_cloud(id) on delete set null,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (group_id, memory_key)
);

create table if not exists public.group_invites_v2 (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups_v2(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete restrict,
  invitee_id uuid references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'PENDING' check (state in ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index if not exists group_invites_v2_target_idx on public.group_invites_v2(group_id, state, expires_at);

create table if not exists public.round_invites_v2 (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds_cloud(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete restrict,
  invitee_id uuid references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'PENDING' check (state in ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.guest_player_claims_v2 (
  id uuid primary key default gen_random_uuid(),
  guest_player_id uuid not null references public.guest_players_v2(id) on delete cascade,
  claimant_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  verification_method text not null check (verification_method in ('SIGNED_INVITE', 'ADMIN_REVIEW')),
  token_hash text check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'PENDING' check (state in ('PENDING', 'VERIFIED', 'REJECTED', 'REVOKED')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  audit jsonb not null default '{}'::jsonb,
  constraint guest_claim_not_self_issued check (claimant_id <> created_by)
);

create table if not exists public.feature_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null default 'BETA_PRO' check (plan_id in ('FREE', 'PRO', 'BETA_PRO')),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

-- Correct a typo defensively if the migration is reviewed/applied as written.
alter table public.feature_entitlements drop constraint if exists feature_entitlements_plan_id_check;
alter table public.feature_entitlements add constraint feature_entitlements_plan_id_check check (plan_id in ('FREE', 'PRO', 'BETA_PRO'));

create table if not exists public.feature_usage_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_id text not null,
  window_kind text not null check (window_kind in ('DAILY', 'MONTHLY', 'LIFETIME')),
  window_key text not null,
  used_count bigint not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature_id, window_kind, window_key)
);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null
);

create or replace function private.is_group_member(target_group_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists(select 1 from public.groups_v2 where id = target_group_id and owner_id = (select auth.uid()))
    or exists(select 1 from public.group_memberships_v2 where group_id = target_group_id and user_id = (select auth.uid()));
$$;
create or replace function private.is_group_manager(target_group_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists(select 1 from public.groups_v2 where id = target_group_id and owner_id = (select auth.uid()))
    or exists(select 1 from public.group_memberships_v2 where group_id = target_group_id and user_id = (select auth.uid()) and role = 'ADMIN');
$$;
create or replace function private.is_app_admin()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists(select 1 from public.app_admins where user_id = (select auth.uid()));
$$;
revoke all on function private.is_group_member(uuid), private.is_group_manager(uuid), private.is_app_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_group_member(uuid), private.is_group_manager(uuid), private.is_app_admin() to authenticated;

create or replace function private.friend_request_transition()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.state <> 'PENDING' then raise exception 'friend request is final'; end if;
  if new.requester_id <> old.requester_id or new.addressee_id <> old.addressee_id then raise exception 'friend identities are immutable'; end if;
  if (select auth.uid()) = old.addressee_id and new.state in ('ACCEPTED', 'REJECTED') then return new; end if;
  if (select auth.uid()) = old.requester_id and new.state = 'CANCELLED' then return new; end if;
  raise exception 'invalid friend request transition';
end;
$$;
drop trigger if exists friend_request_transition_guard on public.friend_requests;
create trigger friend_request_transition_guard before update on public.friend_requests for each row execute function private.friend_request_transition();
revoke all on function private.friend_request_transition() from public, anon, authenticated;

alter table public.social_profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.blocked_connections enable row level security;
alter table public.recent_players enable row level security;
alter table public.groups_v2 enable row level security;
alter table public.guest_players_v2 enable row level security;
alter table public.group_memberships_v2 enable row level security;
alter table public.group_memories_v2 enable row level security;
alter table public.group_invites_v2 enable row level security;
alter table public.round_invites_v2 enable row level security;
alter table public.guest_player_claims_v2 enable row level security;
alter table public.feature_entitlements enable row level security;
alter table public.feature_usage_counters enable row level security;
alter table public.app_admins enable row level security;

create policy social_profiles_discovery on public.social_profiles for select to authenticated
using (user_id = (select auth.uid()) or privacy = 'FRIENDS');
create policy social_profiles_self_insert on public.social_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy social_profiles_self_update on public.social_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy friend_requests_participant_read on public.friend_requests for select to authenticated
using ((select auth.uid()) in (requester_id, addressee_id));
create policy friend_requests_self_insert on public.friend_requests for insert to authenticated
with check (requester_id = (select auth.uid()) and requester_id <> addressee_id and state = 'PENDING');
create policy friend_requests_participant_update on public.friend_requests for update to authenticated
using ((select auth.uid()) in (requester_id, addressee_id)) with check ((select auth.uid()) in (requester_id, addressee_id));

create policy friendships_participant_read on public.friendships for select to authenticated
using ((select auth.uid()) in (user_a_id, user_b_id));
create policy blocked_connections_self on public.blocked_connections for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy recent_players_self_read on public.recent_players for select to authenticated using (owner_id = (select auth.uid()));

create policy groups_v2_member_read on public.groups_v2 for select to authenticated using (private.is_group_member(id));
create policy groups_v2_owner_insert on public.groups_v2 for insert to authenticated with check (owner_id = (select auth.uid()));
create policy groups_v2_manager_update on public.groups_v2 for update to authenticated using (private.is_group_manager(id)) with check (private.is_group_manager(id));
create policy groups_v2_owner_delete on public.groups_v2 for delete to authenticated using (owner_id = (select auth.uid()));

create policy guest_players_v2_owner on public.guest_players_v2 for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy group_memberships_v2_member_read on public.group_memberships_v2 for select to authenticated using (private.is_group_member(group_id));
create policy group_memberships_v2_manager_insert on public.group_memberships_v2 for insert to authenticated with check (private.is_group_manager(group_id));
create policy group_memberships_v2_manager_update on public.group_memberships_v2 for update to authenticated using (private.is_group_manager(group_id)) with check (private.is_group_manager(group_id));
create policy group_memberships_v2_manager_delete on public.group_memberships_v2 for delete to authenticated using (private.is_group_manager(group_id));
create policy group_memories_v2_member_read on public.group_memories_v2 for select to authenticated using (private.is_group_member(group_id));
create policy group_memories_v2_manager_write on public.group_memories_v2 for all to authenticated using (private.is_group_manager(group_id)) with check (private.is_group_manager(group_id) and updated_by = (select auth.uid()));

create policy group_invites_v2_participant_read on public.group_invites_v2 for select to authenticated
using (inviter_id = (select auth.uid()) or invitee_id = (select auth.uid()) or private.is_group_manager(group_id));
create policy group_invites_v2_manager_insert on public.group_invites_v2 for insert to authenticated
with check (inviter_id = (select auth.uid()) and private.is_group_manager(group_id));
create policy group_invites_v2_participant_update on public.group_invites_v2 for update to authenticated
using (inviter_id = (select auth.uid()) or invitee_id = (select auth.uid()))
with check (inviter_id = (select auth.uid()) or invitee_id = (select auth.uid()));
create policy round_invites_v2_participant_read on public.round_invites_v2 for select to authenticated
using (inviter_id = (select auth.uid()) or invitee_id = (select auth.uid()));

create policy guest_claims_v2_participant_read on public.guest_player_claims_v2 for select to authenticated
using ((select auth.uid()) in (claimant_id, created_by));
create policy guest_claims_v2_claimant_insert on public.guest_player_claims_v2 for insert to authenticated
with check (claimant_id = (select auth.uid()) and claimant_id <> created_by and state = 'PENDING');

create policy feature_entitlements_self_read on public.feature_entitlements for select to authenticated using (user_id = (select auth.uid()));
create policy feature_usage_counters_self_read on public.feature_usage_counters for select to authenticated using (user_id = (select auth.uid()));
create policy app_admins_self_read on public.app_admins for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.social_profiles, public.friend_requests, public.friendships,
  public.blocked_connections, public.recent_players, public.groups_v2, public.guest_players_v2,
  public.group_memberships_v2, public.group_memories_v2, public.group_invites_v2,
  public.round_invites_v2, public.guest_player_claims_v2, public.feature_entitlements,
  public.feature_usage_counters, public.app_admins from anon;
grant select, insert, update on public.social_profiles, public.friend_requests to authenticated;
grant select on public.friendships, public.recent_players, public.feature_entitlements, public.feature_usage_counters, public.app_admins to authenticated;
grant select, insert, delete on public.blocked_connections to authenticated;
grant select, insert, update, delete on public.groups_v2, public.guest_players_v2, public.group_memberships_v2, public.group_memories_v2 to authenticated;
grant select, insert, update on public.group_invites_v2, public.round_invites_v2, public.guest_player_claims_v2 to authenticated;

comment on table public.guest_player_claims_v2 is 'Guest claims require signed invitation or admin review; names, HCP and weak similarity never authorize a link.';
comment on table public.feature_entitlements is 'Server-managed plan assignment. BETA_PRO never creates a payment or expiry by itself.';

commit;

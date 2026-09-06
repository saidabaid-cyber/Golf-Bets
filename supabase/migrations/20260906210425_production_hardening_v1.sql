-- The Backyard production hardening V1.
-- Additive only: analytics, sanitized operational errors, admin authorization
-- and activity timestamps. Existing golf data and calculations are untouched.

begin;
set local search_path = public, extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists last_login_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('user', 'admin'));
  end if;
end $$;

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_last_seen_idx on public.profiles(last_seen_at desc);

create or replace function private.current_user_is_backyard_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;
revoke all on function private.current_user_is_backyard_admin() from public, anon;
grant execute on function private.current_user_is_backyard_admin() to authenticated, service_role;

-- The former FOR ALL policy would allow a profile owner to update a future
-- authorization column. Split it and restrict client-writable columns so role
-- can only be changed through a privileged, audited database operation.
drop policy if exists profiles_self on public.profiles;
drop policy if exists profiles_self_read on public.profiles;
drop policy if exists profiles_self_insert on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.current_user_is_backyard_admin()));
create policy profiles_self_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()) and role = 'user');
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke update on table public.profiles from authenticated;
grant update (
  name, handicap, photo_url, display_name, avatar_url, default_handicap,
  onboarding_completed_at, updated_at, last_seen_at, last_login_at,
  version, updated_by_device
) on table public.profiles to authenticated;

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid not null,
  event_name text not null check (length(event_name) between 1 and 80),
  event_category text not null check (length(event_category) between 1 and 40),
  created_at timestamptz not null default now(),
  round_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  app_version text not null default 'unknown',
  build_sha text,
  environment text not null default 'unknown',
  device_type text,
  platform text
);

create index if not exists analytics_events_user_created_idx
  on public.analytics_events(user_id, created_at desc);
create index if not exists analytics_events_created_idx
  on public.analytics_events(created_at desc);
create index if not exists analytics_events_name_created_idx
  on public.analytics_events(event_name, created_at desc);
create index if not exists analytics_events_round_idx
  on public.analytics_events(round_id) where round_id is not null;
create index if not exists analytics_events_session_idx
  on public.analytics_events(session_id, created_at);

create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid,
  created_at timestamptz not null default now(),
  environment text not null default 'unknown',
  route text not null default '/',
  error_type text not null check (length(error_type) between 1 and 80),
  error_code text check (error_code is null or length(error_code) <= 80),
  message_sanitized text not null check (length(message_sanitized) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  app_version text not null default 'unknown',
  build_sha text
);

create index if not exists app_errors_user_created_idx
  on public.app_errors(user_id, created_at desc);
create index if not exists app_errors_created_idx
  on public.app_errors(created_at desc);
create index if not exists app_errors_type_created_idx
  on public.app_errors(error_type, created_at desc);
create index if not exists app_errors_session_idx
  on public.app_errors(session_id, created_at) where session_id is not null;

alter table public.analytics_events enable row level security;
alter table public.app_errors enable row level security;

drop policy if exists analytics_events_insert_guest on public.analytics_events;
drop policy if exists analytics_events_insert_self on public.analytics_events;
drop policy if exists analytics_events_read_self on public.analytics_events;
drop policy if exists analytics_events_read_admin on public.analytics_events;
create policy analytics_events_insert_guest on public.analytics_events
  for insert to anon with check (user_id is null);
create policy analytics_events_insert_self on public.analytics_events
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy analytics_events_read_self on public.analytics_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy analytics_events_read_admin on public.analytics_events
  for select to authenticated using ((select private.current_user_is_backyard_admin()));

drop policy if exists app_errors_insert_guest on public.app_errors;
drop policy if exists app_errors_insert_self on public.app_errors;
drop policy if exists app_errors_read_admin on public.app_errors;
create policy app_errors_insert_guest on public.app_errors
  for insert to anon with check (user_id is null);
create policy app_errors_insert_self on public.app_errors
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy app_errors_read_admin on public.app_errors
  for select to authenticated using ((select private.current_user_is_backyard_admin()));

revoke all on table public.analytics_events, public.app_errors from public, anon, authenticated;
grant insert on table public.analytics_events, public.app_errors to authenticated;
grant select on table public.analytics_events to authenticated;
grant all on table public.analytics_events, public.app_errors to service_role;

create or replace function private.touch_profile_from_analytics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    return new;
  end if;
  if new.event_name in ('app_opened', 'login_completed', 'round_started', 'round_completed') then
    update public.profiles
    set last_seen_at = greatest(coalesce(last_seen_at, new.created_at), new.created_at),
        last_login_at = case
          when new.event_name = 'login_completed'
          then greatest(coalesce(last_login_at, new.created_at), new.created_at)
          else last_login_at
        end
    where id = new.user_id
      and (
        last_seen_at is null
        or last_seen_at <= new.created_at - interval '10 minutes'
        or new.event_name in ('login_completed', 'round_started', 'round_completed')
      );
  end if;
  return new;
end;
$$;
revoke all on function private.touch_profile_from_analytics() from public, anon, authenticated;
grant execute on function private.touch_profile_from_analytics() to service_role;

drop trigger if exists analytics_touch_profile on public.analytics_events;
create trigger analytics_touch_profile
after insert on public.analytics_events
for each row execute function private.touch_profile_from_analytics();

comment on table public.analytics_events is
  'Minimized operational product analytics. No question text, bet amounts, tokens or secrets.';
comment on table public.app_errors is
  'Sanitized operational failures. Full stack traces, credentials and private payloads are forbidden.';
comment on column public.profiles.role is
  'Authorization role. Set to admin only through a privileged manual operation.';

commit;

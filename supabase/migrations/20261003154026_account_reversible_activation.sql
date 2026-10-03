-- PREPARED ONLY: controlled apply required on the shared DEV database.
-- Reversible suspension is separate from deletion/retention jobs. Installation
-- changes zero application rows; it performs no cleanup or reconciliation.
begin;
alter table private.account_lifecycle_state drop constraint if exists account_lifecycle_state_account_status_check;
alter table private.account_lifecycle_state add constraint account_lifecycle_state_account_status_check
  check (account_status in ('closing','archived','deleted','deactivated'));

create table if not exists private.account_activation_security (
  user_id uuid primary key,
  revoked_before timestamptz not null
);
create table if not exists private.account_activation_events (
  request_id uuid primary key,
  user_id uuid not null,
  action text not null check (action in ('deactivate','reactivate')),
  occurred_at timestamptz not null default clock_timestamp()
);
create index if not exists account_activation_events_owner_time on private.account_activation_events(user_id,occurred_at desc);
alter table private.account_activation_security enable row level security;
alter table private.account_activation_events enable row level security;
revoke all on private.account_activation_security, private.account_activation_events from public,anon,authenticated;
grant all on private.account_activation_security, private.account_activation_events to service_role;

-- A pre-deactivation access JWT cannot regain access after reactivation. Merely
-- revoking refresh tokens is insufficient: check its real Auth session and
-- creation time, indexed by session PK. Accounts never suspended are unchanged.
create or replace function private.account_data_access_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is null or (
    exists(select 1 from auth.users where id=(select auth.uid()))
    and not exists(select 1 from private.account_lifecycle_state where user_id=(select auth.uid()))
    and (not exists(select 1 from private.account_activation_security where user_id=(select auth.uid()))
      or exists(select 1 from auth.sessions s join private.account_activation_security a on a.user_id=s.user_id
        where s.user_id=(select auth.uid()) and s.id=nullif((select auth.jwt())->>'session_id','')::uuid
          and s.created_at>a.revoked_before))
  )
$$;

create or replace function public.account_activation_status_v1(requested_user uuid, requested_session uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare status text;
begin
  if not exists(select 1 from auth.users where id=requested_user) then return 'deleted'; end if;
  select account_status into status from private.account_lifecycle_state where user_id=requested_user;
  if status in ('closing','archived','deleted') then return status; end if;
  if not exists(select 1 from auth.sessions where id=requested_session and user_id=requested_user)
    or exists(select 1 from private.account_activation_security a where a.user_id=requested_user
      and not exists(select 1 from auth.sessions s where s.id=requested_session and s.user_id=requested_user and s.created_at>a.revoked_before)) then
    return 'session_expired';
  end if;
  return coalesce(status,'active');
end $$;

create or replace function public.account_activation_change_v1(requested_user uuid, requested_session uuid, requested_action text, requested_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare status text; prior private.account_activation_events%rowtype;
begin
  if requested_action not in ('deactivate','reactivate') or requested_id is null or requested_user is null or requested_session is null then
    raise invalid_parameter_value using message='invalid_activation_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_user::text,619));
  select * into prior from private.account_activation_events where request_id=requested_id;
  if found then
    if prior.user_id<>requested_user or prior.action<>requested_action then raise invalid_parameter_value using message='activation_key_conflict'; end if;
    if requested_action='reactivate' and public.account_activation_status_v1(requested_user,requested_session) not in ('active','deactivated') then
      raise insufficient_privilege using message='activation_access_restricted';
    end if;
    -- Replays report current state, never replay a stale state transition.
    return coalesce((select account_status from private.account_lifecycle_state where user_id=requested_user),'active');
  end if;
  status:=public.account_activation_status_v1(requested_user,requested_session);
  if status not in ('active','deactivated') then raise insufficient_privilege using message='activation_access_restricted'; end if;
  if requested_action='deactivate' then
    if status<>'active' then raise invalid_parameter_value using message='already_deactivated'; end if;
    insert into private.account_lifecycle_state(user_id,account_status,updated_at) values(requested_user,'deactivated',clock_timestamp());
    insert into private.account_activation_security(user_id,revoked_before) values(requested_user,clock_timestamp())
      on conflict(user_id) do update set revoked_before=excluded.revoked_before;
    status:='deactivated';
  else
    if status<>'deactivated' then raise invalid_parameter_value using message='not_deactivated'; end if;
    -- Only the reversible suspension marker is removed, never user data or a
    -- deletion/archive job. Its event and session boundary remain durable.
    delete from private.account_lifecycle_state where user_id=requested_user and account_status='deactivated';
    status:='active';
  end if;
  insert into private.account_activation_events(request_id,user_id,action) values(requested_id,requested_user,requested_action);
  return status;
end $$;
revoke all on function public.account_activation_status_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.account_activation_change_v1(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.account_activation_status_v1(uuid,uuid) to service_role;
grant execute on function public.account_activation_change_v1(uuid,uuid,text,uuid) to service_role;
-- Existing restrictive RLS and pre-request guard use the same private helper;
-- no Auth provider, role, retention rule or PostgREST hook configuration changes.
notify pgrst,'reload schema';
commit;

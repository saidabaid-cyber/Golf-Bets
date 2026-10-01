-- Additive role extension. Apply ONLY to the isolated Admin V2 database.
begin;
alter table public.admin_memberships drop constraint admin_memberships_role_check;
alter table public.admin_memberships add constraint admin_memberships_role_check
  check(role in ('SUPER_ADMIN','ADMIN','COURSE_ADMIN','CATALOG_ADMIN','COMPETITION_ADMIN','SUPPORT_ADMIN','CONTENT_ADMIN'));
alter table public.admin_memberships add column role_changed_at timestamptz;

create or replace function private.admin_has_scope_v1(target_entity text,target_scope_type text,target_scope_id text,target_action text default 'READ')
returns boolean language sql stable security definer set search_path='' as $$
  select target_action in ('READ','CREATE_DRAFT','REVIEW','VERIFY','PUBLISH','ARCHIVE','AUDIT') and exists (
    select 1 from public.admin_memberships m where m.user_id=(select auth.uid()) and m.active and (
      (m.role='SUPER_ADMIN' and m.scope_type='GLOBAL' and m.scope_id is null)
      or ((m.scope_type='GLOBAL' or (m.scope_type=target_scope_type and m.scope_id=target_scope_id))
        and target_action <> 'AUDIT' and case m.role
          when 'ADMIN' then target_entity in ('COURSE','COURSE_CONFIGURATION','LOCAL_RULE_SET','CLUB_EQUIPMENT','BALL','SHAFT','COMPETITION','COMPETITION_RULE_SET','REQUEST','BET_PRESENTATION','APP_CONTENT')
          when 'COURSE_ADMIN' then target_entity in ('COURSE','COURSE_CONFIGURATION','LOCAL_RULE_SET')
          when 'CATALOG_ADMIN' then target_entity in ('CLUB_EQUIPMENT','BALL','SHAFT','EQUIPMENT_IMAGE')
          when 'COMPETITION_ADMIN' then target_entity in ('COMPETITION','COMPETITION_RULE_SET','COURSE_CONFIGURATION')
          when 'SUPPORT_ADMIN' then target_entity='REQUEST' and target_action in ('READ','CREATE_DRAFT','REVIEW')
          when 'CONTENT_ADMIN' then target_entity in ('LOCAL_RULE_SET','COMPETITION_RULE_SET','EQUIPMENT_IMAGE','BET_PRESENTATION','APP_CONTENT')
          else false end)
    )
  );
$$;
revoke all on function private.admin_has_scope_v1(text,text,text,text) from public,anon;
grant execute on function private.admin_has_scope_v1(text,text,text,text) to authenticated,service_role;

create function private.admin_application_role_v2() returns text
language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from public.admin_memberships where user_id=(select auth.uid()) and active and role='SUPER_ADMIN' and scope_type='GLOBAL' and scope_id is null) then 'SUPER_ADMIN'
    when exists(select 1 from public.admin_memberships where user_id=(select auth.uid()) and active and role<>'SUPER_ADMIN') then 'ADMIN' else 'PLAYER' end;
$$;
revoke all on function private.admin_application_role_v2() from public,anon;
grant execute on function private.admin_application_role_v2() to authenticated;

-- No membership bootstrap by email: existing SUPER_ADMIN rows remain intact.
-- Clients cannot insert/update memberships directly. Role changes use the next
-- migration's SUPER_ADMIN-only transactional RPC, with immutable audit records.
revoke insert,update,delete on public.admin_memberships from anon,authenticated;
drop policy admin_memberships_self_read on public.admin_memberships;
create policy admin_memberships_self_read on public.admin_memberships for select to authenticated
using(user_id=(select auth.uid()) or private.admin_application_role_v2()='SUPER_ADMIN');
commit;

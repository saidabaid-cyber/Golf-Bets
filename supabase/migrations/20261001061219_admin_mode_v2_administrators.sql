begin;
create or replace function private.admin_application_role_v2() returns text
language sql stable security definer set search_path='' as $$
  select case when not private.account_data_access_allowed() then 'PLAYER'
    when exists(select 1 from public.admin_memberships where user_id=(select auth.uid()) and active and role='SUPER_ADMIN' and scope_type='GLOBAL' and scope_id is null) then 'SUPER_ADMIN'
    when exists(select 1 from public.admin_memberships where user_id=(select auth.uid()) and active and role<>'SUPER_ADMIN') then 'ADMIN' else 'PLAYER' end;
$$;

create function public.admin_user_directory_v2(search_text text default '',page_offset integer default 0)
returns table(user_id uuid,display_name text,username text,email text,role text,account_status text,role_changed_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare viewer text := private.admin_application_role_v2();
begin
  if viewer='PLAYER' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if length(search_text)>160 or page_offset<0 or page_offset>100000 then raise exception 'INVALID_SEARCH'; end if;
  return query select u.id,coalesce(p.display_name,p.name,'Jugador'),p.username,
    case when viewer='SUPER_ADMIN' then u.email::text else null end,
    case when exists(select 1 from public.admin_memberships m where m.user_id=u.id and m.active and m.role='SUPER_ADMIN' and m.scope_type='GLOBAL') then 'SUPER_ADMIN'
      when exists(select 1 from public.admin_memberships m where m.user_id=u.id and m.active) then 'ADMIN' else 'PLAYER' end,
    case when private.account_subject_active(u.id) and (u.banned_until is null or u.banned_until<now()) then 'Activo' else 'No disponible' end,
    (select max(coalesce(m.role_changed_at,m.created_at)) from public.admin_memberships m where m.user_id=u.id)
    from auth.users u left join public.profiles p on p.id=u.id
    where not coalesce(u.is_anonymous,false) and (search_text='' or strpos(lower(coalesce(p.display_name,p.name,'')),lower(search_text))>0
      or strpos(lower(coalesce(p.username,'')),lower(search_text))>0
      or (viewer='SUPER_ADMIN' and strpos(lower(coalesce(u.email::text,'')),lower(search_text))>0))
    order by coalesce(p.display_name,p.name,''),u.id limit 40 offset page_offset;
end;
$$;
revoke all on function public.admin_user_directory_v2(text,integer) from public,anon;
grant execute on function public.admin_user_directory_v2(text,integer) to authenticated;

create unique index admin_v2_role_request_idx on public.admin_audit_log(actor_id,request_id)
where action='CHANGE_APPLICATION_ROLE' and request_id is not null;

create function public.admin_change_role_v2(target_user_id uuid,expected_role text,new_role text,change_reason text,operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior_role text; prior_log public.admin_audit_log; result jsonb;
begin
  if private.admin_application_role_v2()<>'SUPER_ADMIN' then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
  if new_role not in ('PLAYER','ADMIN') or expected_role not in ('PLAYER','ADMIN') or new_role is null or expected_role is null
    or operation_id is null or length(trim(coalesce(change_reason,''))) not between 3 and 1000 then raise exception 'INVALID_ROLE_CHANGE'; end if;
  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text||operation_id::text,0));
  select * into prior_log from public.admin_audit_log where actor_id=(select auth.uid()) and request_id=operation_id and action='CHANGE_APPLICATION_ROLE';
  if found then
    if prior_log.entity_id<>target_user_id::text or prior_log.after_state->>'role'<>new_role then raise exception 'OPERATION_REUSED'; end if;
    return prior_log.after_state;
  end if;
  perform 1 from auth.users where id=target_user_id and not coalesce(is_anonymous,false) for update;
  if not found or not private.account_subject_active(target_user_id) then raise exception 'USER_NOT_AVAILABLE'; end if;
  if exists(select 1 from public.admin_memberships where user_id=target_user_id and role='SUPER_ADMIN' and active) then raise exception 'SUPER_ADMIN_PROTECTED' using errcode='42501'; end if;
  prior_role := case when exists(select 1 from public.admin_memberships where user_id=target_user_id and active) then 'ADMIN' else 'PLAYER' end;
  if prior_role<>expected_role then raise exception 'ROLE_CHANGED_RELOAD' using errcode='40001'; end if;
  if prior_role=new_role then return jsonb_build_object('userId',target_user_id,'role',new_role,'unchanged',true); end if;
  update public.admin_memberships set active=false,role_changed_at=now() where user_id=target_user_id and active;
  if new_role='ADMIN' then
    insert into public.admin_memberships(user_id,role,scope_type,active,created_by,role_changed_at)
      values(target_user_id,'ADMIN','GLOBAL',true,(select auth.uid()),now());
  end if;
  result:=jsonb_build_object('userId',target_user_id,'role',new_role,'changedAt',now());
  perform private.admin_audit_v1('CHANGE_APPLICATION_ROLE','USER_ROLE',target_user_id::text,jsonb_build_object('role',prior_role),result,change_reason,operation_id);
  return result;
end;
$$;
revoke all on function public.admin_change_role_v2(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.admin_change_role_v2(uuid,text,text,text,uuid) to authenticated;
commit;

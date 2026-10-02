-- Portable replacement for the rejected 20261001065019 guard.
-- No account actions, cleanup, seed data or environment binding are executed.
begin;
create or replace function private.admin_has_scope_v1(target_entity text,target_scope_type text,target_scope_id text,target_action text default 'READ')
returns boolean language sql stable security definer set search_path='' as $$
  select private.account_data_access_allowed() and target_action in ('READ','CREATE_DRAFT','REVIEW','VERIFY','PUBLISH','ARCHIVE','AUDIT') and exists (
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

create or replace function private.admin_engine_fields_v2(candidate jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object(
 'engineContract',jsonb_path_query_array(candidate,'$.**.engineContract'),
 'engineAdapter',jsonb_path_query_array(candidate,'$.**.engineAdapter'),
 'algorithm',jsonb_path_query_array(candidate,'$.**.algorithm'),
 'settlement',jsonb_path_query_array(candidate,'$.**.settlement'),
 'strokeAllocation',jsonb_path_query_array(candidate,'$.**.strokeAllocation'),
 'formula',jsonb_path_query_array(candidate,'$.**.formula'),
 'code',jsonb_path_query_array(candidate,'$.**.code'),
 'javascript',jsonb_path_query_array(candidate,'$.**.javascript'));
$$;
revoke all on function private.admin_engine_fields_v2(jsonb) from public,anon;
grant execute on function private.admin_engine_fields_v2(jsonb) to authenticated;
create or replace function private.admin_guard_engine_fields_v2() returns trigger
language plpgsql security definer set search_path='' as $$
declare baseline jsonb;
begin
  if private.admin_application_role_v2()='SUPER_ADMIN' then return new; end if;
  select payload into baseline from public.admin_catalog_revisions where entity_type=new.entity_type and entity_id=new.entity_id and status='PUBLISHED' order by version desc limit 1;
  if private.admin_engine_fields_v2(new.payload) is distinct from private.admin_engine_fields_v2(coalesce(baseline,'{}'::jsonb)) then raise exception 'ENGINE_CHANGE_REQUIRES_DEVELOPMENT' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function private.admin_guard_engine_fields_v2() from public,anon,authenticated;
drop trigger if exists admin_v2_engine_guard on public.admin_catalog_revisions;
create trigger admin_v2_engine_guard before insert or update of payload on public.admin_catalog_revisions
for each row execute function private.admin_guard_engine_fields_v2();

create or replace function private.admin_guard_competition_engine_v2() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if private.admin_application_role_v2()='SUPER_ADMIN' then return new; end if;
 if tg_op='UPDATE' then
   if new.engine_contract is distinct from old.engine_contract then raise exception 'ENGINE_CHANGE_REQUIRES_DEVELOPMENT' using errcode='42501'; end if;
 elsif new.engine_contract is not null and not exists(
   select 1 from public.competition_rules prior join public.competition_rule_sets previous on previous.id=prior.rule_set_id
   join public.competition_rule_sets current_set on current_set.id=new.rule_set_id
   where previous.competition_id=current_set.competition_id and previous.version<current_set.version
     and prior.category=new.category and prior.title=new.title and prior.engine_contract=new.engine_contract
 ) then raise exception 'ENGINE_CHANGE_REQUIRES_DEVELOPMENT' using errcode='42501'; end if;
 return new;
end;
$$;
revoke all on function private.admin_guard_competition_engine_v2() from public,anon,authenticated;
drop trigger if exists admin_v2_competition_engine_guard on public.competition_rules;
create trigger admin_v2_competition_engine_guard before insert or update of engine_contract on public.competition_rules
for each row execute function private.admin_guard_competition_engine_v2();

-- Preserve the existing permissive ownership policies. These restrictions
-- separate global catalog administration from a player's private manual rows.
-- They grant no new personal operations and never authorize by email/JWT metadata.
do $$ declare relation text; personal text; restriction text; begin
 foreach relation in array array['golf_clubs','golf_courses','golf_course_tees','golf_holes','golf_tee_hole_yardages','golf_hole_geo_features','golf_club_catalog','golf_ball_catalog','golf_shaft_catalog','golf_club_brands','golf_ball_brands','golf_shaft_brands'] loop
  if to_regclass('public.'||relation) is not null then
   personal:=case
    when relation in ('golf_clubs','golf_courses') then
     'created_by=(select auth.uid()) and provider=''USER_MANUAL'' and visibility=''PRIVATE'''
    when relation in ('golf_course_tees','golf_holes','golf_tee_hole_yardages') then
     format('%I.provider=''USER_MANUAL'' and exists(select 1 from public.golf_courses c where c.id=%I.course_id and c.created_by=(select auth.uid()) and c.provider=''USER_MANUAL'' and c.visibility=''PRIVATE'')',relation,relation)
    when relation='golf_hole_geo_features' then
     'golf_hole_geo_features.provider=''USER_MANUAL'' and exists(select 1 from public.golf_holes h join public.golf_courses c on c.id=h.course_id where h.id=golf_hole_geo_features.hole_id and c.created_by=(select auth.uid()) and c.provider=''USER_MANUAL'' and c.visibility=''PRIVATE'')'
    else 'false' end;
   restriction:=format('private.account_data_access_allowed() and (private.admin_application_role_v2()=''SUPER_ADMIN'' or (%s))',personal);
   execute format('drop policy if exists admin_v2_base_insert on public.%I',relation);
   execute format('drop policy if exists admin_v2_base_update on public.%I',relation);
   execute format('drop policy if exists admin_v2_preserve_history on public.%I',relation);
   execute format('create policy admin_v2_base_insert on public.%I as restrictive for insert to authenticated with check(%s)',relation,restriction);
   execute format('create policy admin_v2_base_update on public.%I as restrictive for update to authenticated using(%s) with check(%s)',relation,restriction,restriction);
   execute format('create policy admin_v2_preserve_history on public.%I as restrictive for delete to authenticated using(false)',relation);
  end if;
 end loop;
end $$;

-- Direct writes to operation tables still obey the existing version guards.
-- A revoked/deleting account must also fail RLS when bypassing HTTP endpoints.
do $$declare relation text;begin
 foreach relation in array array['admin_memberships','admin_catalog_revisions','course_configurations','course_configuration_holes','course_configuration_tee_holes','course_configuration_ratings','course_local_rule_sets','course_local_rules','competition_definitions','competition_rule_sets','competition_rules','admin_import_jobs','admin_import_rows','admin_request_drafts','admin_audit_log','course_scorecard_profiles','course_scorecard_profile_tees','course_scorecard_profile_holes'] loop
   execute format('drop policy if exists admin_v2_account_active on public.%I',relation);
   execute format('create policy admin_v2_account_active on public.%I as restrictive for all to authenticated using(private.account_data_access_allowed()) with check(private.account_data_access_allowed())',relation);
 end loop;
end$$;

-- Global administration never projects over player-owned manual courses.
-- The normal player's ownership/RLS path above remains independent.
create or replace function private.admin_assert_global_course_v2(course_key text,club_key text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.golf_courses where id=course_key and provider='USER_MANUAL' and visibility='PRIVATE')
 or exists(select 1 from public.golf_clubs where id=club_key and provider='USER_MANUAL' and visibility='PRIVATE') then
  raise exception 'PERSONAL_COURSE_NOT_GLOBAL_CATALOG' using errcode='42501';
 end if;
end $$;
revoke all on function private.admin_assert_global_course_v2(text,text) from public,anon,authenticated;
create or replace function private.admin_global_course_revision_guard_v2() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.entity_type='COURSE' then
  perform private.admin_assert_global_course_v2(new.entity_id,new.payload->>'clubId');
 elsif new.entity_type in ('COURSE_CONFIGURATION','LOCAL_RULE_SET') then
  perform private.admin_assert_global_course_v2(new.payload->>'courseId');
 end if;
 return new;
end $$;
revoke all on function private.admin_global_course_revision_guard_v2() from public,anon,authenticated;
drop trigger if exists admin_global_course_revision_guard_v2 on public.admin_catalog_revisions;
create trigger admin_global_course_revision_guard_v2 before insert or update on public.admin_catalog_revisions
for each row execute function private.admin_global_course_revision_guard_v2();

-- One-time operator bootstrap for a fresh, isolated Auth database. It is never
-- callable with a player's or administrator's JWT and uses no email allowlist.
create or replace function public.admin_bootstrap_super_v2(target_user_id uuid,bootstrap_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'OPERATOR_REQUIRED' using errcode='42501'; end if;
 if length(trim(coalesce(bootstrap_reason,''))) not between 10 and 1000 then raise exception 'BOOTSTRAP_REASON_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('admin-v2-initial-super-admin',0));
 if exists(select 1 from public.admin_memberships where active and role='SUPER_ADMIN') then raise exception 'INITIAL_SUPER_ALREADY_PRESENT'; end if;
 perform 1 from auth.users where id=target_user_id and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<now()) for update;
 if not found or not private.account_subject_active(target_user_id) then raise exception 'REAL_USER_REQUIRED'; end if;
 insert into public.admin_memberships(user_id,role,scope_type,active,role_changed_at) values(target_user_id,'SUPER_ADMIN','GLOBAL',true,now());
 insert into public.admin_audit_log(actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,reason)
 values(null,'SERVICE_ROLE','BOOTSTRAP_SUPER_ADMIN','USER_ROLE',target_user_id::text,jsonb_build_object('role','PLAYER'),jsonb_build_object('role','SUPER_ADMIN'),bootstrap_reason);
 return jsonb_build_object('userId',target_user_id,'role','SUPER_ADMIN');
end;
$$;
revoke all on function public.admin_bootstrap_super_v2(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_bootstrap_super_v2(uuid,text) to service_role;
commit;

begin;
create or replace function private.admin_has_scope_v1(target_entity text,target_scope_type text,target_scope_id text,target_action text default 'READ')
returns boolean language sql stable security definer set search_path='' as $$
  select private.account_data_access_allowed() and target_action in ('READ','CREATE_DRAFT','REVIEW','VERIFY','PUBLISH','ARCHIVE','AUDIT') and exists (
    select 1 from public.admin_memberships m where m.user_id=(select auth.uid()) and m.active and (
      (m.role='SUPER_ADMIN' and m.scope_type='GLOBAL' and m.scope_id is null)
      or ((m.scope_type='GLOBAL' or (m.scope_type=target_scope_type and m.scope_id=target_scope_id))
        and target_action <> 'AUDIT' and case m.role
          when 'ADMIN' then target_entity in ('COURSE','COURSE_CONFIGURATION','LOCAL_RULE_SET','CLUB_EQUIPMENT','BALL','SHAFT','COMPETITION','COMPETITION_RULE_SET','REQUEST','BET_PRESENTATION','APP_CONTENT')
          when 'COURSE_ADMIN' then target_entity in ('COURSE','COURSE_CONFIGURATION','LOCAL_RULE_SET','IMPORT')
          when 'CATALOG_ADMIN' then target_entity in ('CLUB_EQUIPMENT','BALL','SHAFT','EQUIPMENT_IMAGE','IMPORT')
          when 'COMPETITION_ADMIN' then target_entity in ('COMPETITION','COMPETITION_RULE_SET','COURSE_CONFIGURATION')
          when 'SUPPORT_ADMIN' then target_entity='REQUEST' and target_action in ('READ','CREATE_DRAFT','REVIEW')
          when 'CONTENT_ADMIN' then target_entity in ('LOCAL_RULE_SET','COMPETITION_RULE_SET','EQUIPMENT_IMAGE','BET_PRESENTATION','APP_CONTENT')
          else false end)
    )
  );
$$;
revoke all on function private.admin_has_scope_v1(text,text,text,text) from public,anon;
grant execute on function private.admin_has_scope_v1(text,text,text,text) to authenticated,service_role;

create function private.admin_engine_fields_v2(candidate jsonb) returns jsonb
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
create function private.admin_guard_engine_fields_v2() returns trigger
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
create trigger admin_v2_engine_guard before insert or update of payload on public.admin_catalog_revisions
for each row execute function private.admin_guard_engine_fields_v2();

-- Direct writes to operation tables still obey the existing version guards.
-- A revoked/deleting account must also fail RLS when bypassing HTTP endpoints.
do $$declare relation text;begin
 foreach relation in array array['admin_memberships','admin_catalog_revisions','course_configurations','course_configuration_holes','course_configuration_tee_holes','course_configuration_ratings','course_local_rule_sets','course_local_rules','competition_definitions','competition_rule_sets','competition_rules','admin_import_jobs','admin_import_rows','admin_request_drafts','admin_audit_log','course_scorecard_profiles','course_scorecard_profile_tees','course_scorecard_profile_holes'] loop
   execute format('create policy admin_v2_account_active on public.%I as restrictive for all to authenticated using(private.account_data_access_allowed()) with check(private.account_data_access_allowed())',relation);
 end loop;
end$$;
commit;

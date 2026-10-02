-- QA-only, non-destructive integration proof. All role/state writes roll back.
begin;
do $$ begin if not exists(select 1 from private.admin_mode_v2_qa_binding where singleton and enabled and project_ref='gvzeymebltssgjkvksxt') then raise exception 'ISOLATED_ADMIN_QA_REQUIRED';end if;end $$;
select set_config('request.jwt.claim.sub','9aaec38b-7a84-4c72-bf2c-5f7da8f45782',true);
set local role authenticated;
do $$ begin
 begin perform public.admin_change_role_v2('84583e0a-499d-452e-abff-24fd9ff2aa65','PLAYER','SUPER_ADMIN','QA protected promotion',gen_random_uuid());raise exception 'ADMIN_PROMOTED_SUPER';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','65f0aff8-67aa-46d3-91e5-386caf9b2e95',true);
set local role authenticated;
select public.admin_change_role_v2('84583e0a-499d-452e-abff-24fd9ff2aa65','PLAYER','ADMIN','QA assign and read back',gen_random_uuid());
reset role;
do $$ begin if not exists(select 1 from public.admin_memberships where user_id='84583e0a-499d-452e-abff-24fd9ff2aa65' and active and role='ADMIN') then raise exception 'ROLE_WRITE_READBACK_FAILED';end if;end $$;
set local role authenticated;
select public.admin_change_role_v2('84583e0a-499d-452e-abff-24fd9ff2aa65','ADMIN','PLAYER','QA revoke and read back',gen_random_uuid());
reset role;
do $$ begin
 if exists(select 1 from public.admin_memberships where user_id='84583e0a-499d-452e-abff-24fd9ff2aa65' and active) then raise exception 'ROLE_REVOKE_READBACK_FAILED';end if;
 if (select count(*) from public.admin_audit_log where action='CHANGE_APPLICATION_ROLE' and entity_id='84583e0a-499d-452e-abff-24fd9ff2aa65' and reason in ('QA assign and read back','QA revoke and read back'))<>2 then raise exception 'ROLE_AUDIT_FAILED';end if;
end $$;
select set_config('request.jwt.claim.sub','9aaec38b-7a84-4c72-bf2c-5f7da8f45782',true);
set local role authenticated;
select public.admin_competition_status_v3('dc2a60f1-1ce9-409b-b265-487003ed585b','PUBLISHED','DRAFT','QA unpublish transaction');
select public.admin_catalog_lifecycle_v3('COMPETITION','dc2a60f1-1ce9-409b-b265-487003ed585b','archive','QA archive transaction');
reset role;
do $$ begin
 if not exists(select 1 from public.competition_definitions where id='dc2a60f1-1ce9-409b-b265-487003ed585b' and status='ARCHIVED') then raise exception 'COMPETITION_READBACK_FAILED';end if;
 if not exists(select 1 from public.admin_audit_log where entity_id='dc2a60f1-1ce9-409b-b265-487003ed585b' and action='CHANGE_COMPETITION_STATUS' and reason='QA unpublish transaction') then raise exception 'COMPETITION_AUDIT_FAILED';end if;
end $$;
rollback;

begin;
insert into public.feedback_requests(id,user_id,category,payload,status,request_status,title,description,contextual_category,data_environment)
select '61128eed-1992-4f90-bde8-f5cc8df8a747','84583e0a-499d-452e-abff-24fd9ff2aa65',category,'{}',status,'NEW','Transient QA request','Transaction rollback','BALL','QA' from public.feedback_requests limit 1;
select set_config('request.jwt.claim.sub','9aaec38b-7a84-4c72-bf2c-5f7da8f45782',true);
set local role authenticated;
do $$ declare draft public.admin_catalog_revisions;preview jsonb;payload jsonb;begin
 perform public.admin_review_request_v2('61128eed-1992-4f90-bde8-f5cc8df8a747','NEW','APPROVED','Transient QA approve');
 select r.payload into payload from public.admin_catalog_revisions r where entity_type='BALL' and status='PUBLISHED' limit 1;
 payload:=payload||jsonb_build_object('id','qa-transient-request-ball','model','Transient QA request ball','fitEligible',false,'active',false,'dataEnvironment','PRODUCTION');
 draft:=public.admin_create_revision_v1('BALL','qa-transient-request-ball','CATALOG','equipment',payload,'ADMIN_RESEARCH','Transient QA verified source',null,'VERIFIED',now(),null,null);
 perform public.admin_link_request_revision_v3('61128eed-1992-4f90-bde8-f5cc8df8a747',draft.id);
 if not exists(select 1 from jsonb_array_elements(public.admin_simple_request_queue_v2()->'items') r where r->>'id'='61128eed-1992-4f90-bde8-f5cc8df8a747' and r->>'request_status'='APPROVED') then raise exception 'REQUEST_RESOLVED_BEFORE_PUBLICATION';end if;
 preview:=public.admin_prepare_revision_v1(draft.id);
 perform public.admin_transition_revision_v1(draft.id,'REVIEWED','Transient QA review',gen_random_uuid());
 perform public.admin_transition_revision_v1(draft.id,'VERIFIED','Transient QA verification',gen_random_uuid());
 perform public.admin_publish_revision_v1(draft.id,preview->>'previewHash','Transient QA publication',gen_random_uuid());
 if not exists(select 1 from jsonb_array_elements(public.admin_simple_request_queue_v2()->'items') r where r->>'id'='61128eed-1992-4f90-bde8-f5cc8df8a747' and r->>'request_status'='RESOLVED') then raise exception 'RESOLUTION_READBACK_FAILED';end if;
end $$;
reset role;
do $$ begin if not exists(select 1 from public.admin_audit_log where action='RESOLVE_REQUEST_WITH_RECORD' and entity_id='61128eed-1992-4f90-bde8-f5cc8df8a747') then raise exception 'AUDIT_FAILED';end if;end $$;
rollback;


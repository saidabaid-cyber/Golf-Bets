-- Non-destructive integration test: all fixture writes and deletes roll back.
begin;
insert into public.golf_courses(id,club_id,name,holes,active,visibility,catalog_metadata)
select 'qa-ux-unused-course',id,'QA UX transient unused',9,true,'PRIVATE','{"dataEnvironment":"TEST"}' from public.golf_clubs order by id limit 1;
insert into public.golf_courses(id,club_id,name,holes,active,visibility,catalog_metadata)
select 'qa-ux-referenced-course',id,'QA UX transient referenced',9,true,'PRIVATE','{"dataEnvironment":"TEST"}' from public.golf_clubs order by id limit 1;
insert into public.golf_club_brands(id,name) values('qa-ux-transient-brand','QA Transient');
insert into public.golf_club_catalog(id,brand,brand_id,model,category,source_name,source_url,verified_at)
select fixture.id,'QA Transient','qa-ux-transient-brand',fixture.model,'DRIVER','Transient test','https://example.invalid',now()
from (select 1) source
cross join (values('qa-ux-unused-equipment','QA Transient Unused'),('qa-ux-referenced-equipment','QA Transient Referenced')) fixture(id,model);
insert into public.player_clubs(user_id,local_id,catalog_club_id,category) values('84583e0a-499d-452e-abff-24fd9ff2aa65','qa-ux-transient-club','qa-ux-referenced-equipment','DRIVER');
insert into public.rounds_cloud(id,owner_id,local_round_id,local_id,snapshot) values(gen_random_uuid(),'9aaec38b-7a84-4c72-bf2c-5f7da8f45782','qa-ux-transient-round','qa-ux-transient-round','{"course":{"id":"qa-ux-referenced-course"}}');
select set_config('request.jwt.claim.sub','9aaec38b-7a84-4c72-bf2c-5f7da8f45782',true);
select set_config('request.jwt.claims','{"sub":"9aaec38b-7a84-4c72-bf2c-5f7da8f45782","role":"authenticated"}',true);
set local role authenticated;
do $$ declare result jsonb; begin
 result:=public.admin_catalog_lifecycle_v3('COURSE','qa-ux-unused-course','inspect');
 if result->>'canDelete'<>'true' then raise exception 'UNUSED_INSPECTION_FAILED: %',result;end if;
 result:=public.admin_catalog_lifecycle_v3('COURSE','qa-ux-unused-course','archive','Transient integration QA');
 if result->>'state'<>'ARCHIVED' then raise exception 'ARCHIVE_FAILED';end if;
 result:=public.admin_catalog_lifecycle_v3('COURSE','qa-ux-unused-course','activate','Transient integration QA');
 if result->>'state'<>'ACTIVE' then raise exception 'ACTIVATE_FAILED';end if;
 result:=public.admin_catalog_lifecycle_v3('COURSE','qa-ux-referenced-course','delete','Transient integration QA');
 if result->>'blocked'<>'true' then raise exception 'REFERENCED_DELETE_NOT_BLOCKED';end if;
 result:=public.admin_catalog_lifecycle_v3('COURSE','qa-ux-unused-course','delete','Transient integration QA');
 if result->>'state'<>'DELETED' then raise exception 'UNUSED_DELETE_FAILED';end if;
 result:=public.admin_catalog_lifecycle_v3('CLUB_EQUIPMENT','qa-ux-referenced-equipment','delete','Transient integration QA');
 if result->>'blocked'<>'true' then raise exception 'REFERENCED_EQUIPMENT_NOT_PROTECTED';end if;
 result:=public.admin_catalog_lifecycle_v3('CLUB_EQUIPMENT','qa-ux-unused-equipment','archive','Transient integration QA');
 if result->>'state'<>'ARCHIVED' then raise exception 'EQUIPMENT_ARCHIVE_FAILED';end if;
 result:=public.admin_catalog_lifecycle_v3('CLUB_EQUIPMENT','qa-ux-unused-equipment','delete','Transient integration QA');
 if result->>'state'<>'DELETED' then raise exception 'EQUIPMENT_DELETE_FAILED';end if;
end $$;
select set_config('request.jwt.claim.sub','84583e0a-499d-452e-abff-24fd9ff2aa65',true);
do $$ begin
 begin perform public.admin_catalog_lifecycle_v3('COURSE','qa-ux-referenced-course','archive','Forbidden QA write');raise exception 'PLAYER_WRITE_ALLOWED';
 exception when insufficient_privilege then null;end;
end $$;
rollback;

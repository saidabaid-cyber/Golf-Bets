-- Portable schema/logic replacement; installs no fixtures or automatic data actions.
begin;
create or replace function public.admin_link_request_revision_v3(feedback_id uuid,revision_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request_row public.feedback_requests;revision public.admin_catalog_revisions;link public.admin_request_drafts;category text;
begin
 if not private.account_data_access_allowed() or not private.admin_has_scope_v1('REQUEST','GLOBAL',null,'CREATE_DRAFT') then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
 select * into request_row from public.feedback_requests where id=feedback_id for update;
 select * into revision from public.admin_catalog_revisions where id=revision_key for update;
 if request_row.id is null or request_row.request_status<>'APPROVED' or not (request_row.data_environment=private.admin_request_environment_v2()) then raise exception 'APPROVED_REQUEST_REQUIRED';end if;
 if revision.id is null or revision.status<>'DRAFT' or revision.entity_type not in ('COURSE','BALL','CLUB_EQUIPMENT','SHAFT') or not private.admin_has_scope_v1(revision.entity_type,revision.scope_type,revision.scope_id,'CREATE_DRAFT') then raise exception 'DRAFT_NOT_AVAILABLE';end if;
 category:=lower(coalesce(request_row.contextual_category,''));
 if category not in ('general','catalog','catalogue') and not (
   revision.entity_type='COURSE' and category~'(course|campo)'
   or revision.entity_type='BALL' and category~'(ball|bola)'
   or revision.entity_type in ('CLUB_EQUIPMENT','SHAFT') and category~'(equipment|club|shaft|baston|bastón|varilla)')
 then raise exception 'REQUEST_CATEGORY_MISMATCH';end if;
 if exists(select 1 from public.admin_request_drafts where feedback_request_id=feedback_id and status='PUBLISHED') then raise exception 'REQUEST_ALREADY_PUBLISHED';end if;
 insert into public.admin_request_drafts(feedback_request_id,entity_type,revision_id,status,created_by)
 values(feedback_id,revision.entity_type,revision.id,'DRAFT',(select auth.uid()))
 on conflict(feedback_request_id,entity_type) do update set revision_id=excluded.revision_id,status='DRAFT'
 returning * into link;
 return jsonb_build_object('id',link.id,'requestId',feedback_id,'status','DRAFT');
end $$;
revoke all on function public.admin_link_request_revision_v3(uuid,uuid) from public,anon;
grant execute on function public.admin_link_request_revision_v3(uuid,uuid) to authenticated;
create or replace function private.admin_resolve_published_request_v3()
returns trigger language plpgsql security definer set search_path='' as $$
declare link public.admin_request_drafts;prior public.feedback_requests;
begin
 if new.status<>'PUBLISHED' or old.status='PUBLISHED' then return new;end if;
 for link in select l.* from public.admin_request_drafts l join public.admin_catalog_revisions r on r.id=l.revision_id
   where r.entity_type=new.entity_type and r.entity_id=new.entity_id and l.status<>'PUBLISHED' for update of l
 loop
   if not private.account_data_access_allowed() or not private.admin_has_scope_v1('REQUEST','GLOBAL',null,'REVIEW') then raise exception 'REQUEST_REVIEW_REQUIRED' using errcode='42501';end if;
   select * into prior from public.feedback_requests where id=link.feedback_request_id for update;
   if prior.id is null or prior.request_status not in ('APPROVED','IN_REVIEW') or prior.data_environment<>private.admin_request_environment_v2() then raise exception 'APPROVED_REQUEST_REQUIRED';end if;
   update public.feedback_requests set request_status='RESOLVED',resolved_at=now(),updated_at=now() where id=prior.id;
   update public.admin_request_drafts set revision_id=new.id,status='PUBLISHED' where id=link.id;
   perform private.admin_audit_v1('RESOLVE_REQUEST_WITH_RECORD','REQUEST',prior.id::text,jsonb_build_object('status',prior.request_status),jsonb_build_object('status','RESOLVED','entityType',new.entity_type,'entityId',new.entity_id),'Registro verificado y publicado',new.id);
 end loop;
 return new;
end $$;
revoke all on function private.admin_resolve_published_request_v3() from public,anon,authenticated;
drop trigger if exists admin_resolve_published_request_v3 on public.admin_catalog_revisions;
create trigger admin_resolve_published_request_v3 after update of status on public.admin_catalog_revisions for each row execute function private.admin_resolve_published_request_v3();
commit;

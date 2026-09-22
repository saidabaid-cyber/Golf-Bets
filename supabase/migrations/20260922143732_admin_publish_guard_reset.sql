-- The internal publication marker must never outlive the publication RPC.
-- Keeping it transaction-local was insufficient when a caller performed a
-- second statement in the same transaction.
create or replace function public.admin_publish_revision_v1(revision_id uuid,expected_preview_hash text,publish_reason text,request_id uuid)
returns public.admin_catalog_revisions language plpgsql security invoker set search_path=''
as $$
declare prior public.admin_catalog_revisions; changed public.admin_catalog_revisions; computed_hash text; publish_from timestamptz;
begin
  select * into prior from public.admin_catalog_revisions where id=revision_id for update;
  if not found then raise exception 'REVISION_NOT_FOUND' using errcode='P0002'; end if;
  if prior.status<>'VERIFIED' or prior.provenance_status<>'VERIFIED' then raise exception 'VERIFICATION_REQUIRED'; end if;
  if not private.admin_has_scope_v1(prior.entity_type,prior.scope_type,prior.scope_id,'PUBLISH') then raise exception 'PUBLISH_FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(publish_reason,'')))<3 then raise exception 'REASON_REQUIRED'; end if;
  computed_hash:=encode(extensions.digest(convert_to(prior.payload::text,'UTF8'),'sha256'),'hex');
  if expected_preview_hash is null or prior.preview_hash is distinct from expected_preview_hash or computed_hash<>expected_preview_hash then raise exception 'STALE_PREVIEW'; end if;
  publish_from:=coalesce(prior.effective_from,now());
  if prior.effective_until is not null and prior.effective_until<=publish_from then raise exception 'INVALID_EFFECTIVE_WINDOW'; end if;
  perform pg_advisory_xact_lock(hashtextextended(prior.entity_type||':'||prior.entity_id,0));
  if exists(
    select 1 from public.admin_catalog_revisions existing
    where existing.id<>prior.id and existing.entity_type=prior.entity_type and existing.entity_id=prior.entity_id
      and existing.status='PUBLISHED' and existing.effective_from>=publish_from
      and tstzrange(existing.effective_from,existing.effective_until,'[)') && tstzrange(publish_from,prior.effective_until,'[)')
  ) then raise exception 'PUBLICATION_OVERLAP'; end if;
  perform set_config('backyard.admin_publish','on',true);
  if publish_from>now() then
    update public.admin_catalog_revisions set effective_until=publish_from
      where id<>prior.id and entity_type=prior.entity_type and entity_id=prior.entity_id and status='PUBLISHED'
        and (effective_from is null or effective_from<publish_from) and (effective_until is null or effective_until>publish_from);
  else
    if exists(select 1 from public.admin_catalog_revisions existing where existing.id<>prior.id and existing.entity_type=prior.entity_type and existing.entity_id=prior.entity_id and existing.status='PUBLISHED' and existing.effective_from>now()) then raise exception 'FUTURE_PUBLICATION_EXISTS'; end if;
    update public.admin_catalog_revisions set status='SUPERSEDED'
      where entity_type=prior.entity_type and entity_id=prior.entity_id and status='PUBLISHED' and id<>prior.id;
  end if;
  update public.admin_catalog_revisions set status='PUBLISHED',effective_from=publish_from,revision_hash=computed_hash where id=prior.id returning * into changed;
  perform set_config('backyard.admin_publish','off',true);
  perform private.admin_project_published_revision_v1(changed);
  perform private.admin_audit_v1('PUBLISH',prior.entity_type,prior.entity_id,to_jsonb(prior),to_jsonb(changed),publish_reason,request_id,prior.scope_type,prior.scope_id);
  return changed;
exception when others then
  perform set_config('backyard.admin_publish','off',true);
  raise;
end;
$$;
revoke all on function public.admin_publish_revision_v1(uuid,text,text,uuid) from public,anon;
grant execute on function public.admin_publish_revision_v1(uuid,text,text,uuid) to authenticated,service_role;

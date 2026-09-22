-- A closed base hole remains part of the operational revision, but it must not
-- consume an engine hole number. Only playable holes receive the canonical
-- 1..9/18 runtime sequence that is frozen into a round snapshot.

alter table public.course_configuration_holes
  alter column runtime_hole_number drop not null;

alter table public.course_configuration_holes
  drop constraint if exists course_configuration_holes_runtime_hole_number_check;

alter table public.course_configuration_holes
  add constraint course_configuration_holes_runtime_hole_number_check
  check (runtime_hole_number is null or runtime_hole_number between 1 and 18),
  add constraint course_configuration_holes_playable_runtime_check
  check (not playable or runtime_hole_number is not null);

comment on column public.course_configuration_holes.runtime_hole_number is
  'Stable engine hole number for playable rows. Null for closed/non-playable rows.';

alter table public.round_course_snapshots
  add column if not exists configuration_versions integer[] not null default array[]::integer[];

-- Published facts are immutable. Status may still move through the explicit
-- soft-lifecycle transitions, but a client cannot rewrite evidence or payload.
create or replace function private.guard_admin_revision_v1()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare allowed boolean := false;
begin
  if old.status is distinct from new.status then
    allowed := case old.status
      when 'DRAFT' then new.status in ('REVIEWED','ARCHIVED')
      when 'REVIEWED' then new.status in ('DRAFT','VERIFIED','ARCHIVED')
      when 'VERIFIED' then new.status in ('DRAFT','PUBLISHED','ARCHIVED')
      when 'PUBLISHED' then new.status in ('SUPERSEDED','ARCHIVED')
      when 'SUPERSEDED' then new.status='ARCHIVED'
      else false end;
    if not allowed then raise exception 'INVALID_PUBLICATION_TRANSITION' using errcode='23514'; end if;
    if new.status='PUBLISHED' and coalesce(current_setting('backyard.admin_publish',true),'')<>'on' then
      raise exception 'PUBLISH_RPC_REQUIRED' using errcode='42501';
    end if;
    if new.status='REVIEWED' then new.reviewed_by:=(select auth.uid()); end if;
    if new.status='VERIFIED' then
      if new.provenance_status<>'VERIFIED' or new.source_type is null or new.source_name is null or new.verified_at is null then
        raise exception 'VERIFIED_EVIDENCE_REQUIRED' using errcode='23514';
      end if;
      new.verified_by:=(select auth.uid());
    end if;
    if new.status='PUBLISHED' then new.published_by:=(select auth.uid()); new.published_at:=now(); end if;
  end if;
  if old.status not in ('DRAFT','REVIEWED','VERIFIED') and (
    old.entity_type is distinct from new.entity_type or old.entity_id is distinct from new.entity_id
    or old.scope_type is distinct from new.scope_type or old.scope_id is distinct from new.scope_id
    or old.version is distinct from new.version or old.payload is distinct from new.payload
    or old.source_type is distinct from new.source_type or old.source_name is distinct from new.source_name
    or old.source_url is distinct from new.source_url or old.provenance_status is distinct from new.provenance_status
    or old.verified_at is distinct from new.verified_at or old.confidence is distinct from new.confidence
    or old.internal_notes is distinct from new.internal_notes or old.effective_from is distinct from new.effective_from
    or old.effective_until is distinct from new.effective_until or old.supersedes_revision_id is distinct from new.supersedes_revision_id
    or old.preview_hash is distinct from new.preview_hash or old.revision_hash is distinct from new.revision_hash
    or old.created_by is distinct from new.created_by or old.created_at is distinct from new.created_at
  ) then raise exception 'PUBLISHED_REVISION_IMMUTABLE' using errcode='23514'; end if;
  new.updated_at:=now();
  return new;
end;
$$;
revoke all on function private.guard_admin_revision_v1() from public,anon,authenticated;

-- Confirmation of an import creates ordinary DRAFT revisions only. Invalid,
-- duplicate and unchanged rows remain in the diff and never enter publication.
create or replace function public.admin_confirm_import_v1(
  target_import_id uuid,
  confirmation_reason text,
  request_id uuid
) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare job public.admin_import_jobs; candidate public.admin_import_rows; payload jsonb;
  target_id text; source_type text; verified_at timestamptz; created_count integer:=0;
begin
  select * into job from public.admin_import_jobs where id=target_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND' using errcode='P0002'; end if;
  if job.status<>'PREVIEWED' then raise exception 'IMPORT_NOT_CONFIRMABLE'; end if;
  if length(trim(coalesce(confirmation_reason,'')))<3 then raise exception 'REASON_REQUIRED'; end if;
  if not private.admin_has_scope_v1('IMPORT',job.scope_type,job.scope_id,'CREATE_DRAFT') then raise exception 'ADMIN_SCOPE_REQUIRED' using errcode='42501'; end if;
  for candidate in select * from public.admin_import_rows where import_id=job.id and status in ('NEW','UPDATE') order by row_number loop
    payload:=candidate.normalized_payload;
    target_id:=coalesce(candidate.existing_entity_id,payload->>'id');
    if target_id is null or jsonb_typeof(payload)<>'object' then raise exception 'INVALID_IMPORT_ROW'; end if;
    source_type:=case when payload->>'sourceType' in ('OEM_OFFICIAL','DISTRIBUTOR','SECONDARY_ARCHIVE','USER_SUBMITTED','ADMIN_RESEARCH','OTHER') then payload->>'sourceType' else 'ADMIN_RESEARCH' end;
    begin verified_at:=nullif(payload->>'verifiedAt','')::timestamptz; exception when others then raise exception 'INVALID_VERIFIED_AT_ROW_%',candidate.row_number; end;
    perform public.admin_create_revision_v1(
      job.kind,target_id,
      case when job.kind='COURSE' then job.scope_type else 'CATALOG' end,
      case when job.kind='COURSE' then job.scope_id else 'equipment' end,
      payload,source_type,payload->>'sourceName',nullif(payload->>'sourceUrl',''),
      case when verified_at is not null and nullif(payload->>'sourceName','') is not null then 'VERIFIED' else 'REVIEWED' end,
      verified_at,case when payload->>'confidence' in ('LOW','MEDIUM','HIGH') then payload->>'confidence' else null end,
      'Draft creado por importación controlada '||job.id::text
    );
    created_count:=created_count+1;
  end loop;
  update public.admin_import_jobs
    set status='CONFIRMED',confirmed_by=(select auth.uid()),updated_at=now(),
      summary=summary||jsonb_build_object('draftsCreated',created_count,'confirmationReason',confirmation_reason)
    where id=job.id;
  perform private.admin_audit_v1('CONFIRM_IMPORT','IMPORT',job.id::text,to_jsonb(job),
    jsonb_build_object('draftsCreated',created_count),confirmation_reason,request_id,job.scope_type,job.scope_id);
  return jsonb_build_object('importId',job.id,'status','CONFIRMED','draftsCreated',created_count);
end;
$$;
revoke all on function public.admin_confirm_import_v1(uuid,text,uuid) from public,anon;
grant execute on function public.admin_confirm_import_v1(uuid,text,uuid) to authenticated,service_role;

-- Child rows never make a private/draft ruleset readable on their own.
drop policy if exists local_rule_read on public.course_local_rules;
create policy local_rule_read on public.course_local_rules for select to authenticated
using(exists(
  select 1 from public.course_local_rule_sets rule_set
  where rule_set.id=rule_set_id and (
    rule_set.status='PUBLISHED'
    or private.admin_has_scope_v1('LOCAL_RULE_SET','COURSE',rule_set.course_id,'READ')
  )
));

drop policy if exists competition_rule_set_read on public.competition_rule_sets;
create policy competition_rule_set_read on public.competition_rule_sets for select to authenticated
using(
  private.admin_has_scope_v1('COMPETITION_RULE_SET','COMPETITION',competition_id::text,'READ')
  or (
    status='PUBLISHED' and exists(
      select 1 from public.competition_definitions competition
      where competition.id=competition_id and competition.status='PUBLISHED' and competition.visibility='PUBLIC'
    )
  )
);

drop policy if exists competition_rule_read on public.competition_rules;
create policy competition_rule_read on public.competition_rules for select to authenticated
using(exists(
  select 1 from public.competition_rule_sets rule_set
  join public.competition_definitions competition on competition.id=rule_set.competition_id
  where rule_set.id=rule_set_id and (
    private.admin_has_scope_v1('COMPETITION_RULE_SET','COMPETITION',competition.id::text,'READ')
    or (rule_set.status='PUBLISHED' and competition.status='PUBLISHED' and competition.visibility='PUBLIC')
  )
));

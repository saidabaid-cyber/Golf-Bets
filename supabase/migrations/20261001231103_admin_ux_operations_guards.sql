-- QA-only additive operation guards. Installs controls; performs no record deletion, cleanup or account action.
begin;
do $$ begin if not exists(select 1 from private.admin_mode_v2_qa_binding where singleton and enabled and project_ref='gvzeymebltssgjkvksxt') then raise exception 'ISOLATED_ADMIN_QA_REQUIRED';end if;end $$;
create or replace function public.admin_catalog_lifecycle_v3(kind text,item_id text,operation text,change_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entity text:=kind;scope text;scope_id text; target regclass; before_row jsonb; previous_state text;usage jsonb;next_state text;published_record boolean;
begin
  if not exists(select 1 from private.admin_mode_v2_qa_binding where singleton and enabled and project_ref='gvzeymebltssgjkvksxt') then raise exception 'ISOLATED_ADMIN_QA_REQUIRED'; end if;
  if kind='TEE' then entity:='COURSE';select course_id into scope_id from public.golf_course_tees where id=item_id;
  elsif kind='COURSE' then scope_id:=item_id;elsif kind='COMPETITION' then scope_id:=item_id;else scope_id:='equipment';end if;
  scope:=case when entity='COURSE' then 'COURSE' when entity='COMPETITION' then 'COMPETITION' else 'CATALOG' end;
  if not private.account_data_access_allowed() or not private.admin_has_scope_v1(entity,scope,scope_id,case when operation='inspect' then 'READ' else 'ARCHIVE' end) then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
  target:=case kind when 'COURSE' then 'public.golf_courses'::regclass when 'TEE' then 'public.golf_course_tees'::regclass when 'BALL' then 'public.golf_ball_catalog'::regclass when 'CLUB_EQUIPMENT' then 'public.golf_club_catalog'::regclass when 'SHAFT' then 'public.golf_shaft_catalog'::regclass when 'COMPETITION' then 'public.competition_definitions'::regclass end;
  if target is null or operation not in ('inspect','archive','activate','delete') or length(item_id) not between 1 and 240 then raise exception 'INVALID_OPERATION';end if;
  perform pg_advisory_xact_lock(hashtextextended(kind||item_id,0));
  execute format('select to_jsonb(t) from %s t where id::text=$1 for update',target) into before_row using item_id;
  select state into previous_state from public.admin_catalog_lifecycle where entity_type=kind and entity_id=item_id for update;
  select exists(select 1 from public.admin_catalog_revisions where entity_type=kind and entity_id=item_id and status='PUBLISHED') into published_record;
  usage:=private.admin_catalog_usage_v3(kind,item_id,operation='delete');
  if operation='inspect' then return usage||jsonb_build_object('canDelete',(before_row is not null or published_record) and previous_state is distinct from 'DELETED' and (usage->>'references')::bigint=0,'state',coalesce(previous_state,'ACTIVE'));end if;
  if before_row is null and not exists(select 1 from public.admin_catalog_revisions where entity_type=kind and entity_id=item_id and status='PUBLISHED') then raise exception 'ENTITY_NOT_AVAILABLE';end if;
  if length(trim(coalesce(change_reason,''))) not between 3 and 1000 or previous_state='DELETED' then raise exception 'INVALID_CHANGE';end if;
  if operation='delete' and ((before_row is null and not published_record) or (usage->>'references')::bigint>0) then return usage||jsonb_build_object('blocked',true,'canDelete',false);end if;
  next_state:=case operation when 'delete' then 'DELETED' when 'archive' then 'ARCHIVED' else 'ACTIVE' end;
  if operation='delete' and before_row is not null then execute format('delete from %s where id::text=$1',target) using item_id; end if;
  if kind='COMPETITION' and operation<>'delete' then
    update public.competition_definitions set status=case when operation='archive' then 'ARCHIVED' else 'DRAFT' end,updated_at=now() where id=item_id::uuid;
  end if;
  insert into public.admin_catalog_lifecycle(entity_type,entity_id,state,changed_by) values(kind,item_id,next_state,(select auth.uid()))
    on conflict(entity_type,entity_id) do update set state=excluded.state,changed_by=excluded.changed_by,changed_at=now();
  perform private.admin_audit_v1(upper(operation)||'_CATALOG',entity,item_id,jsonb_build_object('state',coalesce(previous_state,'ACTIVE')),jsonb_build_object('state',next_state),change_reason,null,scope,scope_id);
  return jsonb_build_object('state',next_state,'references',usage->'references');
end $$;

create function private.admin_ux_revision_guard_v3() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.admin_catalog_lifecycle where entity_type=new.entity_type and entity_id=new.entity_id and state='DELETED') then raise exception 'ENTITY_PERMANENTLY_RETIRED';end if;
 return new;
end $$;
revoke all on function private.admin_ux_revision_guard_v3() from public,anon,authenticated;
create trigger admin_ux_revision_guard_v3 before insert or update on public.admin_catalog_revisions for each row execute function private.admin_ux_revision_guard_v3();
create function private.admin_ux_variant_engine_guard_v3() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('bet-variant:'||new.variant_id::text,0));
 if exists(select 1 from public.admin_bet_variant_versions where variant_id=new.variant_id and id<>new.id and payload->>'engine' is distinct from new.payload->>'engine') then raise exception 'ENGINE_IMMUTABLE';end if;
 return new;
end $$;
revoke all on function private.admin_ux_variant_engine_guard_v3() from public,anon,authenticated;
create trigger admin_ux_variant_engine_guard_v3 before insert or update on public.admin_bet_variant_versions for each row execute function private.admin_ux_variant_engine_guard_v3();
create function public.admin_competition_status_v3(competition_key uuid,expected_status text,next_status text,change_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.competition_definitions;
begin
 if not private.account_data_access_allowed() or not private.admin_has_scope_v1('COMPETITION','COMPETITION',competition_key::text,'PUBLISH') then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
 if next_status not in ('DRAFT','COMPLETED') or next_status is null or length(trim(coalesce(change_reason,''))) not between 3 and 1000 then raise exception 'INVALID_CHANGE';end if;
 select * into prior from public.competition_definitions where id=competition_key for update;
 if prior.id is null or prior.status<>expected_status or prior.status<>'PUBLISHED' then raise exception 'STALE_COMPETITION' using errcode='40001';end if;
 update public.competition_definitions set status=next_status,updated_at=now() where id=competition_key;
 perform private.admin_audit_v1('CHANGE_COMPETITION_STATUS','COMPETITION',competition_key::text,jsonb_build_object('status',prior.status,'name',prior.name),jsonb_build_object('status',next_status,'name',prior.name),change_reason,null,'COMPETITION',competition_key::text);
 return jsonb_build_object('id',competition_key,'status',next_status);
end $$;
revoke all on function public.admin_competition_status_v3(uuid,text,text,text) from public,anon;
grant execute on function public.admin_competition_status_v3(uuid,text,text,text) to authenticated;
commit;

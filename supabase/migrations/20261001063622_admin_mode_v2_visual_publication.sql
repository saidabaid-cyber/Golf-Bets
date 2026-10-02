begin;
create table public.admin_visual_versions(
  id uuid primary key default gen_random_uuid(),target_kind text not null check(target_kind in ('BET','CONTENT')),
  target_key text not null,version integer not null,base_version integer not null default 0,
  status text not null default 'DRAFT' check(status in ('DRAFT','VERIFIED','PUBLISHED','SUPERSEDED','ARCHIVED')),
  payload jsonb not null check(jsonb_typeof(payload)='object'),preview_hash text,
  created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete restrict,published_at timestamptz,
  unique(target_kind,target_key,version),
  check((target_kind='BET' and target_key in ('rabbits','skins','units','foursome','ball_friend','monkey','polla_first','polla_second','polla_total','mini_polla','vipers','camels','fish','loba','personals','individual_nassau','dollar_stroke','individual_pressures','team_pressures','chicago','vegas','minimum_putts','manuals'))
    or (target_kind='CONTENT' and target_key in ('coach_ball_fit','coach_launch_monitor','home_empty_feed')))
);
create unique index admin_visual_current_idx on public.admin_visual_versions(target_kind,target_key) where status='PUBLISHED';
alter table public.admin_visual_versions enable row level security;
revoke all on public.admin_visual_versions from public,anon,authenticated;
grant select on public.admin_visual_versions to authenticated;
create policy admin_visual_read on public.admin_visual_versions for select to authenticated
using(private.account_data_access_allowed() and private.admin_has_scope_v1(case when target_kind='BET' then 'BET_PRESENTATION' else 'APP_CONTENT' end,'GLOBAL',null,'READ'));

create function public.admin_save_visual_draft_v2(content_kind text,content_key text,content_values jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_version integer;next_version integer;created public.admin_visual_versions;field text;entity text:=case when content_kind='BET' then 'BET_PRESENTATION' else 'APP_CONTENT' end;
begin
  if not private.account_data_access_allowed() or not private.admin_has_scope_v1(entity,'GLOBAL',null,'CREATE_DRAFT') then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if content_kind not in ('BET','CONTENT') or jsonb_typeof(content_values)<>'object' or pg_column_size(content_values)>30000 then raise exception 'INVALID_CONTENT'; end if;
  for field in select jsonb_object_keys(content_values) loop
    if field<>all(case when content_kind='BET' then array['title','description','instructions','active','order','icon'] else array['title','body','active'] end) then raise exception 'PROTECTED_FIELD'; end if;
  end loop;
  if jsonb_typeof(content_values->'title') is distinct from 'string' or length(trim(content_values->>'title')) not between 1 and 160 or jsonb_typeof(content_values->'active') is distinct from 'boolean' then raise exception 'INVALID_CONTENT'; end if;
  foreach field in array array['description','instructions','icon','body'] loop
    if coalesce(jsonb_typeof(content_values->field),'null') not in ('null','string') then raise exception 'INVALID_CONTENT_FIELD'; end if;
  end loop;
  if content_kind='BET' and (jsonb_typeof(content_values->'order') is distinct from 'number' or (content_values->>'order')::numeric not between 0 and 1000 or length(content_values->>'icon')>8 or length(coalesce(content_values->>'description',''))>2000 or length(coalesce(content_values->>'instructions',''))>20000) then raise exception 'INVALID_BET_PRESENTATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(content_kind||content_key,0));
  select coalesce(max(version),0) into current_version from public.admin_visual_versions where target_kind=content_kind and target_key=content_key and status='PUBLISHED';
  if expected_version is null or current_version<>expected_version then raise exception 'STALE_CONTENT' using errcode='40001'; end if;
  select coalesce(max(version),0)+1 into next_version from public.admin_visual_versions where target_kind=content_kind and target_key=content_key;
  insert into public.admin_visual_versions(target_kind,target_key,version,base_version,payload,created_by)
    values(content_kind,content_key,next_version,current_version,content_values,(select auth.uid())) returning * into created;
  perform private.admin_audit_v1('SAVE_VISUAL_DRAFT',entity,content_key,null,jsonb_build_object('version',created.version,'payload',created.payload),null,null);
  return jsonb_build_object('id',created.id,'status',created.status);
end;
$$;
create function public.admin_preview_visual_v2(visual_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate public.admin_visual_versions;before_values jsonb;hash text;entity text;
begin
  select * into candidate from public.admin_visual_versions where id=visual_id for update;
  entity:=case when candidate.target_kind='BET' then 'BET_PRESENTATION' else 'APP_CONTENT' end;
  if not private.account_data_access_allowed() or not private.admin_has_scope_v1(entity,'GLOBAL',null,'READ') then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if candidate.id is null or candidate.status not in ('DRAFT','VERIFIED') then raise exception 'DRAFT_REQUIRED'; end if;
  hash:=encode(sha256(convert_to(candidate.payload::text,'UTF8')),'hex');
  update public.admin_visual_versions set preview_hash=hash where id=candidate.id;
  select payload into before_values from public.admin_visual_versions where target_kind=candidate.target_kind and target_key=candidate.target_key and status='PUBLISHED';
  perform private.admin_audit_v1('PREVIEW_VISUAL',entity,candidate.target_key,before_values,candidate.payload,null,null);
  return jsonb_build_object('id',candidate.id,'previewHash',hash,'before',coalesce(before_values,'{}'::jsonb),'after',candidate.payload);
end;
$$;
create function public.admin_publish_visual_v2(visual_id uuid,expected_hash text,publish_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate public.admin_visual_versions;prior public.admin_visual_versions;entity text;
begin
  select * into candidate from public.admin_visual_versions where id=visual_id for update;
  entity:=case when candidate.target_kind='BET' then 'BET_PRESENTATION' else 'APP_CONTENT' end;
  if not private.account_data_access_allowed() or not private.admin_has_scope_v1(entity,'GLOBAL',null,'PUBLISH') then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if candidate.status not in ('DRAFT','VERIFIED') or length(trim(coalesce(publish_reason,''))) not between 3 and 1000
    or expected_hash is null or candidate.preview_hash is distinct from expected_hash or expected_hash<>encode(sha256(convert_to(candidate.payload::text,'UTF8')),'hex') then raise exception 'STALE_PREVIEW_OR_UNCONFIRMED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(candidate.target_kind||candidate.target_key,0));
  select * into prior from public.admin_visual_versions where target_kind=candidate.target_kind and target_key=candidate.target_key and status='PUBLISHED' for update;
  if coalesce(prior.version,0)<>candidate.base_version then raise exception 'STALE_CONTENT' using errcode='40001'; end if;
  update public.admin_visual_versions set status='SUPERSEDED' where id=prior.id;
  update public.admin_visual_versions set status='PUBLISHED',published_by=(select auth.uid()),published_at=now() where id=candidate.id;
  perform private.admin_audit_v1('PUBLISH_VISUAL',entity,candidate.target_key,prior.payload,candidate.payload,publish_reason,null);
  return jsonb_build_object('id',candidate.id,'status','PUBLISHED');
end;
$$;
revoke all on function public.admin_save_visual_draft_v2(text,text,jsonb,integer),public.admin_preview_visual_v2(uuid),public.admin_publish_visual_v2(uuid,text,text) from public,anon;
grant execute on function public.admin_save_visual_draft_v2(text,text,jsonb,integer),public.admin_preview_visual_v2(uuid),public.admin_publish_visual_v2(uuid,text,text) to authenticated;

create function public.player_visual_content_v2() returns table(target_kind text,target_key text,"values" jsonb)
language sql stable security definer set search_path='' as $$select target_kind,target_key,payload from public.admin_visual_versions where status='PUBLISHED'$$;
revoke all on function public.player_visual_content_v2() from public;
grant execute on function public.player_visual_content_v2() to anon,authenticated;
commit;

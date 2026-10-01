-- QA-only installation. No record is archived or deleted by this migration.
begin;
do $$ begin
  if not exists (select 1 from private.admin_mode_v2_qa_binding where singleton and enabled and project_ref='gvzeymebltssgjkvksxt') then
    raise exception 'ISOLATED_ADMIN_QA_REQUIRED';
  end if;
end $$;
create table public.admin_catalog_lifecycle (
  entity_type text not null check(entity_type in ('COURSE','TEE','CLUB_EQUIPMENT','BALL','SHAFT','COMPETITION')),
  entity_id text not null check(length(entity_id) between 1 and 240),
  state text not null check(state in ('ACTIVE','ARCHIVED','DELETED')),
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  primary key(entity_type,entity_id)
);
alter table public.admin_catalog_lifecycle enable row level security;
revoke all on public.admin_catalog_lifecycle from public,anon,authenticated;
grant select on public.admin_catalog_lifecycle to authenticated;
create policy lifecycle_admin_read on public.admin_catalog_lifecycle for select to authenticated
using(private.account_data_access_allowed() and exists(select 1 from public.admin_memberships where user_id=(select auth.uid()) and active));

-- Counts only; never returns personal snapshots. Constraints and JSON snapshots
-- are both checked because older bags/rounds use a denormalized read path.
create function private.admin_catalog_usage_v3(kind text, item_id text, lock_references boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target regclass; r record; n bigint; total bigint:=0; counts jsonb:='{}';
begin
  target:=case kind when 'COURSE' then 'public.golf_courses'::regclass when 'TEE' then 'public.golf_course_tees'::regclass
    when 'BALL' then 'public.golf_ball_catalog'::regclass when 'CLUB_EQUIPMENT' then 'public.golf_club_catalog'::regclass
    when 'SHAFT' then 'public.golf_shaft_catalog'::regclass when 'COMPETITION' then 'public.competition_definitions'::regclass end;
  if target is null then raise exception 'INVALID_ENTITY'; end if;
  for r in select distinct c.conrelid::regclass rel,a.attname col
    from pg_catalog.pg_constraint c cross join lateral unnest(c.conkey,c.confkey) k(child,parent)
    join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.child
    join pg_catalog.pg_attribute b on b.attrelid=c.confrelid and b.attnum=k.parent
    where c.contype='f' and c.confrelid=target and b.attname='id' order by rel,col
  loop
    if lock_references then execute format('lock table %s in share row exclusive mode',r.rel); end if;
    execute format('select count(*) from %s where %I::text=$1',r.rel,r.col) into n using item_id;
    if n>0 then counts:=counts||jsonb_build_object(r.rel::text,n);total:=total+n; end if;
  end loop;
  for r in select c.oid::regclass rel,a.attname col from pg_catalog.pg_class c
    join pg_catalog.pg_namespace s on s.oid=c.relnamespace join pg_catalog.pg_attribute a on a.attrelid=c.oid
    where s.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
      and c.relname not in ('admin_catalog_revisions','admin_audit_log','admin_visual_versions','admin_catalog_lifecycle')
      and ((a.atttypid='jsonb'::regtype and a.attname in ('snapshot','course','settings','payload','config','bet_config','scorecard_profile_snapshot'))
        or (kind='COURSE' and a.attname in ('course_id','base_course_id') and a.atttypid='text'::regtype)
        or (kind='TEE' and a.attname='tee_id' and a.atttypid='text'::regtype)) order by rel,col
  loop
    if lock_references then execute format('lock table %s in share row exclusive mode',r.rel); end if;
    if (select atttypid from pg_catalog.pg_attribute where attrelid=r.rel and attname=r.col)='jsonb'::regtype then
      execute format('select count(*) from %s where jsonb_path_exists(%I,''$.** ? (@ == $id)'',$1)',r.rel,r.col) into n using jsonb_build_object('id',item_id);
    else execute format('select count(*) from %s where %I=$1',r.rel,r.col) into n using item_id; end if;
    if n>0 then counts:=counts||jsonb_build_object(r.rel::text,n);total:=total+n; end if;
  end loop;
  return jsonb_build_object('references',total,'groups',counts);
end $$;
revoke all on function private.admin_catalog_usage_v3(text,text,boolean) from public,anon,authenticated;

create function public.admin_catalog_lifecycle_v3(kind text,item_id text,operation text,change_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entity text:=kind;scope text;scope_id text; target regclass; before_row jsonb; previous_state text;usage jsonb;next_state text;
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
  usage:=private.admin_catalog_usage_v3(kind,item_id,operation='delete');
  if operation='inspect' then return usage||jsonb_build_object('canDelete',before_row is not null and (usage->>'references')::bigint=0,'state',coalesce(previous_state,'ACTIVE'));end if;
  if before_row is null and not exists(select 1 from public.admin_catalog_revisions where entity_type=kind and entity_id=item_id and status='PUBLISHED') then raise exception 'ENTITY_NOT_AVAILABLE';end if;
  if length(trim(coalesce(change_reason,''))) not between 3 and 1000 or previous_state='DELETED' then raise exception 'INVALID_CHANGE';end if;
  if operation='delete' and (before_row is null or (usage->>'references')::bigint>0) then return usage||jsonb_build_object('blocked',true,'canDelete',false);end if;
  next_state:=case operation when 'delete' then 'DELETED' when 'archive' then 'ARCHIVED' else 'ACTIVE' end;
  if operation='delete' then execute format('delete from %s where id::text=$1',target) using item_id; end if;
  insert into public.admin_catalog_lifecycle(entity_type,entity_id,state,changed_by) values(kind,item_id,next_state,(select auth.uid()))
    on conflict(entity_type,entity_id) do update set state=excluded.state,changed_by=excluded.changed_by,changed_at=now();
  perform private.admin_audit_v1(upper(operation)||'_CATALOG',entity,item_id,jsonb_build_object('state',coalesce(previous_state,'ACTIVE')),jsonb_build_object('state',next_state),change_reason,null,scope,scope_id);
  return jsonb_build_object('state',next_state,'references',usage->'references');
end $$;
revoke all on function public.admin_catalog_lifecycle_v3(text,text,text,text) from public,anon;
grant execute on function public.admin_catalog_lifecycle_v3(text,text,text,text) to authenticated;
create function public.player_catalog_lifecycle_v3() returns table(entity_type text,entity_id text,state text)
language sql stable security definer set search_path='' as $$ select entity_type,entity_id,state from public.admin_catalog_lifecycle $$;
revoke all on function public.player_catalog_lifecycle_v3() from public;
grant execute on function public.player_catalog_lifecycle_v3() to anon,authenticated;
commit;

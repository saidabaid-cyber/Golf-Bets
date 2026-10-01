-- QA-only: protects references in every public JSON snapshot, including shot club snapshots. No data mutations.
begin;
do $$ begin if not exists(select 1 from private.admin_mode_v2_qa_binding where singleton and enabled and project_ref='gvzeymebltssgjkvksxt') then raise exception 'ISOLATED_ADMIN_QA_REQUIRED';end if;end $$;
create or replace function private.admin_catalog_usage_v3(kind text, item_id text, lock_references boolean default false)
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
      and ((a.atttypid='jsonb'::regtype )
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
commit;

-- Transactional RLS/grant contract for the provider-agnostic Course Master.
-- Run only against the isolated Preview database after migrations.
begin;

do $$
declare
  reader_oid oid;
  reader_definition text;
begin
  if to_regclass('public.golf_course_data_sources') is null then
    raise exception 'missing Course Master source registry';
  end if;
  if not exists (
    select 1 from pg_class relation
    join pg_namespace schema on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname = 'golf_course_data_sources'
      and relation.relrowsecurity
  ) then raise exception 'RLS is not enabled on Course Master source registry'; end if;

  if has_table_privilege('anon', 'public.golf_course_data_sources', 'SELECT')
    or has_table_privilege('anon', 'public.golf_course_data_sources', 'INSERT')
    or has_table_privilege('anon', 'public.golf_course_data_sources', 'UPDATE')
    or has_table_privilege('anon', 'public.golf_course_data_sources', 'DELETE') then
    raise exception 'anon unexpectedly has Course Master source privileges';
  end if;
  if not has_table_privilege('authenticated', 'public.golf_course_data_sources', 'SELECT')
    or has_table_privilege('authenticated', 'public.golf_course_data_sources', 'INSERT')
    or has_table_privilege('authenticated', 'public.golf_course_data_sources', 'UPDATE')
    or has_table_privilege('authenticated', 'public.golf_course_data_sources', 'DELETE') then
    raise exception 'authenticated Course Master source grants are not read-only';
  end if;

  if not exists (
    select 1 from public.golf_course_data_sources
    where provider = 'USGA_NCRDB'
      and authorization_status = 'LEGAL_REVIEW_REQUIRED'
      and not authorized_for_import
      and not authorized_for_display
      and not rating_reuse_authorized
  ) then raise exception 'NCRDB must remain blocked pending legal authorization'; end if;

  if exists (
    select 1 from public.golf_course_data_sources
    where authorized_for_import
      and (authorization_status <> 'AUTHORIZED' or authorization_basis is null or not authorized_for_display)
  ) then raise exception 'an importable source lacks authorization evidence'; end if;

  select procedure.oid, pg_get_functiondef(procedure.oid)
  into reader_oid, reader_definition
  from pg_proc procedure
  join pg_namespace schema on schema.oid = procedure.pronamespace
  where schema.nspname = 'public' and procedure.proname = 'read_backyard_course_master_v1';
  if reader_oid is null then raise exception 'missing Course Master reader'; end if;
  if not has_function_privilege('authenticated', reader_oid, 'EXECUTE')
    or has_function_privilege('anon', reader_oid, 'EXECUTE') then
    raise exception 'Course Master reader execute grants are unsafe';
  end if;
  if reader_definition not like '%auth.uid() is null%'
    or reader_definition not like '%authorized_for_display%'
    or reader_definition like '%course.visibility%'
    or reader_definition like '%club.visibility%'
    or reader_definition like '%GHIN_TEST_PASSWORD%'
    or reader_definition like '%golfer_user_token%' then
    raise exception 'Course Master reader authentication/source boundary is incomplete';
  end if;
end $$;

rollback;

begin;

do $$
declare
  table_oid oid := to_regclass('public.course_provider_lookup_cache');
begin
  if table_oid is null then raise exception 'missing course provider lookup cache'; end if;
  if not (select relrowsecurity from pg_class where oid = table_oid) then
    raise exception 'course provider lookup cache RLS is disabled';
  end if;
  if has_table_privilege('anon','public.course_provider_lookup_cache','select')
    or has_table_privilege('authenticated','public.course_provider_lookup_cache','select')
    or has_table_privilege('anon','public.course_provider_lookup_cache','insert')
    or has_table_privilege('authenticated','public.course_provider_lookup_cache','insert') then
    raise exception 'provider lookup cache is exposed to browser roles';
  end if;
  if not has_table_privilege('service_role','public.course_provider_lookup_cache','select,insert,update,delete') then
    raise exception 'service role cannot coordinate provider lookups';
  end if;
  if has_function_privilege('anon','public.claim_course_provider_lookup_v1(text,text)','execute')
    or has_function_privilege('authenticated','public.claim_course_provider_lookup_v1(text,text)','execute')
    or has_function_privilege('anon','public.finish_course_provider_lookup_v1(text,text,text,text[],integer)','execute')
    or has_function_privilege('authenticated','public.finish_course_provider_lookup_v1(text,text,text,text[],integer)','execute') then
    raise exception 'provider lookup RPCs are exposed to browser roles';
  end if;
end $$;

rollback;

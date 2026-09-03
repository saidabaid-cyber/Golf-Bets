-- READ ONLY. Run in SQL Editor and compare before applying any new migration.
select p.oid::regprocedure as function_name, p.prosecdef as security_definer,
  p.proconfig as settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1;

select e.extname, n.nspname as extension_schema
from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto';

select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'polla_join_attempts';
select * from pg_publication_tables where pubname = 'supabase_realtime';
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'scorecard-photos';

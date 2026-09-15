-- Run ONLY on a distinct isolated Preview branch after the reset migrations.
-- pgTAP contract is rolled back and creates no user data.
begin;
select plan(16);

select has_table('public', 'user_statistics_resets');
select has_table('public', 'user_statistics_reset_requests');
-- row_security_active() reflects the *runner's* role and can be false for an
-- owner/bypass role; relrowsecurity is the table's enabled RLS setting.
select ok((select relrowsecurity from pg_class where oid = 'public.user_statistics_resets'::regclass), 'canonical reset marker has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.user_statistics_reset_requests'::regclass), 'idempotency ledger has RLS enabled');
select policies_are('public', 'user_statistics_resets', array['statistics reset owner read']);
select policies_are('public', 'user_statistics_reset_requests', array['statistics reset request owner read']);
select ok(exists (
  select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = 'user_statistics_reset_requests'
    and c.conname = 'user_statistics_reset_requests_pkey' and c.contype = 'p'
), 'request key is unique by user and request_id');
select function_returns('public', 'reset_my_statistics', array['text','uuid'], 'timestamp with time zone');
select function_privs_are('public', 'reset_my_statistics', array['text','uuid'], 'authenticated', array['EXECUTE']);
select function_privs_are('public', 'reset_my_statistics', array['text','uuid'], 'anon', array[]::text[]);
select function_privs_are('public', 'reset_my_statistics', array['text'], 'authenticated', array[]::text[]);
select ok(has_table_privilege('authenticated', 'public.user_statistics_resets', 'SELECT'), 'owner may read canonical marker');
select ok(not (has_table_privilege('authenticated', 'public.user_statistics_resets', 'INSERT')
  or has_table_privilege('authenticated', 'public.user_statistics_resets', 'UPDATE')
  or has_table_privilege('authenticated', 'public.user_statistics_resets', 'DELETE')), 'REST cannot move marker');
select ok(has_table_privilege('authenticated', 'public.user_statistics_reset_requests', 'SELECT'), 'owner may read request records');
select ok(not (has_table_privilege('authenticated', 'public.user_statistics_reset_requests', 'INSERT')
  or has_table_privilege('authenticated', 'public.user_statistics_reset_requests', 'UPDATE')
  or has_table_privilege('authenticated', 'public.user_statistics_reset_requests', 'DELETE')), 'REST cannot forge request records');
select has_table('public', 'product_usage_events_v2');

select * from finish();
rollback;

-- Read-only verification after applying 20260904013601.
-- Expected: every row reports present = true.
with required_columns(table_name, column_name) as (
  values
    ('round_scores_cloud', 'version'),
    ('round_scores_cloud', 'updated_by_device'),
    ('round_scores_cloud', 'updated_at'),
    ('profiles', 'version'),
    ('profiles', 'updated_by_device'),
    ('account_data_migrations', 'last_attempt_at'),
    ('account_data_migrations', 'last_error_code')
)
select required_columns.table_name,
       required_columns.column_name,
       (columns.column_name is not null) as present
from required_columns
left join information_schema.columns as columns
  on columns.table_schema = 'public'
 and columns.table_name = required_columns.table_name
 and columns.column_name = required_columns.column_name
order by required_columns.table_name, required_columns.column_name;

-- Expected: one row for 20260904013601 after Supabase CLI/Dashboard records it.
select version, name
from supabase_migrations.schema_migrations
where version = '20260904013601';

-- Review RLS/policies, ACLs and the required version/audit functions.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'round_scores_cloud', 'account_data_migrations', 'polla_join_attempts')
order by tablename, policyname;

select routine_schema, routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('handle_backyard_user_profile', 'bump_backyard_cloud_version', 'archive_backyard_round_version', 'archive_backyard_draft_version');

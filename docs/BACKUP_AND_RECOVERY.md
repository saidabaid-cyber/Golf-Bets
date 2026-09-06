# Backup and recovery

The Backyard relies on Supabase managed backups and point-in-time recovery (when enabled for the project plan). This change does not introduce a second backup system or copy production data elsewhere.

## Before applying `production_hardening_v1`

1. In Supabase, confirm the project is healthy and record the latest available backup/PITR restore point.
2. Export only schema definitions for `public.profiles`, `public.rounds_cloud`, and their policies/grants for an audit trail. Do not put user data or secrets in Git.
3. Apply `20260906210425_production_hardening_v1.sql` first to an isolated Supabase branch or staging project.
4. Run `supabase/tests/production_hardening_rls_check.sql` as an administrator and execute the application regression suite.
5. Assign the first administrator manually only after the migration is verified:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = '<AUTH_USER_UUID>';
   ```

## Retention and minimization

- `analytics_events` contains event names, coarse device/platform data and minimized metadata. It never stores questions, scores, HCP, names, e-mail, bet amounts, photographs, tokens or full IP addresses.
- `app_errors` contains sanitized operational messages, never credentials, payloads or full stack traces.
- Retention should be configured operationally: 13 months for product analytics and 90 days for operational errors, unless a documented legal or incident hold applies.
- Deleting an Auth user sets the telemetry `user_id` to `null`, leaving only anonymous aggregate records.

## Recovery

For an application rollback, redeploy the exact Git SHA from before the hardening release. The additive tables and nullable profile timestamps are safe for the older application to ignore.

For a database rollback, prefer leaving the additive schema in place and rolling back application code. Dropping analytics tables loses operational history and is therefore not automated. If removal is explicitly approved after export, disable telemetry ingestion, export the required aggregate data, remove the trigger and policies, then remove the two tables. Do not remove `profiles.role` until all admin routes are retired.

For accidental data loss, stop writes, note the incident time and use Supabase PITR/managed backup restore into a separate project first. Validate account, round and consent counts before any controlled cutover. Never restore over the only healthy copy without verification.

## Preview limitation

The migration must not be applied to the production database merely to validate a Preview deployment. Use a Supabase branch/staging project and configure its Preview environment variables in Vercel. Until that is done, `/admin` reports the migration as pending and existing application data remains untouched.

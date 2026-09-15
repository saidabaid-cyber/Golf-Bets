-- Explicit permissions for the server-only Social reconciler. Do not depend
-- on project-level automatic Data API exposure/default privileges.
-- Additive: no data, policies or historical snapshots are changed.
begin;

grant usage on schema public to service_role;

-- Reconciliation derives activities from canonical persisted source facts.
-- These sources are read-only to this feature.
grant select on public.rounds_cloud,
  public.player_equipment_profiles,
  public.profiles,
  public.social_profiles,
  public.friendships,
  public.user_statistics_resets,
  public.social_activity_preferences_v3,
  public.social_round_account_links_v3
to service_role;

-- Definitive SHA-256 and derived achievement summaries are server writes.
-- Likes, comments, participant confirmation and attestations continue through
-- the verified user client + RLS; they do not need elevated write grants.
grant select,insert,update on public.social_activities_v3 to service_role;

commit;

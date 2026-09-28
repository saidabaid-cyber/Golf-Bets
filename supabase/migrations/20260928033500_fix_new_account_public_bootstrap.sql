-- auth.users has two AFTER INSERT triggers. The legacy profile trigger runs
-- first and can create public.profiles with the historical private default.
-- Make the new-account bootstrap authoritative for that same just-created row
-- without changing any existing account outside the Auth INSERT transaction.
begin;

create or replace function public.handle_phase2_user_bootstrap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  username_base text;
  username_candidate text;
begin
  username_base := regexp_replace(
    lower(split_part(coalesce(new.email, ''), '@', 1)),
    '[^a-z0-9._]+', '', 'g'
  );
  username_base := regexp_replace(username_base, '^[^a-z0-9]+', '');
  if length(username_base) < 2 then
    username_base := 'golfista_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  username_candidate := left(username_base, 40);
  if exists(select 1 from public.social_profiles where lower(username) = lower(username_candidate)) then
    username_candidate := left(username_base, 33) || '_' || substr(md5(new.id::text), 1, 6);
  end if;

  insert into public.profiles(
    id, name, display_name, avatar_url, username, social_privacy, profile_visibility
  )
  values (
    new.id,
    '',
    '',
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    username_candidate,
    'PRIVATE',
    'public'
  )
  on conflict (id) do update set
    name = '',
    display_name = '',
    username = coalesce(public.profiles.username, excluded.username),
    social_privacy = coalesce(public.profiles.social_privacy, 'PRIVATE'),
    profile_visibility = 'public';

  insert into public.social_profiles(user_id, username, display_name, avatar_url, privacy)
  values (
    new.id,
    username_candidate,
    'Golfista',
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    'PUBLIC'
  )
  on conflict (user_id) do nothing;

  insert into public.feature_entitlements(user_id, plan_id, metadata)
  values (new.id, 'BETA_PRO', jsonb_build_object('source', 'preview_beta_bootstrap'))
  on conflict (user_id) do nothing;

  insert into public.user_preferences(
    user_id, notifications_enabled, push_notifications_enabled,
    email_notifications_enabled, round_notifications_enabled, reminders_enabled
  )
  values (new.id, true, true, true, true, true)
  on conflict (user_id) do nothing;

  insert into public.social_activity_preferences_v3(
    user_id, notify_like, notify_comment, notify_attest,
    notify_friend_achievement, notify_equipment, notify_friend_request
  )
  values (new.id, true, true, true, true, true, true)
  on conflict (user_id) do nothing;

  insert into public.notification_preferences_v2(user_id, event_type, in_app, push)
  select new.id, event_type, true, true
  from unnest(array[
    'friend_request', 'friend_accepted', 'group_invite', 'round_invite',
    'round_started', 'round_finished', 'scorecard_ready'
  ]::text[]) event_type
  on conflict (user_id, event_type) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_phase2_user_bootstrap()
  from public, anon, authenticated;

comment on function public.handle_phase2_user_bootstrap() is
  'Creates new-account Preview defaults. PUBLIC applies only to the profile row created during the same auth.users INSERT; existing account choices are never backfilled.';

commit;

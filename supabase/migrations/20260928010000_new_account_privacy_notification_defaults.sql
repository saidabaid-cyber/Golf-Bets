-- New-account defaults are written only by the Auth bootstrap. General table
-- defaults retain legacy behavior, and no existing row is updated/backfilled.
begin;

alter table public.profiles
  alter column profile_visibility set default 'private';

alter table public.social_profiles
  alter column privacy set default 'PRIVATE';

-- The Auth bootstrap predates profile_visibility and wrote the social
-- projection as PRIVATE explicitly. Keep activity sharing private, but make
-- the new account identity card match the canonical PUBLIC profile default.
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
    social_privacy = coalesce(public.profiles.social_privacy, 'PRIVATE');

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

  -- Persist the new-account defaults at creation time. Services can therefore
  -- distinguish a real new account from a legacy account whose row is absent,
  -- without inferring consent or preferences from a clean browser.
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
revoke all on function public.handle_phase2_user_bootstrap() from public, anon, authenticated;

alter table public.user_preferences
  alter column notifications_enabled set default false,
  add column if not exists push_notifications_enabled boolean,
  add column if not exists email_notifications_enabled boolean,
  add column if not exists round_notifications_enabled boolean,
  add column if not exists reminders_enabled boolean;

-- Existing accounts keep NULL as an explicit bootstrap marker so the client
-- can migrate their local choices exactly once. The Auth trigger above writes
-- every ON value explicitly for a genuinely new account. A row created later
-- for a legacy account must not acquire new-account defaults by accident.
alter table public.user_preferences
  alter column push_notifications_enabled drop default,
  alter column email_notifications_enabled drop default,
  alter column round_notifications_enabled drop default,
  alter column reminders_enabled drop default;

alter table public.notification_preferences_v2
  alter column in_app set default true,
  alter column push set default false;

alter table public.social_activity_preferences_v3
  alter column notify_like set default true,
  alter column notify_comment set default true,
  alter column notify_attest set default true,
  alter column notify_friend_achievement set default false,
  alter column notify_equipment set default false,
  add column if not exists notify_friend_request boolean;

-- Existing and later-created legacy rows retain NULL. NULL preserves the
-- pre-existing unconditional friend-request notification until an owner
-- explicitly saves this new preference; new Auth rows write true explicitly.
alter table public.social_activity_preferences_v3
  alter column notify_friend_request drop default;

-- Friend-request delivery follows the same account preference as the other
-- Social categories. Missing/NULL keeps the historical unconditional request
-- event; it is not treated as proof of a new account. A stored false opts out.
create or replace function private.notify_friend_request_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'PENDING' and coalesce((
    select preference.notify_friend_request
    from public.social_activity_preferences_v3 preference
    where preference.user_id = new.addressee_id
  ), true) then
    insert into public.notification_events_v2(id,recipient_id,event_type,resource_type,resource_id)
    values(new.id,new.addressee_id,'friend_request','FRIEND',new.id::text)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.notify_friend_request_v1() from public, anon, authenticated;

comment on column public.profiles.profile_visibility is
  'Auth bootstrap writes public only for genuinely new accounts; the general row default remains private for legacy repair paths.';
comment on column public.user_preferences.push_notifications_enabled is
  'Nullable legacy marker. Auth bootstrap writes true for new accounts; this preference does not prove OS permission, subscription registration, or delivery.';
comment on column public.user_preferences.email_notifications_enabled is
  'Nullable legacy marker. Auth bootstrap writes true for new accounts; this preference does not prove that a transactional notification mailer is configured.';

commit;

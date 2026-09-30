-- Explicit optional-feature authorization. This migration intentionally does
-- not infer or backfill consent for an existing account. Only an auth.users
-- row created after this migration receives the private eligibility marker
-- that can resolve the onboarding bundle.
begin;

create schema if not exists private;

alter table public.user_preferences
  add column if not exists personal_memory_enabled boolean,
  add column if not exists global_learning_enabled boolean,
  add column if not exists location_internal_enabled boolean,
  add column if not exists notification_internal_enabled boolean;

comment on column public.user_preferences.personal_memory_enabled is
  'Projection of the latest explicit PERSONAL_MEMORY decision. NULL is legacy/unresolved, never implicit acceptance.';
comment on column public.user_preferences.global_learning_enabled is
  'Projection of the latest explicit GLOBAL_LEARNING decision. NULL is legacy/unresolved, never implicit acceptance.';
comment on column public.user_preferences.location_internal_enabled is
  'Internal Backyard location preference only. It does not prove browser/OS permission.';
comment on column public.user_preferences.notification_internal_enabled is
  'Internal Backyard notification preference only. It does not prove browser/OS permission, provider registration or delivery.';

create table public.optional_authorization_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in (
    'AI_PROVIDER_PROCESSING_CONSENT',
    'AI_IMAGE_PROCESSING_CONSENT',
    'AI_LAUNCH_MONITOR_PROCESSING_CONSENT',
    'PERSONAL_MEMORY',
    'GLOBAL_LEARNING',
    'LOCATION_INTERNAL',
    'NOTIFICATION_INTERNAL'
  )),
  decision_status text not null check (decision_status in ('accepted', 'declined', 'revoked')),
  policy_version text not null check (char_length(policy_version) between 1 and 80),
  source text not null check (source in (
    'onboarding_authorize_all',
    'onboarding_decline_all',
    'settings'
  )),
  bundle_version text check (
    bundle_version is null or char_length(bundle_version) between 1 and 80
  ),
  idempotency_key uuid not null,
  decided_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint optional_authorization_events_source_shape check (
    (source = 'settings' and bundle_version is null)
    or
    (source in ('onboarding_authorize_all', 'onboarding_decline_all')
      and bundle_version is not null)
  ),
  constraint optional_authorization_events_idempotency
    unique (user_id, scope, idempotency_key)
);

create index optional_authorization_events_latest_idx
  on public.optional_authorization_events (user_id, scope, id desc);

create table public.optional_authorization_bundle_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bundle_version text not null check (char_length(bundle_version) between 1 and 80),
  action text not null check (action in ('authorize_all', 'decline_all')),
  idempotency_key uuid not null,
  feature_set jsonb not null check (jsonb_typeof(feature_set) = 'object'),
  decided_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint optional_authorization_bundle_one_resolution
    unique (user_id, bundle_version),
  constraint optional_authorization_bundle_idempotency
    unique (user_id, idempotency_key)
);

-- This private row is the non-forgeable boundary between a newly created
-- account and an existing account. There is deliberately no INSERT ... SELECT
-- backfill. Existing accounts remain in their current state until they make an
-- individual explicit settings decision.
create table private.optional_authorization_onboarding_eligibility (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bundle_version text not null check (char_length(bundle_version) between 1 and 80),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolution_action text check (resolution_action in ('authorize_all', 'decline_all')),
  -- Both rows are account-owned lifecycle data. CASCADE avoids sibling-FK
  -- ordering making an auth.users deletion depend on which child fires first.
  receipt_id uuid references public.optional_authorization_bundle_receipts(id) on delete cascade,
  constraint optional_authorization_eligibility_resolution_shape check (
    (resolved_at is null and resolution_action is null and receipt_id is null)
    or
    (resolved_at is not null and resolution_action is not null and receipt_id is not null)
  )
);

create index optional_authorization_eligibility_receipt_idx
  on private.optional_authorization_onboarding_eligibility (receipt_id)
  where receipt_id is not null;

alter table public.optional_authorization_events enable row level security;
alter table public.optional_authorization_bundle_receipts enable row level security;
alter table private.optional_authorization_onboarding_eligibility enable row level security;

revoke all on table public.optional_authorization_events
  from public, anon, authenticated, service_role;
revoke all on table public.optional_authorization_bundle_receipts
  from public, anon, authenticated, service_role;
revoke all on table private.optional_authorization_onboarding_eligibility
  from public, anon, authenticated, service_role;
revoke all on sequence public.optional_authorization_events_id_seq
  from public, anon, authenticated, service_role;

grant select on table public.optional_authorization_events to authenticated;
grant select on table public.optional_authorization_bundle_receipts to authenticated;
grant select, insert on table public.optional_authorization_events to service_role;
grant select, insert on table public.optional_authorization_bundle_receipts to service_role;
grant select, insert, update, delete on table private.optional_authorization_onboarding_eligibility
  to service_role;
grant usage, select on sequence public.optional_authorization_events_id_seq
  to service_role;

-- The privacy export is executed only after a verified GLOBAL SUPER_ADMIN
-- membership check. Several older tables deliberately revoked PUBLIC grants,
-- so give the server-only service role the least privileges required to read
-- the allowlisted sources and append the mandatory audit record.
grant select on table public.profiles, public.user_preferences, public.legal_acceptances
  to service_role;
grant insert on table public.admin_audit_log to service_role;
grant usage, select on sequence public.admin_audit_log_id_seq to service_role;

create policy optional_authorization_events_owner_read
  on public.optional_authorization_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy account_active_access
  on public.optional_authorization_events
  as restrictive
  for all
  to authenticated
  using ((select private.account_data_access_allowed()))
  with check ((select private.account_data_access_allowed()));

create policy optional_authorization_receipts_owner_read
  on public.optional_authorization_bundle_receipts
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy account_active_access
  on public.optional_authorization_bundle_receipts
  as restrictive
  for all
  to authenticated
  using ((select private.account_data_access_allowed()))
  with check ((select private.account_data_access_allowed()));

comment on table public.optional_authorization_events is
  'Append-only explicit decisions for optional app functions. Marketing and financial/patrimonial processing are intentionally excluded.';
comment on table public.optional_authorization_bundle_receipts is
  'Immutable receipt for the one-time optional onboarding bundle. It is not a receipt for marketing or financial/patrimonial processing.';
comment on table private.optional_authorization_onboarding_eligibility is
  'Private new-account marker. No historical account is backfilled or inferred as eligible/accepted.';

-- Keep the pre-existing server-only AI decision lane ordered with the new
-- optional bundle. Both functions acquire locks in the same order and only
-- timestamp a decision after serialization, so commit order and evidence time
-- cannot be inverted by concurrent onboarding/settings requests.
create or replace function public.record_ai_processing_consent_decisions(
  p_user_id uuid,
  p_policy_version text,
  p_decisions jsonb,
  p_source text
)
returns setof public.ai_processing_consents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  latest public.ai_processing_consents%rowtype;
  chosen_scope text;
  accepted boolean;
  decision_time timestamptz;
begin
  if p_user_id is null
    or p_policy_version is null or char_length(p_policy_version) not between 1 and 80
    or p_source is null or p_source not in ('onboarding', 'account_update', 'settings')
    or p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
    raise exception 'Invalid consent decision request' using errcode = '22023';
  end if;
  if jsonb_array_length(p_decisions) not between 1 and 3 then
    raise exception 'Invalid consent decision count' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_decisions) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'scope' and item ? 'accepted')
      or item - 'scope' - 'accepted' <> '{}'::jsonb
      or jsonb_typeof(item->'accepted') <> 'boolean'
      or coalesce(item->>'scope', '') not in (
        'AI_PROVIDER_PROCESSING_CONSENT',
        'AI_IMAGE_PROCESSING_CONSENT',
        'AI_LAUNCH_MONITOR_PROCESSING_CONSENT'
      ) then
      raise exception 'Invalid consent decision' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct value->>'scope') from jsonb_array_elements(p_decisions))
    <> jsonb_array_length(p_decisions) then
    raise exception 'Duplicate consent scope' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('optional-authorization:' || p_user_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('ai-processing-consent:' || p_user_id::text, 0)
  );
  -- A legacy/individual AI choice is itself an explicit decision. Consume the
  -- one-time broad onboarding offer before writing it so a mixed-version tab
  -- cannot leave the account advertised as eligible for a bundle that must
  -- refuse to overwrite this narrower evidence.
  delete from private.optional_authorization_onboarding_eligibility eligibility
  where eligibility.user_id = p_user_id
    and eligibility.bundle_version = 'optional-features-2026-09-30-v1'
    and eligibility.resolved_at is null;
  select greatest(
    clock_timestamp(),
    coalesce(max(evidence.decided_at) + interval '1 millisecond', '-infinity'::timestamptz)
  ) into decision_time
  from (
    select consent.decided_at
    from public.ai_processing_consents consent
    where consent.user_id = p_user_id
    union all
    select event.decided_at
    from public.optional_authorization_events event
    where event.user_id = p_user_id
  ) evidence;

  for item in select value from jsonb_array_elements(p_decisions) loop
    chosen_scope := item->>'scope';
    accepted := (item->>'accepted')::boolean;
    select * into latest
    from public.ai_processing_consents consent
    where consent.user_id = p_user_id
      and consent.scope = chosen_scope
      and consent.policy_version = p_policy_version
    order by consent.id desc
    limit 1;

    if found and p_source <> 'settings' then continue; end if;
    if latest.id is not null and latest.decision_status = 'accepted' then
      if not accepted then
        update public.ai_processing_consents
        set decision_status = 'revoked',
            revoked_at = greatest(decision_time, latest.accepted_at),
            decided_at = greatest(decision_time, latest.accepted_at),
            updated_at = decision_time
        where id = latest.id and user_id = p_user_id;
      end if;
      continue;
    end if;
    if latest.id is not null and not accepted then continue; end if;
    insert into public.ai_processing_consents (
      user_id, scope, policy_version, decision_status, source, decided_at,
      accepted_at, locale, updated_at
    ) values (
      p_user_id,
      chosen_scope,
      p_policy_version,
      case when accepted then 'accepted' else 'declined' end,
      p_source,
      decision_time,
      case when accepted then decision_time else null end,
      'es-MX',
      decision_time
    );
  end loop;

  return query
  select distinct on (consent.scope) consent.*
  from public.ai_processing_consents consent
  where consent.user_id = p_user_id
    and consent.policy_version = p_policy_version
  order by consent.scope, consent.id desc;
end;
$$;
revoke all on function public.record_ai_processing_consent_decisions(uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.record_ai_processing_consent_decisions(uuid, text, jsonb, text)
  to service_role;
comment on function public.record_ai_processing_consent_decisions(uuid, text, jsonb, text) is
  'Server-only atomic AI choices serialized with the optional authorization bundle. LEGAL_REVIEW_REQUIRED for policy wording and mandatory/optional classification.';

-- Privacy, notification-channel and Social settings are projections that can
-- race with the one-time optional bundle. Each writer below consumes the
-- unresolved offer and persists the explicit setting under the same
-- account-scoped advisory lock and PostgreSQL transaction. A failed projection
-- therefore rolls the eligibility delete back instead of leaving a partial
-- decision behind.
create or replace function public.set_my_profile_visibility(requested_visibility text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  saved text;
  profile_row public.profiles%rowtype;
begin
  if owner_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;
  if not private.account_data_access_allowed() then
    raise insufficient_privilege using message = 'account_access_restricted';
  end if;
  if requested_visibility is null
    or requested_visibility not in ('public', 'friends') then
    raise invalid_parameter_value using message = 'invalid_profile_audience';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('optional-authorization:' || owner_id::text, 0)
  );
  delete from private.optional_authorization_onboarding_eligibility eligibility
  where eligibility.user_id = owner_id
    and eligibility.bundle_version = 'optional-features-2026-09-30-v1'
    and eligibility.resolved_at is null;

  select * into profile_row
  from public.profiles profile
  where profile.id = owner_id
  for update;
  if not found then
    raise insufficient_privilege using message = 'profile_not_available';
  end if;
  if profile_row.username is null
    or lower(trim(profile_row.username)) !~ '^[a-z0-9][a-z0-9._]{1,39}$'
    or coalesce(
      nullif(trim(profile_row.display_name), ''),
      nullif(trim(profile_row.name), '')
    ) is null then
    raise invalid_parameter_value using message = 'social_identity_incomplete';
  end if;

  update public.profiles
  set profile_visibility = requested_visibility
  where id = owner_id
  returning profile_visibility into saved;

  insert into public.social_profiles (
    user_id, username, display_name, avatar_url, privacy, updated_at
  ) values (
    owner_id,
    lower(trim(profile_row.username)),
    coalesce(
      nullif(trim(profile_row.display_name), ''),
      nullif(trim(profile_row.name), '')
    ),
    profile_row.avatar_url,
    upper(requested_visibility),
    clock_timestamp()
  )
  on conflict (user_id) do update set
    username = excluded.username,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    privacy = excluded.privacy,
    updated_at = excluded.updated_at;

  return saved;
end;
$$;

create or replace function public.set_my_notification_preferences_v1(
  requested_push boolean,
  requested_email boolean,
  requested_rounds boolean,
  requested_reminders boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  decision_time timestamptz;
  saved public.user_preferences%rowtype;
begin
  if owner_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;
  if not private.account_data_access_allowed() then
    raise insufficient_privilege using message = 'account_access_restricted';
  end if;
  if requested_push is null
    or requested_email is null
    or requested_rounds is null
    or requested_reminders is null then
    raise invalid_parameter_value using message = 'notification_preferences_required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('optional-authorization:' || owner_id::text, 0)
  );
  delete from private.optional_authorization_onboarding_eligibility eligibility
  where eligibility.user_id = owner_id
    and eligibility.bundle_version = 'optional-features-2026-09-30-v1'
    and eligibility.resolved_at is null;
  decision_time := clock_timestamp();

  insert into public.user_preferences (
    user_id,
    push_notifications_enabled,
    email_notifications_enabled,
    round_notifications_enabled,
    reminders_enabled,
    updated_at,
    updated_by_device
  ) values (
    owner_id,
    requested_push,
    requested_email,
    requested_rounds,
    requested_reminders,
    decision_time,
    'server:notification-preferences-v1'
  )
  on conflict (user_id) do update set
    push_notifications_enabled = excluded.push_notifications_enabled,
    email_notifications_enabled = excluded.email_notifications_enabled,
    round_notifications_enabled = excluded.round_notifications_enabled,
    reminders_enabled = excluded.reminders_enabled,
    updated_at = excluded.updated_at,
    version = public.user_preferences.version + 1,
    updated_by_device = excluded.updated_by_device
  returning * into saved;

  return jsonb_build_object(
    'push_notifications_enabled', saved.push_notifications_enabled,
    'email_notifications_enabled', saved.email_notifications_enabled,
    'round_notifications_enabled', saved.round_notifications_enabled,
    'reminders_enabled', saved.reminders_enabled,
    'updated_at', saved.updated_at
  );
end;
$$;

create or replace function public.set_my_social_activity_preferences_v1(
  requested_preferences jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  preference_key text;
  required_keys constant text[] := array[
    'shareRounds',
    'shareAchievements',
    'shareEquipment',
    'shareCourses',
    'notifyLike',
    'notifyComment',
    'notifyAttest',
    'notifyFriendAchievement',
    'notifyEquipment',
    'notifyFriendRequest'
  ];
  decision_time timestamptz;
  saved public.social_activity_preferences_v3%rowtype;
  saved_audience text;
  changed_rows integer;
begin
  if owner_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;
  if not private.account_data_access_allowed() then
    raise insufficient_privilege using message = 'account_access_restricted';
  end if;
  if requested_preferences is null
    or jsonb_typeof(requested_preferences) <> 'object'
    or not requested_preferences ?& required_keys then
    raise invalid_parameter_value using message = 'social_preferences_required';
  end if;
  for preference_key in select jsonb_object_keys(requested_preferences) loop
    if not preference_key = any(
      required_keys || array['enabledForFriends']::text[]
    ) or jsonb_typeof(requested_preferences -> preference_key) <> 'boolean' then
      raise invalid_parameter_value using message = 'invalid_social_preferences';
    end if;
  end loop;

  perform pg_advisory_xact_lock(
    hashtextextended('optional-authorization:' || owner_id::text, 0)
  );
  delete from private.optional_authorization_onboarding_eligibility eligibility
  where eligibility.user_id = owner_id
    and eligibility.bundle_version = 'optional-features-2026-09-30-v1'
    and eligibility.resolved_at is null;
  decision_time := clock_timestamp();

  insert into public.social_activity_preferences_v3 (
    user_id,
    share_rounds,
    share_achievements,
    share_equipment,
    share_courses,
    notify_like,
    notify_comment,
    notify_attest,
    notify_friend_achievement,
    notify_equipment,
    notify_friend_request,
    updated_at
  ) values (
    owner_id,
    (requested_preferences ->> 'shareRounds')::boolean,
    (requested_preferences ->> 'shareAchievements')::boolean,
    (requested_preferences ->> 'shareEquipment')::boolean,
    (requested_preferences ->> 'shareCourses')::boolean,
    (requested_preferences ->> 'notifyLike')::boolean,
    (requested_preferences ->> 'notifyComment')::boolean,
    (requested_preferences ->> 'notifyAttest')::boolean,
    (requested_preferences ->> 'notifyFriendAchievement')::boolean,
    (requested_preferences ->> 'notifyEquipment')::boolean,
    (requested_preferences ->> 'notifyFriendRequest')::boolean,
    decision_time
  )
  on conflict (user_id) do update set
    share_rounds = excluded.share_rounds,
    share_achievements = excluded.share_achievements,
    share_equipment = excluded.share_equipment,
    share_courses = excluded.share_courses,
    notify_like = excluded.notify_like,
    notify_comment = excluded.notify_comment,
    notify_attest = excluded.notify_attest,
    notify_friend_achievement = excluded.notify_friend_achievement,
    notify_equipment = excluded.notify_equipment,
    notify_friend_request = excluded.notify_friend_request,
    updated_at = excluded.updated_at
  returning * into saved;

  if requested_preferences ? 'enabledForFriends' then
    saved_audience := case
      when (requested_preferences ->> 'enabledForFriends')::boolean
        then 'FRIENDS'
      else 'PRIVATE'
    end;
    update public.profiles
    set social_privacy = saved_audience
    where id = owner_id;
    get diagnostics changed_rows = row_count;
    if changed_rows <> 1 then
      raise invalid_parameter_value using message = 'profile_projection_failed';
    end if;
  else
    select profile.social_privacy into saved_audience
    from public.profiles profile
    where profile.id = owner_id;
    if not found then
      raise invalid_parameter_value using message = 'profile_projection_failed';
    end if;
  end if;

  return to_jsonb(saved) || jsonb_build_object(
    'enabled_for_friends', saved_audience = 'FRIENDS'
  );
end;
$$;

revoke all on function public.set_my_profile_visibility(text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_my_notification_preferences_v1(boolean, boolean, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.set_my_social_activity_preferences_v1(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_profile_visibility(text)
  to authenticated;
grant execute on function public.set_my_notification_preferences_v1(boolean, boolean, boolean, boolean)
  to authenticated;
grant execute on function public.set_my_social_activity_preferences_v1(jsonb)
  to authenticated;

comment on function public.set_my_profile_visibility(text) is
  'Owner-only profile audience update that atomically consumes any unresolved optional-onboarding offer.';
comment on function public.set_my_notification_preferences_v1(boolean, boolean, boolean, boolean) is
  'Owner-only notification-channel update that atomically consumes any unresolved optional-onboarding offer.';
comment on function public.set_my_social_activity_preferences_v1(jsonb) is
  'Owner-only Social preference/master update that atomically consumes any unresolved optional-onboarding offer.';

create or replace function private.optional_authorization_eligible_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and private.account_data_access_allowed()
    and exists (
    select 1
    from private.optional_authorization_onboarding_eligibility eligibility
    where eligibility.user_id = (select auth.uid())
      and eligibility.bundle_version = 'optional-features-2026-09-30-v1'
      and eligibility.resolved_at is null
  )
    and not exists (
      select 1
      from public.optional_authorization_events event
      where event.user_id = (select auth.uid())
    )
    and not exists (
      select 1
      from public.ai_processing_consents consent
      where consent.user_id = (select auth.uid())
        and consent.scope in (
          'AI_PROVIDER_PROCESSING_CONSENT',
          'AI_IMAGE_PROCESSING_CONSENT',
          'AI_LAUNCH_MONITOR_PROCESSING_CONSENT'
        )
    )
$$;
revoke all on function private.optional_authorization_eligible_v1()
  from public, anon;
grant execute on function private.optional_authorization_eligible_v1()
  to authenticated, service_role;

-- Owner-readable canonical state. AI scopes remain sourced from their existing
-- versioned ledger so a later individual AI revocation is reflected here. The
-- four new scopes are sourced from optional_authorization_events.
create or replace function public.get_optional_authorization_state_v1()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  result jsonb;
begin
  if owner_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;

  with expected_scopes(scope, policy_version, ledger_kind) as (
    values
      ('AI_PROVIDER_PROCESSING_CONSENT'::text, '2026-09-08-v2'::text, 'AI'::text),
      ('AI_IMAGE_PROCESSING_CONSENT', '2026-09-08-v2', 'AI'),
      ('AI_LAUNCH_MONITOR_PROCESSING_CONSENT', '2026-09-08-v2', 'AI'),
      ('PERSONAL_MEMORY', 'ai-first-phase1-v1', 'OPTIONAL'),
      ('GLOBAL_LEARNING', 'ai-first-phase1-v1', 'OPTIONAL'),
      ('LOCATION_INTERNAL', 'optional-features-2026-09-30-v1', 'OPTIONAL'),
      ('NOTIFICATION_INTERNAL', 'optional-features-2026-09-30-v1', 'OPTIONAL')
  ), current_scopes as (
    select
      expected.scope,
      expected.policy_version as expected_policy_version,
      decision.decision_status,
      decision.policy_version,
      decision.source,
      decision.decided_at
    from expected_scopes expected
    left join lateral (
      select ai.decision_status, ai.policy_version, ai.source, ai.decided_at, ai.id
      from public.ai_processing_consents ai
      where expected.ledger_kind = 'AI'
        and ai.user_id = owner_id
        and ai.scope = expected.scope
        and ai.policy_version = expected.policy_version
      union all
      select optional_event.decision_status, optional_event.policy_version,
        optional_event.source, optional_event.decided_at, optional_event.id
      from public.optional_authorization_events optional_event
      where expected.ledger_kind = 'OPTIONAL'
        and optional_event.user_id = owner_id
        and optional_event.scope = expected.scope
        and optional_event.policy_version = expected.policy_version
      order by id desc
      limit 1
    ) decision on true
  ), scope_state as (
    select jsonb_object_agg(
      scope,
      jsonb_build_object(
        'active', coalesce(decision_status = 'accepted', false),
        'status', coalesce(decision_status, 'missing'),
        'policyVersion', coalesce(policy_version, expected_policy_version),
        'source', source,
        'decidedAt', decided_at
      )
      order by scope
    ) as value
    from current_scopes
  ), receipt_state as (
    select jsonb_build_object(
      'id', receipt.id,
      'bundleVersion', receipt.bundle_version,
      'action', receipt.action,
      'idempotencyKey', receipt.idempotency_key,
      'featureSet', receipt.feature_set,
      'decidedAt', receipt.decided_at
    ) as value
    from public.optional_authorization_bundle_receipts receipt
    where receipt.user_id = owner_id
      and receipt.bundle_version = 'optional-features-2026-09-30-v1'
    order by receipt.created_at desc
    limit 1
  )
  select jsonb_build_object(
    'bundleVersion', 'optional-features-2026-09-30-v1',
    'resolved', exists (
      select 1 from public.optional_authorization_bundle_receipts receipt
      where receipt.user_id = owner_id
        and receipt.bundle_version = 'optional-features-2026-09-30-v1'
    ),
    'eligible', private.optional_authorization_eligible_v1(),
    'receipt', (select value from receipt_state),
    'scopes', coalesce((select value from scope_state), '{}'::jsonb),
    'profileVisibility', coalesce((
      select profile.profile_visibility from public.profiles profile
      where profile.id = owner_id
    ), 'private'),
    'socialPrivacy', coalesce((
      select profile.social_privacy from public.profiles profile
      where profile.id = owner_id
    ), 'PRIVATE'),
    'socialProfilePrivacy', coalesce((
      select profile.privacy from public.social_profiles profile
      where profile.user_id = owner_id
    ), 'PRIVATE'),
    'sharing', coalesce((
      select jsonb_build_object(
        'enabledForFriends', profile.social_privacy = 'FRIENDS',
        'rounds', coalesce(preference.share_rounds, false),
        'achievements', coalesce(preference.share_achievements, false),
        'equipment', coalesce(preference.share_equipment, false),
        'courses', coalesce(preference.share_courses, false)
      )
      from public.profiles profile
      left join public.social_activity_preferences_v3 preference
        on preference.user_id = profile.id
      where profile.id = owner_id
    ), jsonb_build_object(
      'enabledForFriends', false,
      'rounds', false,
      'achievements', false,
      'equipment', false,
      'courses', false
    )),
    'notifications', coalesce((
      select jsonb_build_object(
        'internal', coalesce(preference.notification_internal_enabled, false),
        'master', coalesce(preference.notifications_enabled, false),
        'push', coalesce(preference.push_notifications_enabled, false),
        'email', coalesce(preference.email_notifications_enabled, false),
        'rounds', coalesce(preference.round_notifications_enabled, false),
        'reminders', coalesce(preference.reminders_enabled, false)
      )
      from public.user_preferences preference
      where preference.user_id = owner_id
    ), jsonb_build_object(
      'internal', false,
      'master', false,
      'push', false,
      'email', false,
      'rounds', false,
      'reminders', false
    ))
  ) into result;

  return result;
end;
$$;

-- One transactional resolution for the initial checkpoint. The private
-- eligibility marker ensures this RPC cannot reinterpret old missing values as
-- historical consent. A receipt makes every retry idempotent and prevents a
-- later bundle retry from undoing an individual revocation.
create or replace function public.resolve_optional_authorization_bundle_v1(
  requested_action text,
  requested_bundle_version text,
  requested_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  supported_bundle constant text := 'optional-features-2026-09-30-v1';
  decision_time timestamptz;
  enabled boolean;
  decision_source text;
  existing_receipt public.optional_authorization_bundle_receipts%rowtype;
  created_receipt_id uuid;
  changed_rows integer;
begin
  if owner_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;
  if not private.account_data_access_allowed() then
    raise insufficient_privilege using message = 'account_access_restricted';
  end if;
  if requested_action is null
    or requested_action not in ('authorize_all', 'decline_all') then
    raise invalid_parameter_value using message = 'invalid_optional_authorization_action';
  end if;
  if requested_bundle_version is distinct from supported_bundle then
    raise invalid_parameter_value using message = 'unsupported_optional_authorization_bundle';
  end if;
  if requested_idempotency_key is null then
    raise invalid_parameter_value using message = 'idempotency_key_required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('optional-authorization:' || owner_id::text, 0)
  );
  -- Serialize against the pre-existing canonical AI decision RPC before its
  -- ledger is inspected. This prevents a concurrent legacy AI checkpoint from
  -- landing between the partial-state precheck and this bundle's three rows.
  perform pg_advisory_xact_lock(
    hashtextextended('ai-processing-consent:' || owner_id::text, 0)
  );
  -- Timestamp the decision only after this account's mutation lanes are
  -- serialized. A later committed decision must never carry an older clock
  -- than the decision immediately before it.
  select greatest(
    clock_timestamp(),
    coalesce(max(evidence.decided_at) + interval '1 millisecond', '-infinity'::timestamptz)
  ) into decision_time
  from (
    select event.decided_at
    from public.optional_authorization_events event
    where event.user_id = owner_id
    union all
    select consent.decided_at
    from public.ai_processing_consents consent
    where consent.user_id = owner_id
  ) evidence;

  select receipt.* into existing_receipt
  from public.optional_authorization_bundle_receipts receipt
  where receipt.user_id = owner_id
    and receipt.bundle_version = supported_bundle
  limit 1;

  if found then
    if existing_receipt.action <> requested_action then
      raise invalid_parameter_value
        using message = 'optional_authorization_bundle_already_resolved';
    end if;
    return public.get_optional_authorization_state_v1();
  end if;

  if not exists (
    select 1
    from private.optional_authorization_onboarding_eligibility eligibility
    where eligibility.user_id = owner_id
      and eligibility.bundle_version = supported_bundle
      and eligibility.resolved_at is null
  ) then
    raise insufficient_privilege
      using message = 'optional_authorization_bundle_not_eligible';
  end if;

  -- A parallel/legacy partial choice must be resolved explicitly instead of
  -- being overwritten by a broad bundle action.
  if exists (
    select 1 from public.optional_authorization_events event
    where event.user_id = owner_id
  ) or exists (
    select 1 from public.ai_processing_consents consent
    where consent.user_id = owner_id
      and consent.scope in (
        'AI_PROVIDER_PROCESSING_CONSENT',
        'AI_IMAGE_PROCESSING_CONSENT',
        'AI_LAUNCH_MONITOR_PROCESSING_CONSENT'
      )
  ) then
    delete from private.optional_authorization_onboarding_eligibility eligibility
    where eligibility.user_id = owner_id
      and eligibility.bundle_version = supported_bundle
      and eligibility.resolved_at is null;
    return public.get_optional_authorization_state_v1();
  end if;

  -- Defense in depth for explicit privacy/sharing/channel choices written by
  -- a mixed-version client before it knew about the eligibility consumer.
  -- Consume the broad offer and return the preserved state; the HTTP boundary
  -- will not report bundle success because no receipt exists.
  if exists (
    select 1 from public.profiles profile
    where profile.id = owner_id
      and (profile.profile_visibility <> 'private' or profile.social_privacy <> 'PRIVATE')
  ) or exists (
    select 1 from public.social_profiles profile
    where profile.user_id = owner_id and profile.privacy <> 'PRIVATE'
  ) or exists (
    select 1 from public.social_activity_preferences_v3 preference
    where preference.user_id = owner_id
      and (
        preference.share_rounds or preference.share_achievements
        or preference.share_equipment or preference.share_courses
        or preference.notify_like or preference.notify_comment
        or preference.notify_attest or preference.notify_friend_achievement
        or preference.notify_equipment or preference.notify_friend_request
      )
  ) or exists (
    select 1 from public.user_preferences preference
    where preference.user_id = owner_id
      and (
        coalesce(preference.personal_memory_enabled, false)
        or coalesce(preference.global_learning_enabled, false)
        or coalesce(preference.location_internal_enabled, false)
        or coalesce(preference.notification_internal_enabled, false)
        or preference.notifications_enabled
        or preference.push_notifications_enabled
        or preference.email_notifications_enabled
        or preference.round_notifications_enabled
        or preference.reminders_enabled
      )
  ) or exists (
    select 1 from public.notification_preferences_v2 preference
    where preference.user_id = owner_id and (preference.in_app or preference.push)
  ) then
    delete from private.optional_authorization_onboarding_eligibility eligibility
    where eligibility.user_id = owner_id
      and eligibility.bundle_version = supported_bundle
      and eligibility.resolved_at is null;
    return public.get_optional_authorization_state_v1();
  end if;

  if not exists (select 1 from public.profiles profile where profile.id = owner_id)
    or not exists (select 1 from public.social_profiles profile where profile.user_id = owner_id)
    or not exists (select 1 from public.user_preferences preference where preference.user_id = owner_id)
    or not exists (select 1 from public.social_activity_preferences_v3 preference where preference.user_id = owner_id) then
    raise invalid_parameter_value
      using message = 'optional_authorization_projections_unavailable';
  end if;

  enabled := requested_action = 'authorize_all';
  decision_source := case
    when enabled then 'onboarding_authorize_all'
    else 'onboarding_decline_all'
  end;

  insert into public.optional_authorization_bundle_receipts (
    user_id, bundle_version, action, idempotency_key, feature_set, decided_at
  ) values (
    owner_id,
    supported_bundle,
    requested_action,
    requested_idempotency_key,
    jsonb_build_object(
      'scopes', jsonb_build_array(
        jsonb_build_object('scope', 'AI_PROVIDER_PROCESSING_CONSENT', 'policyVersion', '2026-09-08-v2'),
        jsonb_build_object('scope', 'AI_IMAGE_PROCESSING_CONSENT', 'policyVersion', '2026-09-08-v2'),
        jsonb_build_object('scope', 'AI_LAUNCH_MONITOR_PROCESSING_CONSENT', 'policyVersion', '2026-09-08-v2'),
        jsonb_build_object('scope', 'PERSONAL_MEMORY', 'policyVersion', 'ai-first-phase1-v1'),
        jsonb_build_object('scope', 'GLOBAL_LEARNING', 'policyVersion', 'ai-first-phase1-v1'),
        jsonb_build_object('scope', 'LOCATION_INTERNAL', 'policyVersion', supported_bundle),
        jsonb_build_object('scope', 'NOTIFICATION_INTERNAL', 'policyVersion', supported_bundle)
      ),
      'excluded', jsonb_build_array('MARKETING', 'FINANCIAL_PATRIMONIAL'),
      'projections', jsonb_build_object(
        'profileVisibility', case when enabled then 'public' else 'private' end,
        'socialPrivacy', case when enabled then 'FRIENDS' else 'PRIVATE' end,
        'socialProfilePrivacy', case when enabled then 'PUBLIC' else 'PRIVATE' end,
        'sharing', jsonb_build_object(
          'enabledForFriends', enabled,
          'rounds', enabled,
          'achievements', enabled,
          'equipment', enabled,
          'courses', enabled
        ),
        'notifications', jsonb_build_object(
          'internal', enabled,
          'master', enabled,
          'push', enabled,
          'email', enabled,
          'rounds', enabled,
          'reminders', enabled
        )
      )
    ),
    decision_time
  )
  returning id into created_receipt_id;

  insert into public.optional_authorization_events (
    user_id, scope, decision_status, policy_version, source,
    bundle_version, idempotency_key, decided_at
  )
  select
    owner_id,
    scope_definition.scope,
    case when enabled then 'accepted' else 'declined' end,
    scope_definition.policy_version,
    decision_source,
    supported_bundle,
    requested_idempotency_key,
    decision_time
  from (values
    ('AI_PROVIDER_PROCESSING_CONSENT'::text, '2026-09-08-v2'::text),
    ('AI_IMAGE_PROCESSING_CONSENT', '2026-09-08-v2'),
    ('AI_LAUNCH_MONITOR_PROCESSING_CONSENT', '2026-09-08-v2'),
    ('PERSONAL_MEMORY', 'ai-first-phase1-v1'),
    ('GLOBAL_LEARNING', 'ai-first-phase1-v1'),
    ('LOCATION_INTERNAL', supported_bundle),
    ('NOTIFICATION_INTERNAL', supported_bundle)
  ) as scope_definition(scope, policy_version);

  insert into public.ai_processing_consents (
    user_id, scope, policy_version, decision_status, source, decided_at,
    accepted_at, revoked_at, locale, updated_at
  )
  select
    owner_id,
    ai_scope.scope,
    '2026-09-08-v2',
    case when enabled then 'accepted' else 'declined' end,
    'onboarding',
    decision_time,
    case when enabled then decision_time else null end,
    null,
    'es-MX',
    decision_time
  from (values
    ('AI_PROVIDER_PROCESSING_CONSENT'::text),
    ('AI_IMAGE_PROCESSING_CONSENT'),
    ('AI_LAUNCH_MONITOR_PROCESSING_CONSENT')
  ) as ai_scope(scope);

  update public.profiles
  set profile_visibility = case when enabled then 'public' else 'private' end,
      social_privacy = case when enabled then 'FRIENDS' else 'PRIVATE' end,
      updated_at = decision_time,
      version = version + 1,
      updated_by_device = 'server:optional-authorizations-v1'
  where id = owner_id;
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise invalid_parameter_value using message = 'profile_projection_failed';
  end if;

  update public.social_profiles
  set privacy = case when enabled then 'PUBLIC' else 'PRIVATE' end,
      updated_at = decision_time
  where user_id = owner_id;
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise invalid_parameter_value using message = 'social_profile_projection_failed';
  end if;

  insert into public.user_preferences (
    user_id,
    notifications_enabled,
    push_notifications_enabled,
    email_notifications_enabled,
    round_notifications_enabled,
    reminders_enabled,
    personal_memory_enabled,
    global_learning_enabled,
    location_internal_enabled,
    notification_internal_enabled,
    updated_at,
    updated_by_device
  ) values (
    owner_id,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    decision_time,
    'server:optional-authorizations-v1'
  )
  on conflict (user_id) do update set
    notifications_enabled = excluded.notifications_enabled,
    push_notifications_enabled = excluded.push_notifications_enabled,
    email_notifications_enabled = excluded.email_notifications_enabled,
    round_notifications_enabled = excluded.round_notifications_enabled,
    reminders_enabled = excluded.reminders_enabled,
    personal_memory_enabled = excluded.personal_memory_enabled,
    global_learning_enabled = excluded.global_learning_enabled,
    location_internal_enabled = excluded.location_internal_enabled,
    notification_internal_enabled = excluded.notification_internal_enabled,
    updated_at = excluded.updated_at,
    version = public.user_preferences.version + 1,
    updated_by_device = excluded.updated_by_device;

  insert into public.social_activity_preferences_v3 (
    user_id,
    share_rounds,
    share_achievements,
    share_equipment,
    share_courses,
    notify_like,
    notify_comment,
    notify_attest,
    notify_friend_achievement,
    notify_equipment,
    notify_friend_request,
    updated_at
  ) values (
    owner_id,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    enabled,
    decision_time
  )
  on conflict (user_id) do update set
    share_rounds = excluded.share_rounds,
    share_achievements = excluded.share_achievements,
    share_equipment = excluded.share_equipment,
    share_courses = excluded.share_courses,
    notify_like = excluded.notify_like,
    notify_comment = excluded.notify_comment,
    notify_attest = excluded.notify_attest,
    notify_friend_achievement = excluded.notify_friend_achievement,
    notify_equipment = excluded.notify_equipment,
    notify_friend_request = excluded.notify_friend_request,
    updated_at = excluded.updated_at;

  insert into public.notification_preferences_v2 (
    user_id, event_type, in_app, push, updated_at
  )
  select owner_id, event_type, enabled, enabled, decision_time
  from unnest(array[
    'friend_request',
    'friend_accepted',
    'group_invite',
    'round_invite',
    'round_started',
    'round_finished',
    'scorecard_ready'
  ]::text[]) event_type
  on conflict (user_id, event_type) do update set
    in_app = excluded.in_app,
    push = excluded.push,
    updated_at = excluded.updated_at;

  update private.optional_authorization_onboarding_eligibility
  set resolved_at = decision_time,
      resolution_action = requested_action,
      receipt_id = created_receipt_id
  where user_id = owner_id
    and bundle_version = supported_bundle
    and resolved_at is null;
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise invalid_parameter_value
      using message = 'optional_authorization_eligibility_resolution_failed';
  end if;

  return public.get_optional_authorization_state_v1();
end;
$$;

-- Explicit post-onboarding settings decisions for the four non-AI optional
-- scopes. AI retains its existing independently revocable/versioned server
-- path. No marketing or financial/patrimonial scope is accepted here.
create or replace function public.set_optional_authorization_scope_v1(
  requested_scope text,
  requested_enabled boolean,
  requested_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  decision_time timestamptz;
  selected_policy_version text;
  prior_status text;
  next_status text;
  replay_status text;
begin
  if owner_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;
  if not private.account_data_access_allowed() then
    raise insufficient_privilege using message = 'account_access_restricted';
  end if;
  if requested_scope is null or requested_scope not in (
    'PERSONAL_MEMORY',
    'GLOBAL_LEARNING',
    'LOCATION_INTERNAL',
    'NOTIFICATION_INTERNAL'
  ) then
    raise invalid_parameter_value using message = 'unsupported_optional_authorization_scope';
  end if;
  if requested_enabled is null then
    raise invalid_parameter_value using message = 'optional_authorization_decision_required';
  end if;
  if requested_idempotency_key is null then
    raise invalid_parameter_value using message = 'idempotency_key_required';
  end if;

  selected_policy_version := case
    when requested_scope in ('PERSONAL_MEMORY', 'GLOBAL_LEARNING')
      then 'ai-first-phase1-v1'
    else 'optional-features-2026-09-30-v1'
  end;

  perform pg_advisory_xact_lock(
    hashtextextended('optional-authorization:' || owner_id::text, 0)
  );
  -- An individual settings decision supersedes the unresolved one-time
  -- onboarding bundle without fabricating a bundle receipt. Preserve the
  -- narrow decision and stop presenting a broad action that can no longer be
  -- applied atomically.
  delete from private.optional_authorization_onboarding_eligibility eligibility
  where eligibility.user_id = owner_id
    and eligibility.bundle_version = 'optional-features-2026-09-30-v1'
    and eligibility.resolved_at is null;
  select greatest(
    clock_timestamp(),
    coalesce(max(evidence.decided_at) + interval '1 millisecond', '-infinity'::timestamptz)
  ) into decision_time
  from (
    select event.decided_at
    from public.optional_authorization_events event
    where event.user_id = owner_id
    union all
    select consent.decided_at
    from public.ai_processing_consents consent
    where consent.user_id = owner_id
  ) evidence;

  select event.decision_status into replay_status
  from public.optional_authorization_events event
  where event.user_id = owner_id
    and event.scope = requested_scope
    and event.idempotency_key = requested_idempotency_key
  limit 1;

  if found then
    if (requested_enabled and replay_status <> 'accepted')
      or (not requested_enabled and replay_status not in ('declined', 'revoked')) then
      raise invalid_parameter_value
        using message = 'optional_authorization_idempotency_conflict';
    end if;
    return public.get_optional_authorization_state_v1();
  end if;

  select event.decision_status into prior_status
  from public.optional_authorization_events event
  where event.user_id = owner_id
    and event.scope = requested_scope
    and event.policy_version = selected_policy_version
  order by event.id desc
  limit 1;

  next_status := case
    when requested_enabled then 'accepted'
    when prior_status = 'accepted' then 'revoked'
    else 'declined'
  end;

  insert into public.optional_authorization_events (
    user_id, scope, decision_status, policy_version, source,
    bundle_version, idempotency_key, decided_at
  ) values (
    owner_id,
    requested_scope,
    next_status,
    selected_policy_version,
    'settings',
    null,
    requested_idempotency_key,
    decision_time
  );

  insert into public.user_preferences (
    user_id,
    personal_memory_enabled,
    global_learning_enabled,
    location_internal_enabled,
    notification_internal_enabled,
    notifications_enabled,
    updated_at,
    updated_by_device
  ) values (
    owner_id,
    case when requested_scope = 'PERSONAL_MEMORY' then requested_enabled else null end,
    case when requested_scope = 'GLOBAL_LEARNING' then requested_enabled else null end,
    case when requested_scope = 'LOCATION_INTERNAL' then requested_enabled else null end,
    case when requested_scope = 'NOTIFICATION_INTERNAL' then requested_enabled else null end,
    case when requested_scope = 'NOTIFICATION_INTERNAL' then requested_enabled else false end,
    decision_time,
    'server:optional-authorizations-v1'
  )
  on conflict (user_id) do update set
    personal_memory_enabled = case
      when requested_scope = 'PERSONAL_MEMORY' then requested_enabled
      else public.user_preferences.personal_memory_enabled
    end,
    global_learning_enabled = case
      when requested_scope = 'GLOBAL_LEARNING' then requested_enabled
      else public.user_preferences.global_learning_enabled
    end,
    location_internal_enabled = case
      when requested_scope = 'LOCATION_INTERNAL' then requested_enabled
      else public.user_preferences.location_internal_enabled
    end,
    notification_internal_enabled = case
      when requested_scope = 'NOTIFICATION_INTERNAL' then requested_enabled
      else public.user_preferences.notification_internal_enabled
    end,
    notifications_enabled = case
      when requested_scope = 'NOTIFICATION_INTERNAL' then requested_enabled
      else public.user_preferences.notifications_enabled
    end,
    updated_at = excluded.updated_at,
    version = public.user_preferences.version + 1,
    updated_by_device = excluded.updated_by_device;

  return public.get_optional_authorization_state_v1();
end;
$$;

revoke all on function public.get_optional_authorization_state_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_optional_authorization_bundle_v1(text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.set_optional_authorization_scope_v1(text, boolean, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_optional_authorization_state_v1()
  to authenticated;
grant execute on function public.resolve_optional_authorization_bundle_v1(text, text, uuid)
  to authenticated;
grant execute on function public.set_optional_authorization_scope_v1(text, boolean, uuid)
  to authenticated;

comment on function public.get_optional_authorization_state_v1() is
  'Owner-only canonical optional authorization state. Device/OS permission and delivery remain separate states.';
comment on function private.optional_authorization_eligible_v1() is
  'Owner-bound boolean only; preserves a private no-backfill eligibility table while the state getter remains SECURITY INVOKER.';
comment on function public.resolve_optional_authorization_bundle_v1(text, text, uuid) is
  'Authenticated, atomic, one-time new-account authorization/decline bundle. Derives auth.uid and never includes marketing or financial/patrimonial processing.';
comment on function public.set_optional_authorization_scope_v1(text, boolean, uuid) is
  'Authenticated individual settings decision for memory, learning, internal location or internal notifications. Derives auth.uid.';

-- Reinstall the future-account bootstrap with privacy/off projections and an
-- eligibility marker. There is no historical UPDATE in this migration.
create or replace function public.handle_phase2_user_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  if exists (
    select 1 from public.social_profiles
    where lower(username) = lower(username_candidate)
  ) then
    username_candidate := left(username_base, 33) || '_'
      || substr(md5(new.id::text), 1, 6);
  end if;

  insert into public.profiles (
    id, name, display_name, avatar_url, username,
    social_privacy, profile_visibility
  ) values (
    new.id,
    '',
    '',
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    username_candidate,
    'PRIVATE',
    'private'
  )
  on conflict (id) do update set
    name = '',
    display_name = '',
    username = coalesce(public.profiles.username, excluded.username),
    social_privacy = 'PRIVATE',
    profile_visibility = 'private';

  insert into public.social_profiles (
    user_id, username, display_name, avatar_url, privacy
  ) values (
    new.id,
    username_candidate,
    'Golfista',
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    'PRIVATE'
  )
  on conflict (user_id) do update set
    privacy = 'PRIVATE',
    updated_at = clock_timestamp();

  insert into public.feature_entitlements (user_id, plan_id, metadata)
  values (new.id, 'BETA_PRO', jsonb_build_object('source', 'preview_beta_bootstrap'))
  on conflict (user_id) do nothing;

  insert into public.user_preferences (
    user_id,
    notifications_enabled,
    push_notifications_enabled,
    email_notifications_enabled,
    round_notifications_enabled,
    reminders_enabled,
    personal_memory_enabled,
    global_learning_enabled,
    location_internal_enabled,
    notification_internal_enabled
  ) values (
    new.id, false, false, false, false, false, false, false, false, false
  )
  on conflict (user_id) do update set
    notifications_enabled = false,
    push_notifications_enabled = false,
    email_notifications_enabled = false,
    round_notifications_enabled = false,
    reminders_enabled = false,
    personal_memory_enabled = false,
    global_learning_enabled = false,
    location_internal_enabled = false,
    notification_internal_enabled = false,
    updated_at = clock_timestamp(),
    version = public.user_preferences.version + 1,
    updated_by_device = 'server:new-account-bootstrap-v1';

  insert into public.social_activity_preferences_v3 (
    user_id,
    share_rounds,
    share_achievements,
    share_equipment,
    share_courses,
    notify_like,
    notify_comment,
    notify_attest,
    notify_friend_achievement,
    notify_equipment,
    notify_friend_request
  ) values (
    new.id, false, false, false, false, false, false, false, false, false, false
  )
  on conflict (user_id) do update set
    share_rounds = false,
    share_achievements = false,
    share_equipment = false,
    share_courses = false,
    notify_like = false,
    notify_comment = false,
    notify_attest = false,
    notify_friend_achievement = false,
    notify_equipment = false,
    notify_friend_request = false,
    updated_at = clock_timestamp();

  insert into public.notification_preferences_v2 (
    user_id, event_type, in_app, push
  )
  select new.id, event_type, false, false
  from unnest(array[
    'friend_request',
    'friend_accepted',
    'group_invite',
    'round_invite',
    'round_started',
    'round_finished',
    'scorecard_ready'
  ]::text[]) event_type
  on conflict (user_id, event_type) do update set
    in_app = false,
    push = false,
    updated_at = clock_timestamp();

  insert into private.optional_authorization_onboarding_eligibility (
    user_id, bundle_version
  ) values (
    new.id, 'optional-features-2026-09-30-v1'
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_phase2_user_bootstrap()
  from public, anon, authenticated, service_role;

comment on function public.handle_phase2_user_bootstrap() is
  'Future accounts only: creates private/off projections and an unresolved private authorization marker. It never backfills historical users.';

commit;

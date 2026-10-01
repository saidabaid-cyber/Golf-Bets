-- DEV-only rollout. New explicit resolutions use v2; historical receipts and
-- decisions are never rewritten. Public audience and friend activity are
-- independent. Device policy versions remain v1 to preserve prior revocations.
begin;

create or replace function private.optional_authorization_state_v2(owner_id uuid, requested_environment text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if owner_id is null or not private.account_subject_active(owner_id) then
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
      and receipt.bundle_version in ('optional-features-2026-09-30-v1', 'optional-features-2026-10-01-v2')
    order by receipt.created_at desc
    limit 1
  )
  select jsonb_build_object(
    'bundleVersion', 'optional-features-2026-10-01-v2',
    'resolved', exists (
      select 1 from public.optional_authorization_bundle_receipts receipt
      where receipt.user_id = owner_id
        and receipt.bundle_version in ('optional-features-2026-09-30-v1', 'optional-features-2026-10-01-v2')
    ),
    'eligible', exists (
      select 1 from private.optional_authorization_onboarding_eligibility eligibility
      where eligibility.user_id = owner_id and eligibility.resolved_at is null
    ) and not exists (select 1 from public.optional_authorization_events where user_id = owner_id)
      and not exists (select 1 from public.ai_processing_consents where user_id = owner_id),
    'legal', (
      select jsonb_object_agg(subject, jsonb_build_object(
        'active', coalesce(evidence.action = 'accepted', false),
        'status', coalesce(evidence.action, 'missing'),
        'policyVersion', '2026-09-08-v6',
        'decidedAt', evidence.server_received_at
      )) from unnest(array['financial_data','marketing']::text[]) subject
      left join lateral (
        select event.action, event.server_received_at from public.legal_evidence_events event
        where event.user_id = owner_id and event.environment = requested_environment
          and event.purpose_key = subject and event.document_version = '2026-09-08-v6'
          and event.action in ('accepted','rejected','revoked')
        order by event.server_received_at desc, event.idempotency_key desc limit 1
      ) evidence on true
    ),
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


revoke all on function private.optional_authorization_state_v2(uuid,text) from public, anon, authenticated;

create or replace function public.get_optional_authorization_state_v2(requested_environment text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select private.optional_authorization_state_v2((select auth.uid()), requested_environment)
$$;
revoke all on function public.get_optional_authorization_state_v2(text) from public, anon;
grant execute on function public.get_optional_authorization_state_v2(text) to authenticated, service_role;

create or replace function public.resolve_optional_authorization_bundle_v2(
  requested_owner_id uuid,
  requested_action text,
  requested_bundle_version text,
  requested_idempotency_key uuid,
  requested_environment text,
  requested_deployment_ref text,
  requested_legal_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := requested_owner_id;
  supported_bundle constant text := 'optional-features-2026-10-01-v2';
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
  if not private.account_subject_active(owner_id) then
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
  -- Share the individual legal ledger's lock before inspecting any prior
  -- marketing/financial decision. A concurrent revocation cannot be broadened.
  perform pg_advisory_xact_lock(
    hashtextextended('legal-evidence:' || owner_id::text || ':' || requested_environment, 0)
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
    and receipt.bundle_version in ('optional-features-2026-09-30-v1', supported_bundle)
  limit 1;

  if found then
    if existing_receipt.action <> requested_action then
      raise invalid_parameter_value
        using message = 'optional_authorization_bundle_already_resolved';
    end if;
    return private.optional_authorization_state_v2(owner_id, requested_environment);
  end if;

  if not exists (
    select 1
    from private.optional_authorization_onboarding_eligibility eligibility
    where eligibility.user_id = owner_id
      and eligibility.bundle_version = 'optional-features-2026-09-30-v1'
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
  ) or exists (
    select 1 from public.legal_evidence_events
    where user_id = owner_id and environment = requested_environment
      and purpose_key in ('financial_data','marketing')
      and action in ('accepted','rejected','revoked')
  ) then
    delete from private.optional_authorization_onboarding_eligibility eligibility
    where eligibility.user_id = owner_id
      and eligibility.bundle_version = 'optional-features-2026-09-30-v1'
      and eligibility.resolved_at is null;
    return private.optional_authorization_state_v2(owner_id, requested_environment);
  end if;

  -- Defense in depth for explicit privacy/sharing/channel choices written by
  -- a mixed-version client before it knew about the eligibility consumer.
  -- Consume the broad offer and return the preserved state; the HTTP boundary
  -- will not report bundle success because no receipt exists.
  if exists (
    select 1 from public.profiles profile
    where profile.id = owner_id
      and profile.social_privacy <> 'PRIVATE'
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
      and eligibility.bundle_version = 'optional-features-2026-09-30-v1'
      and eligibility.resolved_at is null;
    return private.optional_authorization_state_v2(owner_id, requested_environment);
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

  -- The two legal purposes retain individual canonical envelopes. A failure
  -- here or in any later projection rolls back the entire bundle transaction.
  if jsonb_typeof(requested_legal_events) is distinct from 'array'
    or jsonb_array_length(requested_legal_events) <> 2
    or not exists (select 1 from jsonb_array_elements(requested_legal_events) e where e->>'subject' = 'financial_data')
    or not exists (select 1 from jsonb_array_elements(requested_legal_events) e where e->>'subject' = 'marketing')
    or exists (select 1 from jsonb_array_elements(requested_legal_events) e
      where e->>'action' is distinct from case when enabled then 'accepted' else 'rejected' end
        or e->>'origin' is distinct from 'onboarding') then
    raise invalid_parameter_value using message = 'invalid_optional_legal_evidence';
  end if;
  perform public.record_legal_evidence_batch(
    owner_id, requested_environment, requested_deployment_ref, requested_legal_events
  );

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
        jsonb_build_object('scope', 'LOCATION_INTERNAL', 'policyVersion', 'optional-features-2026-09-30-v1'),
        jsonb_build_object('scope', 'NOTIFICATION_INTERNAL', 'policyVersion', 'optional-features-2026-09-30-v1')
      ),
      'excluded', '[]'::jsonb,
      'legal', requested_legal_events,
      'projections', jsonb_build_object(
        'profileVisibility', (select profile_visibility from public.profiles where id = owner_id),
        'socialPrivacy', case when enabled then 'FRIENDS' else 'PRIVATE' end,
        'socialProfilePrivacy', (select privacy from public.social_profiles where user_id = owner_id),
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
    ('LOCATION_INTERNAL', 'optional-features-2026-09-30-v1'),
    ('NOTIFICATION_INTERNAL', 'optional-features-2026-09-30-v1')
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
  set social_privacy = case when enabled then 'FRIENDS' else 'PRIVATE' end,
      updated_at = decision_time,
      version = version + 1,
      updated_by_device = 'server:optional-authorizations-v2'
  where id = owner_id;
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise invalid_parameter_value using message = 'profile_projection_failed';
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
    'server:optional-authorizations-v2'
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
    and bundle_version = 'optional-features-2026-09-30-v1'
    and resolved_at is null;
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise invalid_parameter_value
      using message = 'optional_authorization_eligibility_resolution_failed';
  end if;

  return private.optional_authorization_state_v2(owner_id, requested_environment);
end;
$$;


-- Only the authenticated HTTP boundary may resolve v2 using its verified
-- account ID and server-derived canonical legal envelopes/environment.
revoke all on function public.resolve_optional_authorization_bundle_v2(uuid,text,text,uuid,text,text,jsonb)
from public, anon, authenticated;
grant execute on function public.resolve_optional_authorization_bundle_v2(uuid,text,text,uuid,text,text,jsonb) to service_role;
-- Old clients must reload rather than record the superseded incomplete bundle.
revoke execute on function public.resolve_optional_authorization_bundle_v1(text,text,uuid) from authenticated;

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
    'public'
  )
  -- An earlier auth INSERT trigger may have created this same fresh profile.
  on conflict (id) do update set
    name = '',
    display_name = '',
    username = coalesce(public.profiles.username, excluded.username),
    social_privacy = 'PRIVATE',
    profile_visibility = 'public';

  insert into public.social_profiles (
    user_id, username, display_name, avatar_url, privacy
  ) values (
    new.id,
    username_candidate,
    'Golfista',
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    'PUBLIC'
  )
  on conflict (user_id) do update set privacy = 'PUBLIC';

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
commit;

-- Explicit optional-authorizations schema, RLS, atomicity and idempotency.
-- Synthetic fixtures only; the transaction always rolls back.
begin;

do $$
declare
  target_table_name text;
  policy_count integer;
  function_oid oid;
  function_is_definer boolean;
  function_config text[];
  function_definition text;
begin
  foreach target_table_name in array array[
    'optional_authorization_events',
    'optional_authorization_bundle_receipts'
  ] loop
    if to_regclass('public.' || target_table_name) is null then
      raise exception 'missing public.%', target_table_name;
    end if;
    if not (
      select relation.relrowsecurity
      from pg_class relation
      where relation.oid = ('public.' || target_table_name)::regclass
    ) then
      raise exception 'RLS is not enabled on public.%', target_table_name;
    end if;
    if has_table_privilege('anon', 'public.' || target_table_name, 'SELECT')
      or has_table_privilege('anon', 'public.' || target_table_name, 'INSERT')
      or has_table_privilege('anon', 'public.' || target_table_name, 'UPDATE')
      or has_table_privilege('anon', 'public.' || target_table_name, 'DELETE') then
      raise exception 'anon unexpectedly has privileges on public.%', target_table_name;
    end if;
    if not has_table_privilege('authenticated', 'public.' || target_table_name, 'SELECT')
      or has_table_privilege('authenticated', 'public.' || target_table_name, 'INSERT')
      or has_table_privilege('authenticated', 'public.' || target_table_name, 'UPDATE')
      or has_table_privilege('authenticated', 'public.' || target_table_name, 'DELETE') then
      raise exception 'authenticated grants are not owner-read-only on public.%', target_table_name;
    end if;
    if not has_table_privilege('service_role', 'public.' || target_table_name, 'SELECT')
      or not has_table_privilege('service_role', 'public.' || target_table_name, 'INSERT')
      or has_table_privilege('service_role', 'public.' || target_table_name, 'UPDATE')
      or has_table_privilege('service_role', 'public.' || target_table_name, 'DELETE') then
      raise exception 'service_role grants are not append-only on public.%', target_table_name;
    end if;

    select count(*) into policy_count
    from pg_policies
    where schemaname = 'public'
      and tablename = target_table_name
      and cmd = 'SELECT'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and coalesce(qual, '') like '%auth.uid()%'
      and coalesce(qual, '') like '%user_id%';
    if policy_count <> 1 then
      raise exception 'public.% does not have exactly one owner-read policy', target_table_name;
    end if;

    select count(*) into policy_count
    from pg_policies
    where schemaname = 'public'
      and tablename = target_table_name
      and policyname = 'account_active_access'
      and cmd = 'ALL'
      and permissive = 'RESTRICTIVE'
      and roles = array['authenticated']::name[]
      and coalesce(qual, '') like '%private.account_data_access_allowed()%'
      and coalesce(with_check, '') like '%private.account_data_access_allowed()%';
    if policy_count <> 1 then
      raise exception 'public.% is missing the restrictive account lifecycle policy', target_table_name;
    end if;
  end loop;

  if to_regclass('private.optional_authorization_onboarding_eligibility') is null then
    raise exception 'missing private new-account eligibility table';
  end if;
  if has_sequence_privilege('anon', 'public.optional_authorization_events_id_seq', 'USAGE')
    or has_sequence_privilege('anon', 'public.optional_authorization_events_id_seq', 'SELECT')
    or has_sequence_privilege('authenticated', 'public.optional_authorization_events_id_seq', 'USAGE')
    or has_sequence_privilege('authenticated', 'public.optional_authorization_events_id_seq', 'SELECT')
    or not has_sequence_privilege('service_role', 'public.optional_authorization_events_id_seq', 'USAGE')
    or not has_sequence_privilege('service_role', 'public.optional_authorization_events_id_seq', 'SELECT') then
    raise exception 'optional authorization identity sequence grants are not service-only';
  end if;
  if has_table_privilege('anon', 'private.optional_authorization_onboarding_eligibility', 'SELECT')
    or has_table_privilege('authenticated', 'private.optional_authorization_onboarding_eligibility', 'SELECT')
    or has_table_privilege('authenticated', 'private.optional_authorization_onboarding_eligibility', 'INSERT')
    or has_table_privilege('authenticated', 'private.optional_authorization_onboarding_eligibility', 'UPDATE')
    or has_table_privilege('authenticated', 'private.optional_authorization_onboarding_eligibility', 'DELETE') then
    raise exception 'client can forge optional authorization eligibility';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public'
        and table_name = 'user_preferences'
        and column_name in (
          'personal_memory_enabled',
          'global_learning_enabled',
          'location_internal_enabled',
          'notification_internal_enabled'
        )) <> 4 then
    raise exception 'missing optional authorization preference projections';
  end if;

  if not has_table_privilege('service_role', 'public.profiles', 'SELECT')
    or not has_table_privilege('service_role', 'public.user_preferences', 'SELECT')
    or not has_table_privilege('service_role', 'public.legal_acceptances', 'SELECT')
    or not has_table_privilege('service_role', 'public.admin_audit_log', 'INSERT')
    or not has_sequence_privilege('service_role', 'public.admin_audit_log_id_seq', 'USAGE') then
    raise exception 'administrative privacy export lacks its least-privilege read/audit grants';
  end if;

  foreach function_oid in array array[
    to_regprocedure('public.resolve_optional_authorization_bundle_v1(text,text,uuid)')::oid,
    to_regprocedure('public.set_optional_authorization_scope_v1(text,boolean,uuid)')::oid,
    to_regprocedure('public.set_my_profile_visibility(text)')::oid,
    to_regprocedure('public.set_my_notification_preferences_v1(boolean,boolean,boolean,boolean)')::oid,
    to_regprocedure('public.set_my_social_activity_preferences_v1(jsonb)')::oid,
    to_regprocedure('public.get_optional_authorization_state_v1()')::oid
  ] loop
    if function_oid is null then
      raise exception 'missing optional authorization RPC';
    end if;
    select function.prosecdef, function.proconfig
      into function_is_definer, function_config
    from pg_proc function
    where function.oid = function_oid;
    if function_config is null or not exists (
      select 1 from unnest(function_config) setting
      where split_part(setting, '=', 1) = 'search_path'
        and split_part(setting, '=', 2) in ('', '""')
    ) then
      raise exception 'optional authorization RPC does not pin an empty search_path';
    end if;
    if has_function_privilege('anon', function_oid, 'EXECUTE')
      or not has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or has_function_privilege('service_role', function_oid, 'EXECUTE') then
      raise exception 'optional authorization RPC grants are not authenticated-only';
    end if;
  end loop;

  if not (
    select function.prosecdef
    from pg_proc function
    where function.oid = 'public.resolve_optional_authorization_bundle_v1(text,text,uuid)'::regprocedure
  ) or not (
    select function.prosecdef
    from pg_proc function
    where function.oid = 'public.set_optional_authorization_scope_v1(text,boolean,uuid)'::regprocedure
  ) or not (
    select function.prosecdef
    from pg_proc function
    where function.oid = 'public.set_my_profile_visibility(text)'::regprocedure
  ) or not (
    select function.prosecdef
    from pg_proc function
    where function.oid = 'public.set_my_notification_preferences_v1(boolean,boolean,boolean,boolean)'::regprocedure
  ) or not (
    select function.prosecdef
    from pg_proc function
    where function.oid = 'public.set_my_social_activity_preferences_v1(jsonb)'::regprocedure
  ) then
    raise exception 'mutation RPCs must be narrowly authenticated SECURITY DEFINER boundaries';
  end if;
  if to_regprocedure('public.consume_optional_authorization_onboarding_offer_v1()') is not null then
    raise exception 'standalone offer consumer remains callable without saving a decision';
  end if;
  if (
    select function.prosecdef
    from pg_proc function
    where function.oid = 'public.get_optional_authorization_state_v1()'::regprocedure
  ) then
    raise exception 'read RPC must remain SECURITY INVOKER';
  end if;

  function_oid := to_regprocedure('private.optional_authorization_eligible_v1()');
  if function_oid is null then
    raise exception 'missing private eligibility helper';
  end if;
  select function.prosecdef, function.proconfig
    into function_is_definer, function_config
  from pg_proc function
  where function.oid = function_oid;
  function_definition := pg_get_functiondef(function_oid);
  if not function_is_definer
    or function_config is null
    or not exists (
      select 1 from unnest(function_config) setting
      where split_part(setting, '=', 1) = 'search_path'
        and split_part(setting, '=', 2) in ('', '""')
    )
    or has_function_privilege('anon', function_oid, 'EXECUTE')
    or not has_function_privilege('authenticated', function_oid, 'EXECUTE')
    or pg_get_function_result(function_oid) <> 'boolean'
    or pg_get_function_arguments(function_oid) <> ''
    or function_definition not like '%auth.uid()%'
    or function_definition not like '%private.account_data_access_allowed()%' then
    raise exception 'private eligibility helper is not a narrow auth.uid boolean boundary';
  end if;

  function_definition := pg_get_functiondef(
    'public.resolve_optional_authorization_bundle_v1(text,text,uuid)'::regprocedure
  );
  if function_definition not like '%auth.uid()%'
    or function_definition not like '%pg_advisory_xact_lock%'
    or function_definition not like '%ai-processing-consent:%'
    or position('into decision_time' in lower(function_definition))
      < position('ai-processing-consent:' in lower(function_definition))
    or pg_get_functiondef(
      'public.set_optional_authorization_scope_v1(text,boolean,uuid)'::regprocedure
    ) not like '%auth.uid()%'
    or pg_get_functiondef(
      'public.set_optional_authorization_scope_v1(text,boolean,uuid)'::regprocedure
    ) not like '%delete from private.optional_authorization_onboarding_eligibility%'
    or position(
      'into decision_time'
      in lower(pg_get_functiondef('public.set_optional_authorization_scope_v1(text,boolean,uuid)'::regprocedure))
    ) < position(
      'pg_advisory_xact_lock'
      in lower(pg_get_functiondef('public.set_optional_authorization_scope_v1(text,boolean,uuid)'::regprocedure))
    ) then
    raise exception 'mutation RPCs do not derive ownership from auth.uid()';
  end if;

  foreach function_oid in array array[
    'public.set_my_profile_visibility(text)'::regprocedure::oid,
    'public.set_my_notification_preferences_v1(boolean,boolean,boolean,boolean)'::regprocedure::oid,
    'public.set_my_social_activity_preferences_v1(jsonb)'::regprocedure::oid
  ] loop
    function_definition := lower(pg_get_functiondef(function_oid));
    if position('auth.uid()' in function_definition) = 0
      or position('private.account_data_access_allowed()' in function_definition) = 0
      or position('pg_advisory_xact_lock' in function_definition) = 0
      or position('delete from private.optional_authorization_onboarding_eligibility' in function_definition) = 0 then
      raise exception 'settings writer % does not atomically consume the owner offer', function_oid::regprocedure;
    end if;
  end loop;
  if lower(pg_get_functiondef('public.set_my_profile_visibility(text)'::regprocedure))
      not like '%update public.profiles%'
    or lower(pg_get_functiondef(
      'public.set_my_notification_preferences_v1(boolean,boolean,boolean,boolean)'::regprocedure
    )) not like '%insert into public.user_preferences%'
    or lower(pg_get_functiondef(
      'public.set_my_social_activity_preferences_v1(jsonb)'::regprocedure
    )) not like '%insert into public.social_activity_preferences_v3%' then
    raise exception 'atomic settings RPC is missing its canonical projection write';
  end if;

  function_definition := lower(pg_get_functiondef(
    'public.record_ai_processing_consent_decisions(uuid,text,jsonb,text)'::regprocedure
  ));
  if position('optional-authorization:' in function_definition) = 0
    or position('ai-processing-consent:' in function_definition) = 0
    or position('optional-authorization:' in function_definition)
      > position('ai-processing-consent:' in function_definition)
    or position('into decision_time' in function_definition)
      < position('ai-processing-consent:' in function_definition)
    or function_definition like '%decision_time timestamptz := clock_timestamp()%'
    or function_definition not like '%delete from private.optional_authorization_onboarding_eligibility%'
    or has_function_privilege(
      'authenticated',
      'public.record_ai_processing_consent_decisions(uuid,text,jsonb,text)',
      'EXECUTE'
    ) then
    raise exception 'AI decisions are not serialized chronologically with the optional bundle';
  end if;
end;
$$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '49000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'optional-a@backyard.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '49000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'optional-b@backyard.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '49000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'optional-legacy@backyard.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '49000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'optional-partial@backyard.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '49000000-0000-4000-8000-000000000005',
    'authenticated', 'authenticated', 'optional-rollback@backyard.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '49000000-0000-4000-8000-000000000006',
    'authenticated', 'authenticated', 'optional-notifications@backyard.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '49000000-0000-4000-8000-000000000007',
    'authenticated', 'authenticated', 'optional-social@backyard.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '49000000-0000-4000-8000-000000000008',
    'authenticated', 'authenticated', 'optional-privacy@backyard.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

do $$
declare
  preference public.user_preferences%rowtype;
  social_preference public.social_activity_preferences_v3%rowtype;
begin
  if (select profile_visibility from public.profiles
      where id = '49000000-0000-4000-8000-000000000001') <> 'private' then
    raise exception 'new account was not bootstrapped private';
  end if;
  if (select social_privacy from public.profiles
      where id = '49000000-0000-4000-8000-000000000001') <> 'PRIVATE' then
    raise exception 'new account sharing master was not bootstrapped private';
  end if;
  if (select privacy from public.social_profiles
      where user_id = '49000000-0000-4000-8000-000000000001') <> 'PRIVATE' then
    raise exception 'new social profile was not bootstrapped private';
  end if;

  select * into preference from public.user_preferences
  where user_id = '49000000-0000-4000-8000-000000000001';
  if preference.notifications_enabled
    or preference.push_notifications_enabled
    or preference.email_notifications_enabled
    or preference.round_notifications_enabled
    or preference.reminders_enabled
    or preference.personal_memory_enabled
    or preference.global_learning_enabled
    or preference.location_internal_enabled
    or preference.notification_internal_enabled then
    raise exception 'new account optional preferences were not bootstrapped off';
  end if;

  select * into social_preference from public.social_activity_preferences_v3
  where user_id = '49000000-0000-4000-8000-000000000001';
  if social_preference.share_rounds
    or social_preference.share_achievements
    or social_preference.share_equipment
    or social_preference.share_courses
    or social_preference.notify_like
    or social_preference.notify_comment
    or social_preference.notify_attest
    or social_preference.notify_friend_achievement
    or social_preference.notify_equipment
    or social_preference.notify_friend_request then
    raise exception 'new account sharing/notification projections were not bootstrapped off';
  end if;

  if (select count(*) from public.optional_authorization_events
      where user_id = '49000000-0000-4000-8000-000000000001') <> 0
    or (select count(*) from public.optional_authorization_bundle_receipts
      where user_id = '49000000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'bootstrap fabricated optional authorization evidence';
  end if;
  if not exists (
    select 1 from private.optional_authorization_onboarding_eligibility
    where user_id = '49000000-0000-4000-8000-000000000001'
      and bundle_version = 'optional-features-2026-09-30-v1'
      and resolved_at is null
  ) then
    raise exception 'new account did not receive its private unresolved marker';
  end if;
end;
$$;

-- Simulate a historical account. The private eligibility row is intentionally
-- absent; no RPC can convert missing historical values into broad consent.
delete from private.optional_authorization_onboarding_eligibility
where user_id = '49000000-0000-4000-8000-000000000003';

-- Profile visibility requires a real public identity. The rollback fixture
-- intentionally keeps its bootstrap-empty identity; the success fixture does
-- not.
update public.profiles
set name = 'Privacy Owner', display_name = 'Privacy Owner'
where id = '49000000-0000-4000-8000-000000000008';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '49000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

do $$
declare
  state jsonb;
  visible integer;
  denied boolean := false;
begin
  state := public.get_optional_authorization_state_v1();
  if (state->>'resolved')::boolean
    or coalesce((state#>>'{scopes,PERSONAL_MEMORY,active}')::boolean, false) then
    raise exception 'unresolved bootstrap state was reported as accepted';
  end if;

  begin
    insert into public.optional_authorization_events (
      user_id, scope, decision_status, policy_version, source,
      idempotency_key, decided_at
    ) values (
      '49000000-0000-4000-8000-000000000001',
      'PERSONAL_MEMORY', 'accepted', 'ai-first-phase1-v1', 'settings',
      '49100000-0000-4000-8000-000000000099', now()
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'authenticated client inserted directly into the canonical ledger';
  end if;

  state := public.resolve_optional_authorization_bundle_v1(
    'authorize_all',
    'optional-features-2026-09-30-v1',
    '49100000-0000-4000-8000-000000000001'
  );
  if not (state->>'resolved')::boolean
    or state#>>'{receipt,action}' <> 'authorize_all'
    or not (state#>>'{scopes,AI_PROVIDER_PROCESSING_CONSENT,active}')::boolean
    or not (state#>>'{scopes,AI_IMAGE_PROCESSING_CONSENT,active}')::boolean
    or not (state#>>'{scopes,AI_LAUNCH_MONITOR_PROCESSING_CONSENT,active}')::boolean
    or not (state#>>'{scopes,PERSONAL_MEMORY,active}')::boolean
    or not (state#>>'{scopes,GLOBAL_LEARNING,active}')::boolean
    or not (state#>>'{scopes,LOCATION_INTERNAL,active}')::boolean
    or not (state#>>'{scopes,NOTIFICATION_INTERNAL,active}')::boolean then
    raise exception 'authorize_all did not return seven active scopes: %', state;
  end if;
  if state->>'profileVisibility' <> 'public'
    or state->>'socialPrivacy' <> 'FRIENDS'
    or state->>'socialProfilePrivacy' <> 'PUBLIC'
    or not (state#>>'{sharing,rounds}')::boolean
    or not (state#>>'{sharing,achievements}')::boolean
    or not (state#>>'{sharing,equipment}')::boolean
    or not (state#>>'{sharing,courses}')::boolean
    or not (state#>>'{notifications,internal}')::boolean
    or not (state#>>'{notifications,master}')::boolean then
    raise exception 'authorize_all projections are incomplete: %', state;
  end if;

  select count(*) into visible from public.optional_authorization_events;
  if visible <> 7 then
    raise exception 'owner expected seven bundle events, saw %', visible;
  end if;
  select count(*) into visible from public.optional_authorization_bundle_receipts;
  if visible <> 1 then
    raise exception 'owner expected one bundle receipt, saw %', visible;
  end if;

  -- Exact replay does not duplicate evidence or reapply defaults.
  perform public.resolve_optional_authorization_bundle_v1(
    'authorize_all',
    'optional-features-2026-09-30-v1',
    '49100000-0000-4000-8000-000000000001'
  );
  select count(*) into visible from public.optional_authorization_events;
  if visible <> 7 then
    raise exception 'bundle replay duplicated events';
  end if;

  state := public.set_optional_authorization_scope_v1(
    'PERSONAL_MEMORY', false, '49100000-0000-4000-8000-000000000002'
  );
  if (state#>>'{scopes,PERSONAL_MEMORY,active}')::boolean
    or state#>>'{scopes,PERSONAL_MEMORY,status}' <> 'revoked'
    or not (state#>>'{scopes,GLOBAL_LEARNING,active}')::boolean then
    raise exception 'individual memory revocation changed the wrong scope: %', state;
  end if;
  perform public.set_optional_authorization_scope_v1(
    'PERSONAL_MEMORY', false, '49100000-0000-4000-8000-000000000002'
  );
  select count(*) into visible
  from public.optional_authorization_events
  where scope = 'PERSONAL_MEMORY';
  if visible <> 2 then
    raise exception 'individual settings replay duplicated evidence';
  end if;

  denied := false;
  begin
    perform public.set_optional_authorization_scope_v1(
      'MARKETING', true, '49100000-0000-4000-8000-000000000003'
    );
  exception when invalid_parameter_value then
    denied := true;
  end;
  if not denied then
    raise exception 'marketing entered the optional feature bundle';
  end if;

  denied := false;
  begin
    perform public.resolve_optional_authorization_bundle_v1(
      'decline_all',
      'optional-features-2026-09-30-v1',
      '49100000-0000-4000-8000-000000000004'
    );
  exception when invalid_parameter_value then
    denied := true;
  end;
  if not denied then
    raise exception 'later bundle retry overwrote a resolved authorization';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '49000000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

do $$
declare
  state jsonb;
  visible integer;
begin
  state := public.resolve_optional_authorization_bundle_v1(
    'decline_all',
    'optional-features-2026-09-30-v1',
    '49200000-0000-4000-8000-000000000001'
  );
  if not (state->>'resolved')::boolean
    or state#>>'{receipt,action}' <> 'decline_all'
    or (state#>>'{scopes,AI_PROVIDER_PROCESSING_CONSENT,active}')::boolean
    or (state#>>'{scopes,PERSONAL_MEMORY,active}')::boolean
    or state->>'profileVisibility' <> 'private'
    or state->>'socialPrivacy' <> 'PRIVATE'
    or (state#>>'{sharing,rounds}')::boolean
    or (state#>>'{notifications,internal}')::boolean then
    raise exception 'decline_all did not preserve private/off state: %', state;
  end if;

  select count(*) into visible from public.optional_authorization_events;
  if visible <> 7 then
    raise exception 'owner B can see another owner events or lacks its seven events: %', visible;
  end if;
  select count(*) into visible from public.optional_authorization_bundle_receipts;
  if visible <> 1 then
    raise exception 'owner B can see another owner receipt or lacks its receipt: %', visible;
  end if;
  select count(*) into visible from public.ai_processing_consents
  where decision_status = 'declined';
  if visible <> 3 then
    raise exception 'decline_all did not record all three AI refusals: %', visible;
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '49000000-0000-4000-8000-000000000003',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);

do $$
declare
  denied boolean := false;
  visible integer;
  state jsonb;
begin
  begin
    perform public.resolve_optional_authorization_bundle_v1(
      'authorize_all',
      'optional-features-2026-09-30-v1',
      '49300000-0000-4000-8000-000000000001'
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'historical/unmarked account resolved the new-account bundle';
  end if;
  select count(*) into visible from public.optional_authorization_events;
  if visible <> 0 then
    raise exception 'failed ineligible resolution left partial events';
  end if;
  select count(*) into visible from public.optional_authorization_bundle_receipts;
  if visible <> 0 then
    raise exception 'failed ineligible resolution left a partial receipt';
  end if;

  -- Existing accounts are not broadly backfilled, but can make a new,
  -- individual settings decision for one supported scope.
  state := public.set_optional_authorization_scope_v1(
    'PERSONAL_MEMORY', true, '49300000-0000-4000-8000-000000000002'
  );
  if not (state#>>'{scopes,PERSONAL_MEMORY,active}')::boolean
    or state#>>'{scopes,PERSONAL_MEMORY,status}' <> 'accepted'
    or (state->>'resolved')::boolean
    or (state->>'eligible')::boolean then
    raise exception 'historical account individual decision was not isolated: %', state;
  end if;
  select count(*) into visible from public.optional_authorization_events;
  if visible <> 1 then
    raise exception 'historical individual decision should create exactly one owner event';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '49000000-0000-4000-8000-000000000004',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);

do $$
declare
  denied boolean := false;
  state jsonb;
  visible integer;
begin
  state := public.set_optional_authorization_scope_v1(
    'PERSONAL_MEMORY', true, '49400000-0000-4000-8000-000000000001'
  );
  if (state->>'resolved')::boolean
    or (state->>'eligible')::boolean
    or not (state#>>'{scopes,PERSONAL_MEMORY,active}')::boolean then
    raise exception 'individual decision did not consume the unresolved bundle offer: %', state;
  end if;
  begin
    perform public.resolve_optional_authorization_bundle_v1(
      'authorize_all',
      'optional-features-2026-09-30-v1',
      '49400000-0000-4000-8000-000000000002'
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'bundle broadened a prior individual decision';
  end if;
  select count(*) into visible
  from public.optional_authorization_events
  where user_id = '49000000-0000-4000-8000-000000000004'
    and scope = 'PERSONAL_MEMORY'
    and decision_status = 'accepted';
  if visible <> 1 or exists (
    select 1 from public.optional_authorization_bundle_receipts
    where user_id = '49000000-0000-4000-8000-000000000004'
  ) then
    raise exception 'failed bundle changed the preserved individual evidence';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '49000000-0000-4000-8000-000000000005',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000005","role":"authenticated"}',
  true
);

do $$
declare
  state jsonb;
  failed boolean := false;
begin
  begin
    perform public.set_my_profile_visibility('public');
  exception when invalid_parameter_value then
    failed := true;
  end;
  if not failed then
    raise exception 'incomplete social identity unexpectedly saved visibility';
  end if;
  state := public.get_optional_authorization_state_v1();
  if not (state->>'eligible')::boolean or (state->>'resolved')::boolean
    or state->>'profileVisibility' <> 'private' then
    raise exception 'failed atomic privacy write consumed or changed state: %', state;
  end if;
  if exists (
    select 1 from public.optional_authorization_events
    where user_id = '49000000-0000-4000-8000-000000000005'
  ) or exists (
    select 1 from public.optional_authorization_bundle_receipts
    where user_id = '49000000-0000-4000-8000-000000000005'
  ) then
    raise exception 'failed atomic privacy write fabricated consent evidence';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '49000000-0000-4000-8000-000000000006',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000006","role":"authenticated"}',
  true
);

do $$
declare
  saved jsonb;
  state jsonb;
begin
  saved := public.set_my_notification_preferences_v1(false, true, false, true);
  if (saved->>'push_notifications_enabled')::boolean
    or not (saved->>'email_notifications_enabled')::boolean
    or (saved->>'round_notifications_enabled')::boolean
    or not (saved->>'reminders_enabled')::boolean then
    raise exception 'atomic notification writer returned the wrong projection: %', saved;
  end if;
  state := public.get_optional_authorization_state_v1();
  if (state->>'eligible')::boolean or (state->>'resolved')::boolean then
    raise exception 'atomic notification write did not consume only the offer: %', state;
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '49000000-0000-4000-8000-000000000007',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000007","role":"authenticated"}',
  true
);

do $$
declare
  saved jsonb;
  state jsonb;
begin
  saved := public.set_my_social_activity_preferences_v1(jsonb_build_object(
    'shareRounds', true,
    'shareAchievements', false,
    'shareEquipment', true,
    'shareCourses', false,
    'notifyLike', true,
    'notifyComment', false,
    'notifyAttest', true,
    'notifyFriendAchievement', false,
    'notifyEquipment', true,
    'notifyFriendRequest', false,
    'enabledForFriends', true
  ));
  if not (saved->>'share_rounds')::boolean
    or (saved->>'share_achievements')::boolean
    or not (saved->>'share_equipment')::boolean
    or not (saved->>'enabled_for_friends')::boolean then
    raise exception 'atomic Social writer returned the wrong projection: %', saved;
  end if;
  state := public.get_optional_authorization_state_v1();
  if (state->>'eligible')::boolean or (state->>'resolved')::boolean
    or state->>'socialPrivacy' <> 'FRIENDS' then
    raise exception 'atomic Social write did not consume only the offer: %', state;
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '49000000-0000-4000-8000-000000000008',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"49000000-0000-4000-8000-000000000008","role":"authenticated"}',
  true
);

do $$
declare
  saved text;
  state jsonb;
begin
  saved := public.set_my_profile_visibility('public');
  if saved <> 'public' then
    raise exception 'atomic privacy writer returned %', saved;
  end if;
  state := public.get_optional_authorization_state_v1();
  if (state->>'eligible')::boolean or (state->>'resolved')::boolean
    or state->>'profileVisibility' <> 'public'
    or state->>'socialProfilePrivacy' <> 'PUBLIC' then
    raise exception 'atomic privacy write did not consume only the offer: %', state;
  end if;
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from private.optional_authorization_onboarding_eligibility
    where user_id = '49000000-0000-4000-8000-000000000005'
      and resolved_at is null
  ) then
    raise exception 'failed settings transaction did not restore eligibility';
  end if;
  if exists (
    select 1 from private.optional_authorization_onboarding_eligibility
    where user_id in (
      '49000000-0000-4000-8000-000000000004',
      '49000000-0000-4000-8000-000000000006',
      '49000000-0000-4000-8000-000000000007',
      '49000000-0000-4000-8000-000000000008'
    )
  ) then
    raise exception 'successful atomic settings writer left an unresolved offer';
  end if;
  if not exists (
    select 1 from public.user_preferences
    where user_id = '49000000-0000-4000-8000-000000000006'
      and not push_notifications_enabled
      and email_notifications_enabled
      and not round_notifications_enabled
      and reminders_enabled
  ) then
    raise exception 'atomic notification projection was not committed';
  end if;
  if not exists (
    select 1 from public.social_activity_preferences_v3
    where user_id = '49000000-0000-4000-8000-000000000007'
      and share_rounds
      and not share_achievements
      and share_equipment
      and not share_courses
  ) or (select social_privacy from public.profiles
    where id = '49000000-0000-4000-8000-000000000007') <> 'FRIENDS' then
    raise exception 'atomic Social projections were not committed together';
  end if;
end;
$$;

do $$
declare
  event_count integer;
  receipt_count integer;
  accepted_ai integer;
  preference public.user_preferences%rowtype;
  notification_rows integer;
begin
  if position('and receipt.bundle_version = ''optional-features-2026-09-30-v1''' in pg_get_functiondef('public.get_optional_authorization_state_v1()'::regprocedure)) = 0 then
    raise exception 'state getter does not isolate the supported bundle receipt version';
  end if;
  select count(*) into event_count
  from public.optional_authorization_events
  where user_id = '49000000-0000-4000-8000-000000000001';
  if event_count <> 8 then
    raise exception 'authorize + one revocation should retain eight events, saw %', event_count;
  end if;
  select count(*) into receipt_count
  from public.optional_authorization_bundle_receipts
  where user_id = '49000000-0000-4000-8000-000000000001';
  if receipt_count <> 1 then
    raise exception 'authorize bundle produced % receipts', receipt_count;
  end if;
  select count(*) into accepted_ai
  from public.ai_processing_consents
  where user_id = '49000000-0000-4000-8000-000000000001'
    and decision_status = 'accepted';
  if accepted_ai <> 3 then
    raise exception 'authorize_all did not persist three canonical AI acceptances';
  end if;
  if exists (
    select 1 from public.optional_authorization_events
    where scope not in (
      'AI_PROVIDER_PROCESSING_CONSENT',
      'AI_IMAGE_PROCESSING_CONSENT',
      'AI_LAUNCH_MONITOR_PROCESSING_CONSENT',
      'PERSONAL_MEMORY',
      'GLOBAL_LEARNING',
      'LOCATION_INTERNAL',
      'NOTIFICATION_INTERNAL'
    )
  ) then
    raise exception 'unsupported marketing/financial scope was stored';
  end if;

  select * into preference from public.user_preferences
  where user_id = '49000000-0000-4000-8000-000000000001';
  if preference.personal_memory_enabled
    or not preference.global_learning_enabled
    or not preference.location_internal_enabled
    or not preference.notification_internal_enabled
    or not preference.notifications_enabled
    or not preference.push_notifications_enabled then
    raise exception 'individual revocation did not preserve other authorized projections';
  end if;

  select count(*) into notification_rows
  from public.notification_preferences_v2
  where user_id = '49000000-0000-4000-8000-000000000001'
    and in_app and push;
  if notification_rows <> 7 then
    raise exception 'authorize_all did not enable seven notification delivery preferences';
  end if;
  if not exists (
    select 1 from private.optional_authorization_onboarding_eligibility
    where user_id = '49000000-0000-4000-8000-000000000001'
      and resolved_at is not null
      and resolution_action = 'authorize_all'
      and receipt_id is not null
  ) then
    raise exception 'eligibility was not atomically linked to its receipt';
  end if;
end;
$$;

-- Account deletion must remove the eligibility marker and its linked receipt
-- regardless of sibling cascade order.
delete from auth.users
where id = '49000000-0000-4000-8000-000000000001';

do $$
begin
  if exists (
    select 1 from public.optional_authorization_bundle_receipts
    where user_id = '49000000-0000-4000-8000-000000000001'
  ) or exists (
    select 1 from private.optional_authorization_onboarding_eligibility
    where user_id = '49000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'account deletion did not cascade optional authorization lifecycle data';
  end if;
end;
$$;

rollback;

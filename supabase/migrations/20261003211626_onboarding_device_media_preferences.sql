-- Step 2 records internal intent only. Reuse the optional-authorization ledger;
-- existing bundle receipts/scopes, projections and OS state are untouched.
-- No backfill: the existing authorize-all bundle did not include these purposes.
begin;

alter table public.optional_authorization_events
  drop constraint optional_authorization_events_scope_check;
alter table public.optional_authorization_events
  add constraint optional_authorization_events_scope_check check (scope in (
    'AI_PROVIDER_PROCESSING_CONSENT', 'AI_IMAGE_PROCESSING_CONSENT',
    'AI_LAUNCH_MONITOR_PROCESSING_CONSENT', 'PERSONAL_MEMORY', 'GLOBAL_LEARNING',
    'LOCATION_INTERNAL', 'NOTIFICATION_INTERNAL', 'CAMERA_INTERNAL', 'PHOTO_LIBRARY_INTERNAL'
  ));

create function public.get_optional_device_media_preferences_v1()
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
  if owner_id is null or not private.account_data_access_allowed() then
    raise insufficient_privilege using message = 'account_access_restricted';
  end if;
  select jsonb_object_agg(purpose.name, case when evidence.id is null then 'null'::jsonb else
    jsonb_build_object('version', 1,
      'value', case when evidence.decision_status = 'accepted' then 'enabled' else 'disabled' end,
      'changedAt', evidence.decided_at) end)
  into result
  from (values ('camera', 'CAMERA_INTERNAL'), ('photos', 'PHOTO_LIBRARY_INTERNAL')) purpose(name, scope)
  left join lateral (
    select event.id, event.decision_status, event.decided_at
    from public.optional_authorization_events event
    where event.user_id = owner_id and event.scope = purpose.scope
      and event.policy_version = 'device-media-2026-10-03-v1'
    order by event.id desc limit 1
  ) evidence on true;
  return result;
end;
$$;

-- Same authenticated owner, account-access guard, append-only evidence and
-- serialization lock as the existing optional-scope writer. Definer is needed
-- because clients deliberately have SELECT only on this evidence ledger.
create function public.set_optional_device_media_preference_v1(
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
  prior_status text;
  replay_status text;
  decision_time timestamptz;
begin
  if owner_id is null or not private.account_data_access_allowed() then
    raise insufficient_privilege using message = 'account_access_restricted';
  end if;
  if requested_scope is null or requested_scope not in ('CAMERA_INTERNAL', 'PHOTO_LIBRARY_INTERNAL')
    or requested_enabled is null or requested_idempotency_key is null then
    raise invalid_parameter_value using message = 'invalid_device_media_decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('optional-authorization:' || owner_id::text, 0));

  select event.decision_status into replay_status
  from public.optional_authorization_events event
  where event.user_id = owner_id and event.scope = requested_scope
    and event.idempotency_key = requested_idempotency_key limit 1;
  if found then
    if (requested_enabled and replay_status <> 'accepted')
      or (not requested_enabled and replay_status not in ('declined', 'revoked')) then
      raise invalid_parameter_value using message = 'optional_authorization_idempotency_conflict';
    end if;
    -- Read latest evidence on a retry; never restore an older acceptance.
    return public.get_optional_device_media_preferences_v1();
  end if;

  select event.decision_status into prior_status
  from public.optional_authorization_events event
  where event.user_id = owner_id and event.scope = requested_scope
    and event.policy_version = 'device-media-2026-10-03-v1'
  order by event.id desc limit 1;
  select greatest(clock_timestamp(), coalesce(max(event.decided_at) + interval '1 millisecond', '-infinity'::timestamptz))
  into decision_time from public.optional_authorization_events event where event.user_id = owner_id;

  insert into public.optional_authorization_events (
    user_id, scope, decision_status, policy_version, source, bundle_version, idempotency_key, decided_at
  ) values (
    owner_id, requested_scope,
    case when requested_enabled then 'accepted' when prior_status = 'accepted' then 'revoked' else 'declined' end,
    'device-media-2026-10-03-v1', 'settings', null, requested_idempotency_key, decision_time
  );
  return public.get_optional_device_media_preferences_v1();
end;
$$;

revoke all on function public.get_optional_device_media_preferences_v1() from public, anon, service_role;
revoke all on function public.set_optional_device_media_preference_v1(text, boolean, uuid) from public, anon, service_role;
grant execute on function public.get_optional_device_media_preferences_v1() to authenticated;
grant execute on function public.set_optional_device_media_preference_v1(text, boolean, uuid) to authenticated;

comment on function public.get_optional_device_media_preferences_v1() is
  'Latest explicit internal camera/photo-picker intent from the existing optional ledger. Missing means undecided; no OS permission is inferred.';
comment on function public.set_optional_device_media_preference_v1(text, boolean, uuid) is
  'Owner-bound internal camera/photo-picker decision only. No system prompt, photo-library access, AI consent or bundle acceptance.';

notify pgrst, 'reload schema';
commit;

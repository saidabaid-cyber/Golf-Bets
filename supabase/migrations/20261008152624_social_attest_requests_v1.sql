-- DEV-only additive request workflow. No score, handicap or attestation writes.
create table public.social_attest_requests_v1 (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.social_activities_v3(id) on delete cascade,
  round_id uuid not null references public.rounds_cloud(id) on delete cascade,
  requester_id uuid not null references auth.users(id),
  recipient_id uuid not null references auth.users(id),
  expected_version bigint not null check(expected_version > 0),
  expected_hash text not null check(expected_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check(requester_id <> recipient_id),
  constraint social_attest_request_revision_unique unique(activity_id,recipient_id,expected_hash)
);
create index social_attest_requests_inbox_v1 on public.social_attest_requests_v1(recipient_id,created_at desc);
create index social_attest_requests_author_v1 on public.social_attest_requests_v1(requester_id,created_at desc);
create index social_attest_requests_round_v1 on public.social_attest_requests_v1(round_id);
alter table public.social_attest_requests_v1 enable row level security;
revoke all on public.social_attest_requests_v1 from public,anon,authenticated;
grant select on public.social_attest_requests_v1 to authenticated;
create policy account_active_access on public.social_attest_requests_v1 as restrictive for all to authenticated
using ((select private.account_data_access_allowed())) with check ((select private.account_data_access_allowed()));
create policy social_attest_request_read_v1 on public.social_attest_requests_v1 for select to authenticated
using ((requester_id=(select auth.uid()) or recipient_id=(select auth.uid()))
  and private.can_read_social_activity_v3(activity_id));
-- Extend recipient notifications without weakening any existing event policy.
create policy social_attest_request_notification_read_v1 on public.notification_events_v2
as restrictive for select to authenticated using (
  event_type <> 'attest_request' or exists (
    select 1 from public.social_attest_requests_v1 request
    where request.id=notification_events_v2.id and request.recipient_id=(select auth.uid())
  )
);

-- Preserve current social privacy: being on a roster alone never publishes a private card.
create function private.attest_request_recipient_v1(activity uuid, recipient uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.social_activities_v3 a join public.rounds_cloud r on r.id=a.source_round_id
  where a.id=activity and a.active and a.event_kind='ROUND_COMPLETED' and a.audience='FRIENDS'
    and a.author_id<>recipient and r.version=a.source_version and r.snapshot->>'lifecycleState'='completed'
    and nullif(r.snapshot->>'completedAt','') is not null
    and (select count(*) from jsonb_array_elements(r.snapshot->'players') p where p->>'accountUserId'=recipient::text)=1
    and not exists(select 1 from jsonb_array_elements(r.snapshot->'players') p
      group by p->>'id' having count(*)>1)
    and not exists(select 1 from jsonb_array_elements(r.snapshot->'players') p
      where nullif(p->>'accountUserId','') is not null group by p->>'accountUserId' having count(*)>1)
    and exists(select 1 from public.profiles p where p.id=a.author_id and p.social_privacy='FRIENDS')
    and exists(select 1 from public.social_activity_preferences_v3 p where p.user_id=a.author_id and p.share_rounds)
    and exists(select 1 from public.friendships f where f.user_a_id=least(a.author_id,recipient) and f.user_b_id=greatest(a.author_id,recipient))
    and not exists(select 1 from public.blocked_connections b where (b.owner_id=a.author_id and b.blocked_user_id=recipient) or (b.owner_id=recipient and b.blocked_user_id=a.author_id)));
$$;
revoke all on function private.attest_request_recipient_v1(uuid,uuid) from public,anon,authenticated;

create function private.attest_request_roster_v1(activity uuid, expected_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.social_activities_v3; r public.rounds_cloud; result jsonb;
begin
  if auth.uid() is null or not private.account_data_access_allowed() then raise insufficient_privilege; end if;
  select * into a from public.social_activities_v3 where id=activity and author_id=auth.uid() and event_kind='ROUND_COMPLETED';
  if not found or not private.can_read_social_activity_v3(a.id) then raise insufficient_privilege; end if;
  if a.material_hash<>expected_hash then raise exception 'STALE_REVISION' using errcode='40001'; end if;
  select * into r from public.rounds_cloud where id=a.source_round_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'playerKey',p->>'id','userId',p->>'accountUserId','name',p->>'name',
    'eligible',case when p->>'accountUserId' ~ '^[a-f0-9-]{36}$' then private.attest_request_recipient_v1(a.id,(p->>'accountUserId')::uuid) else false end,
    'participation',case when p->>'accountUserId' is null then 'GUEST'
      when exists(select 1 from public.social_round_account_links_v3 l where l.round_id=r.id and l.player_key=p->>'id' and l.user_id::text=p->>'accountUserId' and l.verified_by in ('SELF_CONFIRMED','ROUND_OWNER')) then 'CONFIRMED' else 'PENDING_CONFIRMATION' end,
    'state',case when exists(select 1 from public.social_round_attestations_v3 t where t.activity_id=a.id and t.attester_id::text=p->>'accountUserId' and t.target_user_id=a.author_id and t.expected_hash=a.material_hash) then 'ATTESTED'
      when exists(select 1 from public.social_attest_requests_v1 q where q.activity_id=a.id and q.recipient_id::text=p->>'accountUserId' and q.expected_hash=a.material_hash) then 'PENDING'
      when exists(select 1 from public.social_attest_requests_v1 q where q.activity_id=a.id and q.recipient_id::text=p->>'accountUserId') then 'STALE' else 'UNSENT' end
  )), '[]'::jsonb) into result from jsonb_array_elements(r.snapshot->'players') p where coalesce(p->>'accountUserId','')<>auth.uid()::text;
  return result;
end;
$$;
create function public.attest_request_roster_v1(activity uuid, expected_hash text) returns jsonb
language sql security invoker set search_path='' as $$select private.attest_request_roster_v1(activity,expected_hash)$$;

create function private.send_attest_requests_v1(activity uuid, expected_hash text, recipients uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.social_activities_v3; r public.rounds_cloud; recipient uuid; request_id uuid; result jsonb='[]'::jsonb;
begin
  if auth.uid() is null or not private.account_data_access_allowed() or cardinality(recipients) not between 1 and 20 then raise insufficient_privilege; end if;
  select * into a from public.social_activities_v3 where id=activity and author_id=auth.uid() and event_kind='ROUND_COMPLETED';
  if not found or not private.can_read_social_activity_v3(a.id) then raise insufficient_privilege; end if;
  select * into r from public.rounds_cloud where id=a.source_round_id for update;
  select * into a from public.social_activities_v3 where id=activity and author_id=auth.uid() and event_kind='ROUND_COMPLETED' for update;
  if a.material_hash<>expected_hash or r.version<>a.source_version then raise exception 'STALE_REVISION' using errcode='40001'; end if;
  -- Validate the complete batch before writing anything, including duplicate/ambiguous accounts.
  foreach recipient in array recipients loop
    if recipient is null or not private.attest_request_recipient_v1(a.id,recipient) then raise insufficient_privilege; end if;
  end loop;
  for recipient in select distinct unnest(recipients) loop
    if exists(select 1 from public.social_round_attestations_v3 t where t.activity_id=a.id and t.attester_id=recipient and t.expected_hash=a.material_hash and t.target_user_id=a.author_id) then continue; end if;
    insert into public.social_attest_requests_v1(activity_id,round_id,requester_id,recipient_id,expected_version,expected_hash)
      values(a.id,r.id,auth.uid(),recipient,a.source_version,a.material_hash)
      on conflict on constraint social_attest_request_revision_unique do nothing;
    select id into request_id from public.social_attest_requests_v1 q where q.activity_id=a.id and q.recipient_id=recipient and q.expected_hash=a.material_hash;
    -- Persist independently of notification read state. Display honors existing notification preferences.
    insert into public.notification_events_v2(id,recipient_id,event_type,resource_type,resource_id)
      values(request_id,recipient,'attest_request','SCORECARD',a.id::text) on conflict(id) do nothing;
    result=result||jsonb_build_array(jsonb_build_object('id',request_id,'recipientId',recipient));
  end loop;
  return result;
end;
$$;
create function public.send_attest_requests_v1(activity uuid, expected_hash text, recipients uuid[]) returns jsonb
language sql security invoker set search_path='' as $$select private.send_attest_requests_v1(activity,expected_hash,recipients)$$;
revoke all on function private.attest_request_roster_v1(uuid,text),public.attest_request_roster_v1(uuid,text),private.send_attest_requests_v1(uuid,text,uuid[]),public.send_attest_requests_v1(uuid,text,uuid[]) from public,anon;
grant execute on function private.attest_request_roster_v1(uuid,text),public.attest_request_roster_v1(uuid,text),private.send_attest_requests_v1(uuid,text,uuid[]),public.send_attest_requests_v1(uuid,text,uuid[]) to authenticated;
-- Reversal: first deploy the preceding code checkpoint, then remove the new notification policy, these four functions,
-- the private recipient helper and this new table only. Never remove existing attestations.

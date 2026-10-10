-- Canonical live card CAS. No new round tables, global write grant, RLS change,
-- historical rewrite or account impersonation. Only the verified server calls
-- this function; authenticated clients cannot submit replacement snapshots.
begin;
create or replace function public.shared_round_live_cas_v1(
  p_round_id uuid, p_expected_version bigint, p_actor uuid, p_snapshot jsonb
) returns table(id uuid, owner_id uuid, version bigint, snapshot jsonb)
language plpgsql security definer set search_path = ''
as $$
declare r public.rounds_cloud%rowtype;
  mutable text[] := array['scores','putts','sharedLive','updatedAt','completedAt','lifecycleState',
    'playerBalances','categoryBalances','betResult','netResult','categoryResults','resultDetails',
    'counterBetEvents','personalOpponentResults','personalResults','personalSlidingAdjustments'];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server operation only' using errcode = '42501';
  end if;
  select c.* into r from public.rounds_cloud c where c.id = p_round_id
    and c.version = p_expected_version for update;
  if not found then return; end if;
  if r.snapshot->>'lifecycleState' is distinct from 'live'
    or r.snapshot->'scorekeeping'->>'version' is distinct from '1'
    or p_actor is null
    or (r.owner_id is distinct from p_actor and not exists (
      select 1 from jsonb_array_elements(coalesce(r.snapshot->'players','[]'::jsonb)) p
      where p->>'accountUserId' = p_actor::text
    )) then raise exception 'Invalid live membership' using errcode = '42501'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or (p_snapshot - mutable) is distinct from (r.snapshot - mutable)
    or coalesce(p_snapshot->>'lifecycleState','') not in ('live','completed','cancelled')
    or (p_snapshot->>'lifecycleState' <> 'live' and r.owner_id is distinct from p_actor)
    then raise exception 'Immutable round context' using errcode = '22023'; end if;
  -- Existing version-bump, historical audit and publication triggers remain.
  return query update public.rounds_cloud c set snapshot = p_snapshot, updated_at = now()
    where c.id = p_round_id and c.version = p_expected_version
    returning c.id, c.owner_id, c.version, c.snapshot;
end;
$$;
revoke all on function public.shared_round_live_cas_v1(uuid,bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.shared_round_live_cas_v1(uuid,bigint,uuid,jsonb) to service_role;
commit;

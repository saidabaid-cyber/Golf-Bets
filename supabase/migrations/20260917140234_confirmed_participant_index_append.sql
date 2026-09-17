-- QA ledger 20260917140234. No table UPDATE grant. Server-only append of one confirmed player's frozen
-- index record; scores, ownership, bets and existing evidence cannot be changed.
create function public.append_confirmed_round_index(
  p_round_id uuid, p_account_user_id uuid, p_expected_version bigint, p_record jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r public.rounds_cloud%rowtype;
  player_key text;
  records jsonb;
begin
  select * into r from public.rounds_cloud where id = p_round_id for update;
  if not found or r.snapshot->>'lifecycleState' <> 'completed' then
    raise exception 'Completed round required' using errcode='42501';
  end if;
  select l.player_key into player_key from public.social_round_account_links_v3 l
    where l.round_id=p_round_id and l.user_id=p_account_user_id and l.verified_by='SELF_CONFIRMED';
  if player_key is null or (select count(*) from jsonb_array_elements(r.snapshot->'players') p
    where p->>'accountUserId'=p_account_user_id::text) <> 1
    or not exists(select 1 from jsonb_array_elements(r.snapshot->'players') p
      where p->>'accountUserId'=p_account_user_id::text and p->>'id'=player_key)
    or jsonb_typeof(p_record) is distinct from 'object'
    or p_record->>'accountUserId' is distinct from p_account_user_id::text
    or p_record->>'playerId' is distinct from player_key
    or p_record->>'roundId' is distinct from r.snapshot->>'id' then
    raise exception 'Confirmed canonical participant required' using errcode='42501';
  end if;
  records := coalesce(r.snapshot->'backyardIndexSnapshots','[]'::jsonb);
  if exists(select 1 from jsonb_array_elements(records) s where s->>'accountUserId'=p_account_user_id::text) then
    return true; -- retry does not replace evidence
  end if;
  if r.version <> p_expected_version then return false; end if;
  update public.rounds_cloud set snapshot=jsonb_set(r.snapshot,'{backyardIndexSnapshots}',records || jsonb_build_array(p_record))
    where id=p_round_id;
  return true;
end;
$$;
revoke all on function public.append_confirmed_round_index(uuid,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.append_confirmed_round_index(uuid,uuid,bigint,jsonb) to service_role;

-- QA ledger: 20260917134241. Additive SELECT only; no write or definer bypass.
-- Membership is
-- self-confirmed under the existing guarded INSERT policy, not organizer text.
create policy rounds_confirmed_participant_read on public.rounds_cloud
for select to authenticated using (
  snapshot ->> 'lifecycleState' = 'completed'
  and exists (
    select 1 from public.social_round_account_links_v3 link
    where link.round_id = rounds_cloud.id
      and link.user_id = (select auth.uid())
      and link.verified_by = 'SELF_CONFIRMED'
      and (select count(*) from jsonb_array_elements(
        case when jsonb_typeof(snapshot -> 'players') = 'array'
          then snapshot -> 'players' else '[]'::jsonb end
      ) player where player ->> 'accountUserId' = (select auth.uid())::text) = 1
      and exists (select 1 from jsonb_array_elements(
        case when jsonb_typeof(snapshot -> 'players') = 'array'
          then snapshot -> 'players' else '[]'::jsonb end
      ) player where player ->> 'accountUserId' = (select auth.uid())::text
        and player ->> 'id' = link.player_key)
  )
);

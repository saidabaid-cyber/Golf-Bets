-- Behavioral multiuser authorization contract for the full Phase 2 stack.
-- Run only on an isolated Preview branch. Everything is transaction-scoped.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'closeout-a@backyard.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'closeout-b@backyard.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('20000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'closeout-admin@backyard.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.rounds_cloud(id, owner_id, local_round_id, snapshot) values
  ('21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'closeout-a-round', '{}'::jsonb),
  ('21000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'closeout-b-round', '{}'::jsonb);
insert into public.groups_v2(id, owner_id, name) values
  ('22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Private B');
insert into public.app_admins(user_id) values ('20000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.groups_v2(id, owner_id, name) values
  ('22000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Private A');
insert into public.round_participants_v2(id, round_id, user_id, player_key, role) values
  ('23000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'player-b', 'PLAYER');
insert into public.friend_requests(id, requester_id, addressee_id, operation_id) values
  ('24000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000002');
insert into public.group_invites_v2(id, group_id, inviter_id, invitee_id, token_hash, expires_at) values
  ('25000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', repeat('a', 64), now() + interval '1 day');

do $$
declare visible integer; denied boolean := false;
begin
  select count(*) into visible from public.social_profiles where user_id = '20000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'USER_A can read USER_B full social profile before friendship'; end if;
  select count(*) into visible from public.groups_v2 where id = '22000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'USER_A can read USER_B private group'; end if;
  select count(*) into visible from public.rounds_cloud where id = '21000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'USER_A can read USER_B private round'; end if;
  begin
    update public.feature_entitlements set plan_id = 'PRO' where user_id = '20000000-0000-4000-8000-000000000001';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'USER_A can change their own server-managed plan'; end if;
  denied := false;
  begin
    perform public.phase2_admin_aggregate_metrics();
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'normal user can execute admin aggregate successfully'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

update public.friend_requests set state = 'ACCEPTED', updated_at = now()
where id = '24000000-0000-4000-8000-000000000001';

do $$
declare visible integer; changed integer; denied boolean := false;
begin
  select count(*) into visible from public.friendships
  where user_a_id = '20000000-0000-4000-8000-000000000001'
    and user_b_id = '20000000-0000-4000-8000-000000000002';
  if visible <> 1 then raise exception 'accepting request did not create exactly one friendship'; end if;
  select count(*) into visible from public.social_profiles where user_id = '20000000-0000-4000-8000-000000000001';
  if visible <> 1 then raise exception 'accepted friend cannot read authorized social profile'; end if;
  select count(*) into visible from public.rounds_cloud where id = '21000000-0000-4000-8000-000000000001';
  if visible <> 1 then raise exception 'authorized participant cannot read canonical round snapshot'; end if;
  update public.rounds_cloud set snapshot = '{"tampered":true}'::jsonb where id = '21000000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'PLAYER rewrote organizer round snapshot'; end if;
  update public.groups_v2 set name = 'Tampered' where id = '22000000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'MEMBER administered group without permission'; end if;
  begin
    update public.group_invites_v2 set token_hash = repeat('b', 64), state = 'ACCEPTED'
    where id = '25000000-0000-4000-8000-000000000001';
  exception when others then denied := true; end;
  if not denied then raise exception 'invitee changed immutable invite token'; end if;
end;
$$;

update public.group_invites_v2 set state = 'ACCEPTED'
where id = '25000000-0000-4000-8000-000000000001';

insert into public.live_round_operations_v2(id, round_id, actor_id, operation_kind, player_key, hole, payload, base_version, resulting_version)
values ('26000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'SCORE_SET', 'player-b', 1, '{"score":4}', 0, 1);
insert into public.round_shots_v2(id, round_id, owner_id, player_key, hole, sequence, club_snapshot, source, started_at, operation_id)
values ('27000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'player-b', 1, 1, '{"label":"7i"}', 'MANUAL', now(), '27000000-0000-4000-8000-000000000002');

do $$
declare denied boolean := false; member_rows integer;
begin
  select count(*) into member_rows from public.group_memberships_v2
  where group_id = '22000000-0000-4000-8000-000000000001' and user_id = '20000000-0000-4000-8000-000000000002';
  if member_rows <> 1 then raise exception 'accepted group invite did not preserve/create membership'; end if;
  begin
    insert into public.live_round_operations_v2(id, round_id, actor_id, operation_kind, player_key, hole, payload, base_version, resulting_version)
    values ('26000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'SCORE_SET', 'player-a', 1, '{"score":3}', 1, 2);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'PLAYER edited another player score'; end if;
end;
$$;

insert into public.blocked_connections(owner_id, blocked_user_id)
values ('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001');

do $$
declare visible integer;
begin
  select count(*) into visible from public.friendships
  where user_a_id = '20000000-0000-4000-8000-000000000001'
    and user_b_id = '20000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'blocking did not remove friendship'; end if;
  select count(*) into visible from public.social_profiles where user_id = '20000000-0000-4000-8000-000000000001';
  if visible <> 0 then raise exception 'blocked account retained full social-profile access'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

do $$
declare visible integer; metrics jsonb;
begin
  select count(*) into visible from public.rounds_cloud where id in ('21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002');
  if visible <> 0 then raise exception 'ADMIN_TEST bypassed private round RLS'; end if;
  metrics := public.phase2_admin_aggregate_metrics();
  if jsonb_typeof(metrics) <> 'object' then raise exception 'ADMIN_TEST did not receive aggregate metrics'; end if;
end;
$$;

rollback;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const PARTICIPANT_B = "55555555-5555-4555-8555-555555555555";
const PARTICIPANT_C = "66666666-6666-4666-8666-666666666666";
const FRIEND_NONPARTICIPANT = "77777777-7777-4777-8777-777777777777";
const BLOCKED_FRIEND = "88888888-8888-4888-8888-888888888888";
const ROUND = "44444444-4444-4444-8444-444444444444";
const INCOMPLETE_ROUND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HASH = "a".repeat(64);
const NEXT_HASH = "b".repeat(64);
const db = new PGlite();
const run = (sql, params) => db.query(sql, params);
const role = async id => db.exec(`set role authenticated; set request.jwt.claim.sub = '${id}';`);
const anon = async () => db.exec("set role anon; reset request.jwt.claim.sub;");
const admin = async () => db.exec("reset role; reset request.jwt.claim.sub;");
let expectationIndex = 0;
const expectError = async (action, codes, label = "authorization/revision guard") => {
  const index = ++expectationIndex;
  let thrown;
  try { await action(); } catch (error) { thrown = error; }
  assert.ok(thrown, `${label} #${index}: expected a PostgreSQL authorization/revision error`);
  assert.ok(codes.includes(thrown.code), `${label} #${index}: ${thrown.code}: ${thrown.message}`);
};

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.profiles(
      id uuid primary key references auth.users(id),
      social_privacy text not null default 'PRIVATE'
    );
    create table public.social_profiles(user_id uuid primary key);
    create table public.user_statistics_resets(user_id uuid primary key,reset_at timestamptz);
    create table public.friendships(
      user_a_id uuid not null, user_b_id uuid not null,
      primary key(user_a_id,user_b_id)
    );
    create table public.blocked_connections(
      owner_id uuid not null,blocked_user_id uuid not null,
      primary key(owner_id,blocked_user_id)
    );
    create table public.rounds_cloud(
      id uuid primary key,owner_id uuid not null references auth.users(id),
      local_round_id text not null,snapshot jsonb not null,version bigint not null default 1
    );
    create table public.round_participants_v2(
      round_id uuid not null references public.rounds_cloud(id),
      user_id uuid not null references auth.users(id),player_key text not null,
      primary key(round_id,user_id)
    );
    create table public.player_equipment_profiles(
      user_id uuid primary key references auth.users(id),snapshot jsonb not null,version bigint not null
    );
    create table public.notification_events_v2(
      id uuid primary key,recipient_id uuid not null references auth.users(id),
      event_type text not null,resource_type text not null,resource_id text not null,
      created_at timestamptz not null default now(),read_at timestamptz
    );
    alter table public.notification_events_v2 enable row level security;
    create policy notification_events_v2_recipient_select on public.notification_events_v2
      for select to authenticated using (recipient_id=(select auth.uid()));
    grant select on public.notification_events_v2 to authenticated;
    grant usage on schema auth,private to authenticated;
    grant select on public.profiles,public.friendships,public.blocked_connections,
      public.rounds_cloud,public.round_participants_v2 to authenticated;
    insert into auth.users(id) values('${OWNER}'),('${FRIEND}'),('${OTHER}'),
      ('${PARTICIPANT_B}'),('${PARTICIPANT_C}'),('${FRIEND_NONPARTICIPANT}'),('${BLOCKED_FRIEND}');
    insert into public.profiles(id,social_privacy) values
      ('${OWNER}','FRIENDS'),('${FRIEND}','FRIENDS'),('${OTHER}','FRIENDS'),
      ('${PARTICIPANT_B}','FRIENDS'),('${PARTICIPANT_C}','FRIENDS'),
      ('${FRIEND_NONPARTICIPANT}','FRIENDS'),('${BLOCKED_FRIEND}','FRIENDS');
    insert into public.friendships(user_a_id,user_b_id) values
      ('${OWNER}','${FRIEND}'),('${OWNER}','${PARTICIPANT_B}'),
      ('${OWNER}','${PARTICIPANT_C}'),('${OWNER}','${FRIEND_NONPARTICIPANT}'),
      ('${OWNER}','${BLOCKED_FRIEND}');
    insert into public.blocked_connections(owner_id,blocked_user_id)
      values('${OWNER}','${BLOCKED_FRIEND}');
  `);
  const migration = readFileSync("supabase/migrations/20260915183026_social_activity_v3.sql", "utf8");
  await db.exec(migration);
  await db.exec(readFileSync("supabase/migrations/20260915203550_social_service_privileges.sql", "utf8"));
  await db.exec("set role service_role");
  assert.equal((await run("select count(*) as n from public.social_activities_v3")).rows[0].n,0,
    "server reconciliation can read Social without project default grants");
  await run("select id,snapshot from public.rounds_cloud limit 1");
  await run("select user_id from public.social_activity_preferences_v3 limit 1");
  await run("select player_key from public.social_round_account_links_v3 limit 1");
  await expectError(() => run("delete from public.social_activities_v3"),["42501"],
    "reconciliation role gains no unnecessary activity DELETE privilege");
  await expectError(() => run("delete from public.social_comments_v3"),["42501"],
    "social grants do not authorize elevated comment deletion");
  await admin();

  const snapshot = JSON.stringify({
    id: "local-round-1",ownerId: "owner-player",lifecycleState: "completed",
    completedAt: "2026-09-15T15:00:00.000Z",
    players: [
      { id: "owner-player",accountUserId: OWNER },
      { id: "friend-player",accountUserId: FRIEND },
      { id: "participant-b",accountUserId: PARTICIPANT_B },
      { id: "participant-c",accountUserId: PARTICIPANT_C },
    ],
  });
  await run(`insert into public.rounds_cloud(id,owner_id,local_round_id,snapshot,version)
    values('${ROUND}','${OWNER}','local-round-1',$1::jsonb,1)`, [snapshot]);
  let activity = (await run(`select * from public.social_activities_v3 where source_round_id='${ROUND}'`)).rows[0];
  assert.equal(activity.active,true);
  assert.equal(activity.audience,"OWNER");
  assert.equal(activity.material_hash.length,32,"SQL reference is provisional until TS materializer");
  assert.equal((await run(`select count(*) as n from public.social_round_account_links_v3
    where round_id='${ROUND}' and user_id='${OWNER}'`)).rows[0].n,1);

  await run(`insert into public.social_activity_preferences_v3(user_id,share_rounds)
    values('${OWNER}',true)`);
  await run(`update public.rounds_cloud set version=2 where id='${ROUND}'`);
  activity = (await run(`select * from public.social_activities_v3 where source_round_id='${ROUND}'`)).rows[0];
  assert.equal(activity.audience,"FRIENDS");
  await role(FRIEND);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where id='${activity.id}'`)).rows[0].n,0,
    "a provisional SQL md5 cannot leak source metadata through REST before server SHA validation");
  await admin();
  await run(`update public.social_activities_v3 set material_hash='${HASH}' where id='${activity.id}'`);

  await role(OTHER);
  assert.equal((await run("select count(*) as n from public.social_activities_v3")).rows[0].n,0);
  await expectError(() => run(`insert into public.social_likes_v3(activity_id,user_id,expected_hash)
    values('${activity.id}','${OTHER}','${HASH}')`),["42501"]);
  await admin();
  await role(BLOCKED_FRIEND);
  assert.equal((await run("select count(*) as n from public.social_activities_v3")).rows[0].n,0,
    "blocking defeats a friendship edge even when the author shares");
  await expectError(() => run(`insert into public.social_likes_v3(activity_id,user_id,expected_hash)
    values('${activity.id}','${BLOCKED_FRIEND}','${HASH}')`),["42501"]);
  await admin();
  await anon();
  await expectError(() => run("select count(*) from public.social_activities_v3"),["42501"]);
  await expectError(() => run(`insert into public.social_likes_v3(activity_id,user_id,expected_hash)
    values('${activity.id}','${OTHER}','${HASH}')`),["42501"]);
  await admin();
  await role(FRIEND);
  assert.equal((await run("select count(*) as n from public.social_activities_v3")).rows[0].n,1);
  await expectError(() => run(`insert into public.social_round_account_links_v3(round_id,user_id,player_key,verified_by)
    values('${ROUND}','${FRIEND}','participant-b','SELF_CONFIRMED')`),["42501"],
    "a user cannot claim a different canonical player ID");
  await run(`insert into public.social_round_account_links_v3(round_id,user_id,player_key,verified_by)
    values('${ROUND}','${FRIEND}','friend-player','SELF_CONFIRMED')`);
  await admin();
  await run(`insert into public.round_participants_v2(round_id,user_id,player_key)
    values('${ROUND}','${FRIEND}','friend-player')`);
  await role(FRIEND);
  await expectError(() => run(`insert into public.social_round_account_links_v3(round_id,user_id,player_key,verified_by)
    values('${ROUND}','${FRIEND}','friend-player','SELF_CONFIRMED')`),["23505"],
    "self-confirming twice cannot mint a second participant link");
  await run(`insert into public.social_likes_v3(activity_id,user_id,expected_hash)
    values('${activity.id}','${FRIEND}','${HASH}')`);
  await expectError(() => run(`insert into public.social_likes_v3(activity_id,user_id,expected_hash)
    values('${activity.id}','${FRIEND}','${HASH}')`),["23505"]);
  const commentId = (await run(`insert into public.social_comments_v3(activity_id,author_id,body,expected_hash)
    values('${activity.id}','${FRIEND}','Buena ronda','${HASH}') returning id`)).rows[0].id;
  assert.equal((await run(`update public.social_comments_v3 set body='  Bien jugado  '
    where id='${commentId}' returning body`)).rows[0].body,"Bien jugado",
    "the author may edit text and the trigger trims it");
  await run(`insert into public.social_round_attestations_v3(
    activity_id,round_id,attester_id,target_user_id,expected_version,expected_hash)
    values('${activity.id}','${ROUND}','${FRIEND}','${OWNER}',2,'${HASH}')`);
  await expectError(() => run(`insert into public.social_round_attestations_v3(
    activity_id,round_id,attester_id,target_user_id,expected_version,expected_hash)
    values('${activity.id}','${ROUND}','${FRIEND}','${OWNER}',2,'${HASH}')`),["23505"]);
  await expectError(() => run(`insert into public.social_round_attestations_v3(
    activity_id,round_id,attester_id,target_user_id,expected_version,expected_hash)
    values('${activity.id}','${ROUND}','${FRIEND}','${FRIEND}',2,'${HASH}')`),["23514","42501"]);
  await admin();
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${OWNER}'`)).rows[0].n,3);
  await role(OWNER);
  assert.equal((await run(`update public.social_comments_v3 set body='Falsificado'
    where id='${commentId}' returning id`)).rows.length,0,"the round owner cannot edit another author's comment");
  assert.equal((await run(`delete from public.social_comments_v3 where id='${commentId}' returning id`)).rows.length,0,
    "the round owner cannot delete another author's comment");
  await admin();
  await run(`insert into public.round_participants_v2(round_id,user_id,player_key) values
    ('${ROUND}','${PARTICIPANT_B}','participant-b'),
    ('${ROUND}','${PARTICIPANT_C}','participant-c')`);
  for (const [id,key] of [[PARTICIPANT_B,"participant-b"],[PARTICIPANT_C,"participant-c"]]) {
    await role(id);
    await run(`insert into public.social_round_account_links_v3(round_id,user_id,player_key,verified_by)
      values('${ROUND}','${id}','${key}','SELF_CONFIRMED')`);
    await run(`insert into public.social_round_attestations_v3(
      activity_id,round_id,attester_id,target_user_id,expected_version,expected_hash)
      values('${activity.id}','${ROUND}','${id}','${OWNER}',2,'${HASH}')`);
    await admin();
  }
  assert.equal((await run(`select count(*) as n from public.social_round_attestations_v3
    where activity_id='${activity.id}' and target_user_id='${OWNER}'`)).rows[0].n,3,
    "three distinct self-confirmed accounts can attest Said's current revision");
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where source_round_id='${ROUND}' and event_kind='ROUND_COMPLETED'`)).rows[0].n,4,
    "the owner and three confirmed participants each receive one independently owned card");
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where source_round_id='${ROUND}' and author_id in ('${FRIEND}','${PARTICIPANT_B}','${PARTICIPANT_C}')
      and audience='OWNER'`)).rows[0].n,3,
    "participant cards are private until each participant opts into sharing");
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${OWNER}'`)).rows[0].n,5);

  await role(FRIEND_NONPARTICIPANT);
  assert.equal((await run("select count(*) as n from public.social_activities_v3")).rows[0].n,1,
    "a nonparticipant friend may read the shared card");
  await expectError(() => run(`insert into public.social_round_attestations_v3(
    activity_id,round_id,attester_id,target_user_id,expected_version,expected_hash)
    values('${activity.id}','${ROUND}','${FRIEND_NONPARTICIPANT}','${OWNER}',2,'${HASH}')`),["42501"]);
  await expectError(() => run(`insert into public.social_round_account_links_v3(round_id,user_id,player_key,verified_by)
    values('${ROUND}','${FRIEND_NONPARTICIPANT}','friend-player','SELF_CONFIRMED')`),["42501"]);
  await admin();
  await run(`update public.social_activity_preferences_v3
    set notify_like=false,notify_comment=false,notify_attest=false where user_id='${OWNER}'`);
  await role(FRIEND_NONPARTICIPANT);
  await run(`insert into public.social_likes_v3(activity_id,user_id,expected_hash)
    values('${activity.id}','${FRIEND_NONPARTICIPANT}','${HASH}')`);
  const quietComment = (await run(`insert into public.social_comments_v3(activity_id,author_id,body,expected_hash)
    values('${activity.id}','${FRIEND_NONPARTICIPANT}','Muy bien','${HASH}') returning id`)).rows[0].id;
  assert.equal((await run(`delete from public.social_comments_v3 where id='${quietComment}' returning id`)).rows.length,1,
    "an author can remove their own comment");
  await admin();
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${OWNER}'`)).rows[0].n,5,
    "recipient's disabled notification choices suppress new rows");

  await role(FRIEND);
  assert.equal((await run(`delete from public.social_likes_v3 where activity_id='${activity.id}'
    and user_id='${FRIEND}' returning user_id`)).rows.length,1,"unlike removes only the actor's own like");
  await run(`insert into public.social_likes_v3(activity_id,user_id,expected_hash)
    values('${activity.id}','${FRIEND}','${HASH}')`);
  await admin();
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${OWNER}'`)).rows[0].n,5,
    "unlike/re-like cannot override disabled notification preference");

  await run(`update public.social_activities_v3 set material_hash='${NEXT_HASH}'
    where id='${activity.id}' and material_hash='${HASH}'`);
  await role(FRIEND);
  await expectError(() => run(`update public.social_comments_v3
    set expected_hash='${NEXT_HASH}',body='Comentario reciclado'
    where id='${commentId}' returning id`),["42501"],
    "old comments must not be moved to a new scorecard revision");
  await expectError(() => run(`insert into public.social_likes_v3(activity_id,user_id,expected_hash)
    values('${activity.id}','${FRIEND}','${HASH}')`),["40001","42501"],
    "a stale revision cannot accept a new like");
  await admin();
  assert.equal((await run(`select expected_hash from public.social_comments_v3
    where id='${commentId}'`)).rows[0].expected_hash,HASH);

  await run(`update public.rounds_cloud set version=3,snapshot=jsonb_set(snapshot,'{completedAt}','"2026-09-15T16:00:00.000Z"')
    where id='${ROUND}'`);
  activity = (await run(`select * from public.social_activities_v3 where id='${activity.id}'`)).rows[0];
  assert.equal(activity.source_version,3);
  assert.equal(activity.material_hash.length,32,
    "a source write atomically invalidates the previous server SHA before client mutations");
  await role(FRIEND);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where id='${activity.id}'`)).rows[0].n,0,
    "source revision is hidden until it regains a definitive current SHA");
  await expectError(() => run(`insert into public.social_round_attestations_v3(
    activity_id,round_id,attester_id,target_user_id,expected_version,expected_hash)
    values('${activity.id}','${ROUND}','${FRIEND}','${OWNER}',3,'${HASH}')`),["40001","42501"]);
  await admin();
  await run(`update public.social_activities_v3 set material_hash='${NEXT_HASH}'
    where id='${activity.id}' and source_version=3 and material_hash='${activity.material_hash}'`);
  await role(FRIEND);
  await run(`insert into public.social_comments_v3(activity_id,author_id,body,expected_hash)
    values('${activity.id}','${FRIEND}','La ronda sigue vigente','${NEXT_HASH}')`);
  await admin();
  assert.equal((await run(`select count(*) as n from public.social_comments_v3
    where activity_id='${activity.id}' and expected_hash='${NEXT_HASH}'`)).rows[0].n,1,
    "new revision accepts a fresh comment only after server materialization");

  const incompleteSnapshot = JSON.stringify({
    id: "local-incomplete",ownerId: "owner-player",lifecycleState: "active",completedAt: null,
    players: [{ id: "owner-player",accountUserId: OWNER }],
  });
  await run(`insert into public.rounds_cloud(id,owner_id,local_round_id,snapshot,version)
    values('${INCOMPLETE_ROUND}','${OWNER}','local-incomplete',$1::jsonb,1)`,[incompleteSnapshot]);
  let incompleteEvent = (await run(`select active from public.social_activities_v3
    where source_round_id='${INCOMPLETE_ROUND}'`)).rows[0];
  assert.equal(incompleteEvent.active,false,"active/incomplete rounds are never readable as completion");
  await role(OWNER);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where source_round_id='${INCOMPLETE_ROUND}'`)).rows[0].n,0);
  await admin();
  await run(`update public.rounds_cloud set version=2,
    snapshot=jsonb_set(jsonb_set(snapshot,'{lifecycleState}','"completed"'),
      '{completedAt}','"2026-09-15T17:00:00.000Z"')
    where id='${INCOMPLETE_ROUND}'`);
  incompleteEvent = (await run(`select active from public.social_activities_v3
    where source_round_id='${INCOMPLETE_ROUND}'`)).rows[0];
  assert.equal(incompleteEvent.active,true);
  await run(`update public.rounds_cloud set version=3,
    snapshot=jsonb_set(snapshot,'{lifecycleState}','"active"')
    where id='${INCOMPLETE_ROUND}'`);
  incompleteEvent = (await run(`select active from public.social_activities_v3
    where source_round_id='${INCOMPLETE_ROUND}'`)).rows[0];
  assert.equal(incompleteEvent.active,false,"undoing completion immediately revokes the card");

  await run(`insert into public.social_activity_preferences_v3(user_id)
    values('${FRIEND}')`);
  await run(`update public.social_activity_preferences_v3 set notify_equipment=true
    where user_id='${FRIEND}'`);
  await run(`insert into public.player_equipment_profiles(user_id,snapshot,version)
    values('${OWNER}','{"schemaVersion":1,"driver":"QA"}'::jsonb,1)`);
  let equipmentEvent = (await run(`select * from public.social_activities_v3
    where source_equipment_user_id='${OWNER}' and event_kind='EQUIPMENT_UPDATED'`)).rows[0];
  assert.equal(equipmentEvent.audience,"OWNER","equipment sharing defaults fail closed");
  assert.equal(equipmentEvent.material_hash.length,32);
  await run(`update public.social_activity_preferences_v3 set share_equipment=true
    where user_id='${OWNER}'`);
  await run(`update public.player_equipment_profiles set version=2,
    snapshot='{"schemaVersion":1,"driver":"QA Driver"}'::jsonb where user_id='${OWNER}'`);
  equipmentEvent = (await run(`select * from public.social_activities_v3
    where source_equipment_user_id='${OWNER}' and event_kind='EQUIPMENT_UPDATED'`)).rows[0];
  assert.equal(equipmentEvent.audience,"FRIENDS");
  await role(FRIEND);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where id='${equipmentEvent.id}'`)).rows[0].n,0,
    "provisional equipment md5 is hidden even after opt-in");
  await admin();
  await run(`update public.social_activities_v3 set material_hash='${HASH}'
    where id='${equipmentEvent.id}' and source_version=2`);
  await role(FRIEND);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where event_kind='EQUIPMENT_UPDATED'`)).rows[0].n,1);
  await admin();
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${FRIEND}' and event_type='equipment'`)).rows[0].n,1,
    "definitive equipment publication notifies a friend who opted into equipment alerts");
  await role(FRIEND);
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${FRIEND}' and event_type='equipment'`)).rows[0].n,1,
    "recipient can read a live Social notification through direct REST RLS");
  await admin();
  await run(`update public.player_equipment_profiles set version=3,
    snapshot='{"schemaVersion":1,"driver":"QA Driver Plus"}'::jsonb
    where user_id='${OWNER}'`);
  await run(`update public.social_activities_v3 set material_hash='${NEXT_HASH}'
    where id='${equipmentEvent.id}' and source_version=3`);
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${FRIEND}' and event_type='equipment'`)).rows[0].n,1,
    "rapid equipment revisions coalesce within the 30-minute private dedupe window");

  await run(`update public.social_activity_preferences_v3 set share_rounds=true
    where user_id='${FRIEND}'`);
  await run(`insert into public.friendships(user_a_id,user_b_id)
    values('${FRIEND}','${OTHER}')`);
  await run(`update public.rounds_cloud set version=4,
    snapshot=jsonb_set(snapshot,'{updatedAt}','"2026-09-15T18:00:00.000Z"')
    where id='${ROUND}'`);
  let friendCard = (await run(`select id,active,audience from public.social_activities_v3
    where source_round_id='${ROUND}' and author_id='${FRIEND}'
      and event_kind='ROUND_COMPLETED'`)).rows[0];
  assert.equal(friendCard.active,true);
  assert.equal(friendCard.audience,"FRIENDS");
  await run(`update public.social_activities_v3 set material_hash='${HASH}'
    where id='${friendCard.id}' and source_version=4`);
  await role(OTHER);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where id='${friendCard.id}'`)).rows[0].n,1,
    "only this participant's own friend sees their voluntarily shared card");
  await admin();
  await role(FRIEND);
  assert.equal((await run(`delete from public.social_round_account_links_v3
    where round_id='${ROUND}' and user_id='${FRIEND}' returning user_id`)).rows.length,1);
  await admin();
  friendCard = (await run(`select id,active from public.social_activities_v3
    where id='${friendCard.id}'`)).rows[0];
  assert.equal(friendCard.active,false,"revoke trigger immediately deactivates participant card");
  await run(`update public.social_activities_v3 set active=true where id='${friendCard.id}'`);
  await role(OTHER);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where id='${friendCard.id}'`)).rows[0].n,0,
    "RLS still denies a forged active card when SELF_CONFIRMED link is absent");
  await admin();
  await run(`update public.social_activities_v3 set active=false where id='${friendCard.id}'`);
  await role(FRIEND);
  await run(`insert into public.social_round_account_links_v3(round_id,user_id,player_key,verified_by)
    values('${ROUND}','${FRIEND}','friend-player','SELF_CONFIRMED')`);
  await admin();
  friendCard = (await run(`select id,active,audience from public.social_activities_v3
    where id='${friendCard.id}'`)).rows[0];
  assert.equal(friendCard.active,true,"new explicit self-confirmation can republish the private source");
  assert.equal(friendCard.audience,"FRIENDS");
  await role(OTHER);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where id='${friendCard.id}'`)).rows[0].n,0,
    "re-confirmation cannot publish a provisional hash until server materialization");
  await admin();
  await run(`update public.social_activities_v3 set material_hash='${HASH}'
    where id='${friendCard.id}' and source_version=4`);
  await role(OTHER);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where id='${friendCard.id}'`)).rows[0].n,1);
  await admin();

  // A synthetic ACHIEVEMENT source isolates RLS preferences; the deterministic
  // achievements engine is independently exercised in round-achievements.test.ts.
  await run(`insert into public.social_activity_preferences_v3(
    user_id,notify_friend_achievement) values('${OTHER}',true)`);
  await run(`insert into public.social_activities_v3(
    author_id,event_kind,source_round_id,local_round_id,source_version,
    material_hash,audience,active)
    values('${FRIEND}','ACHIEVEMENT','${ROUND}','local-round-1',4,
      '${HASH}','FRIENDS',true)`);
  await role(OTHER);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where source_round_id='${ROUND}' and author_id='${FRIEND}'
      and event_kind='ACHIEVEMENT'`)).rows[0].n,0,
    "shareAchievements=false hides even a FRIENDS-labelled event");
  await admin();
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${OTHER}' and event_type='friend_achievement'`)).rows[0].n,0,
    "no friend-achievement fanout before the source author consents");
  await run(`update public.social_activity_preferences_v3 set share_achievements=true
    where user_id='${FRIEND}'`);
  await role(OTHER);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where source_round_id='${ROUND}' and author_id='${FRIEND}'
      and event_kind='ACHIEVEMENT'`)).rows[0].n,1);
  await admin();
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${OTHER}' and event_type='friend_achievement'`)).rows[0].n,1,
    "opted-in friend receives one notification after definitive SHA publication");
  await run(`update public.social_activity_preferences_v3 set share_achievements=false
    where user_id='${FRIEND}'`);

  await run(`insert into public.notification_events_v2(
    id,recipient_id,event_type,resource_type,resource_id)
    values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${FRIEND}',
      'group','GROUP','qa-non-social')`);
  await role(OTHER);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where source_round_id='${ROUND}' and author_id='${FRIEND}'
      and event_kind='ACHIEVEMENT'`)).rows[0].n,0,
    "revoking achievement sharing applies immediately at SELECT time");
  await admin();
  await run(`update public.social_activity_preferences_v3 set share_achievements=true
    where user_id='${FRIEND}'`);
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${OTHER}' and event_type='friend_achievement'`)).rows[0].n,1,
    "same material revision is not re-notified after an audience toggle");
  await run(`update public.social_activity_preferences_v3 set share_achievements=false
    where user_id='${FRIEND}'`);

  // Source version is provenance; the material SHA is the authoritative CAS.
  // A cosmetic updatedAt does not change the TS whitelist fingerprint, so a
  // participant may attest with the older UI version and the DB stores actual.
  const ownerCard = (await run(`select id from public.social_activities_v3
    where source_round_id='${ROUND}' and author_id='${OWNER}'
      and event_kind='ROUND_COMPLETED'`)).rows[0];
  await run(`update public.social_activities_v3 set material_hash='${NEXT_HASH}'
    where id='${ownerCard.id}' and source_version=4`);
  await run(`update public.rounds_cloud set version=5,
    snapshot=jsonb_set(snapshot,'{updatedAt}','"2026-09-15T19:00:00.000Z"')
    where id='${ROUND}'`);
  await run(`update public.social_activities_v3 set material_hash='${NEXT_HASH}'
    where id='${ownerCard.id}' and source_version=5`);
  await role(PARTICIPANT_B);
  const advisory = (await run(`insert into public.social_round_attestations_v3(
    activity_id,round_id,attester_id,target_user_id,expected_version,expected_hash)
    values('${ownerCard.id}','${ROUND}','${PARTICIPANT_B}','${OWNER}',4,'${NEXT_HASH}')
    returning expected_version`)).rows[0];
  assert.equal(advisory.expected_version,5,
    "same-SHA cosmetic source bump succeeds and stores the actual locked source version");
  await expectError(() => run(`insert into public.social_round_attestations_v3(
    activity_id,round_id,attester_id,target_user_id,expected_version,expected_hash)
    values('${ownerCard.id}','${ROUND}','${PARTICIPANT_B}','${OWNER}',4,'${HASH}')`),
    ["40001","42501"],"changed material SHA rejects stale action");
  await admin();
  await run(`update public.social_activities_v3 set material_hash='${HASH}'
    where id='${friendCard.id}' and source_version=5`);

  await run(`update public.profiles set social_privacy='PRIVATE' where id='${OWNER}'`);
  await role(FRIEND);
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where author_id='${OWNER}'`)).rows[0].n,0,
    "revoking Said's sharing hides Said's cards, without deleting another owner's private card");
  assert.equal((await run(`select count(*) as n from public.social_activities_v3
    where author_id='${FRIEND}'`)).rows[0].n,1,
    "a golfer retains their own definitive round after Said revokes sharing; stale synthetic achievement stays hidden");
  assert.equal((await run("select count(*) as n from public.social_comments_v3")).rows[0].n,0);
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${FRIEND}' and event_type='equipment'`)).rows[0].n,0,
    "author privacy revoke hides the old Social notification via direct recipient RLS");
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${FRIEND}' and event_type='group'`)).rows[0].n,1,
    "restrictive Social policy does not hide unrelated recipient notifications");
  await admin();
  assert.equal((await run(`select count(*) as n from public.notification_events_v2
    where recipient_id='${FRIEND}' and event_type='equipment'`)).rows[0].n,1,
    "revocation filters direct recipient reads without destructively deleting the audit event");

  // Reverse direction is equally valid: the canonical organizer participated
  // and can attest a peer. ROUND_OWNER never needs a SELF_CONFIRMED insert.
  await run(`update public.social_activity_preferences_v3 set share_rounds=true
    where user_id='${FRIEND}'`);
  await run(`update public.social_activities_v3 set material_hash='${HASH}'
    where id='${friendCard.id}' and source_version=5`);
  assert.equal((await run(`select verified_by from public.social_round_account_links_v3
    where round_id='${ROUND}' and user_id='${OWNER}'`)).rows[0].verified_by,"ROUND_OWNER");
  await role(OWNER);
  const reverseAttest = (await run(`insert into public.social_round_attestations_v3(
    activity_id,round_id,attester_id,target_user_id,expected_version,expected_hash)
    values('${friendCard.id}','${ROUND}','${OWNER}','${FRIEND}',5,'${HASH}')
    returning attester_id,target_user_id`)).rows[0];
  assert.equal(reverseAttest.attester_id,OWNER);
  assert.equal(reverseAttest.target_user_id,FRIEND);
  await admin();
  await db.exec("set role service_role");
  assert.equal((await run(`update public.social_activities_v3 set material_hash=material_hash
    where id='${friendCard.id}' returning id`)).rows[0].id,friendCard.id,
    "server reconciliation has an explicit real UPDATE grant");
  assert.equal((await run(`insert into public.social_activities_v3(
    author_id,event_kind,source_round_id,local_round_id,source_version,material_hash,audience)
    values('${OWNER}','ACHIEVEMENT','${ROUND}','local-round-1',5,'${NEXT_HASH}','OWNER')
    returning author_id`)).rows[0].author_id,OWNER,
    "server reconciliation has an explicit real INSERT grant for derived summary references");
  await admin();
  console.log("isolated SocialActivity PostgreSQL QA passed: 3 self-confirmed attesters + organizer attests peer, blocked/nonparticipant/anon, immutable comments, notifications, definitive SHA, revision advisory, equipment, privacy/revoke");
} catch (error) {
  console.error(`${error.code ?? "ERROR"}: ${error.message}; position=${error.position ?? "?"}; detail=${error.detail ?? "?"}; queryLength=${error.query?.length ?? "?"}`);
  if (error.code === "ERR_ASSERTION") console.error(error.stack);
  console.error(error.query?.slice(0,300));
  process.exitCode = 1;
} finally {
  await db.close();
}

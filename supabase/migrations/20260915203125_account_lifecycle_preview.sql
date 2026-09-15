-- Isolated Preview only. Non-destructive installation; no account is changed
-- until a server-verified, strongly confirmed request calls these RPCs.
begin;
create schema if not exists private;

create table private.account_lifecycle_state (
  user_id uuid primary key,
  account_status text not null check (account_status in ('closing','archived','deleted')),
  archived_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);
create table private.account_lifecycle_jobs (
  request_id uuid primary key,
  user_id uuid not null unique,
  data_policy text not null check (data_policy in ('delete_golf_data','retain_history')),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  stage text not null default 'requested' check (stage in ('requested','data_prepared','completed')),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table private.account_lifecycle_state enable row level security;
alter table private.account_lifecycle_jobs enable row level security;
revoke all on private.account_lifecycle_state,private.account_lifecycle_jobs from public,anon,authenticated;
grant all on private.account_lifecycle_state,private.account_lifecycle_jobs to service_role;

create function private.account_data_access_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is null or (
    exists(select 1 from auth.users where id=(select auth.uid()))
    and not exists(select 1 from private.account_lifecycle_state where user_id=(select auth.uid()))
  )
$$;
revoke all on function private.account_data_access_allowed() from public;
grant execute on function private.account_data_access_allowed() to anon,authenticated,service_role;
create function private.account_subject_active(subject_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=subject_id)
    and not exists(select 1 from private.account_lifecycle_state where user_id=subject_id)
$$;
revoke all on function private.account_subject_active(uuid) from public;
grant execute on function private.account_subject_active(uuid) to authenticated,service_role;

create function public.account_access_status() returns text
language sql stable security definer set search_path='' as $$
  select case when (select auth.uid()) is null then 'unauthenticated'
    when not exists(select 1 from auth.users where id=(select auth.uid())) then 'deleted'
    else coalesce((select account_status from private.account_lifecycle_state where user_id=(select auth.uid())),'active') end
$$;
revoke all on function public.account_access_status() from public,anon;
grant execute on function public.account_access_status() to authenticated,service_role;

-- The Data API pre-request check also protects SECURITY DEFINER business RPCs.
-- RLS separately protects Storage and direct table access with a stale JWT.
create function public.account_api_access_guard() returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.account_data_access_allowed() then
    raise insufficient_privilege using message='account_access_restricted';
  end if;
end $$;
revoke all on function public.account_api_access_guard() from public;
grant execute on function public.account_api_access_guard() to anon,authenticated,service_role;
do $$ declare existing_hook text; target record; begin
  select split_part(setting,'=',2) into existing_hook from pg_roles r,
    lateral unnest(r.rolconfig) setting where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%';
  if nullif(existing_hook,'') is not null and existing_hook <> 'public.account_api_access_guard' then
    raise exception 'existing_pre_request_hook_requires_controlled_composition';
  end if;
  alter role authenticator set pgrst.db_pre_request='public.account_api_access_guard';
  for target in select schemaname,tablename from pg_tables
    where (schemaname='public' and rowsecurity) or (schemaname='storage' and tablename='objects')
  loop
    execute format('create policy account_active_access on %I.%I as restrictive for all to authenticated using ((select private.account_data_access_allowed())) with check ((select private.account_data_access_allowed()))',target.schemaname,target.tablename);
  end loop;
end $$;
notify pgrst,'reload config';
create policy account_subject_visible on public.profiles as restrictive for select to authenticated using(private.account_subject_active(id));
create policy account_subject_visible on public.social_profiles as restrictive for select to authenticated using(private.account_subject_active(user_id));
-- The directory search is a SECURITY DEFINER RPC, so a table policy alone is
-- insufficient. Add the same subject check without changing saved privacy.
do $$ declare definition text; begin
  select pg_get_functiondef('public.search_social_profiles_v2(text,integer)'::regprocedure) into definition;
  if position('and profile.user_id <> (select auth.uid())' in definition)=0 then raise exception 'social_directory_review_required'; end if;
  execute replace(definition,'and profile.user_id <> (select auth.uid())','and private.account_subject_active(profile.user_id) and profile.user_id <> (select auth.uid())');
end $$;

-- Scrub identity-bearing objects while preserving scores, player keys, teams
-- and economic results belonging to the other participants. Never match names.
create function private.anonymize_account_json(value jsonb,target uuid,player_keys text[] default '{}') returns jsonb
language plpgsql immutable set search_path='' as $$
declare output jsonb; pair record; matched boolean; local_keys text[]:=player_keys; owner_matches boolean; begin
  if jsonb_typeof(value)='object' and jsonb_typeof(value->'players')='array' then
    select local_keys || coalesce(array_agg(p->>'id') filter(where p->>'id' is not null),'{}') into local_keys
      from jsonb_array_elements(value->'players') p where p->>'accountUserId'=target::text;
  end if;
  if jsonb_typeof(value)='array' then
    select coalesce(jsonb_agg(private.anonymize_account_json(item,target,local_keys)),'[]'::jsonb) into output from jsonb_array_elements(value) item;
    return output;
  elsif jsonb_typeof(value)='object' then
    matched := value->>'accountUserId'=target::text or value->>'profileId'=target::text or value->>'userId'=target::text
      or value->>'id'=any(local_keys) or value->>'playerId'=any(local_keys) or value->>'roundPlayerId'=any(local_keys) or value->>'opponentId'=any(local_keys);
    owner_matches:=value->>'ownerId'=any(local_keys);
    output := '{}'::jsonb;
    for pair in select * from jsonb_each(value) loop
      if (coalesce(matched,false) and pair.key in ('name','playerName','opponentName','displayName','display_name','firstName','lastName','username'))
        or (coalesce(owner_matches,false) and pair.key='ownerName') then
        output := output || jsonb_build_object(pair.key,'Jugador eliminado');
      elsif (coalesce(matched,false) and pair.key in ('email','phone','avatar','avatarUrl','avatar_url','avatarConfig','photoUrl','photoDataUrl','emoji','profilePhoto'))
        or (coalesce(owner_matches,false) and pair.key in ('ownerAvatar','ownerPhoto','ownerPlayerSnapshot','ownerBagSnapshot'))
        or (pair.key in ('accountUserId','profileId','userId') and pair.value=to_jsonb(target::text)) then
        output := output || jsonb_build_object(pair.key,null);
      else output := output || jsonb_build_object(pair.key,private.anonymize_account_json(pair.value,target,local_keys));
      end if;
    end loop;
    if coalesce(matched,false) then output := output || '{"identityDeleted":true}'::jsonb; end if;
    return output;
  end if;
  return value;
end $$;
revoke all on function private.anonymize_account_json(jsonb,uuid,text[]) from public,anon,authenticated;

-- A stale offline device must not restore deleted account identities through
-- an otherwise authorized owner's later cloud sync.
create function private.account_scrub_deleted_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
declare document jsonb:=to_jsonb(new); target record; column_name text; begin
  foreach column_name in array tg_argv loop
    if document->column_name is null then continue; end if;
    for target in select state.user_id from private.account_lifecycle_state state
      join private.account_lifecycle_jobs job on job.user_id=state.user_id
      where job.data_policy='delete_golf_data' and (job.stage<>'requested' or state.account_status='deleted')
      and (document->column_name)::text like '%'||state.user_id::text||'%'
    loop
      document:=jsonb_set(document,array[column_name],private.anonymize_account_json(document->column_name,target.user_id));
    end loop;
  end loop;
  new:=jsonb_populate_record(new,document);
  return new;
end $$;
revoke all on function private.account_scrub_deleted_snapshot() from public,anon,authenticated;
do $$ declare target record; begin
  for target in select table_name,string_agg(quote_literal(column_name),',') args from information_schema.columns
    where table_schema='public' and udt_name='jsonb' and table_name in
      ('rounds_cloud','round_bet_configs','round_bet_results','personal_bets_cloud','manual_bets_cloud','expenses_cloud','round_course_handicap_snapshots','user_cloud_state','players','frequent_groups_cloud','personal_rivals_cloud','groups_v2','group_memories_v2','group_bet_templates_v2','live_round_operations_v2','cloud_record_versions')
    group by table_name
  loop
    execute format('create trigger account_scrub_deleted_snapshot before insert or update on public.%I for each row execute function private.account_scrub_deleted_snapshot(%s)',target.table_name,target.args);
  end loop;
end $$;
create function private.account_scrub_round_player_name() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  if exists(select 1 from public.rounds_cloud r,jsonb_array_elements(coalesce(r.snapshot->'players','[]')) p
    where r.id=new.round_id and p->>'id'=new.local_player_id and p->>'identityDeleted'='true') then new.name:='Jugador eliminado'; end if;
  return new;
end $$;
revoke all on function private.account_scrub_round_player_name() from public,anon,authenticated;
create trigger account_scrub_round_player_name before insert or update on public.round_players_cloud
  for each row execute function private.account_scrub_round_player_name();

-- Preserve shared records without inventing a replacement account/owner.
alter table public.rounds_cloud alter column owner_id drop not null;
alter table public.groups_v2 alter column owner_id drop not null;
alter table public.tournaments alter column created_by drop not null;
alter table public.guest_players_v2 alter column owner_id drop not null;
alter table public.group_memories_v2 alter column updated_by drop not null;
alter table public.live_round_operations_v2 alter column actor_id drop not null;
alter table public.round_activity_v2 alter column actor_id drop not null;
create policy round_group_snapshot_participant_read on public.round_group_snapshots_v2 for select to authenticated
  using(private.is_round_participant(round_id));
create policy round_group_snapshot_player_participant_read on public.round_group_snapshot_players_v2 for select to authenticated
  using(private.is_round_participant(round_id));

-- Existing archive triggers cannot insert a version owned by an Auth row
-- already being cascaded away, nor by an anonymized ownerless shared round.
do $$ declare definition text; fn text; owner_column text; begin
  foreach fn in array array['archive_backyard_round_version','archive_backyard_draft_version'] loop
    owner_column:=case when fn='archive_backyard_round_version' then 'owner_id' else 'user_id' end;
    select replace(pg_get_functiondef(('public.'||fn||'()')::regprocedure),E'\r\n',E'\n') into definition;
    if position(E'begin\n' in definition)=0 then raise exception 'cloud_archiver_review_required'; end if;
    definition:=replace(definition,E'begin\n',format(E'begin\n  if old.%I is null or not exists(select 1 from auth.users where id=old.%I) then\n    if tg_op=''DELETE'' then return old; else return new; end if;\n  end if;\n',owner_column,owner_column));
    execute definition;
  end loop;
end $$;

-- Existing publisher assumes an organizer Auth row. An orphaned shared round
-- keeps participant cards; only their current revision needs reconciliation.
do $$ declare definition text; begin
  select replace(pg_get_functiondef('private.publish_social_round_v3()'::regprocedure),E'\r\n',E'\n') into definition;
  if position(E'begin\n  completed :=' in definition)=0 then raise exception 'social_publisher_review_required'; end if;
  definition:=replace(definition,E'begin\n  completed :=',E'begin\n  if new.owner_id is null then\n    update public.social_activities_v3 set source_version=new.version,material_hash=md5(new.snapshot::text),updated_at=now() where source_round_id=new.id;\n    return new;\n  end if;\n  completed :=');
  execute definition;
end $$;
create function private.account_hide_closed_social_activity() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  if exists(select 1 from private.account_lifecycle_state where user_id=new.author_id) then new.active:=false; end if;
  return new;
end $$;
revoke all on function private.account_hide_closed_social_activity() from public,anon,authenticated;
create trigger account_hide_closed_social_activity before insert or update on public.social_activities_v3
  for each row execute function private.account_hide_closed_social_activity();

create function public.account_lifecycle_acquire(actor uuid,operation_id uuid,policy text,proof_hash text,lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.account_lifecycle_jobs; begin
  if actor is null or operation_id is null or lease is null or policy not in ('delete_golf_data','retain_history') or proof_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_lifecycle_request' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,619));
  select * into job from private.account_lifecycle_jobs where user_id=actor for update;
  if found then
    if job.request_id<>operation_id or job.data_policy<>policy or job.token_hash<>proof_hash then
      raise exception 'lifecycle_request_conflict' using errcode='23505';
    end if;
    if job.stage='completed' then return to_jsonb(job)-'token_hash'; end if;
    if job.lease_until>clock_timestamp() then return (to_jsonb(job)-'token_hash') || '{"lease_token":null}'::jsonb; end if;
  else
    if not exists(select 1 from auth.users where id=actor) then raise insufficient_privilege using message='authentication_required'; end if;
    insert into private.account_lifecycle_jobs(request_id,user_id,data_policy,token_hash) values(operation_id,actor,policy,proof_hash);
    insert into private.account_lifecycle_state(user_id,account_status) values(actor,'closing');
    update public.social_activities_v3 set active=false where author_id=actor;
    insert into public.product_usage_events_v2(id,owner_id,event_name,metadata,occurred_at)
      values('account-delete-'||operation_id::text,actor,'account_delete_requested',jsonb_build_object('policy',policy),clock_timestamp());
  end if;
  update private.account_lifecycle_jobs set lease_token=lease,lease_until=clock_timestamp()+interval '2 minutes' where request_id=operation_id returning * into job;
  return to_jsonb(job)-'token_hash';
end $$;

-- Recovery proves possession of the exact bearer used for the authenticated
-- confirmed request. This endpoint does not accept a client-supplied user id.
create function public.account_lifecycle_recover(operation_id uuid,policy text,proof_hash text) returns uuid
language sql stable security definer set search_path='' as $$
  select user_id from private.account_lifecycle_jobs where request_id=operation_id and data_policy=policy and token_hash=proof_hash
$$;

create function public.account_lifecycle_storage(operation_id uuid,lease uuid)
returns table(bucket_id text,name text) language plpgsql security definer set search_path='' as $$
declare actor uuid; begin
  select user_id into actor from private.account_lifecycle_jobs where request_id=operation_id and lease_token=lease
    and lease_until>clock_timestamp() and data_policy='delete_golf_data' and stage='requested';
  if actor is null or lease is null then raise insufficient_privilege; end if;
  return query select o.bucket_id,o.name from storage.objects o
    where o.owner_id=actor::text or o.owner=actor
      or (o.bucket_id='scorecard-photos' and split_part(o.name,'/',1)=actor::text)
    order by o.bucket_id,o.name limit 100;
end $$;

create function public.account_lifecycle_prepare(operation_id uuid,lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.account_lifecycle_jobs; actor uuid; target record; begin
  select * into job from private.account_lifecycle_jobs where request_id=operation_id for update;
  if not found or lease is null or job.lease_token is distinct from lease or job.lease_until is null or job.lease_until<=clock_timestamp() then raise insufficient_privilege; end if;
  if job.stage<>'requested' then return to_jsonb(job)-'token_hash'; end if;
  actor:=job.user_id;
  if job.data_policy='delete_golf_data' then
    -- Private-only owned rounds can be removed. Shared canonical rounds stay;
    -- participant reads remain governed by existing participant RLS.
    delete from public.rounds_cloud r where r.owner_id=actor
      and not exists(select 1 from public.round_participants_v2 p where p.round_id=r.id and p.user_id is not null and p.user_id<>actor)
      and not exists(select 1 from public.social_round_account_links_v3 p where p.round_id=r.id and p.user_id<>actor)
      and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(r.snapshot->'players')='array' then r.snapshot->'players' else '[]'::jsonb end) p
        join auth.users u on u.id::text=p->>'accountUserId' where u.id<>actor);
    update public.rounds_cloud set owner_id=null where owner_id=actor;
    -- Anonymize all canonical player projections before the profile FK is null.
    update public.round_players_cloud p set name='Jugador eliminado'
      where exists(select 1 from public.rounds_cloud r,jsonb_array_elements(coalesce(r.snapshot->'players','[]')) player
        where r.id=p.round_id and player->>'accountUserId'=actor::text and player->>'id'=p.local_player_id);
    update public.round_group_snapshot_players_v2 s set display_name_snapshot='Jugador eliminado'
      where exists(select 1 from public.round_players_cloud p where p.id=s.round_player_id and p.name='Jugador eliminado');
    update public.players set name='Jugador eliminado',profile_id=null,snapshot=private.anonymize_account_json(coalesce(snapshot,'{}')||jsonb_build_object('accountUserId',actor),actor) where profile_id=actor;
    update public.tournament_players set name='Jugador eliminado',profile_id=null,pin_hash=null,claimed_at=null where profile_id=actor;
    update public.guest_players_v2 set display_name='Jugador eliminado',linked_user_id=null,linked_at=null where linked_user_id=actor;
    -- Shared groups retain their members/templates; there is no silent transfer
    -- of ownership. Existing ADMIN memberships can continue managing the group.
    delete from public.groups_v2 g where g.owner_id=actor and not exists(select 1 from public.group_memberships_v2 m where m.group_id=g.id and m.user_id is not null and m.user_id<>actor);
    update public.groups_v2 set owner_id=null where owner_id=actor;
    update public.guest_players_v2 g set owner_id=null where owner_id=actor and (
      exists(select 1 from public.round_participants_v2 p where p.guest_player_id=g.id)
      or exists(select 1 from public.group_memberships_v2 m where m.guest_player_id=g.id));
    update public.group_memories_v2 set updated_by=null where updated_by=actor;
    delete from public.group_invites_v2 where inviter_id=actor;
    delete from public.round_invites_v2 where inviter_id=actor;
    delete from public.guest_player_claims_v2 where created_by=actor;
    update public.live_round_operations_v2 set actor_id=null where actor_id=actor;
    update public.round_activity_v2 set actor_id=null where actor_id=actor;
    update public.courses_cloud set owner_id=null where owner_id=actor;
    update public.course_versions set created_by=null where created_by=actor;
    update public.golf_clubs set created_by=null where created_by=actor;
    update public.golf_courses set created_by=null where created_by=actor;
    delete from public.tournaments t where t.created_by=actor and not exists(select 1 from public.tournament_access a where a.tournament_id=t.id and a.user_id is not null and a.user_id<>actor)
      and not exists(select 1 from public.tournament_players p where p.tournament_id=t.id and p.profile_id is not null and p.profile_id<>actor);
    update public.tournaments set created_by=null where created_by=actor;
    update public.tournament_groups set confirmed_by=null where confirmed_by=actor;
    update public.tournament_scores set entered_by=null,access_id=null where entered_by=actor or access_id in(select id from public.tournament_access where user_id=actor);
    update public.tournament_oyes set entered_by=null,access_id=null where entered_by=actor or access_id in(select id from public.tournament_access where user_id=actor);
    update public.score_audit_log set changed_by=null,reason=null where changed_by=actor;
    -- JSON columns are legacy snapshots, not a new opaque storage model. Only
    -- identity-linked objects are scrubbed; unlinked names are never guessed.
    for target in select table_name,column_name from information_schema.columns where table_schema='public' and udt_name='jsonb'
      and table_name in ('rounds_cloud','round_bet_configs','round_bet_results','personal_bets_cloud','manual_bets_cloud','expenses_cloud','round_course_handicap_snapshots','user_cloud_state','players','frequent_groups_cloud','personal_rivals_cloud','groups_v2','group_memories_v2','group_bet_templates_v2','live_round_operations_v2','cloud_record_versions')
    loop
      execute format('update public.%I set %I=private.anonymize_account_json(%I,$1) where %I::text like $2',target.table_name,target.column_name,target.column_name,target.column_name)
        using actor,'%'||actor::text||'%';
    end loop;
    -- Auth deletion will cascade private account-owned rows. All RESTRICT and
    -- shared references above are prepared in this one atomic transaction.
  end if;
  update private.account_lifecycle_jobs set stage='data_prepared',lease_until=clock_timestamp()+interval '2 minutes' where request_id=operation_id returning * into job;
  return to_jsonb(job)-'token_hash';
end $$;

create function public.account_lifecycle_complete(operation_id uuid,lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.account_lifecycle_jobs; begin
  select * into job from private.account_lifecycle_jobs where request_id=operation_id for update;
  if not found or lease is null or job.lease_token is distinct from lease or job.lease_until is null or job.lease_until<=clock_timestamp() then raise insufficient_privilege; end if;
  if job.stage<>'data_prepared' then raise insufficient_privilege; end if;
  if job.data_policy='delete_golf_data' and exists(select 1 from auth.users where id=job.user_id) then raise exception 'auth_deletion_not_complete'; end if;
  if job.data_policy='retain_history' and not exists(select 1 from auth.users where id=job.user_id and banned_until>clock_timestamp()) then raise exception 'auth_archive_not_complete'; end if;
  update private.account_lifecycle_state set account_status=case when job.data_policy='retain_history' then 'archived' else 'deleted' end,
    archived_at=case when job.data_policy='retain_history' then clock_timestamp() end,
    deleted_at=case when job.data_policy='delete_golf_data' then clock_timestamp() end,updated_at=clock_timestamp() where user_id=job.user_id;
  update private.account_lifecycle_jobs set stage='completed',completed_at=clock_timestamp(),lease_token=null,lease_until=null where request_id=operation_id returning * into job;
  return to_jsonb(job)-'token_hash';
end $$;

create function public.account_lifecycle_release(operation_id uuid,lease uuid) returns void
language sql security definer set search_path='' as $$
  update private.account_lifecycle_jobs set lease_token=null,lease_until=null where request_id=operation_id and lease_token=lease
$$;

-- Only the trusted server may orchestrate lifecycle operations. No client can
-- provide an arbitrary actor to any of these functions, even authenticated.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'account_lifecycle_%'
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
commit;

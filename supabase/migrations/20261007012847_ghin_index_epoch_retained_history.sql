-- DEV additive source state. Rollback: disable transition UI; retain the state
-- and provider evidence. Never drop/history-delete to roll back this feature.
create table public.player_handicap_source_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  backyard_index_reset_at timestamptz not null,
  source_changed_at timestamptz not null,
  source_revision bigint not null default 1 check (source_revision > 0),
  retained_ghin_player_id text,
  retained_ghin_score_ids text[] not null default '{}',
  ghin_unlinked_at timestamptz,
  check (cardinality(retained_ghin_score_ids) <= 20)
);
alter table public.player_handicap_source_state enable row level security;
revoke all on public.player_handicap_source_state from public, anon, authenticated, service_role;
grant select on public.player_handicap_source_state to authenticated;
grant select, insert, update on public.player_handicap_source_state to service_role;
create policy player_handicap_source_state_owner_read on public.player_handicap_source_state
  for select to authenticated using (owner_id = (select auth.uid())
    and not coalesce((select auth.jwt())->>'is_anonymous','false')::boolean
    and private.account_subject_active(owner_id));

-- Called only after the provider identity has been verified. An existing link
-- can adopt the boundary once; refresh/reauthorization never advance it.
create or replace function public.initialize_verified_handicap_source_v1(p_owner_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.player_handicap_provider_profiles
    where owner_id=p_owner_id and provider='GHIN' and association_status='VERIFIED') then
    raise exception 'GHIN_NOT_VERIFIED';
  end if;
  insert into public.player_handicap_source_state(owner_id,backyard_index_reset_at,source_changed_at)
    values(p_owner_id,statement_timestamp(),statement_timestamp()) on conflict(owner_id) do nothing;
end; $$;
revoke all on function public.initialize_verified_handicap_source_v1(uuid) from public, anon, authenticated;
grant execute on function public.initialize_verified_handicap_source_v1(uuid) to service_role;

create or replace function private.record_verified_handicap_source_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.provider <> 'GHIN' or new.association_status <> 'VERIFIED' then return new; end if;
  if tg_op='UPDATE' and old.association_status='VERIFIED' and old.external_player_id=new.external_player_id then
    perform public.initialize_verified_handicap_source_v1(new.owner_id);
  else
    insert into public.player_handicap_source_state(owner_id,backyard_index_reset_at,source_changed_at)
      values(new.owner_id,statement_timestamp(),statement_timestamp())
    on conflict(owner_id) do update set
      backyard_index_reset_at=excluded.backyard_index_reset_at,
      source_changed_at=excluded.source_changed_at,
      source_revision=public.player_handicap_source_state.source_revision+1;
  end if;
  return new;
end; $$;
revoke all on function private.record_verified_handicap_source_v1() from public, anon, authenticated;
grant execute on function private.record_verified_handicap_source_v1() to service_role;
create trigger player_handicap_provider_source_transition
  after insert or update on public.player_handicap_provider_profiles
  for each row execute function private.record_verified_handicap_source_v1();

-- Lock the profile while taking the retained-ID snapshot. Imported provider
-- rows and posting receipts have no FK to the profile; neither is deleted.
create or replace function public.unlink_ghin_profile_v1(p_owner_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  removed_external_player_id text;
  retained_ids text[];
begin
  select external_player_id into removed_external_player_id
    from public.player_handicap_provider_profiles
    where owner_id=p_owner_id and provider='GHIN' for update;
  if removed_external_player_id is null then return false; end if;
  perform public.initialize_verified_handicap_source_v1(p_owner_id);
  select coalesce(array_agg(s.external_score_id order by s.played_on desc,s.external_score_id desc),'{}')
    into retained_ids from (select external_score_id,played_on from public.handicap_provider_scores
      where owner_id=p_owner_id and provider='GHIN' and external_player_id=removed_external_player_id
      order by played_on desc,external_score_id desc limit 20) s;
  update public.player_handicap_source_state set
    retained_ghin_player_id=removed_external_player_id,retained_ghin_score_ids=retained_ids,
    ghin_unlinked_at=statement_timestamp(),source_changed_at=statement_timestamp(),source_revision=source_revision+1
    where owner_id=p_owner_id;
  delete from public.player_handicap_provider_profiles where owner_id=p_owner_id and provider='GHIN';
  insert into public.player_handicap_provider_link_audit(owner_id,provider,external_player_id,event)
    values(p_owner_id,'GHIN',removed_external_player_id,'UNLINKED');
  return true;
end; $$;
revoke all on function public.unlink_ghin_profile_v1(uuid) from public, anon, authenticated;
grant execute on function public.unlink_ghin_profile_v1(uuid) to service_role;

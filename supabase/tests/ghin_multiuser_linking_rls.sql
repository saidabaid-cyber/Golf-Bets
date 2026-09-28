-- Multiuser GHIN uniqueness, ownership and unlink audit contract.
-- Runs transactionally against isolated/local Supabase only.
begin;

delete from public.player_handicap_provider_link_audit
where owner_id in (
  '41000000-0000-4000-8000-000000000001'::uuid,
  '41000000-0000-4000-8000-000000000002'::uuid
);
delete from public.player_handicap_provider_profiles
where owner_id in (
  '41000000-0000-4000-8000-000000000001'::uuid,
  '41000000-0000-4000-8000-000000000002'::uuid
);
delete from auth.users
where id in (
  '41000000-0000-4000-8000-000000000001'::uuid,
  '41000000-0000-4000-8000-000000000002'::uuid
);

do $$
begin
  if to_regclass('public.player_handicap_provider_link_audit') is null then
    raise exception 'missing GHIN unlink audit';
  end if;
  if not exists (
    select 1 from pg_class relation
    join pg_namespace schema on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname = 'player_handicap_provider_link_audit'
      and relation.relrowsecurity
  ) then raise exception 'GHIN unlink audit RLS is not enabled'; end if;
  if has_table_privilege('authenticated', 'public.player_handicap_provider_link_audit', 'SELECT')
    or has_table_privilege('authenticated', 'public.player_handicap_provider_link_audit', 'INSERT')
    or has_table_privilege('authenticated', 'public.player_handicap_provider_link_audit', 'UPDATE')
    or has_table_privilege('authenticated', 'public.player_handicap_provider_link_audit', 'DELETE') then
    raise exception 'authenticated role can access unlink audit';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'player_handicap_provider_profiles'
      and indexname = 'player_handicap_provider_profiles_provider_player_unique'
      and indexdef ilike 'create unique index%'
      and indexdef ilike '%where (association_status = ''VERIFIED''%'
  ) then raise exception 'provider identity uniqueness is missing'; end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('player_handicap_provider_profiles', 'player_handicap_provider_link_audit')
      and column_name ~* '(password|secret|credential|bearer|token|cookie|raw_response|authorization)'
  ) then raise exception 'GHIN multiuser schema persists secret material'; end if;
end;
$$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('41000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ghin-owner-a@backyard.invalid', '', now(), '{}', '{}', now(), now()),
  ('41000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ghin-owner-b@backyard.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles(id, name) values
  ('41000000-0000-4000-8000-000000000001', 'GHIN Owner A'),
  ('41000000-0000-4000-8000-000000000002', 'GHIN Owner B')
on conflict(id) do update set name = excluded.name;

insert into public.player_handicap_provider_profiles(
  owner_id, provider, external_player_id, association_status, self_attested_at,
  provider_player_name, provider_club_name, provider_home_club_name,
  provider_player_status, handicap_index, last_successful_sync_at,
  last_attempted_sync_at, last_attempt_status
) values (
  '41000000-0000-4000-8000-000000000001', 'GHIN', '90000001', 'VERIFIED', now(),
  'Synthetic GHIN A', 'Synthetic Club', 'Synthetic Home Club',
  'Active', 8.1, now(), now(), 'SUCCESS'
);

-- Legacy Preview rows remain non-active and may coexist until their owner
-- reauthorizes. Promoting a second owner to VERIFIED must still be rejected.
insert into public.player_handicap_provider_profiles(
  owner_id, provider, external_player_id, association_status, self_attested_at,
  provider_player_name, last_successful_sync_at, last_attempted_sync_at, last_attempt_status
) values (
  '41000000-0000-4000-8000-000000000002', 'GHIN', '90000001', 'SELF_ATTESTED', now(),
  'Legacy Synthetic GHIN B', now(), now(), 'SUCCESS'
);

do $$
declare rejected boolean := false;
begin
  begin
    update public.player_handicap_provider_profiles
    set association_status = 'VERIFIED'
    where owner_id = '41000000-0000-4000-8000-000000000002'
      and provider = 'GHIN';
  exception when unique_violation then rejected := true;
  end;
  if not rejected then raise exception 'same GHIN linked to two Backyard owners'; end if;
end;
$$;

delete from public.player_handicap_provider_profiles
where owner_id = '41000000-0000-4000-8000-000000000002'
  and provider = 'GHIN';

set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ declare row_count integer; begin
  select count(*) into row_count from public.player_handicap_provider_profiles;
  if row_count <> 1 then raise exception 'owner A cannot read its GHIN link'; end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$ declare row_count integer; begin
  select count(*) into row_count from public.player_handicap_provider_profiles;
  if row_count <> 0 then raise exception 'owner B can read owner A GHIN link'; end if;
end $$;

reset role;
select public.unlink_ghin_profile_v1('41000000-0000-4000-8000-000000000001');
do $$
begin
  if exists (
    select 1 from public.player_handicap_provider_profiles
    where owner_id = '41000000-0000-4000-8000-000000000001' and provider = 'GHIN'
  ) then raise exception 'unlink retained active relation'; end if;
  if not exists (
    select 1 from public.player_handicap_provider_link_audit
    where owner_id = '41000000-0000-4000-8000-000000000001'
      and provider = 'GHIN' and event = 'UNLINKED'
  ) then raise exception 'unlink audit missing'; end if;
end;
$$;

-- Once explicitly unlinked, that provider identity may be linked by another
-- account; the historical audit never exposes or retains a session secret.
insert into public.player_handicap_provider_profiles(
  owner_id, provider, external_player_id, association_status, self_attested_at,
  provider_player_name, last_successful_sync_at, last_attempted_sync_at, last_attempt_status
) values (
  '41000000-0000-4000-8000-000000000002', 'GHIN', '90000001', 'VERIFIED', now(),
  'Synthetic GHIN B', now(), now(), 'SUCCESS'
);

rollback;

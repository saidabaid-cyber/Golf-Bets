-- Applied only to isolated canonical DEV bymeopxkxapfizeeqeyb on 2026-10-09.
-- Append-only private provider cache. No Course Master or historical updates.
begin;

create schema if not exists private;
create table if not exists private.golfapi_saved_responses (
  request_key text primary key check (request_key ~ '^[a-f0-9]{64}$'),
  stage_id text not null check (stage_id = 'puebla-source-20261007'),
  envelope jsonb not null check (envelope->>'provider' = 'GOLFAPI'),
  saved_at timestamptz not null default now()
);
create table if not exists private.golfapi_source_versions (
  external_course_id text not null check (external_course_id ~ '^[0-9]+$'),
  source_version text not null check (source_version ~ '^[a-f0-9]{64}$'),
  course_id text not null references public.golf_courses(id),
  club_id text not null references public.golf_clubs(id),
  snapshot jsonb not null check (snapshot->>'provider' = 'GOLFAPI' and snapshot->>'schemaVersion' = '1'),
  saved_at timestamptz not null default now(),
  primary key (external_course_id, source_version)
);

alter table private.golfapi_saved_responses enable row level security;
alter table private.golfapi_source_versions enable row level security;
-- Remove inherited/default table grants too, including service_role DELETE
-- or UPDATE, then grant only the append/read capabilities this cache needs.
revoke all on private.golfapi_saved_responses, private.golfapi_source_versions from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant select, insert on private.golfapi_saved_responses, private.golfapi_source_versions to service_role;

-- SECURITY INVOKER: no elevated definer, no anonymous/user policy or read grant.
create or replace function public.save_golfapi_response_v1(p_envelope jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_request_key text := p_envelope->>'requestKey';
  existing_body_hash text;
begin
  if p_envelope->>'provider' is distinct from 'GOLFAPI' or p_envelope->>'schemaVersion' is distinct from '1'
    or v_request_key is null or v_request_key !~ '^[a-f0-9]{64}$'
    or p_envelope->>'bodySha256' is null or p_envelope->>'bodySha256' !~ '^[a-f0-9]{64}$'
    or p_envelope->>'bodyText' is null then raise exception 'GOLFAPI_ENVELOPE_INVALID'; end if;
  perform pg_advisory_xact_lock(107072026);
  select r.envelope->>'bodySha256' into existing_body_hash from private.golfapi_saved_responses r where r.request_key = v_request_key;
  if existing_body_hash is not null and existing_body_hash <> p_envelope->>'bodySha256' then raise exception 'GOLFAPI_RESPONSE_VERSION_CONFLICT'; end if;
  if existing_body_hash is null and (select count(*) from private.golfapi_saved_responses where stage_id = 'puebla-source-20261007') >= 10 then raise exception 'GOLFAPI_IMPORT_STAGE_BUDGET_EXHAUSTED'; end if;
  insert into private.golfapi_saved_responses(request_key, stage_id, envelope)
  values(v_request_key, 'puebla-source-20261007', p_envelope) on conflict do nothing;
  return v_request_key;
end;
$$;

create or replace function public.save_golfapi_snapshot_v1(p_snapshot jsonb, p_source_version text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  external_id text := p_snapshot->>'externalCourseId';
  internal_course_id text := p_snapshot#>>'{mapping,courseId}';
  internal_club_id text := p_snapshot#>>'{mapping,clubId}';
  previous_snapshot jsonb;
begin
  if p_source_version is null or p_source_version !~ '^[a-f0-9]{64}$'
    or external_id is null or external_id !~ '^[0-9]+$' or p_snapshot->>'provider' is distinct from 'GOLFAPI'
    or p_snapshot->>'schemaVersion' is distinct from '1'
    or p_snapshot#>>'{source,sourceVersion}' is distinct from p_source_version
    or not exists (select 1 from public.golf_courses where id = internal_course_id and club_id = internal_club_id)
    or not exists (select 1 from private.golfapi_saved_responses where request_key = p_snapshot#>>'{source,coordinatesRequestKey}'
      and envelope->>'endpoint' = 'coordinates/' || external_id and envelope->>'httpStatus' = '200') then
    raise exception 'GOLFAPI_SNAPSHOT_MAPPING_OR_SOURCE_INVALID'; end if;
  -- Serialize with the response batch: a concurrent conflicting version must
  -- fail explicitly instead of disappearing behind ON CONFLICT DO NOTHING.
  perform pg_advisory_xact_lock(107072026);
  select snapshot into previous_snapshot from private.golfapi_source_versions where external_course_id = external_id and source_version = p_source_version;
  if previous_snapshot is not null and previous_snapshot <> p_snapshot then raise exception 'GOLFAPI_SNAPSHOT_VERSION_CONFLICT'; end if;
  insert into private.golfapi_source_versions(external_course_id, source_version, course_id, club_id, snapshot)
  values(external_id, p_source_version, internal_course_id, internal_club_id, p_snapshot) on conflict do nothing;
  return external_id;
end;
$$;

create or replace function public.read_golfapi_snapshot_v1(p_external_course_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select snapshot from private.golfapi_source_versions
  where external_course_id = p_external_course_id order by saved_at desc, source_version desc limit 1;
$$;

revoke all on function public.save_golfapi_response_v1(jsonb), public.save_golfapi_snapshot_v1(jsonb,text), public.read_golfapi_snapshot_v1(text) from public, anon, authenticated;
grant execute on function public.save_golfapi_response_v1(jsonb), public.save_golfapi_snapshot_v1(jsonb,text), public.read_golfapi_snapshot_v1(text) to service_role;

comment on table private.golfapi_saved_responses is 'Private immutable provider response cache. No credentials or user locations. No redistribution.';
comment on table private.golfapi_source_versions is 'Private versioned source snapshots associated to existing IDs, separate from official/local scorecards.';
commit;

-- GHIN course data remains provider-linked to stable Backyard identities.
-- This migration is additive, preserves historical round snapshots, and stores
-- no GHIN password, bearer token, Firebase token, cookie, or Authorization header.
begin;

alter table public.golf_clubs
  add column if not exists origin text,
  add column if not exists is_provisional boolean not null default false,
  add column if not exists provider_status text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists source_updated_at timestamptz;

alter table public.golf_courses
  add column if not exists origin text,
  add column if not exists layout_type text,
  add column if not exists is_provisional boolean not null default false,
  add column if not exists provider_status text,
  add column if not exists course_number text,
  add column if not exists total_par smallint,
  add column if not exists season jsonb,
  add column if not exists last_synced_at timestamptz,
  add column if not exists source_updated_at timestamptz;

alter table public.golf_course_tees
  add column if not exists origin text,
  add column if not exists display_name text,
  add column if not exists provider_status text,
  add column if not exists bogey_rating numeric(5,2),
  add column if not exists front_nine_slope smallint,
  add column if not exists back_nine_slope smallint,
  add column if not exists front_nine_bogey_rating numeric(5,2),
  add column if not exists back_nine_bogey_rating numeric(5,2),
  add column if not exists is_shorter boolean,
  add column if not exists stroke_allocation boolean,
  add column if not exists eligible_sides jsonb not null default '[]'::jsonb,
  add column if not exists last_synced_at timestamptz,
  add column if not exists source_updated_at timestamptz;

alter table public.golf_holes
  add column if not exists origin text,
  add column if not exists active boolean not null default true,
  add column if not exists provider_status text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists source_updated_at timestamptz;

update public.golf_clubs
set origin = case when provider = 'GHIN' then 'GHIN' else 'BACKYARD_ADMIN' end
where origin is null;
update public.golf_courses
set origin = case
  when provider = 'GHIN' or nullif(catalog_metadata->>'ghin_course_id', '') is not null then 'GHIN'
  when provider = 'USER_MANUAL' then 'BACKYARD_ADMIN'
  else 'BACKYARD_ADMIN'
end,
layout_type = coalesce(layout_type, 'STANDARD')
where origin is null or layout_type is null;
update public.golf_course_tees
set origin = case when provider = 'GHIN' then 'GHIN' else 'BACKYARD_ADMIN' end
where origin is null;
update public.golf_holes
set origin = case when provider = 'GHIN' then 'GHIN' else 'BACKYARD_ADMIN' end
where origin is null;

alter table public.golf_clubs
  alter column origin set default 'BACKYARD_ADMIN',
  alter column origin set not null,
  add constraint golf_clubs_origin_check check (origin in ('GHIN','BACKYARD_PROVISIONAL','BACKYARD_ADMIN'));
alter table public.golf_courses
  alter column origin set default 'BACKYARD_ADMIN',
  alter column origin set not null,
  alter column layout_type set default 'STANDARD',
  alter column layout_type set not null,
  add constraint golf_courses_origin_check check (origin in ('GHIN','BACKYARD_PROVISIONAL','BACKYARD_ADMIN')),
  add constraint golf_courses_layout_type_check check (layout_type in ('STANDARD','TEMPORARY','CUSTOM')),
  add constraint golf_courses_total_par_check check (total_par is null or total_par between 20 and 90),
  add constraint golf_courses_provisional_origin_check check (not is_provisional or origin = 'BACKYARD_PROVISIONAL');
alter table public.golf_course_tees
  alter column origin set default 'BACKYARD_ADMIN',
  alter column origin set not null,
  add constraint golf_course_tees_origin_check check (origin in ('GHIN','BACKYARD_PROVISIONAL','BACKYARD_ADMIN')),
  add constraint golf_course_tees_eligible_sides_check check (jsonb_typeof(eligible_sides) = 'array'),
  add constraint golf_course_tees_bogey_rating_check check (bogey_rating is null or bogey_rating between 20 and 120),
  add constraint golf_course_tees_front_slope_check check (front_nine_slope is null or front_nine_slope between 55 and 155),
  add constraint golf_course_tees_back_slope_check check (back_nine_slope is null or back_nine_slope between 55 and 155);
alter table public.golf_holes
  alter column origin set default 'BACKYARD_ADMIN',
  alter column origin set not null,
  add constraint golf_holes_origin_check check (origin in ('GHIN','BACKYARD_PROVISIONAL','BACKYARD_ADMIN'));

create table public.golf_provider_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = upper(trim(provider))),
  external_facility_id text,
  external_course_id text,
  course_id text references public.golf_courses(id) on delete set null,
  mode text not null check (mode in ('DRY_RUN','APPLY')),
  status text not null check (status in ('SUCCESS','PARTIAL','FAILED','BLOCKED','NO_CHANGE')),
  normalized_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(normalized_summary) = 'object'),
  diff_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(diff_summary) = 'object'),
  error_code text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index golf_provider_sync_runs_course_created_idx on public.golf_provider_sync_runs(course_id, created_at desc);
create index golf_provider_sync_runs_external_idx on public.golf_provider_sync_runs(provider, external_course_id, created_at desc);
alter table public.golf_provider_sync_runs enable row level security;
revoke all on public.golf_provider_sync_runs from public, anon, authenticated;
grant all on public.golf_provider_sync_runs to service_role;

create table public.ghin_score_post_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  round_id uuid not null references public.rounds_cloud(id) on delete restrict,
  golfer_id text not null check (length(trim(golfer_id)) between 1 and 240),
  course_id text not null check (length(trim(course_id)) between 1 and 240),
  tee_set_id text not null check (length(trim(tee_set_id)) between 1 and 240),
  played_at date not null,
  gross_score integer not null check (gross_score between 9 and 250),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('PREPARED','POSTING','SUCCEEDED','FAILED')),
  provider_http_status integer check (provider_http_status is null or provider_http_status between 100 and 599),
  provider_score_id text check (provider_score_id is null or length(trim(provider_score_id)) between 1 and 240),
  posted_at timestamptz,
  last_error_code text check (last_error_code is null or length(trim(last_error_code)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, fingerprint),
  unique (round_id, golfer_id)
);
create index ghin_score_post_receipts_owner_created_idx on public.ghin_score_post_receipts(owner_id, created_at desc);
alter table public.ghin_score_post_receipts enable row level security;
revoke all on public.ghin_score_post_receipts from public, anon, authenticated;
grant select on public.ghin_score_post_receipts to authenticated;
grant all on public.ghin_score_post_receipts to service_role;
create policy ghin_score_post_receipts_owner_read
on public.ghin_score_post_receipts for select to authenticated
using (
  owner_id = (select auth.uid())
  and coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) = false
  and private.account_subject_active(owner_id)
);

create function public.claim_ghin_score_post_v1(
  p_owner_id uuid,
  p_round_id uuid,
  p_golfer_id text,
  p_course_id text,
  p_tee_set_id text,
  p_played_at date,
  p_gross_score integer,
  p_fingerprint text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare existing public.ghin_score_post_receipts;
begin
  if current_user not in ('service_role','postgres') then raise exception 'GHIN_POST_NOT_AUTHORIZED'; end if;
  if not exists (
    select 1 from public.rounds_cloud round_record
    where round_record.id=p_round_id and round_record.owner_id=p_owner_id
  ) then raise exception 'GHIN_ROUND_OWNER_MISMATCH'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_fingerprint,0));
  select * into existing
  from public.ghin_score_post_receipts
  where owner_id=p_owner_id and fingerprint=p_fingerprint
  for update;
  if found then
    return jsonb_build_object(
      'acquired',false,'id',existing.id,'status',existing.status,
      'provider_score_id',existing.provider_score_id
    );
  end if;
  if exists (
    select 1 from public.ghin_score_post_receipts
    where round_id=p_round_id and golfer_id=p_golfer_id
  ) then raise exception 'GHIN_ROUND_ALREADY_CLAIMED'; end if;
  insert into public.ghin_score_post_receipts(
    owner_id,round_id,golfer_id,course_id,tee_set_id,played_at,gross_score,fingerprint,status
  ) values (
    p_owner_id,p_round_id,p_golfer_id,p_course_id,p_tee_set_id,p_played_at,p_gross_score,p_fingerprint,'POSTING'
  ) returning * into existing;
  return jsonb_build_object('acquired',true,'id',existing.id,'status',existing.status);
end;
$$;
revoke all on function public.claim_ghin_score_post_v1(uuid,uuid,text,text,text,date,integer,text) from public,anon,authenticated;
grant execute on function public.claim_ghin_score_post_v1(uuid,uuid,text,text,text,date,integer,text) to service_role;

create function public.finish_ghin_score_post_v1(
  p_receipt_id uuid,
  p_succeeded boolean,
  p_http_status integer,
  p_provider_score_id text default null,
  p_error_code text default null
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role','postgres') then raise exception 'GHIN_POST_NOT_AUTHORIZED'; end if;
  update public.ghin_score_post_receipts
  set status=case when p_succeeded then 'SUCCEEDED' else 'FAILED' end,
      provider_http_status=p_http_status,
      provider_score_id=case when p_succeeded then p_provider_score_id else provider_score_id end,
      posted_at=case when p_succeeded then now() else posted_at end,
      last_error_code=case when p_succeeded then null else coalesce(p_error_code,'GHIN_SCORE_POST_FAILED') end,
      updated_at=now()
  where id=p_receipt_id and status='POSTING';
  if not found then raise exception 'GHIN_POST_RECEIPT_NOT_POSTING'; end if;
end;
$$;
revoke all on function public.finish_ghin_score_post_v1(uuid,boolean,integer,text,text) from public,anon,authenticated;
grant execute on function public.finish_ghin_score_post_v1(uuid,boolean,integer,text,text) to service_role;

comment on table public.golf_provider_sync_runs is
  'Sanitized provider sync evidence only. Raw auth/session payloads and Authorization headers are forbidden.';
comment on table public.ghin_score_post_receipts is
  'Idempotency and confirmation metadata for controlled GHIN score posting. Never stores credentials or bearer tokens.';

-- Preserve the previously configured Par 69 layout identity and aggregate tee
-- values as a distinct provisional Backyard record. The legacy app hole array
-- is deliberately not persisted: it reports hole 6 as Par 3, while the owner
-- confirmed the real hole is Par 4. The complete 18-hole configuration must be
-- verified before this layout can safely drive a round.
insert into public.golf_courses(
  id, club_id, name, holes, provider, source_url, active, visibility, verified_at,
  catalog_metadata, origin, layout_type, is_provisional, provider_status, total_par
) select
  'course-la-vista-temporary-par-69', 'club-la-vista', 'La Vista Temporary — Par 69', 18,
  'BACKYARD_INTERNAL', 'https://dev.thebackyard.com.mx', true, 'PRIVATE', now(),
  jsonb_build_object(
    'search_aliases', jsonb_build_array('La Vista Temporal','La Vista Temporary Par 69'),
    'observed_at', current_date::text,
    'dataVersion', 'backyard-provisional-par69-v1',
    'origin', 'BACKYARD_PROVISIONAL',
    'layout_type', 'TEMPORARY',
    'operational_status', 'MISSING_REAL_HOLE_CONFIGURATION',
    'source_limitation', 'Legacy hole 6 conflicts with the confirmed real Par 4; a verified complete 18-hole configuration is required.'
  ),
  'BACKYARD_PROVISIONAL', 'TEMPORARY', true, 'MISSING_REAL_HOLE_CONFIGURATION', 69
where exists (select 1 from public.golf_clubs where id='club-la-vista')
on conflict (id) do update set
  name=excluded.name, origin=excluded.origin, layout_type=excluded.layout_type,
  is_provisional=excluded.is_provisional, provider_status=excluded.provider_status,
  total_par=excluded.total_par, catalog_metadata=excluded.catalog_metadata, updated_at=now();

with tee_values(id, name, rating, slope) as (
  values
    ('tee-la-vista-temporary-par-69-blue','Blue',70.2::numeric,126),
    ('tee-la-vista-temporary-par-69-white','White',67.5::numeric,119),
    ('tee-la-vista-temporary-par-69-gold','Gold',65.2::numeric,113),
    ('tee-la-vista-temporary-par-69-red','Red',67.9::numeric,127)
)
insert into public.golf_course_tees(
  id, course_id, name, rating, slope, par, provider, source_url, verified_at,
  active, catalog_metadata, origin, display_name, provider_status
)
select id, 'course-la-vista-temporary-par-69', name, rating, slope, 69,
  'BACKYARD_INTERNAL', 'https://dev.thebackyard.com.mx', now(), true,
  jsonb_build_object(
    'id', id, 'name', name, 'course_rating', rating, 'slope_rating', slope,
    'yards', null, 'par', 69, 'rating_category', null,
    'qa_status', 'MISSING_REAL_HOLE_CONFIGURATION',
    'source_limitation', 'Legacy hole 6 conflicts with the confirmed real Par 4; a verified complete 18-hole configuration is required.',
    'holes', '[]'::jsonb,
    'nineRatings', '[]'::jsonb,
    'qa', jsonb_build_object(
      'status','MISSING_REAL_HOLE_CONFIGURATION',
      'errors',jsonb_build_array('Legacy hole 6 is Par 3 but the confirmed real hole is Par 4; complete Par 69 hole data is unresolved')
    )
  ),
  'BACKYARD_PROVISIONAL', name, 'MISSING_REAL_HOLE_CONFIGURATION'
from tee_values
where exists (select 1 from public.golf_courses where id='course-la-vista-temporary-par-69')
on conflict (id) do update set
  name=excluded.name, rating=excluded.rating, slope=excluded.slope, par=excluded.par,
  catalog_metadata=excluded.catalog_metadata, origin=excluded.origin,
  display_name=excluded.display_name, provider_status=excluded.provider_status,
  active=true, updated_at=now();

-- Store the owner-provided Par 70 aggregate tee data without inventing holes.
insert into public.golf_courses(
  id, club_id, name, holes, provider, source_url, active, visibility, verified_at,
  catalog_metadata, origin, layout_type, is_provisional, provider_status, total_par
) select
  'course-la-vista-temporary-par-70', 'club-la-vista', 'La Vista Temporary — Par 70', 18,
  'BACKYARD_INTERNAL', 'https://dev.thebackyard.com.mx', true, 'PRIVATE', now(),
  jsonb_build_object(
    'search_aliases', jsonb_build_array('La Vista Temporal Par 70','La Vista Temporary Par 70'),
    'observed_at', current_date::text,
    'dataVersion', 'backyard-provisional-par70-v1',
    'origin', 'BACKYARD_PROVISIONAL',
    'layout_type', 'TEMPORARY',
    'operational_status', 'MISSING_HOLE_DATA',
    'source_limitation', 'Par, rating, slope and total yardage are known; hole definitions and allocations are not yet verified.'
  ),
  'BACKYARD_PROVISIONAL', 'TEMPORARY', true, 'MISSING_HOLE_DATA', 70
where exists (select 1 from public.golf_clubs where id='club-la-vista')
on conflict (id) do update set
  name=excluded.name, origin=excluded.origin, layout_type=excluded.layout_type,
  is_provisional=excluded.is_provisional, provider_status=excluded.provider_status,
  total_par=excluded.total_par, catalog_metadata=excluded.catalog_metadata, updated_at=now();

with tee_values(id, name, display_name, rating, slope, yards) as (
  values
    ('tee-la-vista-temporary-par-70-blue','Blue','Blue',71.2::numeric,128,6790),
    ('tee-la-vista-temporary-par-70-white','White','White',68.4::numeric,121,6191),
    ('tee-la-vista-temporary-par-70-gold','Gold','Gold',66.0::numeric,115,5656),
    ('tee-la-vista-temporary-par-70-red','Red','Red / Ladies',68.6::numeric,128,5156)
)
insert into public.golf_course_tees(
  id, course_id, name, display_name, rating, slope, par, total_yards, provider,
  source_url, verified_at, active, catalog_metadata, origin, provider_status
)
select id, 'course-la-vista-temporary-par-70', name, display_name, rating, slope, 70, yards,
  'BACKYARD_INTERNAL', 'https://dev.thebackyard.com.mx', now(), true,
  jsonb_build_object(
    'id', id, 'name', name, 'displayName', display_name,
    'course_rating', rating, 'slope_rating', slope, 'yards', yards, 'par', 70,
    'rating_category', null, 'qa_status', 'MISSING_HOLE_DATA',
    'source_limitation', 'Hole definitions and allocations are not yet verified.',
    'holes', '[]'::jsonb, 'nineRatings', '[]'::jsonb,
    'qa', jsonb_build_object('status','MISSING_HOLE_DATA','errors',jsonb_build_array('Missing verified hole definitions and stroke allocations'))
  ),
  'BACKYARD_PROVISIONAL', 'MISSING_HOLE_DATA'
from tee_values
where exists (select 1 from public.golf_courses where id='course-la-vista-temporary-par-70')
on conflict (id) do update set
  name=excluded.name, display_name=excluded.display_name, rating=excluded.rating,
  slope=excluded.slope, par=excluded.par, total_yards=excluded.total_yards,
  catalog_metadata=excluded.catalog_metadata, origin=excluded.origin,
  provider_status=excluded.provider_status, active=true, updated_at=now();

-- Extend the QA-only authenticated projection to the two provisional layouts
-- and future normalized GHIN rows. Direct table grants remain unchanged.
create or replace function public.read_owner_course_catalog_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'clubs', coalesce((
      select jsonb_agg(to_jsonb(club_row) order by club_row.id)
      from (
        select id, name, city, state_region, latitude, longitude, catalog_metadata
        from public.golf_clubs club
        where active = true and exists (
          select 1 from public.golf_courses course
          where course.club_id=club.id and course.active=true
            and (course.provider='OWNER_CATALOG_REVIEW' or course.origin in ('GHIN','BACKYARD_PROVISIONAL'))
        )
      ) club_row
    ), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(to_jsonb(course_row) order by course_row.id)
      from (
        select id, club_id, name, holes, source_url, verified_at, catalog_metadata
        from public.golf_courses
        where active=true and (provider='OWNER_CATALOG_REVIEW' or origin in ('GHIN','BACKYARD_PROVISIONAL'))
      ) course_row
    ), '[]'::jsonb),
    'tees', coalesce((
      select jsonb_agg(to_jsonb(tee_row) order by tee_row.id)
      from (
        select tee.id, tee.course_id, tee.catalog_metadata
        from public.golf_course_tees tee
        join public.golf_courses course on course.id=tee.course_id
        where tee.active=true and course.active=true
          and (course.provider='OWNER_CATALOG_REVIEW' or course.origin in ('GHIN','BACKYARD_PROVISIONAL'))
      ) tee_row
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.read_owner_course_catalog_v1() from public, anon;
grant execute on function public.read_owner_course_catalog_v1() to authenticated, service_role;

commit;

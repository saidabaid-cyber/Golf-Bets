-- Provider-agnostic scorecard/playing profiles for one physical course layout.
-- A profile may change ratings and stroke allocation without cloning the
-- facility, physical layout, tees, or holes. Physical repairs that change par,
-- routing, or yardage remain separate golf_courses/course_configurations.
begin;

create table public.course_scorecard_profiles (
  id text primary key default gen_random_uuid()::text check (length(trim(id)) between 3 and 320),
  course_id text not null references public.golf_courses(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 200),
  provenance text not null check (provenance in (
    'GHIN_OFFICIAL','USGA_OFFICIAL','CLUB_SCORECARD_VERIFIED','CLUB_OPERATIONAL',
    'CLUB_TEMPORARY','TOURNAMENT','ADMIN_VERIFIED','PROVIDER_REVIEWED','PROVIDER_VERIFIED'
  )),
  source_provider text not null check (length(trim(source_provider)) between 1 and 100),
  source_external_id text,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  verified_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  active boolean not null default true,
  historical boolean not null default false,
  default_for_play boolean not null default false,
  status text not null default 'DRAFT' check (status in ('DRAFT','VERIFIED','PUBLISHED','SUPERSEDED','ARCHIVED')),
  notes text check (notes is null or length(notes) <= 4000),
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_scorecard_profiles_effective_check check (effective_to is null or effective_from is null or effective_to > effective_from),
  constraint course_scorecard_profiles_history_check check (not historical or not default_for_play),
  constraint course_scorecard_profiles_publish_evidence_check check (status <> 'PUBLISHED' or verified_at is not null)
);

create unique index course_scorecard_profiles_provider_identity_idx
  on public.course_scorecard_profiles (course_id, source_provider, source_external_id)
  where source_external_id is not null;
create unique index course_scorecard_profiles_current_default_idx
  on public.course_scorecard_profiles (course_id)
  where default_for_play and active and not historical and status = 'PUBLISHED';
create index course_scorecard_profiles_course_effective_idx
  on public.course_scorecard_profiles (course_id, active, historical, status, effective_from, effective_to);

create table public.course_scorecard_profile_tees (
  profile_id text not null references public.course_scorecard_profiles(id) on delete restrict,
  tee_id text not null references public.golf_course_tees(id) on delete restrict,
  rating_gender text not null default 'UNSPECIFIED' check (rating_gender in ('MEN','WOMEN','UNISEX','OTHER','UNSPECIFIED')),
  par smallint check (par is null or par between 27 and 90),
  course_rating numeric(5,2) check (course_rating is null or course_rating between 20 and 100),
  bogey_rating numeric(5,2) check (bogey_rating is null or bogey_rating between 20 and 140),
  slope_rating smallint check (slope_rating is null or slope_rating between 55 and 155),
  front_nine_rating numeric(5,2) check (front_nine_rating is null or front_nine_rating between 10 and 60),
  front_nine_slope smallint check (front_nine_slope is null or front_nine_slope between 55 and 155),
  back_nine_rating numeric(5,2) check (back_nine_rating is null or back_nine_rating between 10 and 60),
  back_nine_slope smallint check (back_nine_slope is null or back_nine_slope between 55 and 155),
  total_yards integer check (total_yards is null or total_yards between 100 and 12000),
  total_meters integer check (total_meters is null or total_meters between 100 and 11000),
  source_external_id text,
  provider_status text,
  source_updated_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, tee_id, rating_gender)
);
create index course_scorecard_profile_tees_tee_idx on public.course_scorecard_profile_tees (tee_id, profile_id);

create table public.course_scorecard_profile_holes (
  profile_id text not null references public.course_scorecard_profiles(id) on delete restrict,
  hole_id text not null references public.golf_holes(id) on delete restrict,
  rating_gender text not null default 'UNSPECIFIED' check (rating_gender in ('MEN','WOMEN','UNISEX','OTHER','UNSPECIFIED')),
  hole_number smallint not null check (hole_number between 1 and 36),
  stroke_index smallint not null check (stroke_index between 1 and 36),
  source_external_id text,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, hole_id, rating_gender),
  unique (profile_id, rating_gender, hole_number),
  unique (profile_id, rating_gender, stroke_index)
);
create index course_scorecard_profile_holes_hole_idx on public.course_scorecard_profile_holes (hole_id, profile_id);

create or replace function private.validate_scorecard_profile_member_v1()
returns trigger language plpgsql set search_path = '' as $$
declare
  profile_course_id text;
  member_course_id text;
  physical_par smallint;
  physical_yards integer;
  physical_meters integer;
begin
  select profile.course_id into profile_course_id from public.course_scorecard_profiles profile where profile.id = new.profile_id;
  if tg_table_name = 'course_scorecard_profile_tees' then
    select tee.course_id, tee.par, tee.total_yards, tee.total_meters
      into member_course_id, physical_par, physical_yards, physical_meters
      from public.golf_course_tees tee where tee.id = new.tee_id;
  else
    select hole.course_id into member_course_id from public.golf_holes hole where hole.id = new.hole_id;
  end if;
  if profile_course_id is null or member_course_id is null or profile_course_id <> member_course_id then
    raise exception 'SCORECARD_PROFILE_LAYOUT_MISMATCH' using errcode = '23514';
  end if;
  if tg_table_name = 'course_scorecard_profile_tees' and (
    (new.par is not null and physical_par is not null and new.par <> physical_par)
    or (new.total_yards is not null and physical_yards is not null and abs(new.total_yards - physical_yards) > 1)
    or (new.total_meters is not null and physical_meters is not null and abs(new.total_meters - physical_meters) > 1)
  ) then
    raise exception 'SCORECARD_PROFILE_PHYSICAL_FACT_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger course_scorecard_profile_tees_layout_guard before insert or update on public.course_scorecard_profile_tees
for each row execute function private.validate_scorecard_profile_member_v1();
create trigger course_scorecard_profile_holes_layout_guard before insert or update on public.course_scorecard_profile_holes
for each row execute function private.validate_scorecard_profile_member_v1();
create trigger course_scorecard_profiles_touch before update on public.course_scorecard_profiles
for each row execute function public.touch_golf_architecture_record();
create trigger course_scorecard_profile_tees_touch before update on public.course_scorecard_profile_tees
for each row execute function public.touch_golf_architecture_record();
create trigger course_scorecard_profile_holes_touch before update on public.course_scorecard_profile_holes
for each row execute function public.touch_golf_architecture_record();

-- Preserve every existing playable card as the first profile for its physical
-- layout. This is additive: no facility/layout/tee/hole is deleted or renamed.
insert into public.course_scorecard_profiles (
  id, course_id, name, provenance, source_provider, source_external_id,
  evidence, verified_at, active, historical, default_for_play, status, notes
)
select 'scorecard-' || md5(course.id || ':' || course.provider || ':baseline'), course.id,
  case when course.provider = 'GHIN' then 'GHIN / Oficial'
       when course.is_provisional or course.layout_type = 'TEMPORARY' then 'Temporal / Reparación'
       when course.provider in ('CLUB_OFFICIAL','CLUB_SCORECARD') then 'Tarjeta del club — Actual'
       else 'Tarjeta disponible' end,
  case when course.provider = 'GHIN' then 'GHIN_OFFICIAL'
       when course.provider = 'USGA_NCRDB' then 'USGA_OFFICIAL'
       when course.is_provisional or course.layout_type = 'TEMPORARY' then 'CLUB_TEMPORARY'
       when course.provider in ('CLUB_OFFICIAL','CLUB_SCORECARD') then 'CLUB_SCORECARD_VERIFIED'
       when course.provider = 'BACKYARD_INTERNAL' then 'ADMIN_VERIFIED'
       else 'PROVIDER_REVIEWED' end,
  course.provider,
  case when course.provider = 'GHIN' then coalesce(course.provider_external_id, course.id)
       else coalesce(course.provider_external_id, course.id) || ':baseline' end,
  case when course.source_url is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('url', course.source_url, 'kind', 'SOURCE')) end,
  coalesce(course.verified_at, course.created_at), course.active, not course.active, course.active,
  case when course.active then 'PUBLISHED' else 'ARCHIVED' end,
  'Migrated from the existing Backyard Course Master without changing physical course data.'
from public.golf_courses course on conflict do nothing;

insert into public.course_scorecard_profile_tees (
  profile_id, tee_id, rating_gender, par, course_rating, bogey_rating, slope_rating,
  front_nine_rating, front_nine_slope, back_nine_rating, back_nine_slope,
  total_yards, total_meters, source_external_id, provider_status, source_updated_at, active
)
select profile.id, tee.id,
  case when tee.gender in ('MEN','WOMEN','UNISEX','OTHER') then tee.gender else 'UNSPECIFIED' end,
  tee.par, tee.rating, tee.bogey_rating, tee.slope, tee.front_nine_rating, tee.front_nine_slope,
  tee.back_nine_rating, tee.back_nine_slope, tee.total_yards, tee.total_meters,
  tee.provider_external_id, tee.provider_status, tee.source_updated_at, tee.active
from public.golf_course_tees tee join public.course_scorecard_profiles profile
  on profile.course_id = tee.course_id and profile.source_external_id = (select
    case when course.provider = 'GHIN' then coalesce(course.provider_external_id, course.id)
         else coalesce(course.provider_external_id, course.id) || ':baseline' end
    from public.golf_courses course where course.id = tee.course_id)
on conflict do nothing;

insert into public.course_scorecard_profile_holes (
  profile_id, hole_id, rating_gender, hole_number, stroke_index, source_external_id, source_updated_at
)
select profile.id, hole.id, 'UNSPECIFIED', hole.hole_number, hole.stroke_index, hole.provider_external_id, hole.source_updated_at
from public.golf_holes hole join public.course_scorecard_profiles profile
  on profile.course_id = hole.course_id and profile.source_external_id = (select
    case when course.provider = 'GHIN' then coalesce(course.provider_external_id, course.id)
         else coalesce(course.provider_external_id, course.id) || ':baseline' end
    from public.golf_courses course where course.id = hole.course_id)
on conflict do nothing;

alter table public.round_course_snapshots
  add column if not exists scorecard_profile_id text,
  add column if not exists scorecard_profile_name text,
  add column if not exists scorecard_profile_provenance text,
  add column if not exists scorecard_profile_snapshot jsonb;

alter table public.course_scorecard_profiles enable row level security;
alter table public.course_scorecard_profile_tees enable row level security;
alter table public.course_scorecard_profile_holes enable row level security;
revoke all on public.course_scorecard_profiles, public.course_scorecard_profile_tees, public.course_scorecard_profile_holes from public, anon, authenticated;
grant select, insert, update on public.course_scorecard_profiles, public.course_scorecard_profile_tees, public.course_scorecard_profile_holes to authenticated;
grant all on public.course_scorecard_profiles, public.course_scorecard_profile_tees, public.course_scorecard_profile_holes to service_role;

create policy course_scorecard_profiles_read on public.course_scorecard_profiles for select to authenticated using (
  (active and not historical and status = 'PUBLISHED' and (effective_from is null or effective_from <= now()) and (effective_to is null or effective_to > now())
    and exists (
      select 1 from public.golf_courses course
      left join public.golf_course_data_sources source on source.provider = course.provider
      where course.id = course_scorecard_profiles.course_id and course.active and (
        course_scorecard_profiles.provenance in ('CLUB_SCORECARD_VERIFIED','CLUB_OPERATIONAL','CLUB_TEMPORARY','TOURNAMENT','ADMIN_VERIFIED')
        or (course_scorecard_profiles.provenance = 'GHIN_OFFICIAL' and course.provider = 'GHIN')
        or source.rating_reuse_authorized = true
      )
    ))
  or private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',course_id,'READ')
);
create policy course_scorecard_profiles_admin_insert on public.course_scorecard_profiles for insert to authenticated with check (
  created_by = (select auth.uid()) and private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',course_id,'CREATE_DRAFT')
);
create policy course_scorecard_profiles_admin_update on public.course_scorecard_profiles for update to authenticated
using (private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',course_id,'READ'))
with check (private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',course_id,'CREATE_DRAFT'));
create policy course_scorecard_profile_tees_read on public.course_scorecard_profile_tees for select to authenticated using (
  exists (select 1 from public.course_scorecard_profiles profile where profile.id = profile_id)
);
create policy course_scorecard_profile_tees_admin_insert on public.course_scorecard_profile_tees for insert to authenticated with check (
  exists (select 1 from public.course_scorecard_profiles profile where profile.id = profile_id and private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',profile.course_id,'CREATE_DRAFT'))
);
create policy course_scorecard_profile_tees_admin_update on public.course_scorecard_profile_tees for update to authenticated
using (exists (select 1 from public.course_scorecard_profiles profile where profile.id = profile_id and private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',profile.course_id,'READ')))
with check (exists (select 1 from public.course_scorecard_profiles profile where profile.id = profile_id and private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',profile.course_id,'CREATE_DRAFT')));
create policy course_scorecard_profile_holes_read on public.course_scorecard_profile_holes for select to authenticated using (
  exists (select 1 from public.course_scorecard_profiles profile where profile.id = profile_id)
);
create policy course_scorecard_profile_holes_admin_insert on public.course_scorecard_profile_holes for insert to authenticated with check (
  exists (select 1 from public.course_scorecard_profiles profile where profile.id = profile_id and private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',profile.course_id,'CREATE_DRAFT'))
);
create policy course_scorecard_profile_holes_admin_update on public.course_scorecard_profile_holes for update to authenticated
using (exists (select 1 from public.course_scorecard_profiles profile where profile.id = profile_id and private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',profile.course_id,'READ')))
with check (exists (select 1 from public.course_scorecard_profiles profile where profile.id = profile_id and private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',profile.course_id,'CREATE_DRAFT')));

create or replace function public.admin_create_scorecard_profile_v1(profile_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  target_course_id text := nullif(trim(profile_payload->>'courseId'), '');
  new_profile_id text := coalesce(nullif(trim(profile_payload->>'id'), ''), 'scorecard-admin-' || gen_random_uuid()::text);
  provenance_value text := nullif(trim(profile_payload->>'provenance'), '');
  evidence_value jsonb := coalesce(profile_payload->'evidence', '[]'::jsonb);
  tee_row jsonb;
  hole_row jsonb;
begin
  if actor is null or target_course_id is null or not private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',target_course_id,'CREATE_DRAFT') then
    raise exception 'ADMIN_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.golf_courses where id = target_course_id) then
    raise exception 'COURSE_NOT_FOUND' using errcode = '23503';
  end if;
  if jsonb_typeof(evidence_value) <> 'array'
    or jsonb_typeof(coalesce(profile_payload->'tees', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(profile_payload->'holes', '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_SCORECARD_PROFILE_PAYLOAD' using errcode = '22023';
  end if;

  insert into public.course_scorecard_profiles (
    id, course_id, name, provenance, source_provider, source_external_id,
    evidence, verified_at, effective_from, effective_to, active, historical,
    default_for_play, status, notes, created_by
  ) values (
    new_profile_id, target_course_id, nullif(trim(profile_payload->>'name'), ''), provenance_value,
    nullif(trim(profile_payload->>'sourceProvider'), ''), nullif(trim(profile_payload->>'sourceExternalId'), ''),
    evidence_value, nullif(profile_payload->>'verifiedAt', '')::timestamptz,
    nullif(profile_payload->>'effectiveFrom', '')::timestamptz,
    nullif(profile_payload->>'effectiveTo', '')::timestamptz,
    true, false, false, 'DRAFT', nullif(trim(profile_payload->>'notes'), ''), actor
  );

  for tee_row in select value from jsonb_array_elements(coalesce(profile_payload->'tees', '[]'::jsonb)) loop
    insert into public.course_scorecard_profile_tees (
      profile_id, tee_id, rating_gender, par, course_rating, bogey_rating, slope_rating,
      front_nine_rating, front_nine_slope, back_nine_rating, back_nine_slope,
      total_yards, total_meters, source_external_id, provider_status, source_updated_at, active
    ) values (
      new_profile_id, trim(tee_row->>'teeId'), coalesce(nullif(upper(trim(tee_row->>'ratingGender')), ''), 'UNSPECIFIED'),
      nullif(tee_row->>'par', '')::smallint, nullif(tee_row->>'courseRating', '')::numeric,
      nullif(tee_row->>'bogeyRating', '')::numeric, nullif(tee_row->>'slopeRating', '')::smallint,
      nullif(tee_row->>'frontNineRating', '')::numeric, nullif(tee_row->>'frontNineSlope', '')::smallint,
      nullif(tee_row->>'backNineRating', '')::numeric, nullif(tee_row->>'backNineSlope', '')::smallint,
      nullif(tee_row->>'totalYards', '')::integer, nullif(tee_row->>'totalMeters', '')::integer,
      nullif(trim(tee_row->>'sourceExternalId'), ''), nullif(trim(tee_row->>'providerStatus'), ''),
      nullif(tee_row->>'sourceUpdatedAt', '')::timestamptz, coalesce((tee_row->>'active')::boolean, true)
    );
  end loop;

  for hole_row in select value from jsonb_array_elements(coalesce(profile_payload->'holes', '[]'::jsonb)) loop
    insert into public.course_scorecard_profile_holes (
      profile_id, hole_id, rating_gender, hole_number, stroke_index, source_external_id, source_updated_at
    ) values (
      new_profile_id, trim(hole_row->>'holeId'), coalesce(nullif(upper(trim(hole_row->>'ratingGender')), ''), 'UNSPECIFIED'),
      (hole_row->>'holeNumber')::smallint, (hole_row->>'strokeIndex')::smallint,
      nullif(trim(hole_row->>'sourceExternalId'), ''), nullif(hole_row->>'sourceUpdatedAt', '')::timestamptz
    );
  end loop;

  perform private.admin_audit_v1('CREATE_SCORECARD_PROFILE_DRAFT','COURSE_CONFIGURATION',new_profile_id,null,
    jsonb_build_object('courseId',target_course_id,'status','DRAFT','provenance',provenance_value),
    nullif(trim(profile_payload->>'reason'), ''),null,'COURSE',target_course_id);
  return jsonb_build_object('id', new_profile_id, 'courseId', target_course_id, 'status', 'DRAFT');
end;
$$;
revoke all on function public.admin_create_scorecard_profile_v1(jsonb) from public, anon;
grant execute on function public.admin_create_scorecard_profile_v1(jsonb) to authenticated, service_role;

create or replace function public.admin_transition_scorecard_profile_v1(
  target_profile_id text, target_action text, make_default boolean default false, transition_reason text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  candidate public.course_scorecard_profiles%rowtype;
  before_state jsonb;
  expected_holes integer;
  profile_holes integer;
  profile_tees integer;
begin
  select * into candidate from public.course_scorecard_profiles where id = target_profile_id for update;
  if candidate.id is null then raise exception 'SCORECARD_PROFILE_NOT_FOUND' using errcode = 'P0002'; end if;
  if (select auth.uid()) is null or not private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',candidate.course_id,
    case when upper(target_action) = 'PUBLISH' then 'PUBLISH' else 'CREATE_DRAFT' end) then
    raise exception 'ADMIN_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  before_state := jsonb_build_object('status',candidate.status,'active',candidate.active,'historical',candidate.historical,'defaultForPlay',candidate.default_for_play);

  if upper(target_action) = 'VERIFY' then
    if candidate.status <> 'DRAFT' or candidate.evidence = '[]'::jsonb then
      raise exception 'SCORECARD_PROFILE_EVIDENCE_REQUIRED' using errcode = '23514';
    end if;
    update public.course_scorecard_profiles set status = 'VERIFIED', verified_at = coalesce(verified_at, now()) where id = candidate.id;
  elsif upper(target_action) = 'PUBLISH' then
    if candidate.status <> 'VERIFIED' or candidate.verified_at is null or candidate.evidence = '[]'::jsonb then
      raise exception 'SCORECARD_PROFILE_VERIFICATION_REQUIRED' using errcode = '23514';
    end if;
    select holes into expected_holes from public.golf_courses where id = candidate.course_id;
    select count(*) into profile_tees from public.course_scorecard_profile_tees where profile_id = candidate.id and active;
    select count(distinct hole_id) into profile_holes from public.course_scorecard_profile_holes where profile_id = candidate.id;
    if profile_tees < 1 or profile_holes <> expected_holes then
      raise exception 'SCORECARD_PROFILE_INCOMPLETE' using errcode = '23514';
    end if;
    if make_default then
      update public.course_scorecard_profiles set default_for_play = false
      where course_id = candidate.course_id and id <> candidate.id and default_for_play;
    end if;
    update public.course_scorecard_profiles set status = 'PUBLISHED', active = true, historical = false,
      default_for_play = make_default where id = candidate.id;
  elsif upper(target_action) = 'ARCHIVE' then
    update public.course_scorecard_profiles set status = 'ARCHIVED', active = false, historical = true,
      default_for_play = false, effective_to = coalesce(effective_to, now()) where id = candidate.id;
  else
    raise exception 'INVALID_SCORECARD_PROFILE_TRANSITION' using errcode = '22023';
  end if;

  perform private.admin_audit_v1('SCORECARD_PROFILE_' || upper(target_action),'COURSE_CONFIGURATION',candidate.id,before_state,
    (select jsonb_build_object('status',status,'active',active,'historical',historical,'defaultForPlay',default_for_play)
      from public.course_scorecard_profiles where id = candidate.id),
    transition_reason,null,'COURSE',candidate.course_id);
  return (select jsonb_build_object('id',id,'courseId',course_id,'status',status,'active',active,'historical',historical,'defaultForPlay',default_for_play)
    from public.course_scorecard_profiles where id = candidate.id);
end;
$$;
revoke all on function public.admin_transition_scorecard_profile_v1(text,text,boolean,text) from public, anon;
grant execute on function public.admin_transition_scorecard_profile_v1(text,text,boolean,text) to authenticated, service_role;

create or replace function public.read_backyard_scorecard_profiles_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.account_subject_active(auth.uid()) then raise exception 'authentication required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'profiles', coalesce((select jsonb_agg(jsonb_build_object(
        'id', profile.id, 'course_id', profile.course_id, 'name', profile.name,
        'provenance', profile.provenance, 'source_provider', profile.source_provider,
        'source_external_id', profile.source_external_id, 'verified_at', profile.verified_at,
        'effective_from', profile.effective_from, 'effective_to', profile.effective_to,
        'active', profile.active, 'historical', profile.historical,
        'default_for_play', profile.default_for_play, 'status', profile.status
      ) order by profile.course_id, profile.default_for_play desc, profile.name, profile.id)
      from public.course_scorecard_profiles profile join public.golf_courses course on course.id = profile.course_id
      left join public.golf_course_data_sources source on source.provider = course.provider
      where course.active and profile.active and not profile.historical and profile.status = 'PUBLISHED'
        and (profile.effective_from is null or profile.effective_from <= now()) and (profile.effective_to is null or profile.effective_to > now())
        and (profile.provenance in ('CLUB_SCORECARD_VERIFIED','CLUB_OPERATIONAL','CLUB_TEMPORARY','TOURNAMENT','ADMIN_VERIFIED')
          or (profile.provenance = 'GHIN_OFFICIAL' and course.provider = 'GHIN')
          or source.rating_reuse_authorized = true)), '[]'::jsonb),
    'tees', coalesce((select jsonb_agg(jsonb_build_object(
        'profile_id', profile_tee.profile_id, 'tee_id', profile_tee.tee_id,
        'rating_gender', profile_tee.rating_gender, 'par', profile_tee.par,
        'course_rating', profile_tee.course_rating, 'bogey_rating', profile_tee.bogey_rating,
        'slope_rating', profile_tee.slope_rating, 'front_nine_rating', profile_tee.front_nine_rating,
        'front_nine_slope', profile_tee.front_nine_slope, 'back_nine_rating', profile_tee.back_nine_rating,
        'back_nine_slope', profile_tee.back_nine_slope, 'total_yards', profile_tee.total_yards,
        'total_meters', profile_tee.total_meters, 'source_external_id', profile_tee.source_external_id,
        'provider_status', profile_tee.provider_status, 'active', profile_tee.active
      ) order by profile_tee.profile_id, profile_tee.tee_id, profile_tee.rating_gender)
      from public.course_scorecard_profile_tees profile_tee join public.course_scorecard_profiles profile on profile.id = profile_tee.profile_id
      join public.golf_courses course on course.id = profile.course_id
      left join public.golf_course_data_sources source on source.provider = course.provider
      where profile.active and not profile.historical and profile.status = 'PUBLISHED' and profile_tee.active
        and course.active and (profile.effective_from is null or profile.effective_from <= now()) and (profile.effective_to is null or profile.effective_to > now())
        and (profile.provenance in ('CLUB_SCORECARD_VERIFIED','CLUB_OPERATIONAL','CLUB_TEMPORARY','TOURNAMENT','ADMIN_VERIFIED')
          or (profile.provenance = 'GHIN_OFFICIAL' and course.provider = 'GHIN')
          or source.rating_reuse_authorized = true)), '[]'::jsonb),
    'holes', coalesce((select jsonb_agg(jsonb_build_object(
        'profile_id', profile_hole.profile_id, 'hole_id', profile_hole.hole_id,
        'rating_gender', profile_hole.rating_gender, 'hole_number', profile_hole.hole_number,
        'stroke_index', profile_hole.stroke_index
      ) order by profile_hole.profile_id, profile_hole.rating_gender, profile_hole.hole_number)
      from public.course_scorecard_profile_holes profile_hole join public.course_scorecard_profiles profile on profile.id = profile_hole.profile_id
      join public.golf_courses course on course.id = profile.course_id
      left join public.golf_course_data_sources source on source.provider = course.provider
      where profile.active and not profile.historical and profile.status = 'PUBLISHED'
        and course.active and (profile.effective_from is null or profile.effective_from <= now()) and (profile.effective_to is null or profile.effective_to > now())
        and (profile.provenance in ('CLUB_SCORECARD_VERIFIED','CLUB_OPERATIONAL','CLUB_TEMPORARY','TOURNAMENT','ADMIN_VERIFIED')
          or (profile.provenance = 'GHIN_OFFICIAL' and course.provider = 'GHIN')
          or source.rating_reuse_authorized = true)), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.read_backyard_scorecard_profiles_v1() from public, anon;
grant execute on function public.read_backyard_scorecard_profiles_v1() to authenticated, service_role;

comment on table public.course_scorecard_profiles is 'Versioned playing/scorecard profiles for one physical course layout; official, club, tournament and historical identities coexist.';
comment on table public.course_scorecard_profile_holes is 'Stroke allocation belongs to a scorecard profile and rating gender, never universally to a physical hole.';
comment on function public.read_backyard_scorecard_profiles_v1() is 'Player-safe active scorecard profiles; historical/admin-only evidence remains protected by RLS.';
commit;

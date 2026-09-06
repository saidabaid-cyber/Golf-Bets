-- The Backyard golf profile, equipment-distance and course architecture.
-- Additive only: this migration does not rewrite rounds, scores, bets, history,
-- authentication or the existing local-first synchronization authority.

begin;

create extension if not exists pg_trgm with schema extensions;

-- "Mi juego" extends the one existing account profile. default_handicap stays
-- the only profile handicap/index source; no parallel player identity is made.
alter table public.profiles
  add column if not exists given_name text
    check (given_name is null or length(trim(given_name)) between 1 and 120),
  add column if not exists family_name text
    check (family_name is null or length(trim(family_name)) between 1 and 120),
  add column if not exists username text
    check (username is null or (username = trim(username) and length(username) between 1 and 40)),
  add column if not exists city text
    check (city is null or length(trim(city)) between 1 and 160),
  add column if not exists state text
    check (state is null or length(trim(state)) between 1 and 160),
  add column if not exists country text
    check (country is null or length(trim(country)) between 2 and 120),
  add column if not exists home_club text
    check (home_club is null or length(trim(home_club)) between 1 and 200),
  add column if not exists preferred_tee text
    check (preferred_tee is null or length(trim(preferred_tee)) between 1 and 120),
  add column if not exists handedness text
    check (handedness is null or handedness in ('right', 'left', 'ambidextrous')),
  add column if not exists bio text
    check (bio is null or length(bio) <= 2000),
  add column if not exists profile_visibility text not null default 'private'
    check (profile_visibility in ('private', 'friends')),
  add column if not exists typical_score smallint
    check (typical_score is null or typical_score between 40 and 200),
  add column if not exists driver_distance_yards numeric(6,1)
    check (driver_distance_yards is null or driver_distance_yards between 50 and 500),
  add column if not exists driver_swing_speed_band text
    check (driver_swing_speed_band is null or driver_swing_speed_band in ('UNDER_85', 'FROM_85_TO_95', 'FROM_95_TO_105', 'OVER_105')),
  add column if not exists usual_trajectory text
    check (usual_trajectory is null or usual_trajectory in ('LOW', 'MID', 'HIGH')),
  add column if not exists shot_tendency text
    check (shot_tendency is null or shot_tendency in ('DRAW', 'FADE', 'HOOK', 'SLICE', 'STRAIGHT', 'VARIABLE')),
  add column if not exists green_speed text
    check (green_speed is null or green_speed in ('SLOW', 'MID', 'FAST', 'VARIABLE')),
  add column if not exists game_priority text
    check (game_priority is null or game_priority in ('DISTANCE', 'CONTROL', 'ACCURACY', 'FEEL', 'SHORT_GAME')),
  add column if not exists price_importance text
    check (price_importance is null or price_importance in ('LOW', 'MID', 'HIGH')),
  add column if not exists golf_profile_updated_at timestamptz;

create unique index profiles_username_unique_idx on public.profiles (lower(trim(username)))
  where username is not null;

-- New canonical equipment snapshots use the current v2 domain contract. Rows
-- already stored as v1 remain readable and retain their declared version.
alter table public.player_equipment_profiles
  alter column schema_version set default 2;

-- Equipment and ball history fields extend the normalized projection prepared
-- in the previous migration. The canonical runtime write remains the owner-only
-- player_equipment_profiles snapshot with optimistic concurrency.
alter table public.player_clubs
  add column if not exists custom_shaft_brand text
    check (custom_shaft_brand is null or length(trim(custom_shaft_brand)) between 1 and 120),
  add column if not exists custom_shaft_model text
    check (custom_shaft_model is null or length(trim(custom_shaft_model)) between 1 and 160),
  add column if not exists started_using_at timestamptz,
  add column if not exists stopped_using_at timestamptz;

alter table public.player_clubs
  add constraint player_clubs_usage_dates_check
    check (stopped_using_at is null or started_using_at is null or stopped_using_at >= started_using_at),
  add constraint player_clubs_current_usage_check
    check (not is_current or stopped_using_at is null);

alter table public.player_balls
  add column if not exists started_using_at timestamptz,
  add column if not exists stopped_using_at timestamptz,
  add column if not exists notes text check (notes is null or length(notes) <= 2000);

alter table public.player_balls
  add constraint player_balls_usage_dates_check
    check (stopped_using_at is null or started_using_at is null or stopped_using_at >= started_using_at),
  add constraint player_balls_current_usage_check
    check (not is_current or stopped_using_at is null);

-- Equipment brands are separate from golf venues. Stable text ids make catalog
-- imports deterministic across environments and generations.
create table public.golf_ball_brands (
  id text primary key check (length(trim(id)) between 2 and 120),
  name text not null check (length(trim(name)) between 1 and 120),
  active boolean not null default true,
  official_url text check (official_url is null or official_url ~ '^https://[^[:space:]]+$'),
  source_name text check (source_name is null or length(trim(source_name)) between 1 and 160),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index golf_ball_brands_name_idx on public.golf_ball_brands (lower(name));
create index golf_ball_brands_active_name_idx on public.golf_ball_brands (active, lower(name));

create table public.golf_club_brands (
  id text primary key check (length(trim(id)) between 2 and 120),
  name text not null check (length(trim(name)) between 1 and 120),
  active boolean not null default true,
  official_url text check (official_url is null or official_url ~ '^https://[^[:space:]]+$'),
  source_name text check (source_name is null or length(trim(source_name)) between 1 and 160),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index golf_club_brands_name_idx on public.golf_club_brands (lower(name));
create index golf_club_brands_active_name_idx on public.golf_club_brands (active, lower(name));

-- Keep the existing denormalized brand/year fields readable by released clients
-- while adding canonical brand ids and richer, nullable verified attributes.
alter table public.golf_ball_catalog
  add column if not exists brand_id text references public.golf_ball_brands(id) on delete restrict,
  add column if not exists year_from smallint
    check (year_from is null or year_from between 1900 and 2200),
  add column if not exists year_to smallint
    check (year_to is null or year_to between 1900 and 2200),
  add column if not exists construction_pieces smallint
    check (construction_pieces is null or construction_pieces between 1 and 10),
  add column if not exists dimple_count smallint
    check (dimple_count is null or dimple_count between 1 and 2000),
  add column if not exists compression_type text
    check (compression_type is null or compression_type in ('MANUFACTURER', 'INDEPENDENT_MEASURED', 'ESTIMATED', 'UNKNOWN')),
  add column if not exists compression_source text
    check (compression_source is null or length(trim(compression_source)) between 1 and 300),
  add column if not exists compression_source_url text
    check (compression_source_url is null or compression_source_url ~ '^https://[^[:space:]]+$'),
  add column if not exists compression_min numeric(6,2)
    check (compression_min is null or compression_min between 1 and 200),
  add column if not exists compression_max numeric(6,2)
    check (compression_max is null or compression_max between 1 and 200),
  add column if not exists compression_average numeric(6,2)
    check (compression_average is null or compression_average between 1 and 200),
  add column if not exists feel_profile text
    check (feel_profile is null or feel_profile in ('VERY_SOFT', 'SOFT', 'MID', 'FIRM', 'VERY_FIRM')),
  add column if not exists recommended_swing_speed_min_mph numeric(5,1)
    check (recommended_swing_speed_min_mph is null or recommended_swing_speed_min_mph between 30 and 180),
  add column if not exists recommended_swing_speed_max_mph numeric(5,1)
    check (recommended_swing_speed_max_mph is null or recommended_swing_speed_max_mph between 30 and 180),
  add column if not exists target_player_description text
    check (target_player_description is null or length(target_player_description) <= 2000),
  add column if not exists usga_conforming boolean,
  add column if not exists search_text text generated always as (
    lower(trim(brand || ' ' || model || ' ' || coalesce(generation, '')))
  ) stored;

alter table public.golf_ball_catalog
  add constraint golf_ball_catalog_year_range_check
    check (year_to is null or year_from is null or year_to >= year_from),
  add constraint golf_ball_catalog_compression_range_check
    check (compression_max is null or compression_min is null or compression_max >= compression_min),
  add constraint golf_ball_catalog_compression_average_check
    check (
      compression_average is null
      or ((compression_min is null or compression_average >= compression_min)
        and (compression_max is null or compression_average <= compression_max))
    ),
  -- Existing rows may predate dedicated compression provenance. NOT VALID
  -- keeps that legacy data intact while enforcing this rule for every new or
  -- updated row until an administrator verifies and validates the backlog.
  add constraint golf_ball_catalog_compression_provenance_check
    check (
      (
        compression is null and compression_min is null
        and compression_max is null and compression_average is null
      )
      or (
        compression_type is not null
        and compression_type in ('MANUFACTURER', 'INDEPENDENT_MEASURED', 'ESTIMATED')
        and compression_source is not null
        and compression_source_url is not null
      )
    ) not valid,
  add constraint golf_ball_catalog_swing_speed_range_check
    check (
      recommended_swing_speed_max_mph is null
      or recommended_swing_speed_min_mph is null
      or recommended_swing_speed_max_mph >= recommended_swing_speed_min_mph
    );

create index golf_ball_catalog_brand_id_idx on public.golf_ball_catalog (brand_id)
  where brand_id is not null;
create index golf_ball_catalog_search_idx on public.golf_ball_catalog
  using gin (search_text extensions.gin_trgm_ops) where active;

alter table public.golf_club_catalog
  add column if not exists brand_id text references public.golf_club_brands(id) on delete restrict,
  add column if not exists year_from smallint
    check (year_from is null or year_from between 1900 and 2200),
  add column if not exists year_to smallint
    check (year_to is null or year_to between 1900 and 2200),
  add column if not exists construction text
    check (construction is null or length(trim(construction)) between 1 and 300),
  add column if not exists search_text text generated always as (
    lower(trim(brand || ' ' || model || ' ' || coalesce(generation, '')))
  ) stored;

alter table public.golf_club_catalog
  add constraint golf_club_catalog_year_range_check
    check (year_to is null or year_from is null or year_to >= year_from);

-- New catalog writes must use a canonical brand. Legacy rows may remain with a
-- null brand_id until an administrator edits/backfills them; editing the brand
-- itself requires linking that row. The trigger also makes the denormalized
-- brand label deterministic for existing clients and search_text.
create or replace function public.canonicalize_golf_catalog_brand()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  canonical_name text;
begin
  if new.brand_id is null then
    if tg_op = 'INSERT' then
      raise exception using
        errcode = '23514',
        message = 'catalog models require a canonical brand_id';
    elsif old.brand_id is not null then
      raise exception using
        errcode = '23514',
        message = 'a canonical catalog brand_id cannot be removed';
    elsif new.brand is distinct from old.brand then
      raise exception using
        errcode = '23514',
        message = 'catalog models require a canonical brand_id';
    end if;
    return new;
  end if;

  if tg_table_name = 'golf_ball_catalog' then
    select brands.name into canonical_name
    from public.golf_ball_brands as brands
    where brands.id = new.brand_id;
  elsif tg_table_name = 'golf_club_catalog' then
    select brands.name into canonical_name
    from public.golf_club_brands as brands
    where brands.id = new.brand_id;
  end if;

  if canonical_name is null then
    raise exception using
      errcode = '23503',
      message = 'catalog brand_id does not reference an existing brand';
  end if;

  new.brand := canonical_name;
  return new;
end;
$$;
revoke all on function public.canonicalize_golf_catalog_brand()
  from public, anon, authenticated;

drop trigger if exists golf_ball_catalog_canonical_brand on public.golf_ball_catalog;
create trigger golf_ball_catalog_canonical_brand
before insert or update on public.golf_ball_catalog
for each row execute function public.canonicalize_golf_catalog_brand();

drop trigger if exists golf_club_catalog_canonical_brand on public.golf_club_catalog;
create trigger golf_club_catalog_canonical_brand
before insert or update on public.golf_club_catalog
for each row execute function public.canonicalize_golf_catalog_brand();

-- Brand names remain denormalized for released clients and generated search
-- columns. A canonical brand rename therefore cascades only that label to its
-- referenced models; the model trigger revalidates the reference on each row.
create or replace function public.cascade_golf_catalog_brand_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.name is not distinct from old.name then
    return new;
  end if;

  if tg_table_name = 'golf_ball_brands' then
    update public.golf_ball_catalog
    set brand = new.name
    where brand_id = new.id and brand is distinct from new.name;
  elsif tg_table_name = 'golf_club_brands' then
    update public.golf_club_catalog
    set brand = new.name
    where brand_id = new.id and brand is distinct from new.name;
  end if;
  return new;
end;
$$;
revoke all on function public.cascade_golf_catalog_brand_name()
  from public, anon, authenticated;

drop trigger if exists golf_ball_brands_cascade_name on public.golf_ball_brands;
create trigger golf_ball_brands_cascade_name
after update of name on public.golf_ball_brands
for each row execute function public.cascade_golf_catalog_brand_name();

drop trigger if exists golf_club_brands_cascade_name on public.golf_club_brands;
create trigger golf_club_brands_cascade_name
after update of name on public.golf_club_brands
for each row execute function public.cascade_golf_catalog_brand_name();

create index golf_club_catalog_brand_id_idx on public.golf_club_catalog (brand_id)
  where brand_id is not null;
create index golf_club_catalog_search_idx on public.golf_club_catalog
  using gin (search_text extensions.gin_trgm_ops) where active;

alter table public.golf_shaft_catalog
  add column if not exists torque_degrees numeric(5,2)
    check (torque_degrees is null or torque_degrees between 0 and 20),
  add column if not exists tip_diameter_inches numeric(5,3)
    check (tip_diameter_inches is null or tip_diameter_inches between 0.1 and 2),
  add column if not exists butt_diameter_inches numeric(5,3)
    check (butt_diameter_inches is null or butt_diameter_inches between 0.1 and 2),
  add column if not exists search_text text generated always as (
    lower(trim(brand || ' ' || model || ' ' || coalesce(generation, '')))
  ) stored;

create index golf_shaft_catalog_search_idx on public.golf_shaft_catalog
  using gin (search_text extensions.gin_trgm_ops) where active;

-- Verifiable, license-aware test aggregates. No protected dataset is seeded by
-- this migration and every record must retain a source URL.
create table public.golf_ball_test_results (
  id uuid primary key default gen_random_uuid(),
  golf_ball_id text not null references public.golf_ball_catalog(id) on delete restrict,
  test_source text not null check (length(trim(test_source)) between 1 and 240),
  source_url text not null check (length(source_url) <= 1000 and source_url ~ '^https://[^[:space:]]+$'),
  source_license text check (source_license is null or length(trim(source_license)) between 1 and 200),
  source_license_url text check (source_license_url is null or source_license_url ~ '^https://[^[:space:]]+$'),
  provider_external_id text check (provider_external_id is null or length(trim(provider_external_id)) between 1 and 240),
  test_year smallint check (test_year is null or test_year between 1900 and 2200),
  club_type text not null check (club_type in ('DRIVER', 'SEVEN_IRON', 'PW', 'WEDGE', 'OTHER')),
  swing_speed_mph numeric(6,2) check (swing_speed_mph is null or swing_speed_mph between 20 and 180),
  ball_speed_mph numeric(6,2) check (ball_speed_mph is null or ball_speed_mph between 20 and 250),
  launch_angle_degrees numeric(6,2)
    check (launch_angle_degrees is null or launch_angle_degrees between -20 and 90),
  spin_rate_rpm numeric(8,1) check (spin_rate_rpm is null or spin_rate_rpm between 0 and 20000),
  carry_yards numeric(7,2) check (carry_yards is null or carry_yards between 0 and 500),
  total_yards numeric(7,2) check (total_yards is null or total_yards between 0 and 600),
  peak_height_yards numeric(6,2)
    check (peak_height_yards is null or peak_height_yards between 0 and 300),
  descent_angle_degrees numeric(6,2)
    check (descent_angle_degrees is null or descent_angle_degrees between -20 and 90),
  dispersion_yards numeric(7,2) check (dispersion_yards is null or dispersion_yards between 0 and 250),
  notes text check (notes is null or length(notes) <= 1000),
  verified_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index golf_ball_test_results_ball_idx
  on public.golf_ball_test_results (golf_ball_id, active, test_year desc);
create unique index golf_ball_test_results_external_idx
  on public.golf_ball_test_results (test_source, provider_external_id)
  where provider_external_id is not null;

-- One current aggregate per club/source. The actual local-first payload lives in
-- player_equipment_profiles.snapshot until a transactional projector is added.
create table public.player_club_distances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  player_club_local_id text not null check (length(trim(player_club_local_id)) between 1 and 200),
  carry_distance numeric(7,2) check (carry_distance is null or carry_distance between 0 and 800),
  total_distance numeric(7,2) check (total_distance is null or total_distance between 0 and 800),
  unit text not null default 'YD' check (unit in ('YD', 'M')),
  source text not null default 'MANUAL'
    check (source in ('MANUAL', 'ROUND_ESTIMATE', 'LAUNCH_MONITOR', 'GPS', 'IMPORT')),
  sample_count integer check (sample_count is null or sample_count between 1 and 1000000),
  confidence numeric(5,2) check (confidence is null or confidence between 0 and 100),
  archived_at timestamptz,
  version bigint not null default 1 check (version > 0),
  updated_by_device text
    check (updated_by_device is null or length(trim(updated_by_device)) between 8 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, player_club_local_id)
    references public.player_clubs(user_id, local_id) on delete cascade,
  constraint player_club_distances_value_check
    check (carry_distance is not null or total_distance is not null),
  constraint player_club_distances_order_check
    check (total_distance is null or carry_distance is null or total_distance >= carry_distance),
  unique (user_id, player_club_local_id, source)
);
create index player_club_distances_user_idx
  on public.player_club_distances (user_id, updated_at desc);
create index player_club_distances_club_idx
  on public.player_club_distances (player_club_local_id);

create trigger player_club_distances_version
before insert or update on public.player_club_distances
for each row execute function public.bump_player_equipment_record();

-- Golf venues and courses are provider-neutral. USER_MANUAL records stay
-- private to their creator; verified internal/external catalog records can be
-- made PUBLIC by an administrator. Coordinates are nullable and never guessed.
create table public.golf_clubs (
  id text primary key default gen_random_uuid()::text
    check (length(trim(id)) between 3 and 200),
  name text not null check (length(trim(name)) between 1 and 200),
  country text check (country is null or length(trim(country)) between 2 and 120),
  state_region text check (state_region is null or length(trim(state_region)) between 1 and 160),
  city text check (city is null or length(trim(city)) between 1 and 160),
  address text check (address is null or length(trim(address)) between 1 and 500),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  timezone text check (timezone is null or length(trim(timezone)) between 1 and 100),
  phone text check (phone is null or length(trim(phone)) between 1 and 80),
  website text check (website is null or website ~ '^https://[^[:space:]]+$'),
  provider text not null default 'BACKYARD_INTERNAL'
    check (length(trim(provider)) between 1 and 100),
  provider_external_id text check (provider_external_id is null or length(trim(provider_external_id)) between 1 and 240),
  source_url text check (source_url is null or source_url ~ '^https://[^[:space:]]+$'),
  verified_at timestamptz,
  active boolean not null default true,
  visibility text not null default 'PUBLIC' check (visibility in ('PUBLIC', 'PRIVATE')),
  created_by uuid references auth.users(id) on delete cascade,
  search_text text generated always as (
    lower(trim(name || ' ' || coalesce(city, '') || ' ' || coalesce(state_region, '') || ' ' || coalesce(country, '')))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf_clubs_coordinate_pair_check
    check ((latitude is null) = (longitude is null)),
  constraint golf_clubs_manual_owner_check
    check (
      (provider = 'USER_MANUAL' and created_by is not null and visibility = 'PRIVATE')
      or (provider <> 'USER_MANUAL' and created_by is null)
    ),
  constraint golf_clubs_external_provenance_check
    check (
      provider in ('BACKYARD_INTERNAL', 'USER_MANUAL')
      or (provider_external_id is not null and source_url is not null and verified_at is not null)
    )
);
create index golf_clubs_creator_idx on public.golf_clubs (created_by)
  where created_by is not null;
create index golf_clubs_search_idx on public.golf_clubs
  using gin (search_text extensions.gin_trgm_ops) where active;
create index golf_clubs_region_idx on public.golf_clubs
  (country, state_region, city, active);
create index golf_clubs_coordinates_idx on public.golf_clubs (latitude, longitude)
  where active and latitude is not null and longitude is not null;
create unique index golf_clubs_provider_external_idx
  on public.golf_clubs (provider, provider_external_id)
  where provider_external_id is not null;

create table public.golf_courses (
  id text primary key default gen_random_uuid()::text
    check (length(trim(id)) between 3 and 200),
  club_id text not null references public.golf_clubs(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  holes smallint not null check (holes in (9, 18)),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  provider text not null default 'BACKYARD_INTERNAL'
    check (length(trim(provider)) between 1 and 100),
  provider_external_id text check (provider_external_id is null or length(trim(provider_external_id)) between 1 and 240),
  source_url text check (source_url is null or source_url ~ '^https://[^[:space:]]+$'),
  active boolean not null default true,
  visibility text not null default 'PUBLIC' check (visibility in ('PUBLIC', 'PRIVATE')),
  created_by uuid references auth.users(id) on delete cascade,
  verified_at timestamptz,
  search_text text generated always as (lower(trim(name))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf_courses_coordinate_pair_check
    check ((latitude is null) = (longitude is null)),
  constraint golf_courses_manual_owner_check
    check (
      (provider = 'USER_MANUAL' and created_by is not null and visibility = 'PRIVATE')
      or (provider <> 'USER_MANUAL' and created_by is null)
    ),
  constraint golf_courses_external_provenance_check
    check (
      provider in ('BACKYARD_INTERNAL', 'USER_MANUAL')
      or (provider_external_id is not null and source_url is not null and verified_at is not null)
    )
);
create index golf_courses_club_idx on public.golf_courses (club_id);
create index golf_courses_creator_idx on public.golf_courses (created_by)
  where created_by is not null;
create index golf_courses_search_idx on public.golf_courses
  using gin (search_text extensions.gin_trgm_ops) where active;
create index golf_courses_coordinates_idx on public.golf_courses (latitude, longitude)
  where active and latitude is not null and longitude is not null;
create unique index golf_courses_provider_external_idx
  on public.golf_courses (provider, provider_external_id)
  where provider_external_id is not null;
create unique index golf_courses_club_name_idx
  on public.golf_courses (club_id, lower(name));

create table public.golf_course_tees (
  id text primary key default gen_random_uuid()::text
    check (length(trim(id)) between 3 and 200),
  course_id text not null references public.golf_courses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  color text check (color is null or length(trim(color)) between 1 and 80),
  gender text check (gender is null or gender in ('MEN', 'WOMEN', 'UNISEX', 'OTHER')),
  rating numeric(5,2) check (rating is null or rating between 20 and 100),
  slope smallint check (slope is null or slope between 55 and 155),
  par smallint check (par is null or par between 27 and 90),
  total_yards integer check (total_yards is null or total_yards between 1 and 20000),
  total_meters integer check (total_meters is null or total_meters between 1 and 20000),
  front_nine_rating numeric(5,2) check (front_nine_rating is null or front_nine_rating between 20 and 60),
  back_nine_rating numeric(5,2) check (back_nine_rating is null or back_nine_rating between 20 and 60),
  provider text not null default 'BACKYARD_INTERNAL'
    check (length(trim(provider)) between 1 and 100),
  provider_external_id text check (provider_external_id is null or length(trim(provider_external_id)) between 1 and 240),
  source_url text check (source_url is null or source_url ~ '^https://[^[:space:]]+$'),
  verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf_course_tees_external_provenance_check
    check (
      provider in ('BACKYARD_INTERNAL', 'USER_MANUAL')
      or (provider_external_id is not null and source_url is not null and verified_at is not null)
    ),
  unique (id, course_id)
);
create index golf_course_tees_course_idx
  on public.golf_course_tees (course_id, active, name);
create unique index golf_course_tees_identity_idx
  on public.golf_course_tees (course_id, lower(name), coalesce(gender, ''));
create unique index golf_course_tees_provider_external_idx
  on public.golf_course_tees (provider, provider_external_id)
  where provider_external_id is not null;

create table public.golf_holes (
  id text primary key default gen_random_uuid()::text
    check (length(trim(id)) between 3 and 200),
  course_id text not null references public.golf_courses(id) on delete cascade,
  hole_number smallint not null check (hole_number between 1 and 18),
  par smallint not null check (par between 3 and 6),
  stroke_index smallint not null check (stroke_index between 1 and 18),
  tee_latitude double precision check (tee_latitude is null or tee_latitude between -90 and 90),
  tee_longitude double precision check (tee_longitude is null or tee_longitude between -180 and 180),
  green_center_latitude double precision check (green_center_latitude is null or green_center_latitude between -90 and 90),
  green_center_longitude double precision check (green_center_longitude is null or green_center_longitude between -180 and 180),
  green_front_latitude double precision check (green_front_latitude is null or green_front_latitude between -90 and 90),
  green_front_longitude double precision check (green_front_longitude is null or green_front_longitude between -180 and 180),
  green_back_latitude double precision check (green_back_latitude is null or green_back_latitude between -90 and 90),
  green_back_longitude double precision check (green_back_longitude is null or green_back_longitude between -180 and 180),
  provider text not null default 'BACKYARD_INTERNAL'
    check (length(trim(provider)) between 1 and 100),
  provider_external_id text check (provider_external_id is null or length(trim(provider_external_id)) between 1 and 240),
  source_url text check (source_url is null or source_url ~ '^https://[^[:space:]]+$'),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf_holes_tee_coordinate_pair_check
    check ((tee_latitude is null) = (tee_longitude is null)),
  constraint golf_holes_center_coordinate_pair_check
    check ((green_center_latitude is null) = (green_center_longitude is null)),
  constraint golf_holes_front_coordinate_pair_check
    check ((green_front_latitude is null) = (green_front_longitude is null)),
  constraint golf_holes_back_coordinate_pair_check
    check ((green_back_latitude is null) = (green_back_longitude is null)),
  constraint golf_holes_external_provenance_check
    check (
      provider in ('BACKYARD_INTERNAL', 'USER_MANUAL')
      or (provider_external_id is not null and source_url is not null and verified_at is not null)
  ),
  unique (course_id, hole_number),
  unique (course_id, stroke_index),
  unique (id, course_id)
);
create index golf_holes_course_idx on public.golf_holes (course_id, hole_number);
create unique index golf_holes_provider_external_idx
  on public.golf_holes (provider, provider_external_id)
  where provider_external_id is not null;

create table public.golf_tee_hole_yardages (
  id text primary key default gen_random_uuid()::text
    check (length(trim(id)) between 3 and 200),
  course_id text not null,
  tee_id text not null,
  hole_id text not null,
  yards integer check (yards is null or yards between 1 and 1000),
  meters integer check (meters is null or meters between 1 and 1000),
  provider text not null default 'BACKYARD_INTERNAL'
    check (length(trim(provider)) between 1 and 100),
  provider_external_id text check (provider_external_id is null or length(trim(provider_external_id)) between 1 and 240),
  source_url text check (source_url is null or source_url ~ '^https://[^[:space:]]+$'),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tee_id, course_id)
    references public.golf_course_tees(id, course_id) on delete cascade,
  foreign key (hole_id, course_id)
    references public.golf_holes(id, course_id) on delete cascade,
  constraint golf_tee_hole_yardages_value_check check (yards is not null or meters is not null),
  constraint golf_tee_hole_yardages_external_provenance_check
    check (
      provider in ('BACKYARD_INTERNAL', 'USER_MANUAL')
      or (provider_external_id is not null and source_url is not null and verified_at is not null)
    ),
  unique (tee_id, hole_id)
);
create index golf_tee_hole_yardages_course_idx
  on public.golf_tee_hole_yardages (course_id);
create index golf_tee_hole_yardages_hole_idx
  on public.golf_tee_hole_yardages (hole_id);
create unique index golf_tee_hole_yardages_provider_external_idx
  on public.golf_tee_hole_yardages (provider, provider_external_id)
  where provider_external_id is not null;

create table public.golf_hole_geo_features (
  id text primary key default gen_random_uuid()::text
    check (length(trim(id)) between 3 and 200),
  hole_id text not null references public.golf_holes(id) on delete cascade,
  type text not null check (type in (
    'TEE', 'GREEN_CENTER', 'GREEN_FRONT', 'GREEN_BACK', 'BUNKER', 'WATER',
    'LAYUP', 'DOGLEG', 'OB', 'PENALTY_AREA', 'LANDMARK', 'OTHER'
  )),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  geometry jsonb check (geometry is null or jsonb_typeof(geometry) = 'object'),
  label text check (label is null or length(trim(label)) between 1 and 200),
  provider text not null default 'BACKYARD_INTERNAL'
    check (length(trim(provider)) between 1 and 100),
  provider_external_id text check (provider_external_id is null or length(trim(provider_external_id)) between 1 and 240),
  source_url text check (source_url is null or source_url ~ '^https://[^[:space:]]+$'),
  verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf_hole_geo_features_coordinate_pair_check
    check ((latitude is null) = (longitude is null)),
  constraint golf_hole_geo_features_location_check
    check (latitude is not null or geometry is not null),
  constraint golf_hole_geo_features_external_provenance_check
    check (
      provider in ('BACKYARD_INTERNAL', 'USER_MANUAL')
      or (provider_external_id is not null and source_url is not null and verified_at is not null)
    )
);
create index golf_hole_geo_features_hole_idx
  on public.golf_hole_geo_features (hole_id, type, active);
create unique index golf_hole_geo_features_provider_external_idx
  on public.golf_hole_geo_features (provider, provider_external_id)
  where provider_external_id is not null;

create table public.player_favorite_courses (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null references public.golf_courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);
create index player_favorite_courses_course_idx
  on public.player_favorite_courses (course_id);

create table public.player_recent_courses (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null references public.golf_courses(id) on delete cascade,
  last_selected_at timestamptz not null default now(),
  selection_count integer not null default 1 check (selection_count between 1 and 1000000000),
  primary key (user_id, course_id)
);
create index player_recent_courses_user_recency_idx
  on public.player_recent_courses (user_id, last_selected_at desc);
create index player_recent_courses_course_idx
  on public.player_recent_courses (course_id);

-- Optional bridge from the legacy owner aggregate to the normalized catalog.
-- Existing course snapshots remain authoritative and are not rewritten.
alter table public.courses_cloud
  add column if not exists catalog_course_id text,
  add column if not exists catalog_tee_id text;
alter table public.courses_cloud
  add constraint courses_cloud_catalog_tee_requires_course_check
    check (catalog_tee_id is null or catalog_course_id is not null),
  add constraint courses_cloud_catalog_course_fk
    foreign key (catalog_course_id) references public.golf_courses(id) on delete set null,
  add constraint courses_cloud_catalog_tee_course_fk
    foreign key (catalog_tee_id, catalog_course_id)
    references public.golf_course_tees(id, course_id) on delete set null;
create index courses_cloud_catalog_course_idx on public.courses_cloud (catalog_course_id)
  where catalog_course_id is not null;
create index courses_cloud_catalog_tee_idx on public.courses_cloud (catalog_tee_id)
  where catalog_tee_id is not null;

create or replace function public.touch_golf_architecture_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_golf_architecture_record()
  from public, anon, authenticated;

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'golf_ball_brands', 'golf_club_brands', 'golf_ball_test_results',
    'golf_clubs', 'golf_courses', 'golf_course_tees', 'golf_holes',
    'golf_tee_hole_yardages', 'golf_hole_geo_features'
  ] loop
    execute format(
      'create trigger golf_architecture_touch before insert or update on public.%I for each row execute function public.touch_golf_architecture_record()',
      target_table
    );
  end loop;
end;
$$;

alter table public.golf_ball_brands enable row level security;
alter table public.golf_club_brands enable row level security;
alter table public.golf_ball_test_results enable row level security;
alter table public.player_club_distances enable row level security;
alter table public.golf_clubs enable row level security;
alter table public.golf_courses enable row level security;
alter table public.golf_course_tees enable row level security;
alter table public.golf_holes enable row level security;
alter table public.golf_tee_hole_yardages enable row level security;
alter table public.golf_hole_geo_features enable row level security;
alter table public.player_favorite_courses enable row level security;
alter table public.player_recent_courses enable row level security;

-- Equipment catalog records are non-sensitive and remain readable when archived
-- so old bags/fits can render. Writes require immutable app_metadata.
create policy golf_ball_brands_authenticated_read
on public.golf_ball_brands for select to authenticated using (true);
create policy golf_ball_brands_admin_insert
on public.golf_ball_brands for insert to authenticated
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');
create policy golf_ball_brands_admin_update
on public.golf_ball_brands for update to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin')
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');

create policy golf_club_brands_authenticated_read
on public.golf_club_brands for select to authenticated using (true);
create policy golf_club_brands_admin_insert
on public.golf_club_brands for insert to authenticated
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');
create policy golf_club_brands_admin_update
on public.golf_club_brands for update to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin')
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');

create policy golf_ball_test_results_authenticated_read
on public.golf_ball_test_results for select to authenticated using (true);
create policy golf_ball_test_results_admin_insert
on public.golf_ball_test_results for insert to authenticated
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');
create policy golf_ball_test_results_admin_update
on public.golf_ball_test_results for update to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin')
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');

create policy player_club_distances_owner_read
on public.player_club_distances for select to authenticated
using (user_id = (select auth.uid()));
create policy player_club_distances_owner_insert
on public.player_club_distances for insert to authenticated
with check (user_id = (select auth.uid()));
create policy player_club_distances_owner_update
on public.player_club_distances for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Venue/course rows support a public verified catalog plus private manual rows.
-- Non-admin users may only create or archive their own USER_MANUAL records.
create policy golf_clubs_authenticated_read
on public.golf_clubs for select to authenticated
using (
  (active and visibility = 'PUBLIC')
  or created_by = (select auth.uid())
  or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
);
create policy golf_clubs_authorized_insert
on public.golf_clubs for insert to authenticated
with check (
  coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  or (created_by = (select auth.uid()) and provider = 'USER_MANUAL' and visibility = 'PRIVATE')
);
create policy golf_clubs_authorized_update
on public.golf_clubs for update to authenticated
using (
  coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  or (created_by = (select auth.uid()) and provider = 'USER_MANUAL' and visibility = 'PRIVATE')
)
with check (
  coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  or (created_by = (select auth.uid()) and provider = 'USER_MANUAL' and visibility = 'PRIVATE')
);

create policy golf_courses_authenticated_read
on public.golf_courses for select to authenticated
using (
  (active and visibility = 'PUBLIC')
  or created_by = (select auth.uid())
  or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
);
create policy golf_courses_authorized_insert
on public.golf_courses for insert to authenticated
with check (
  coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  or (
    created_by = (select auth.uid()) and provider = 'USER_MANUAL' and visibility = 'PRIVATE'
    and exists (
      select 1 from public.golf_clubs as club
      where club.id = club_id and club.created_by = (select auth.uid())
        and club.provider = 'USER_MANUAL' and club.visibility = 'PRIVATE'
    )
  )
);
create policy golf_courses_authorized_update
on public.golf_courses for update to authenticated
using (
  coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  or (created_by = (select auth.uid()) and provider = 'USER_MANUAL' and visibility = 'PRIVATE')
)
with check (
  coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  or (
    created_by = (select auth.uid()) and provider = 'USER_MANUAL' and visibility = 'PRIVATE'
    and exists (
      select 1 from public.golf_clubs as club
      where club.id = club_id and club.created_by = (select auth.uid())
        and club.provider = 'USER_MANUAL' and club.visibility = 'PRIVATE'
    )
  )
);

create policy golf_course_tees_authenticated_read
on public.golf_course_tees for select to authenticated
using (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    (course.active and course.visibility = 'PUBLIC')
    or course.created_by = (select auth.uid())
    or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  )
));
create policy golf_course_tees_authorized_insert
on public.golf_course_tees for insert to authenticated
with check (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_course_tees.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
));
create policy golf_course_tees_authorized_update
on public.golf_course_tees for update to authenticated
using (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_course_tees.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
))
with check (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_course_tees.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
));

create policy golf_holes_authenticated_read
on public.golf_holes for select to authenticated
using (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    (course.active and course.visibility = 'PUBLIC')
    or course.created_by = (select auth.uid())
    or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  )
));
create policy golf_holes_authorized_insert
on public.golf_holes for insert to authenticated
with check (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_holes.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
));
create policy golf_holes_authorized_update
on public.golf_holes for update to authenticated
using (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_holes.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
))
with check (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_holes.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
));

create policy golf_tee_hole_yardages_authenticated_read
on public.golf_tee_hole_yardages for select to authenticated
using (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    (course.active and course.visibility = 'PUBLIC')
    or course.created_by = (select auth.uid())
    or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  )
));
create policy golf_tee_hole_yardages_authorized_insert
on public.golf_tee_hole_yardages for insert to authenticated
with check (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_tee_hole_yardages.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
));
create policy golf_tee_hole_yardages_authorized_update
on public.golf_tee_hole_yardages for update to authenticated
using (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_tee_hole_yardages.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
))
with check (exists (
  select 1 from public.golf_courses as course
  where course.id = course_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_tee_hole_yardages.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
));

create policy golf_hole_geo_features_authenticated_read
on public.golf_hole_geo_features for select to authenticated
using (exists (
  select 1 from public.golf_holes as hole
  join public.golf_courses as course on course.id = hole.course_id
  where hole.id = hole_id and (
    (course.active and course.visibility = 'PUBLIC')
    or course.created_by = (select auth.uid())
    or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  )
));
create policy golf_hole_geo_features_authorized_insert
on public.golf_hole_geo_features for insert to authenticated
with check (exists (
  select 1 from public.golf_holes as hole
  join public.golf_courses as course on course.id = hole.course_id
  where hole.id = hole_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_hole_geo_features.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
));
create policy golf_hole_geo_features_authorized_update
on public.golf_hole_geo_features for update to authenticated
using (exists (
  select 1 from public.golf_holes as hole
  join public.golf_courses as course on course.id = hole.course_id
  where hole.id = hole_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_hole_geo_features.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
))
with check (exists (
  select 1 from public.golf_holes as hole
  join public.golf_courses as course on course.id = hole.course_id
  where hole.id = hole_id and (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
    or (
      golf_hole_geo_features.provider = 'USER_MANUAL'
      and course.created_by = (select auth.uid())
      and course.provider = 'USER_MANUAL'
      and course.visibility = 'PRIVATE'
    )
  )
));

create policy player_favorite_courses_owner_read
on public.player_favorite_courses for select to authenticated
using (user_id = (select auth.uid()));
create policy player_favorite_courses_owner_insert
on public.player_favorite_courses for insert to authenticated
with check (user_id = (select auth.uid()));
create policy player_favorite_courses_owner_delete
on public.player_favorite_courses for delete to authenticated
using (user_id = (select auth.uid()));

create policy player_recent_courses_owner_read
on public.player_recent_courses for select to authenticated
using (user_id = (select auth.uid()));
create policy player_recent_courses_owner_insert
on public.player_recent_courses for insert to authenticated
with check (user_id = (select auth.uid()));
create policy player_recent_courses_owner_update
on public.player_recent_courses for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy player_recent_courses_owner_delete
on public.player_recent_courses for delete to authenticated
using (user_id = (select auth.uid()));

grant usage on schema public to authenticated;

revoke all on table
  public.golf_ball_brands,
  public.golf_club_brands,
  public.golf_ball_test_results,
  public.player_club_distances,
  public.golf_clubs,
  public.golf_courses,
  public.golf_course_tees,
  public.golf_holes,
  public.golf_tee_hole_yardages,
  public.golf_hole_geo_features,
  public.player_favorite_courses,
  public.player_recent_courses
from public, anon, authenticated, service_role;

grant select, insert, update on table
  public.golf_ball_brands,
  public.golf_club_brands,
  public.golf_ball_test_results,
  public.golf_clubs,
  public.golf_courses,
  public.golf_course_tees,
  public.golf_holes,
  public.golf_tee_hole_yardages,
  public.golf_hole_geo_features
to authenticated;

-- Owner aggregates remain direct-client read-only. The validated equipment API
-- writes the CAS snapshot with service_role after authenticating the caller.
grant select on table public.player_club_distances to authenticated;

grant select, insert, delete on table public.player_favorite_courses to authenticated;
grant select, insert, update, delete on table public.player_recent_courses to authenticated;

grant select, insert, update on table
  public.golf_ball_brands,
  public.golf_club_brands,
  public.golf_ball_test_results,
  public.player_club_distances,
  public.golf_clubs,
  public.golf_courses,
  public.golf_course_tees,
  public.golf_holes,
  public.golf_tee_hole_yardages,
  public.golf_hole_geo_features
to service_role;

grant select, insert, delete on table public.player_favorite_courses to service_role;
grant select, insert, update, delete on table public.player_recent_courses to service_role;

comment on column public.profiles.default_handicap is
  'The single optional golfer Handicap Index; round playing handicaps remain stored with each round.';
comment on table public.player_club_distances is
  'Optional carry/total distance aggregate. Runtime sync remains inside the CAS equipment profile snapshot until projection is transactional.';
comment on table public.golf_ball_test_results is
  'Verified, source-linked test aggregates only; no proprietary dataset is bundled by this migration.';
comment on table public.golf_clubs is
  'Golf venue/club, distinct from golf_club_brands (equipment manufacturers).';
comment on column public.golf_hole_geo_features.geometry is
  'Optional provider-neutral GeoJSON-like geometry. Point coordinates remain nullable and must never be inferred.';

commit;

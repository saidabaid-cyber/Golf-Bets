-- The Backyard equipment, golf-ball catalog and optional ball-fitting data.
-- Additive only: no existing table, wager, round, score or history data changes.
-- Catalog rows are archived with active=false; player rows are archived with
-- archived_at. Client roles intentionally receive no DELETE privilege.

begin;

create table public.golf_ball_catalog (
  -- Stable import key shared with the versioned catalog seed (for example,
  -- titleist-pro-v1-2025). Catalog identities must not change on re-import.
  id text primary key check (length(trim(id)) between 3 and 200),
  brand text not null check (length(trim(brand)) between 1 and 120),
  model text not null check (length(trim(model)) between 1 and 160),
  generation text check (generation is null or length(trim(generation)) between 1 and 120),
  year smallint check (year is null or year between 1900 and 2200),
  active boolean not null default true,
  cover_material text check (cover_material is null or length(trim(cover_material)) between 1 and 120),
  construction text check (construction is null or length(trim(construction)) between 1 and 120),
  -- Compression remains null unless a reliable source publishes a value.
  compression smallint check (compression is null or compression between 1 and 200),
  flight text check (flight is null or flight in ('VERY_LOW', 'LOW', 'MID', 'HIGH', 'VERY_HIGH')),
  driver_spin text check (driver_spin is null or driver_spin in ('VERY_LOW', 'LOW', 'MID', 'HIGH', 'VERY_HIGH')),
  iron_spin text check (iron_spin is null or iron_spin in ('VERY_LOW', 'LOW', 'MID', 'HIGH', 'VERY_HIGH')),
  short_game_spin text check (short_game_spin is null or short_game_spin in ('VERY_LOW', 'LOW', 'MID', 'HIGH', 'VERY_HIGH')),
  feel text check (feel is null or feel in ('VERY_LOW', 'LOW', 'MID', 'HIGH', 'VERY_HIGH')),
  flight_source_text text,
  driver_spin_source_text text,
  iron_spin_source_text text,
  short_game_spin_source_text text,
  feel_source_text text,
  colors text[] not null default array[]::text[],
  price_tier text check (price_tier is null or price_tier in ('ECONOMY', 'MID', 'PREMIUM')),
  target_profile text[] not null default array[]::text[],
  official_url text check (official_url is null or official_url ~ '^https://[^[:space:]]+$'),
  source_name text not null check (length(trim(source_name)) between 1 and 160),
  source_url text not null check (source_url ~ '^https://[^[:space:]]+$'),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index golf_ball_catalog_identity_idx
  on public.golf_ball_catalog (
    lower(brand),
    lower(model),
    lower(coalesce(generation, '')),
    coalesce(year, 0)
  );
create index golf_ball_catalog_active_brand_idx
  on public.golf_ball_catalog (active, lower(brand), lower(model));

create table public.golf_club_catalog (
  id text primary key check (length(trim(id)) between 3 and 200),
  brand text not null check (length(trim(brand)) between 1 and 120),
  model text not null check (length(trim(model)) between 1 and 160),
  generation text check (generation is null or length(trim(generation)) between 1 and 120),
  year smallint check (year is null or year between 1900 and 2200),
  category text not null check (category in (
    'DRIVER', 'MINI_DRIVER', 'FAIRWAY_WOOD', 'HYBRID',
    'UTILITY_IRON', 'IRON_SET', 'WEDGE', 'PUTTER'
  )),
  sub_category text check (sub_category is null or length(trim(sub_category)) between 1 and 120),
  active boolean not null default true,
  handedness text[] not null default array['RH', 'LH']::text[]
    check (cardinality(handedness) between 1 and 2 and handedness <@ array['RH', 'LH']::text[]),
  lofts numeric(5,2)[] not null default array[]::numeric(5,2)[],
  variants jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array'),
  standard_length_inches numeric(5,2)
    check (standard_length_inches is null or standard_length_inches between 10 and 60),
  lie_degrees numeric(5,2) check (lie_degrees is null or lie_degrees between 30 and 90),
  head_volume_cc numeric(6,1) check (head_volume_cc is null or head_volume_cc between 1 and 1000),
  official_url text check (official_url is null or official_url ~ '^https://[^[:space:]]+$'),
  source_name text not null check (length(trim(source_name)) between 1 and 160),
  source_url text not null check (source_url ~ '^https://[^[:space:]]+$'),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index golf_club_catalog_identity_idx
  on public.golf_club_catalog (
    lower(brand),
    lower(model),
    lower(coalesce(generation, '')),
    coalesce(year, 0),
    category
  );
create index golf_club_catalog_active_category_brand_idx
  on public.golf_club_catalog (active, category, lower(brand), lower(model));

create table public.golf_shaft_catalog (
  id text primary key check (length(trim(id)) between 3 and 200),
  brand text not null check (length(trim(brand)) between 1 and 120),
  model text not null check (length(trim(model)) between 1 and 160),
  generation text check (generation is null or length(trim(generation)) between 1 and 120),
  year smallint check (year is null or year between 1900 and 2200),
  active boolean not null default true,
  weight_grams numeric(6,2) check (weight_grams is null or weight_grams between 1 and 1000),
  flex text[] not null default array[]::text[] check (
    flex <@ array['LADIES', 'SENIOR', 'REGULAR', 'STIFF', 'X_STIFF', 'TX', 'OTHER']::text[]
  ),
  launch text check (launch is null or launch in ('VERY_LOW', 'LOW', 'MID', 'HIGH', 'VERY_HIGH')),
  spin text check (spin is null or spin in ('VERY_LOW', 'LOW', 'MID', 'HIGH', 'VERY_HIGH')),
  material text check (material is null or length(trim(material)) between 1 and 120),
  official_url text check (official_url is null or official_url ~ '^https://[^[:space:]]+$'),
  source_name text not null check (length(trim(source_name)) between 1 and 160),
  source_url text not null check (source_url ~ '^https://[^[:space:]]+$'),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index golf_shaft_catalog_identity_idx
  on public.golf_shaft_catalog (
    lower(brand),
    lower(model),
    lower(coalesce(generation, '')),
    coalesce(year, 0),
    coalesce(weight_grams, 0)
  );
create index golf_shaft_catalog_active_brand_idx
  on public.golf_shaft_catalog (active, lower(brand), lower(model));

-- Canonical owner aggregate for cross-device sync. The snapshot is replaced as
-- one unit under CAS and is the only runtime sync target in this milestone.
-- The normalized tables below prepare a future queryable projection; this
-- migration intentionally does not claim or attempt to keep two write models
-- synchronized before a transactional projector is introduced.
create table public.player_equipment_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  schema_version smallint not null default 1 check (schema_version > 0),
  version bigint not null default 1 check (version > 0),
  -- A client must send the version it read. The trigger clears this value after
  -- every successful write, so omitting it can never silently overwrite a row.
  expected_version bigint check (expected_version is null or expected_version > 0),
  last_mutation_id uuid not null default gen_random_uuid(),
  updated_by_device text check (
    updated_by_device is null or length(trim(updated_by_device)) between 8 and 120
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_equipment_profiles_snapshot_owner_check check (
    snapshot ? 'userId' and snapshot ->> 'userId' = user_id::text
  ),
  constraint player_equipment_profiles_snapshot_schema_check check (
    snapshot ? 'schemaVersion' and snapshot ->> 'schemaVersion' = schema_version::text
  ),
  constraint player_equipment_profiles_snapshot_size_check check (
    pg_column_size(snapshot) <= 1000000
  )
);

create table public.player_clubs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null check (length(trim(local_id)) between 1 and 200),
  catalog_club_id text references public.golf_club_catalog(id) on delete restrict,
  custom_brand text check (custom_brand is null or length(trim(custom_brand)) between 1 and 120),
  custom_model text check (custom_model is null or length(trim(custom_model)) between 1 and 160),
  generation text check (generation is null or length(trim(generation)) between 1 and 120),
  year smallint check (year is null or year between 1900 and 2200),
  category text not null check (category in (
    'DRIVER', 'MINI_DRIVER', 'FAIRWAY_WOOD', 'HYBRID',
    'UTILITY_IRON', 'IRON_SET', 'WEDGE', 'PUTTER'
  )),
  sub_category text check (sub_category is null or length(trim(sub_category)) between 1 and 120),
  set_composition text[] not null default array[]::text[],
  loft_degrees numeric(5,2) check (loft_degrees is null or loft_degrees between 0 and 90),
  handedness text check (handedness is null or handedness in ('RH', 'LH')),
  shaft_id text references public.golf_shaft_catalog(id) on delete restrict,
  custom_shaft text check (custom_shaft is null or length(trim(custom_shaft)) between 1 and 200),
  flex text check (flex is null or length(trim(flex)) between 1 and 40),
  shaft_weight_grams numeric(6,2)
    check (shaft_weight_grams is null or shaft_weight_grams between 1 and 300),
  length_inches numeric(5,2) check (length_inches is null or length_inches between 10 and 60),
  lie_degrees numeric(5,2) check (lie_degrees is null or lie_degrees between 30 and 90),
  grip text check (grip is null or length(trim(grip)) between 1 and 200),
  notes text check (notes is null or length(notes) <= 2000),
  is_current boolean not null default true,
  archived_at timestamptz,
  version bigint not null default 1 check (version > 0),
  updated_by_device text check (
    updated_by_device is null or length(trim(updated_by_device)) between 8 and 120
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_clubs_catalog_or_manual_check check (
    catalog_club_id is not null
    or (custom_brand is not null and custom_model is not null)
  ),
  constraint player_clubs_archive_check check (archived_at is null or is_current = false),
  unique (user_id, local_id)
);

create index player_clubs_user_id_idx on public.player_clubs (user_id);
create index player_clubs_catalog_club_id_idx on public.player_clubs (catalog_club_id)
  where catalog_club_id is not null;
create index player_clubs_shaft_id_idx on public.player_clubs (shaft_id)
  where shaft_id is not null;
create index player_clubs_current_bag_idx
  on public.player_clubs (user_id, category, created_at desc)
  where is_current = true and archived_at is null;

create table public.player_balls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null check (length(trim(local_id)) between 1 and 200),
  catalog_ball_id text references public.golf_ball_catalog(id) on delete restrict,
  custom_brand text check (custom_brand is null or length(trim(custom_brand)) between 1 and 120),
  custom_model text check (custom_model is null or length(trim(custom_model)) between 1 and 160),
  generation text check (generation is null or length(trim(generation)) between 1 and 120),
  year smallint check (year is null or year between 1900 and 2200),
  color text check (color is null or length(trim(color)) between 1 and 80),
  is_current boolean not null default true,
  archived_at timestamptz,
  version bigint not null default 1 check (version > 0),
  updated_by_device text check (
    updated_by_device is null or length(trim(updated_by_device)) between 8 and 120
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_balls_catalog_or_manual_check check (
    catalog_ball_id is not null
    or (custom_brand is not null and custom_model is not null)
  ),
  constraint player_balls_archive_check check (archived_at is null or is_current = false),
  unique (user_id, local_id)
);

create index player_balls_user_id_idx on public.player_balls (user_id);
create index player_balls_catalog_ball_id_idx on public.player_balls (catalog_ball_id)
  where catalog_ball_id is not null;
create unique index player_balls_one_current_idx on public.player_balls (user_id)
  where is_current = true and archived_at is null;

create table public.ball_fit_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null check (length(trim(local_id)) between 1 and 200),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'COMPLETED', 'ARCHIVED')),
  fit_mode text not null default 'QUICK' check (fit_mode in ('QUICK', 'LAUNCH_MONITOR')),
  launch_monitor_source text check (
    launch_monitor_source is null or length(trim(launch_monitor_source)) between 1 and 180
  ),
  current_ball_catalog_id text references public.golf_ball_catalog(id) on delete restrict,
  current_ball_brand text,
  current_ball_model text,
  handicap numeric(5,1) check (handicap is null or handicap between -20 and 54),
  typical_score smallint check (typical_score is null or typical_score between 40 and 200),
  driver_distance_yards numeric(6,1)
    check (driver_distance_yards is null or driver_distance_yards between 50 and 500),
  driver_swing_speed text check (driver_swing_speed is null or driver_swing_speed in (
    'UNDER_85', 'FROM_85_TO_95', 'FROM_95_TO_105', 'OVER_105', 'UNKNOWN'
  )),
  feel_preference text check (feel_preference is null or feel_preference in (
    'VERY_SOFT', 'SOFT', 'MEDIUM', 'FIRM', 'VERY_FIRM', 'ANY'
  )),
  trajectory_preference text check (trajectory_preference is null or trajectory_preference in (
    'LOW', 'MID', 'HIGH', 'UNKNOWN'
  )),
  greens_condition text check (greens_condition is null or greens_condition in (
    'SOFT', 'MEDIUM', 'FIRM', 'VARIES_UNKNOWN'
  )),
  priorities text[] not null default array[]::text[] check (
    cardinality(priorities) <= 9
    and priorities <@ array[
      'DRIVER_DISTANCE', 'LESS_DRIVER_SPIN', 'STABILITY_CONTROL', 'HEIGHT',
      'IRON_CONTROL', 'STOP_ON_GREEN', 'WEDGE_SPIN', 'GREENSIDE_FEEL', 'PUTTER_FEEL'
    ]::text[]
  ),
  approach_behavior text check (approach_behavior is null or approach_behavior in (
    'ROLLS_TOO_MUCH', 'STOPS_WELL', 'TOO_MUCH_BACKSPIN', 'UNKNOWN'
  )),
  green_spin_preference text check (green_spin_preference is null or green_spin_preference in (
    'YES', 'NO', 'UNKNOWN'
  )),
  price_preference text check (price_preference is null or price_preference in (
    'BEST_FIT', 'PREMIUM', 'MID', 'ECONOMY'
  )),
  color_preference text check (color_preference is null or color_preference in (
    'WHITE', 'YELLOW', 'OTHER', 'ANY'
  )),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  -- A completed session stores at most three result snapshots. Each snapshot
  -- must reference catalog information verified by application logic.
  recommendations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(recommendations) = 'array' and jsonb_array_length(recommendations) <= 3
  ),
  comparison jsonb check (comparison is null or jsonb_typeof(comparison) = 'object'),
  algorithm_version text not null default 'backyard-ball-fit-v1'
    check (length(trim(algorithm_version)) between 1 and 80),
  is_current boolean not null default true,
  completed_at timestamptz,
  archived_at timestamptz,
  version bigint not null default 1 check (version > 0),
  updated_by_device text check (
    updated_by_device is null or length(trim(updated_by_device)) between 8 and 120
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ball_fit_sessions_completion_check check (
    status <> 'COMPLETED' or completed_at is not null
  ),
  constraint ball_fit_sessions_archive_check check (
    archived_at is null or (is_current = false and status = 'ARCHIVED')
  ),
  unique (id, user_id),
  unique (user_id, local_id)
);

create index ball_fit_sessions_user_id_idx
  on public.ball_fit_sessions (user_id, created_at desc);
create index ball_fit_sessions_current_ball_idx
  on public.ball_fit_sessions (current_ball_catalog_id)
  where current_ball_catalog_id is not null;
create unique index ball_fit_sessions_one_current_idx on public.ball_fit_sessions (user_id)
  where is_current = true and archived_at is null;

create table public.ball_fit_recommendations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null,
  ball_catalog_id text not null references public.golf_ball_catalog(id) on delete restrict,
  rank smallint not null check (rank between 1 and 3),
  match_score numeric(5,2) not null check (match_score between 0 and 100),
  reasons text[] not null default array[]::text[],
  improvement_notes text check (improvement_notes is null or length(improvement_notes) <= 2000),
  catalog_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(catalog_snapshot) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_by_device text check (
    updated_by_device is null or length(trim(updated_by_device)) between 8 and 120
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (session_id, user_id)
    references public.ball_fit_sessions(id, user_id) on delete cascade,
  unique (session_id, rank),
  unique (session_id, ball_catalog_id)
);

create index ball_fit_recommendations_user_id_idx
  on public.ball_fit_recommendations (user_id);
create index ball_fit_recommendations_session_owner_idx
  on public.ball_fit_recommendations (session_id, user_id);
create index ball_fit_recommendations_catalog_idx
  on public.ball_fit_recommendations (ball_catalog_id);

create table public.launch_monitor_shots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null,
  local_id text not null check (length(trim(local_id)) between 1 and 200),
  club_slot text not null check (club_slot in (
    'DRIVER', 'IRON_7', 'PITCHING_WEDGE', 'HALF_WEDGE'
  )),
  shot_index smallint not null check (shot_index between 1 and 99),
  club_speed_mph numeric(6,2) check (club_speed_mph is null or club_speed_mph between 0 and 250),
  ball_speed_mph numeric(6,2) check (ball_speed_mph is null or ball_speed_mph between 0 and 300),
  launch_angle_degrees numeric(6,2)
    check (launch_angle_degrees is null or launch_angle_degrees between -30 and 90),
  spin_rpm numeric(8,1) check (spin_rpm is null or spin_rpm between 0 and 25000),
  carry_yards numeric(7,2) check (carry_yards is null or carry_yards between 0 and 700),
  total_yards numeric(7,2) check (total_yards is null or total_yards between 0 and 800),
  peak_height_yards numeric(6,2)
    check (peak_height_yards is null or peak_height_yards between 0 and 250),
  landing_angle_degrees numeric(6,2)
    check (landing_angle_degrees is null or landing_angle_degrees between -30 and 90),
  excluded boolean not null default false,
  exclusion_reason text check (exclusion_reason is null or length(exclusion_reason) <= 500),
  notes text check (notes is null or length(notes) <= 500),
  version bigint not null default 1 check (version > 0),
  updated_by_device text check (
    updated_by_device is null or length(trim(updated_by_device)) between 8 and 120
  ),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (session_id, user_id)
    references public.ball_fit_sessions(id, user_id) on delete cascade,
  unique (session_id, club_slot, shot_index),
  unique (user_id, local_id)
);

create index launch_monitor_shots_user_id_idx on public.launch_monitor_shots (user_id);
create index launch_monitor_shots_session_owner_idx
  on public.launch_monitor_shots (session_id, user_id);
create index launch_monitor_shots_fit_sample_idx
  on public.launch_monitor_shots (session_id, club_slot, excluded, shot_index);

-- Server-owned timestamps for catalog maintenance.
create or replace function public.touch_equipment_catalog_record()
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

revoke all on function public.touch_equipment_catalog_record()
  from public, anon, authenticated;

create trigger golf_ball_catalog_touch
before insert or update on public.golf_ball_catalog
for each row execute function public.touch_equipment_catalog_record();
create trigger golf_club_catalog_touch
before insert or update on public.golf_club_catalog
for each row execute function public.touch_equipment_catalog_record();
create trigger golf_shaft_catalog_touch
before insert or update on public.golf_shaft_catalog
for each row execute function public.touch_equipment_catalog_record();

-- Normalized owner projections use monotonically increasing versions. The
-- canonical snapshot below is the conflict authority across devices.
create or replace function public.bump_player_equipment_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
  else
    new.version := old.version + 1;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.bump_player_equipment_record()
  from public, anon, authenticated;

create trigger player_clubs_version
before insert or update on public.player_clubs
for each row execute function public.bump_player_equipment_record();
create trigger player_balls_version
before insert or update on public.player_balls
for each row execute function public.bump_player_equipment_record();
create trigger ball_fit_sessions_version
before insert or update on public.ball_fit_sessions
for each row execute function public.bump_player_equipment_record();
create trigger ball_fit_recommendations_version
before insert or update on public.ball_fit_recommendations
for each row execute function public.bump_player_equipment_record();
create trigger launch_monitor_shots_version
before insert or update on public.launch_monitor_shots
for each row execute function public.bump_player_equipment_record();

-- Optimistic concurrency and mutation idempotency for the canonical aggregate.
-- The stored expected_version is always null. A later update must explicitly
-- submit the current version or fails with SQLSTATE 40001.
create or replace function public.enforce_player_equipment_profile_cas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.expected_version is not null then
      raise exception using
        errcode = '22023',
        message = 'equipment_profile_insert_must_not_have_expected_version';
    end if;
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.last_mutation_id = old.last_mutation_id then
    if new.snapshot is distinct from old.snapshot
      or new.schema_version is distinct from old.schema_version then
      raise exception using
        errcode = '22023',
        message = 'equipment_profile_mutation_id_reused';
    end if;
    return old;
  end if;

  if new.expected_version is null or new.expected_version <> old.version then
    raise exception using
      errcode = '40001',
      message = 'equipment_profile_version_conflict';
  end if;

  new.user_id := old.user_id;
  new.version := old.version + 1;
  new.expected_version := null;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.enforce_player_equipment_profile_cas()
  from public, anon, authenticated;

create trigger player_equipment_profiles_cas
before insert or update on public.player_equipment_profiles
for each row execute function public.enforce_player_equipment_profile_cas();

alter table public.golf_ball_catalog enable row level security;
alter table public.golf_club_catalog enable row level security;
alter table public.golf_shaft_catalog enable row level security;
alter table public.player_equipment_profiles enable row level security;
alter table public.player_clubs enable row level security;
alter table public.player_balls enable row level security;
alter table public.ball_fit_sessions enable row level security;
alter table public.ball_fit_recommendations enable row level security;
alter table public.launch_monitor_shots enable row level security;

-- Catalogs are readable by signed-in players. Only a role issued in immutable
-- app_metadata can create or archive catalog entries. user_metadata is never
-- consulted for authorization.
create policy golf_ball_catalog_authenticated_read
on public.golf_ball_catalog for select to authenticated using (true);
create policy golf_ball_catalog_admin_insert
on public.golf_ball_catalog for insert to authenticated
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');
create policy golf_ball_catalog_admin_update
on public.golf_ball_catalog for update to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin')
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');

create policy golf_club_catalog_authenticated_read
on public.golf_club_catalog for select to authenticated using (true);
create policy golf_club_catalog_admin_insert
on public.golf_club_catalog for insert to authenticated
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');
create policy golf_club_catalog_admin_update
on public.golf_club_catalog for update to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin')
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');

create policy golf_shaft_catalog_authenticated_read
on public.golf_shaft_catalog for select to authenticated using (true);
create policy golf_shaft_catalog_admin_insert
on public.golf_shaft_catalog for insert to authenticated
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');
create policy golf_shaft_catalog_admin_update
on public.golf_shaft_catalog for update to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin')
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');

create policy player_equipment_profiles_owner_read
on public.player_equipment_profiles for select to authenticated
using (user_id = (select auth.uid()));
create policy player_equipment_profiles_owner_insert
on public.player_equipment_profiles for insert to authenticated
with check (user_id = (select auth.uid()));
create policy player_equipment_profiles_owner_update
on public.player_equipment_profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy player_clubs_owner_read
on public.player_clubs for select to authenticated
using (user_id = (select auth.uid()));
create policy player_clubs_owner_insert
on public.player_clubs for insert to authenticated
with check (user_id = (select auth.uid()));
create policy player_clubs_owner_update
on public.player_clubs for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy player_balls_owner_read
on public.player_balls for select to authenticated
using (user_id = (select auth.uid()));
create policy player_balls_owner_insert
on public.player_balls for insert to authenticated
with check (user_id = (select auth.uid()));
create policy player_balls_owner_update
on public.player_balls for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy ball_fit_sessions_owner_read
on public.ball_fit_sessions for select to authenticated
using (user_id = (select auth.uid()));
create policy ball_fit_sessions_owner_insert
on public.ball_fit_sessions for insert to authenticated
with check (user_id = (select auth.uid()));
create policy ball_fit_sessions_owner_update
on public.ball_fit_sessions for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy ball_fit_recommendations_owner_read
on public.ball_fit_recommendations for select to authenticated
using (user_id = (select auth.uid()));
create policy ball_fit_recommendations_owner_insert
on public.ball_fit_recommendations for insert to authenticated
with check (user_id = (select auth.uid()));
create policy ball_fit_recommendations_owner_update
on public.ball_fit_recommendations for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy launch_monitor_shots_owner_read
on public.launch_monitor_shots for select to authenticated
using (user_id = (select auth.uid()));
create policy launch_monitor_shots_owner_insert
on public.launch_monitor_shots for insert to authenticated
with check (user_id = (select auth.uid()));
create policy launch_monitor_shots_owner_update
on public.launch_monitor_shots for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Explicit Data API grants account for the 2026 opt-in behavior. RLS remains
-- the row boundary; anon receives no privilege and clients cannot DELETE.
grant usage on schema public to authenticated;

revoke all on table
  public.golf_ball_catalog,
  public.golf_club_catalog,
  public.golf_shaft_catalog,
  public.player_equipment_profiles,
  public.player_clubs,
  public.player_balls,
  public.ball_fit_sessions,
  public.ball_fit_recommendations,
  public.launch_monitor_shots
from public, anon, authenticated, service_role;

grant select, insert, update on table
  public.golf_ball_catalog,
  public.golf_club_catalog,
  public.golf_shaft_catalog
to authenticated;

-- The canonical aggregate is written only by the authenticated server route
-- after strict validation and CAS. Direct client DML stays revoked so a user
-- cannot bypass payload/schema checks, even for their own row. RLS remains as
-- defense in depth and for owner-only reads.
grant select on table
  public.player_equipment_profiles,
  public.player_clubs,
  public.player_balls,
  public.ball_fit_sessions,
  public.ball_fit_recommendations,
  public.launch_monitor_shots
to authenticated;

-- Supabase projects created after April 2026 no longer guarantee implicit
-- table grants. Server-only routes use this role after authenticating the user;
-- DELETE remains deliberately unavailable.
grant select, insert, update on table
  public.golf_ball_catalog,
  public.golf_club_catalog,
  public.golf_shaft_catalog,
  public.player_equipment_profiles,
  public.player_clubs,
  public.player_balls,
  public.ball_fit_sessions,
  public.ball_fit_recommendations,
  public.launch_monitor_shots
to service_role;

comment on table public.player_equipment_profiles is
  'Canonical owner-only equipment snapshot. Replace the full aggregate with expected_version so stale devices cannot silently restore removed records.';
comment on table public.ball_fit_sessions is
  'Optional The Backyard Ball Fit answers/results; this is not a manufacturer fitting or proprietary algorithm.';
comment on column public.golf_ball_catalog.compression is
  'Nullable by design: populate only when a reliable source verifies the value.';
comment on column public.launch_monitor_shots.excluded is
  'Excluded shots remain stored for audit but are omitted from robust fitting statistics.';

commit;

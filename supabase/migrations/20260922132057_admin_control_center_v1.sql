-- Admin Control Center v1. Additive only. No production apply is authorized by
-- this repository change. Published rows are versioned; DELETE is intentionally
-- withheld from client roles and historical round snapshots remain untouched.
begin;

create schema if not exists private;

create table public.admin_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('SUPER_ADMIN','COURSE_ADMIN','CATALOG_ADMIN','COMPETITION_ADMIN','SUPPORT_ADMIN','CONTENT_ADMIN')),
  scope_type text not null check (scope_type in ('GLOBAL','COURSE','COMPETITION','CATALOG')),
  scope_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint admin_memberships_scope_check check (
    (scope_type = 'GLOBAL' and scope_id is null)
    or (scope_type <> 'GLOBAL' and length(trim(scope_id)) between 1 and 200)
  ),
  unique (user_id, role, scope_type, scope_id)
);
create index admin_memberships_user_active_idx on public.admin_memberships(user_id,active);
create index admin_memberships_scope_idx on public.admin_memberships(scope_type,scope_id,active);

alter table public.admin_memberships enable row level security;
revoke all on public.admin_memberships from public,anon,authenticated;
grant select on public.admin_memberships to authenticated;

create or replace function private.admin_has_scope_v1(
  target_entity text,
  target_scope_type text,
  target_scope_id text,
  target_action text default 'READ'
) returns boolean
language sql stable security definer set search_path=''
as $$
  select exists (
    select 1
    from public.admin_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.active
      and (
        (membership.role = 'SUPER_ADMIN' and membership.scope_type = 'GLOBAL')
        or (
          (membership.scope_type = 'GLOBAL'
            or (membership.scope_type = target_scope_type and membership.scope_id = target_scope_id))
          and case membership.role
            when 'COURSE_ADMIN' then target_entity in ('COURSE','COURSE_CONFIGURATION','LOCAL_RULE_SET','IMPORT')
            when 'CATALOG_ADMIN' then target_entity in ('CLUB_EQUIPMENT','BALL','SHAFT','EQUIPMENT_IMAGE','IMPORT')
            when 'COMPETITION_ADMIN' then target_entity in ('COMPETITION','COMPETITION_RULE_SET','COURSE_CONFIGURATION')
            when 'SUPPORT_ADMIN' then target_entity = 'REQUEST' and target_action in ('READ','CREATE_DRAFT','REVIEW')
            when 'CONTENT_ADMIN' then target_entity in ('LOCAL_RULE_SET','COMPETITION_RULE_SET','EQUIPMENT_IMAGE')
            else false
          end
        )
      )
  );
$$;
revoke all on function private.admin_has_scope_v1(text,text,text,text) from public,anon;
grant usage on schema private to authenticated,service_role;
grant execute on function private.admin_has_scope_v1(text,text,text,text) to authenticated,service_role;

create or replace function private.admin_has_any_membership_v1()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.admin_memberships where user_id=(select auth.uid()) and active) $$;
revoke all on function private.admin_has_any_membership_v1() from public,anon;
grant execute on function private.admin_has_any_membership_v1() to authenticated,service_role;

create policy admin_memberships_self_read on public.admin_memberships for select to authenticated
using (user_id = (select auth.uid()) or private.admin_has_scope_v1('REQUEST','GLOBAL',null,'AUDIT'));

create table public.admin_catalog_revisions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'COURSE','COURSE_CONFIGURATION','LOCAL_RULE_SET','CLUB_EQUIPMENT','BALL','SHAFT',
    'EQUIPMENT_IMAGE','COMPETITION','COMPETITION_RULE_SET','REQUEST','IMPORT'
  )),
  entity_id text not null check (length(trim(entity_id)) between 1 and 240),
  scope_type text not null check (scope_type in ('GLOBAL','COURSE','COMPETITION','CATALOG')),
  scope_id text,
  version integer not null check (version > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT','REVIEWED','VERIFIED','PUBLISHED','SUPERSEDED','ARCHIVED')),
  provenance_status text not null default 'REPORTED' check (provenance_status in ('REPORTED','REVIEWED','VERIFIED')),
  payload jsonb not null check (jsonb_typeof(payload)='object' and pg_column_size(payload) <= 1000000),
  source_type text check (source_type is null or source_type in ('OEM_OFFICIAL','DISTRIBUTOR','SECONDARY_ARCHIVE','USER_SUBMITTED','ADMIN_RESEARCH','OTHER')),
  source_name text check (source_name is null or length(trim(source_name)) between 1 and 240),
  source_url text check (source_url is null or source_url ~ '^https://[^[:space:]]+$'),
  verified_at timestamptz,
  confidence text check (confidence is null or confidence in ('LOW','MEDIUM','HIGH')),
  internal_notes text check (internal_notes is null or length(internal_notes) <= 10000),
  effective_from timestamptz,
  effective_until timestamptz,
  supersedes_revision_id uuid references public.admin_catalog_revisions(id) on delete restrict,
  preview_hash text check (preview_hash is null or preview_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text check (revision_hash is null or revision_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  verified_by uuid references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint admin_catalog_revisions_scope_check check (
    (scope_type='GLOBAL' and scope_id is null) or (scope_type<>'GLOBAL' and length(trim(scope_id)) between 1 and 200)
  ),
  constraint admin_catalog_revisions_effective_check check (effective_until is null or effective_from is null or effective_until > effective_from),
  unique(entity_type,entity_id,version)
);
create index admin_catalog_revisions_queue_idx on public.admin_catalog_revisions(status,entity_type,updated_at desc);
create index admin_catalog_revisions_scope_idx on public.admin_catalog_revisions(scope_type,scope_id,status);

create table public.course_configurations (
  id uuid primary key default gen_random_uuid(),
  course_id text not null check(length(trim(course_id)) between 1 and 240),
  name text not null check (length(trim(name)) between 1 and 200),
  description text check (description is null or length(description) <= 5000),
  scope_type text not null check (scope_type in ('COURSE','COMPETITION')),
  competition_id uuid,
  status text not null default 'DRAFT' check (status in ('DRAFT','SCHEDULED','PUBLISHED','SUPERSEDED','EXPIRED','CANCELLED','ARCHIVED')),
  effective_from timestamptz,
  effective_until timestamptz,
  reason text check (reason is null or length(reason) <= 2000),
  source_description text check (source_description is null or length(source_description) <= 2000),
  source_document_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  supersedes_configuration_id uuid references public.course_configurations(id) on delete restrict,
  version integer not null check(version > 0),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  constraint course_configurations_scope_check check (
    (scope_type='COURSE' and competition_id is null) or (scope_type='COMPETITION' and competition_id is not null)
  ),
  constraint course_configurations_effective_check check (effective_until is null or effective_from is null or effective_until > effective_from),
  unique(course_id,scope_type,competition_id,version)
);
create index course_configurations_effective_idx on public.course_configurations(course_id,status,effective_from,effective_until);
create index course_configurations_competition_idx on public.course_configurations(competition_id) where competition_id is not null;

create table public.course_configuration_holes (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references public.course_configurations(id) on delete cascade,
  client_key text not null check(length(trim(client_key)) between 1 and 80),
  sequence smallint not null check(sequence between 1 and 36),
  runtime_hole_number smallint not null check(runtime_hole_number between 1 and 18),
  display_label text not null check(length(trim(display_label)) between 1 and 20),
  source_base_hole_id text,
  source_base_hole_number smallint check(source_base_hole_number is null or source_base_hole_number between 1 and 18),
  kind text not null check(kind in ('BASE','TEMPORARY')),
  playable boolean not null default true,
  par_override smallint check(par_override is null or par_override between 3 and 6),
  stroke_index_override smallint check(stroke_index_override is null or stroke_index_override between 1 and 18),
  notes text check(notes is null or length(notes)<=3000),
  temporary_green boolean not null default false,
  temporary_tee boolean not null default false,
  drop_zone_note text check(drop_zone_note is null or length(drop_zone_note)<=2000),
  operational_note text check(operational_note is null or length(operational_note)<=2000),
  unique(configuration_id,client_key),
  unique(configuration_id,sequence),
  unique(configuration_id,runtime_hole_number),
  constraint configuration_hole_source_check check (
    (kind='BASE' and source_base_hole_id is not null and source_base_hole_number is not null)
    or (kind='TEMPORARY' and par_override is not null and stroke_index_override is not null)
  )
);

create table public.course_configuration_tee_holes (
  configuration_hole_id uuid not null references public.course_configuration_holes(id) on delete cascade,
  tee_id text not null check(length(trim(tee_id)) between 1 and 240),
  yards_override integer check(yards_override is null or yards_override between 1 and 1000),
  source text check(source is null or length(trim(source)) between 1 and 500),
  verified_at timestamptz,
  primary key(configuration_hole_id,tee_id),
  constraint configuration_tee_hole_evidence_check check (yards_override is null or (source is not null and verified_at is not null))
);

create table public.course_configuration_ratings (
  configuration_id uuid not null references public.course_configurations(id) on delete cascade,
  tee_id text not null check(length(trim(tee_id)) between 1 and 240),
  rating numeric(5,2) not null check(rating between 20 and 100),
  slope smallint not null check(slope between 55 and 155),
  category text,
  source text not null check(length(trim(source)) between 1 and 500),
  verified_at timestamptz not null,
  notes text check(notes is null or length(notes)<=2000),
  primary key(configuration_id,tee_id)
);

create table public.course_local_rule_sets (
  id uuid primary key default gen_random_uuid(),
  course_id text not null check(length(trim(course_id)) between 1 and 240),
  title text not null check(length(trim(title)) between 1 and 240),
  version integer not null check(version>0),
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED','VERIFIED','PUBLISHED','SUPERSEDED','ARCHIVED')),
  effective_from timestamptz,
  effective_until timestamptz,
  source text not null check(length(trim(source)) between 1 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id,version)
);

create table public.course_local_rules (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.course_local_rule_sets(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 240),
  body text not null check(length(trim(body)) between 1 and 20000),
  short_summary text check(short_summary is null or length(short_summary)<=500),
  category text not null check(category in ('GENERAL','DROP_ZONE','PENALTY_AREA','GROUND_UNDER_REPAIR','PREFERRED_LIES','CART_PATH','TEMPORARY_GREEN','TEMPORARY_TEE','PACE_OF_PLAY','OTHER')),
  hole_refs smallint[] not null default array[]::smallint[] check(hole_refs <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]::smallint[]),
  display_order integer not null default 0,
  source_reference text check(source_reference is null or length(source_reference)<=1000),
  active boolean not null default true
);

create table public.admin_documents (
  id uuid primary key default gen_random_uuid(),
  owner_entity_type text not null check(owner_entity_type in ('COURSE','COURSE_CONFIGURATION','LOCAL_RULE_SET','CLUB_EQUIPMENT','BALL','SHAFT','COMPETITION','COMPETITION_RULE_SET','REQUEST')),
  owner_entity_id text not null check(length(trim(owner_entity_id)) between 1 and 240),
  scope_type text not null check(scope_type in ('GLOBAL','COURSE','COMPETITION','CATALOG')),
  scope_id text,
  storage_path text not null unique check(length(trim(storage_path)) between 3 and 1000),
  mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg','image/webp')),
  byte_size integer not null check(byte_size between 1 and 10485760),
  original_name text not null check(length(trim(original_name)) between 1 and 240),
  rights_status text not null default 'PENDING_RIGHTS' check(rights_status in ('NO_IMAGE','PENDING_RIGHTS','APPROVED','REJECTED')),
  source text check(source is null or length(source)<=1000),
  license text check(license is null or length(license)<=1000),
  rights_evidence text check(rights_evidence is null or length(rights_evidence)<=5000),
  attribution text check(attribution is null or length(attribution)<=1000),
  visibility text not null default 'ADMIN' check(visibility in ('ADMIN','PLAYER')),
  verified_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint admin_documents_scope_check check(
    (scope_type='GLOBAL' and scope_id is null) or (scope_type<>'GLOBAL' and length(trim(scope_id)) between 1 and 200)
  )
);

create table public.equipment_catalog_images (
  id uuid primary key default gen_random_uuid(),
  equipment_type text not null check(equipment_type in ('CLUB_EQUIPMENT','BALL','SHAFT')),
  equipment_id text not null check(length(trim(equipment_id)) between 1 and 240),
  document_id uuid not null references public.admin_documents(id) on delete restrict,
  status text not null default 'PENDING_RIGHTS' check(status in ('NO_IMAGE','PENDING_RIGHTS','APPROVED','REJECTED')),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(equipment_type,equipment_id,document_id)
);

create table public.competition_definitions (
  id uuid primary key default gen_random_uuid(),
  legacy_tournament_id uuid references public.tournaments(id) on delete restrict,
  name text not null check(length(trim(name)) between 1 and 240),
  type text not null check(type in ('POLLA','TOURNAMENT','LEAGUE','EVENT')),
  course_id text check(course_id is null or length(trim(course_id)) between 1 and 240),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED','VERIFIED','PUBLISHED','COMPLETED','CANCELLED','ARCHIVED')),
  organizer text check(organizer is null or length(organizer)<=500),
  visibility text not null default 'PRIVATE' check(visibility in ('PUBLIC','PRIVATE')),
  description text check(description is null or length(description)<=5000),
  settings jsonb not null default '{}' check(jsonb_typeof(settings)='object' and pg_column_size(settings)<=100000),
  created_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_dates_check check(ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table public.course_configurations
  add constraint course_configurations_competition_fk foreign key(competition_id) references public.competition_definitions(id) on delete restrict;

create table public.competition_rule_sets (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competition_definitions(id) on delete restrict,
  title text not null check(length(trim(title)) between 1 and 240),
  version integer not null check(version>0),
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED','VERIFIED','PUBLISHED','SUPERSEDED','ARCHIVED')),
  created_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(competition_id,version)
);

create table public.competition_rules (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.competition_rule_sets(id) on delete cascade,
  category text not null check(category in ('FORMAT','HANDICAP','SCORING','TIE_BREAK','PRIZE','CLOSEST_TO_PIN','PACE','LOCAL_EVENT_RULE','BETTING','CONDUCT','OTHER')),
  title text not null check(length(trim(title)) between 1 and 240),
  body text not null check(length(trim(body)) between 1 and 20000),
  engine_contract jsonb,
  display_order integer not null default 0,
  active boolean not null default true,
  constraint competition_rule_contract_check check(engine_contract is null or jsonb_typeof(engine_contract)='object')
);

create table public.admin_import_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('COURSE','CLUB_EQUIPMENT','BALL','SHAFT')),
  scope_type text not null check(scope_type in ('GLOBAL','COURSE','CATALOG')),
  scope_id text,
  status text not null default 'UPLOADED' check(status in ('UPLOADED','PARSED','VALIDATED','PREVIEWED','CONFIRMED','PUBLISHED','CANCELLED','FAILED')),
  source_document_id uuid references public.admin_documents(id) on delete restrict,
  source_format text not null check(source_format in ('CSV','JSON','XLSX_TEMPLATE')),
  summary jsonb not null default '{}' check(jsonb_typeof(summary)='object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  confirmed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_import_jobs_scope_check check(
    (scope_type='GLOBAL' and scope_id is null) or (scope_type<>'GLOBAL' and length(trim(scope_id)) between 1 and 200)
  )
);

create table public.admin_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.admin_import_jobs(id) on delete cascade,
  row_number integer not null check(row_number>0),
  status text not null check(status in ('NEW','UPDATE','POSSIBLE_DUPLICATE','INVALID','NO_CHANGE')),
  normalized_payload jsonb,
  existing_entity_id text,
  issues jsonb not null default '[]' check(jsonb_typeof(issues)='array'),
  unique(import_id,row_number)
);

create table public.admin_request_drafts (
  id uuid primary key default gen_random_uuid(),
  feedback_request_id uuid not null references public.feedback_requests(id) on delete restrict,
  entity_type text not null check(entity_type in ('COURSE','CLUB_EQUIPMENT','BALL','SHAFT','LOCAL_RULE_SET','COURSE_CONFIGURATION','REQUEST')),
  revision_id uuid references public.admin_catalog_revisions(id) on delete restrict,
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED','VERIFIED','PUBLISHED','ARCHIVED')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(feedback_request_id,entity_type)
);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  action text not null check(length(trim(action)) between 1 and 100),
  entity_type text not null check(length(trim(entity_type)) between 1 and 100),
  entity_id text not null check(length(trim(entity_id)) between 1 and 240),
  before_state jsonb,
  after_state jsonb,
  reason text check(reason is null or length(reason)<=2000),
  request_id uuid,
  created_at timestamptz not null default now()
);
create index admin_audit_log_entity_idx on public.admin_audit_log(entity_type,entity_id,created_at desc);
create index admin_audit_log_actor_idx on public.admin_audit_log(actor_id,created_at desc);

alter table public.round_course_snapshots
  add column if not exists base_course_id text,
  add column if not exists base_course_version integer,
  add column if not exists configuration_ids uuid[] not null default array[]::uuid[],
  add column if not exists configuration_hashes text[] not null default array[]::text[],
  add column if not exists competition_id uuid references public.competition_definitions(id) on delete restrict,
  add column if not exists competition_rule_set_id uuid references public.competition_rule_sets(id) on delete restrict,
  add column if not exists competition_rule_version integer;

-- Catalog facts added for Admin publication. Unknown remains NULL/empty and
-- archived records retain stable IDs for existing bags.
alter table public.golf_ball_catalog
  add column if not exists aliases text[] not null default array[]::text[],
  add column if not exists bag_eligible boolean not null default true,
  add column if not exists fit_eligible boolean not null default false,
  add column if not exists source_type text,
  add column if not exists confidence text,
  add column if not exists provenance jsonb not null default '[]' check(jsonb_typeof(provenance)='array'),
  add column if not exists catalog_version integer not null default 1,
  add column if not exists publication_revision_id uuid references public.admin_catalog_revisions(id) on delete restrict;
alter table public.golf_club_catalog
  add column if not exists aliases text[] not null default array[]::text[],
  add column if not exists bag_eligible boolean not null default true,
  add column if not exists fit_eligible boolean not null default false,
  add column if not exists set_makeup text,
  add column if not exists stock_shafts text[] not null default array[]::text[],
  add column if not exists stock_flexes text[] not null default array[]::text[],
  add column if not exists source_type text,
  add column if not exists confidence text,
  add column if not exists provenance jsonb not null default '[]' check(jsonb_typeof(provenance)='array'),
  add column if not exists catalog_version integer not null default 1,
  add column if not exists publication_revision_id uuid references public.admin_catalog_revisions(id) on delete restrict;
alter table public.golf_shaft_catalog
  add column if not exists aliases text[] not null default array[]::text[],
  add column if not exists usage text check(usage is null or usage in ('WOOD','FAIRWAY','HYBRID','UTILITY','IRON','WEDGE','PUTTER')),
  add column if not exists bag_eligible boolean not null default true,
  add column if not exists fit_eligible boolean not null default false,
  add column if not exists oem_stock_or_aftermarket text check(oem_stock_or_aftermarket is null or oem_stock_or_aftermarket in ('AFTERMARKET','OEM_STOCK')),
  add column if not exists weight_options numeric[] not null default array[]::numeric[],
  add column if not exists flex_options text[] not null default array[]::text[],
  add column if not exists torque_range numeric[] not null default array[]::numeric[],
  add column if not exists source_type text,
  add column if not exists confidence text,
  add column if not exists provenance jsonb not null default '[]' check(jsonb_typeof(provenance)='array'),
  add column if not exists catalog_version integer not null default 1,
  add column if not exists publication_revision_id uuid references public.admin_catalog_revisions(id) on delete restrict;

-- RLS: drafts are visible only inside the matching administrative scope.
do $$ declare table_name text; begin
  foreach table_name in array array[
    'admin_catalog_revisions','course_configurations','course_configuration_holes',
    'course_configuration_tee_holes','course_configuration_ratings','course_local_rule_sets',
    'course_local_rules','admin_documents','equipment_catalog_images','competition_definitions',
    'competition_rule_sets','competition_rules','admin_import_jobs','admin_import_rows',
    'admin_request_drafts','admin_audit_log'
  ] loop execute format('alter table public.%I enable row level security',table_name); end loop;
end $$;

revoke all on public.admin_catalog_revisions,public.course_configurations,public.course_configuration_holes,
  public.course_configuration_tee_holes,public.course_configuration_ratings,public.course_local_rule_sets,
  public.course_local_rules,public.admin_documents,public.equipment_catalog_images,public.competition_definitions,
  public.competition_rule_sets,public.competition_rules,public.admin_import_jobs,public.admin_import_rows,
  public.admin_request_drafts,public.admin_audit_log from public,anon,authenticated;
grant select,insert,update on public.admin_catalog_revisions,public.course_configurations,public.course_configuration_holes,
  public.course_configuration_tee_holes,public.course_configuration_ratings,
  public.admin_documents,public.equipment_catalog_images,public.admin_import_jobs,public.admin_import_rows,
  public.admin_request_drafts to authenticated;
grant select on public.course_local_rule_sets,public.course_local_rules,public.competition_definitions,
  public.competition_rule_sets,public.competition_rules to authenticated;
grant select on public.admin_audit_log to authenticated;
grant usage,select on sequence public.admin_audit_log_id_seq to service_role;

create policy admin_revision_read on public.admin_catalog_revisions for select to authenticated
using(status='PUBLISHED' or private.admin_has_scope_v1(entity_type,scope_type,scope_id,'READ'));
create policy admin_revision_insert on public.admin_catalog_revisions for insert to authenticated
with check(status='DRAFT' and created_by=(select auth.uid()) and private.admin_has_scope_v1(entity_type,scope_type,scope_id,'CREATE_DRAFT'));
create policy admin_revision_update on public.admin_catalog_revisions for update to authenticated
using(private.admin_has_scope_v1(entity_type,scope_type,scope_id,'READ'))
with check(private.admin_has_scope_v1(entity_type,scope_type,scope_id,'CREATE_DRAFT'));

create policy course_configuration_admin_read on public.course_configurations for select to authenticated
using(private.admin_has_scope_v1('COURSE_CONFIGURATION',scope_type,case when scope_type='COURSE' then course_id else competition_id::text end,'READ'));
create policy course_configuration_admin_insert on public.course_configurations for insert to authenticated
with check(status='DRAFT' and created_by=(select auth.uid()) and private.admin_has_scope_v1('COURSE_CONFIGURATION',scope_type,case when scope_type='COURSE' then course_id else competition_id::text end,'CREATE_DRAFT'));
create policy course_configuration_admin_update on public.course_configurations for update to authenticated
using(private.admin_has_scope_v1('COURSE_CONFIGURATION',scope_type,case when scope_type='COURSE' then course_id else competition_id::text end,'READ'))
with check(private.admin_has_scope_v1('COURSE_CONFIGURATION',scope_type,case when scope_type='COURSE' then course_id else competition_id::text end,'CREATE_DRAFT'));
create policy course_configuration_player_read on public.course_configurations for select to authenticated
using(status in ('SCHEDULED','PUBLISHED') and (effective_from is null or effective_from<=now()) and (effective_until is null or effective_until>now()));

create policy course_configuration_holes_access on public.course_configuration_holes for select to authenticated
using(exists(select 1 from public.course_configurations c where c.id=configuration_id));
create policy course_configuration_holes_admin_write on public.course_configuration_holes for all to authenticated
using(exists(select 1 from public.course_configurations c where c.id=configuration_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'READ')))
with check(exists(select 1 from public.course_configurations c where c.id=configuration_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'CREATE_DRAFT')));
create policy course_configuration_tee_holes_access on public.course_configuration_tee_holes for select to authenticated
using(exists(select 1 from public.course_configuration_holes h join public.course_configurations c on c.id=h.configuration_id where h.id=configuration_hole_id));
create policy course_configuration_tee_holes_admin_write on public.course_configuration_tee_holes for all to authenticated
using(exists(select 1 from public.course_configuration_holes h join public.course_configurations c on c.id=h.configuration_id where h.id=configuration_hole_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'READ')))
with check(exists(select 1 from public.course_configuration_holes h join public.course_configurations c on c.id=h.configuration_id where h.id=configuration_hole_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'CREATE_DRAFT')));
create policy course_configuration_ratings_access on public.course_configuration_ratings for select to authenticated
using(exists(select 1 from public.course_configurations c where c.id=configuration_id));
create policy course_configuration_ratings_admin_write on public.course_configuration_ratings for all to authenticated
using(exists(select 1 from public.course_configurations c where c.id=configuration_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'READ')))
with check(exists(select 1 from public.course_configurations c where c.id=configuration_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'CREATE_DRAFT')));

create policy local_rule_set_read on public.course_local_rule_sets for select to authenticated
using(status='PUBLISHED' or private.admin_has_scope_v1('LOCAL_RULE_SET','COURSE',course_id,'READ'));
create policy local_rule_set_write on public.course_local_rule_sets for all to authenticated
using(private.admin_has_scope_v1('LOCAL_RULE_SET','COURSE',course_id,'READ'))
with check(created_by=(select auth.uid()) and private.admin_has_scope_v1('LOCAL_RULE_SET','COURSE',course_id,'CREATE_DRAFT'));
create policy local_rule_read on public.course_local_rules for select to authenticated
using(exists(select 1 from public.course_local_rule_sets s where s.id=rule_set_id));
create policy local_rule_write on public.course_local_rules for all to authenticated
using(exists(select 1 from public.course_local_rule_sets s where s.id=rule_set_id and private.admin_has_scope_v1('LOCAL_RULE_SET','COURSE',s.course_id,'READ')))
with check(exists(select 1 from public.course_local_rule_sets s where s.id=rule_set_id and private.admin_has_scope_v1('LOCAL_RULE_SET','COURSE',s.course_id,'CREATE_DRAFT')));

create policy competition_read on public.competition_definitions for select to authenticated
using((status='PUBLISHED' and visibility='PUBLIC') or private.admin_has_scope_v1('COMPETITION','COMPETITION',id::text,'READ'));
create policy competition_write on public.competition_definitions for all to authenticated
using(private.admin_has_scope_v1('COMPETITION','COMPETITION',id::text,'READ'))
with check(created_by=(select auth.uid()) and private.admin_has_scope_v1('COMPETITION','COMPETITION',id::text,'CREATE_DRAFT'));
create policy competition_rule_set_read on public.competition_rule_sets for select to authenticated
using(status='PUBLISHED' or private.admin_has_scope_v1('COMPETITION_RULE_SET','COMPETITION',competition_id::text,'READ'));
create policy competition_rule_set_write on public.competition_rule_sets for all to authenticated
using(private.admin_has_scope_v1('COMPETITION_RULE_SET','COMPETITION',competition_id::text,'READ'))
with check(created_by=(select auth.uid()) and private.admin_has_scope_v1('COMPETITION_RULE_SET','COMPETITION',competition_id::text,'CREATE_DRAFT'));
create policy competition_rule_read on public.competition_rules for select to authenticated
using(exists(select 1 from public.competition_rule_sets s where s.id=rule_set_id));
create policy competition_rule_write on public.competition_rules for all to authenticated
using(exists(select 1 from public.competition_rule_sets s where s.id=rule_set_id and private.admin_has_scope_v1('COMPETITION_RULE_SET','COMPETITION',s.competition_id::text,'READ')))
with check(exists(select 1 from public.competition_rule_sets s where s.id=rule_set_id and private.admin_has_scope_v1('COMPETITION_RULE_SET','COMPETITION',s.competition_id::text,'CREATE_DRAFT')));

create policy admin_documents_scope on public.admin_documents for select to authenticated
using((visibility='PLAYER' and rights_status='APPROVED') or private.admin_has_scope_v1(owner_entity_type,scope_type,scope_id,'READ'));
create policy admin_documents_write on public.admin_documents for all to authenticated
using(private.admin_has_scope_v1(owner_entity_type,scope_type,scope_id,'READ'))
with check(created_by=(select auth.uid()) and private.admin_has_scope_v1(owner_entity_type,scope_type,scope_id,'CREATE_DRAFT'));
create policy equipment_images_read on public.equipment_catalog_images for select to authenticated
using(status='APPROVED' or private.admin_has_scope_v1('EQUIPMENT_IMAGE','CATALOG','equipment','READ'));
create policy equipment_images_write on public.equipment_catalog_images for all to authenticated
using(private.admin_has_scope_v1('EQUIPMENT_IMAGE','CATALOG','equipment','READ'))
with check(private.admin_has_scope_v1('EQUIPMENT_IMAGE','CATALOG','equipment','CREATE_DRAFT'));

create policy import_jobs_scope on public.admin_import_jobs for all to authenticated
using(private.admin_has_scope_v1('IMPORT',scope_type,scope_id,'READ'))
with check(created_by=(select auth.uid()) and private.admin_has_scope_v1('IMPORT',scope_type,scope_id,'CREATE_DRAFT'));
create policy import_rows_scope on public.admin_import_rows for all to authenticated
using(exists(select 1 from public.admin_import_jobs j where j.id=import_id and private.admin_has_scope_v1('IMPORT',j.scope_type,j.scope_id,'READ')))
with check(exists(select 1 from public.admin_import_jobs j where j.id=import_id and private.admin_has_scope_v1('IMPORT',j.scope_type,j.scope_id,'CREATE_DRAFT')));

create policy request_drafts_scope on public.admin_request_drafts for all to authenticated
using(private.admin_has_scope_v1('REQUEST','GLOBAL',null,'READ'))
with check(created_by=(select auth.uid()) and private.admin_has_scope_v1('REQUEST','GLOBAL',null,'CREATE_DRAFT'));
create policy audit_admin_read on public.admin_audit_log for select to authenticated
using(private.admin_has_scope_v1('REQUEST','GLOBAL',null,'AUDIT'));

-- Canonical seed tables intentionally receive no new client write grants.
-- Publication is represented by immutable admin_catalog_revisions and consumed
-- through the layered providers, so a bearer token cannot bypass Preview/Diff.

-- Private document bucket; executable formats are deliberately absent.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('admin-documents-private','admin-documents-private',false,10485760,array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy admin_documents_storage_read on storage.objects for select to authenticated
using(bucket_id='admin-documents-private' and exists(
  select 1 from public.admin_documents d where d.storage_path=name
    and ((d.visibility='PLAYER' and d.rights_status='APPROVED') or private.admin_has_scope_v1(d.owner_entity_type,d.scope_type,d.scope_id,'READ'))
));
create policy admin_documents_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='admin-documents-private' and (storage.foldername(name))[1]=(select auth.uid())::text
  and private.admin_has_any_membership_v1());
create policy admin_documents_storage_delete_own on storage.objects for delete to authenticated
using(bucket_id='admin-documents-private' and (storage.foldername(name))[1]=(select auth.uid())::text
  and private.admin_has_any_membership_v1());

comment on table public.admin_memberships is 'Server-authoritative administrative roles. Never derive from user-editable metadata.';
comment on table public.admin_catalog_revisions is 'Draft/review/verified/published revision ledger. Player catalogs read only canonical published projections.';
comment on table public.admin_audit_log is 'Append-only administrative audit. Client roles have no INSERT/UPDATE/DELETE grants.';
comment on table public.course_configurations is 'Versioned temporary course operations. Published changes affect future round snapshots only.';

commit;

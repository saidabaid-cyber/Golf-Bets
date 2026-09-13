-- Group presets and immutable round provenance. Additive only.
-- Apply only to an authorized isolated Preview database after RLS review.
begin;

create table if not exists public.group_bet_templates_v2 (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups_v2(id) on delete cascade,
  local_template_id text not null check (length(trim(local_template_id)) between 1 and 200),
  bet_type text not null check (length(trim(bet_type)) between 1 and 80),
  label text not null default '' check (length(label) <= 120),
  enabled boolean not null default true,
  stake numeric(12,2) check (stake is null or stake >= 0),
  mode text check (mode is null or length(mode) <= 80),
  handicap_percent numeric(5,2) check (handicap_percent is null or handicap_percent between 0 and 100),
  handicap_basis text check (handicap_basis is null or handicap_basis in ('relative', 'course')),
  pressure_multiplier smallint check (pressure_multiplier is null or pressure_multiplier between 1 and 5),
  animal_determination_mode text check (animal_determination_mode is null or animal_determination_mode in ('last_event', 'most_events')),
  animal_tie_rule text check (animal_tie_rule is null or animal_tie_rule in ('tied_players_pay', 'latest_tied_event')),
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, local_template_id)
);
create index if not exists group_bet_templates_v2_group_idx on public.group_bet_templates_v2(group_id, updated_at desc);

create table if not exists public.group_bet_template_participants_v2 (
  bet_template_id uuid not null references public.group_bet_templates_v2(id) on delete cascade,
  membership_id uuid not null references public.group_memberships_v2(id) on delete cascade,
  participation_role text not null default 'PLAYER' check (participation_role in ('PLAYER', 'OWNER', 'RIVAL')),
  position smallint not null default 0 check (position >= 0),
  primary key (bet_template_id, membership_id)
);

create table if not exists public.group_team_templates_v2 (
  id uuid primary key default gen_random_uuid(),
  bet_template_id uuid not null references public.group_bet_templates_v2(id) on delete cascade,
  team_key text not null check (length(trim(team_key)) between 1 and 40),
  position smallint not null default 0 check (position >= 0),
  unique (bet_template_id, team_key)
);

create table if not exists public.group_team_template_members_v2 (
  team_template_id uuid not null references public.group_team_templates_v2(id) on delete cascade,
  membership_id uuid not null references public.group_memberships_v2(id) on delete cascade,
  position smallint not null default 0 check (position >= 0),
  primary key (team_template_id, membership_id)
);

create table if not exists public.round_group_snapshots_v2 (
  round_id uuid primary key references public.rounds_cloud(id) on delete cascade,
  source_group_id uuid references public.groups_v2(id) on delete set null,
  source_group_name text not null check (length(trim(source_group_name)) between 1 and 100),
  source_group_version bigint not null check (source_group_version >= 1),
  selected_player_count smallint not null check (selected_player_count between 1 and 5),
  captured_at timestamptz not null default now()
);

create table if not exists public.round_group_snapshot_players_v2 (
  round_id uuid not null references public.round_group_snapshots_v2(round_id) on delete cascade,
  round_player_id uuid not null references public.round_players_cloud(id) on delete cascade,
  source_membership_id uuid references public.group_memberships_v2(id) on delete set null,
  display_name_snapshot text not null check (length(trim(display_name_snapshot)) between 1 and 120),
  position smallint not null check (position between 0 and 4),
  primary key (round_id, round_player_id),
  unique (round_id, position)
);

alter table public.group_bet_templates_v2 enable row level security;
alter table public.group_bet_template_participants_v2 enable row level security;
alter table public.group_team_templates_v2 enable row level security;
alter table public.group_team_template_members_v2 enable row level security;
alter table public.round_group_snapshots_v2 enable row level security;
alter table public.round_group_snapshot_players_v2 enable row level security;

create policy group_bet_templates_v2_member_read on public.group_bet_templates_v2 for select to authenticated
using (private.is_group_member(group_id));
create policy group_bet_templates_v2_manager_insert on public.group_bet_templates_v2 for insert to authenticated
with check (private.is_group_manager(group_id));
create policy group_bet_templates_v2_manager_update on public.group_bet_templates_v2 for update to authenticated
using (private.is_group_manager(group_id)) with check (private.is_group_manager(group_id));
create policy group_bet_templates_v2_manager_delete on public.group_bet_templates_v2 for delete to authenticated
using (private.is_group_manager(group_id));

create policy group_bet_participants_v2_member_read on public.group_bet_template_participants_v2 for select to authenticated
using (exists (select 1 from public.group_bet_templates_v2 template where template.id = bet_template_id and private.is_group_member(template.group_id)));
create policy group_bet_participants_v2_manager_write on public.group_bet_template_participants_v2 for all to authenticated
using (exists (select 1 from public.group_bet_templates_v2 template where template.id = bet_template_id and private.is_group_manager(template.group_id)))
with check (exists (select 1 from public.group_bet_templates_v2 template where template.id = bet_template_id and private.is_group_manager(template.group_id)));

create policy group_team_templates_v2_member_read on public.group_team_templates_v2 for select to authenticated
using (exists (select 1 from public.group_bet_templates_v2 template where template.id = bet_template_id and private.is_group_member(template.group_id)));
create policy group_team_templates_v2_manager_write on public.group_team_templates_v2 for all to authenticated
using (exists (select 1 from public.group_bet_templates_v2 template where template.id = bet_template_id and private.is_group_manager(template.group_id)))
with check (exists (select 1 from public.group_bet_templates_v2 template where template.id = bet_template_id and private.is_group_manager(template.group_id)));

create policy group_team_members_v2_member_read on public.group_team_template_members_v2 for select to authenticated
using (exists (
  select 1 from public.group_team_templates_v2 team
  join public.group_bet_templates_v2 template on template.id = team.bet_template_id
  where team.id = team_template_id and private.is_group_member(template.group_id)
));
create policy group_team_members_v2_manager_write on public.group_team_template_members_v2 for all to authenticated
using (exists (
  select 1 from public.group_team_templates_v2 team
  join public.group_bet_templates_v2 template on template.id = team.bet_template_id
  where team.id = team_template_id and private.is_group_manager(template.group_id)
)) with check (exists (
  select 1 from public.group_team_templates_v2 team
  join public.group_bet_templates_v2 template on template.id = team.bet_template_id
  where team.id = team_template_id and private.is_group_manager(template.group_id)
));

create policy round_group_snapshots_v2_owner_read on public.round_group_snapshots_v2 for select to authenticated
using (exists (select 1 from public.rounds_cloud round where round.id = round_id and round.owner_id = (select auth.uid())));
create policy round_group_snapshots_v2_owner_insert on public.round_group_snapshots_v2 for insert to authenticated
with check (exists (select 1 from public.rounds_cloud round where round.id = round_id and round.owner_id = (select auth.uid())));
create policy round_group_snapshot_players_v2_owner_read on public.round_group_snapshot_players_v2 for select to authenticated
using (exists (select 1 from public.rounds_cloud round where round.id = round_id and round.owner_id = (select auth.uid())));
create policy round_group_snapshot_players_v2_owner_insert on public.round_group_snapshot_players_v2 for insert to authenticated
with check (exists (select 1 from public.rounds_cloud round where round.id = round_id and round.owner_id = (select auth.uid())));
revoke all on table public.group_bet_templates_v2, public.group_bet_template_participants_v2,
  public.group_team_templates_v2, public.group_team_template_members_v2,
  public.round_group_snapshots_v2, public.round_group_snapshot_players_v2 from anon;
grant select, insert, update, delete on table public.group_bet_templates_v2,
  public.group_bet_template_participants_v2, public.group_team_templates_v2,
  public.group_team_template_members_v2 to authenticated;
grant select, insert on table public.round_group_snapshots_v2,
  public.round_group_snapshot_players_v2 to authenticated;

comment on table public.group_bet_templates_v2 is 'Mutable group-level bet presets. Round calculations must never read this table after a round starts.';
comment on table public.round_group_snapshots_v2 is 'Immutable provenance for a round created from a group; playable players/bets remain frozen in round snapshot tables.';

commit;

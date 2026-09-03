create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
-- Supabase installs pgcrypto outside public. This also resolves SQL-language
-- function bodies while a fresh database is installing this migration.
set search_path = public, extensions;

create type public.tournament_status as enum ('upcoming', 'live', 'finished');
create type public.tournament_role as enum ('admin', 'scorer', 'viewer');
create type public.card_status as enum ('open', 'confirmed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  handicap numeric(5,1),
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  handicap numeric(5,1) not null default 0 check (handicap between -15 and 54),
  created_at timestamptz not null default now()
);

create table public.courses_cloud (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.course_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses_cloud(id) on delete cascade,
  version integer not null,
  holes jsonb not null check (jsonb_array_length(holes) = 18),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(course_id, version)
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  short_code text not null unique check (length(short_code) between 4 and 10),
  created_by uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 160),
  tournament_date date not null,
  course_name text not null,
  course_snapshot jsonb not null,
  holes smallint not null check (holes in (9, 18)),
  start_hole smallint not null check (start_hole in (1, 10)),
  format text not null check (format in ('gross', 'net', 'both')),
  hcp_pct smallint not null default 100 check (hcp_pct between 0 and 100),
  handicap_mode text not null default 'half_up',
  local_rules text not null default '',
  oyes_holes smallint[] not null default '{}',
  status public.tournament_status not null default 'upcoming',
  public_leaderboard boolean not null default true,
  stale_minutes integer not null default 20 check (stale_minutes between 5 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tournament_groups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  tee_time time,
  start_hole smallint not null default 1 check (start_hole in (1, 10)),
  status public.card_status not null default 'open',
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),
  last_score_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tournament_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null,
  handicap numeric(5,1) not null default 0 check (handicap between -15 and 54),
  pin_hash text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(tournament_id, id)
);

create table public.group_members (
  group_id uuid not null references public.tournament_groups(id) on delete cascade,
  tournament_player_id uuid not null references public.tournament_players(id) on delete cascade,
  is_scorer boolean not null default false,
  primary key(group_id, tournament_player_id)
);

create table public.tournament_access (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  group_id uuid references public.tournament_groups(id) on delete cascade,
  tournament_player_id uuid references public.tournament_players(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role public.tournament_role not null,
  token_hash text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tournament_scores (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  group_id uuid not null references public.tournament_groups(id) on delete cascade,
  player_id uuid not null references public.tournament_players(id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  score smallint not null check (score between 1 and 20),
  entered_by uuid references auth.users(id),
  access_id uuid references public.tournament_access(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(tournament_id, player_id, hole)
);

create table public.score_audit_log (
  id bigint generated always as identity primary key,
  tournament_id uuid not null,
  group_id uuid not null,
  player_id uuid not null,
  hole smallint not null,
  old_score smallint,
  new_score smallint not null,
  changed_by uuid,
  access_id uuid,
  reason text,
  changed_at timestamptz not null default now()
);

create table public.tournament_prizes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  position integer not null check (position > 0),
  category text not null check (category in ('gross', 'net', 'other')),
  money numeric(12,2),
  percentage numeric(5,2),
  description text,
  unique(tournament_id, category, position)
);

create table public.tournament_oyes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  player_id uuid not null references public.tournament_players(id) on delete cascade,
  distance_meters numeric(8,3) not null check (distance_meters >= 0),
  entered_by uuid references auth.users(id),
  access_id uuid references public.tournament_access(id),
  created_at timestamptz not null default now()
);

create table public.tournament_invites (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  code_hash text not null,
  role public.tournament_role not null default 'viewer',
  group_id uuid references public.tournament_groups(id) on delete cascade,
  expires_at timestamptz,
  uses integer not null default 0,
  max_uses integer,
  created_at timestamptz not null default now()
);

create table public.rounds_cloud (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  local_round_id text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(owner_id, local_round_id)
);
create table public.round_players_cloud (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds_cloud(id) on delete cascade,
  name text not null,
  handicap numeric(5,1)
);
create table public.round_scores_cloud (
  round_player_id uuid not null references public.round_players_cloud(id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  score smallint not null check (score between 1 and 20),
  primary key(round_player_id, hole)
);
create table public.shared_round_links (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds_cloud(id) on delete cascade,
  public_id uuid not null default gen_random_uuid() unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index tournament_scores_tournament_group_idx on public.tournament_scores(tournament_id, group_id);
create index tournament_scores_player_idx on public.tournament_scores(player_id, hole);
create index tournament_groups_activity_idx on public.tournament_groups(tournament_id, last_score_at);
create index tournament_access_token_idx on public.tournament_access(token_hash) where revoked_at is null;

create or replace function public.audit_score_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.score is distinct from new.score then
    insert into public.score_audit_log(tournament_id, group_id, player_id, hole, old_score, new_score, changed_by, access_id)
    values(new.tournament_id, new.group_id, new.player_id, new.hole, case when tg_op = 'UPDATE' then old.score end, new.score, new.entered_by, new.access_id);
  end if;
  update public.tournament_groups set last_score_at = now() where id = new.group_id;
  return new;
end $$;
create trigger tournament_score_audit after insert or update on public.tournament_scores for each row execute function public.audit_score_change();

create or replace function public.join_polla(p_public_id uuid, p_player_id uuid, p_pin text)
returns table(access_token text, tournament_id uuid, group_id uuid, role public.tournament_role, player_name text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_player public.tournament_players%rowtype;
  v_group uuid;
  v_is_scorer boolean;
  v_token text;
begin
  select tp.* into v_player from public.tournament_players tp
  join public.tournaments t on t.id = tp.tournament_id
  where t.public_id = p_public_id and tp.id = p_player_id;
  if v_player.id is null or v_player.pin_hash is null or crypt(p_pin, v_player.pin_hash) <> v_player.pin_hash then
    raise exception 'invalid_access';
  end if;
  select gm.group_id, gm.is_scorer into v_group, v_is_scorer from public.group_members gm where gm.tournament_player_id = v_player.id limit 1;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.tournament_access(tournament_id, group_id, tournament_player_id, role, token_hash, expires_at)
  values(v_player.tournament_id, v_group, v_player.id, case when v_is_scorer then 'scorer'::public.tournament_role else 'viewer'::public.tournament_role end, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '14 days');
  return query select v_token, v_player.tournament_id, v_group, case when v_is_scorer then 'scorer'::public.tournament_role else 'viewer'::public.tournament_role end, v_player.name;
end $$;

create or replace function public.add_tournament_player(
  p_tournament_id uuid,
  p_group_id uuid,
  p_name text,
  p_handicap numeric,
  p_pin text,
  p_is_scorer boolean default false
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_player_id uuid;
begin
  insert into public.tournament_players(tournament_id, name, handicap, pin_hash)
  values(p_tournament_id, trim(p_name), p_handicap, crypt(p_pin, gen_salt('bf')))
  returning id into v_player_id;
  insert into public.group_members(group_id, tournament_player_id, is_scorer)
  values(p_group_id, v_player_id, p_is_scorer);
  return v_player_id;
end $$;

create or replace function public.resolve_polla_access(p_token text)
returns table(access_id uuid, tournament_id uuid, group_id uuid, role public.tournament_role)
language sql security definer stable set search_path = public, extensions as $$
  select id, tournament_id, group_id, role from public.tournament_access
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and revoked_at is null and (expires_at is null or expires_at > now())
  limit 1
$$;

revoke all on function public.join_polla(uuid, uuid, text) from public;
grant execute on function public.join_polla(uuid, uuid, text) to anon, authenticated;
revoke all on function public.add_tournament_player(uuid, uuid, text, numeric, text, boolean) from public;
grant execute on function public.add_tournament_player(uuid, uuid, text, numeric, text, boolean) to service_role;
revoke all on function public.resolve_polla_access(text) from public;
grant execute on function public.resolve_polla_access(text) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.courses_cloud enable row level security;
alter table public.course_versions enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_groups enable row level security;
alter table public.tournament_players enable row level security;
alter table public.group_members enable row level security;
alter table public.tournament_access enable row level security;
alter table public.tournament_scores enable row level security;
alter table public.score_audit_log enable row level security;
alter table public.tournament_prizes enable row level security;
alter table public.tournament_oyes enable row level security;
alter table public.tournament_invites enable row level security;
alter table public.rounds_cloud enable row level security;
alter table public.round_players_cloud enable row level security;
alter table public.round_scores_cloud enable row level security;
alter table public.shared_round_links enable row level security;

create policy profiles_self on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy players_owner on public.players for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy courses_owner on public.courses_cloud for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy course_versions_owner on public.course_versions for all to authenticated
using (exists(select 1 from public.courses_cloud c where c.id = course_id and c.owner_id = auth.uid()))
with check (exists(select 1 from public.courses_cloud c where c.id = course_id and c.owner_id = auth.uid()));
create policy tournaments_admin on public.tournaments for all to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy groups_admin on public.tournament_groups for all to authenticated using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid())) with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid()));
create policy tournament_players_admin on public.tournament_players for all to authenticated using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid())) with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid()));
create policy group_members_admin on public.group_members for all to authenticated using (exists(select 1 from public.tournament_groups g join public.tournaments t on t.id = g.tournament_id where g.id = group_id and t.created_by = auth.uid())) with check (exists(select 1 from public.tournament_groups g join public.tournaments t on t.id = g.tournament_id where g.id = group_id and t.created_by = auth.uid()));
create policy scores_admin on public.tournament_scores for all to authenticated using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid())) with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid()));
create policy audit_admin_read on public.score_audit_log for select to authenticated using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid()));
create policy access_admin on public.tournament_access for select to authenticated using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid()) or user_id = auth.uid());
create policy prizes_admin on public.tournament_prizes for all to authenticated using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid())) with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid()));
create policy oyes_admin on public.tournament_oyes for all to authenticated using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid())) with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid()));
create policy invites_admin on public.tournament_invites for all to authenticated using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid())) with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid()));
create policy rounds_owner on public.rounds_cloud for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy round_players_owner on public.round_players_cloud for all to authenticated using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid())) with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid()));
create policy round_scores_owner on public.round_scores_cloud for all to authenticated using (exists(select 1 from public.round_players_cloud rp join public.rounds_cloud r on r.id = rp.round_id where rp.id = round_player_id and r.owner_id = auth.uid())) with check (exists(select 1 from public.round_players_cloud rp join public.rounds_cloud r on r.id = rp.round_id where rp.id = round_player_id and r.owner_id = auth.uid()));
create policy shared_links_owner on public.shared_round_links for all to authenticated using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid())) with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid()));

do $$ begin
  alter publication supabase_realtime add table public.tournament_scores;
  alter publication supabase_realtime add table public.tournament_groups;
exception when duplicate_object then null;
end $$;

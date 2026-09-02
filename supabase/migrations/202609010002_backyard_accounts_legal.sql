-- The Backyard Account: profile extensions, consent and preferences.
-- This migration is additive and preserves the existing Golf Bets / Polla Live schema.

alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists default_handicap numeric(5,1);

update public.profiles
set display_name = coalesce(display_name, name),
    avatar_url = coalesce(avatar_url, photo_url),
    default_handicap = coalesce(default_handicap, handicap)
where display_name is null or avatar_url is null or default_handicap is null;

-- Keep Auth as the email source of truth and create only the public profile fields.
insert into public.profiles (id, name, display_name, avatar_url, default_handicap)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name', split_part(coalesce(users.email, ''), '@', 1), ''),
  coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name', split_part(coalesce(users.email, ''), '@', 1), 'Jugador'),
  coalesce(users.raw_user_meta_data ->> 'avatar_url', users.raw_user_meta_data ->> 'picture'),
  null
from auth.users as users
on conflict (id) do nothing;

create or replace function public.handle_backyard_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), 'Jugador'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_backyard_profile on auth.users;
create trigger on_auth_user_created_backyard_profile
after insert on auth.users
for each row execute function public.handle_backyard_user_profile();

create table if not exists public.legal_documents (
  type text not null check (type in ('terms', 'privacy', 'rules_referee', 'age_confirmation')),
  version text not null,
  locale text not null default 'es-MX',
  effective_at timestamptz not null,
  document_path text,
  created_at timestamptz not null default now(),
  primary key (type, version, locale)
);

create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('terms', 'privacy', 'rules_referee', 'age_confirmation')),
  version text not null,
  accepted_at timestamptz not null,
  locale text not null default 'es-MX',
  created_at timestamptz not null default now(),
  unique (user_id, type, version)
);

create table if not exists public.rules_referee_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_version text not null,
  accepted_at timestamptz not null,
  locale text not null default 'es-MX',
  created_at timestamptz not null default now(),
  unique (user_id, document_version)
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  high_contrast boolean not null default false,
  locale text not null default 'es-MX',
  default_handicap numeric(5,1),
  notifications_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_data_migrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_fingerprint text not null,
  status text not null check (status in ('requested', 'completed', 'skipped', 'failed')),
  imported_round_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_fingerprint)
);

alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.rules_referee_acceptances enable row level security;
alter table public.user_preferences enable row level security;
alter table public.account_data_migrations enable row level security;

drop policy if exists "legal_documents_read" on public.legal_documents;
create policy "legal_documents_read" on public.legal_documents for select using (true);

drop policy if exists "legal_acceptances_self_read" on public.legal_acceptances;
create policy "legal_acceptances_self_read" on public.legal_acceptances for select using (auth.uid() = user_id);
drop policy if exists "legal_acceptances_self_insert" on public.legal_acceptances;
create policy "legal_acceptances_self_insert" on public.legal_acceptances for insert with check (auth.uid() = user_id);

drop policy if exists "rules_referee_self_read" on public.rules_referee_acceptances;
create policy "rules_referee_self_read" on public.rules_referee_acceptances for select using (auth.uid() = user_id);
drop policy if exists "rules_referee_self_insert" on public.rules_referee_acceptances;
create policy "rules_referee_self_insert" on public.rules_referee_acceptances for insert with check (auth.uid() = user_id);

drop policy if exists "user_preferences_self" on public.user_preferences;
create policy "user_preferences_self" on public.user_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "account_migrations_self" on public.account_data_migrations;
create policy "account_migrations_self" on public.account_data_migrations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.legal_documents (type, version, locale, effective_at, document_path)
values
  ('terms', '2026-09-01-v1', 'es-MX', '2026-09-01T00:00:00-06:00', '/legal/terms'),
  ('privacy', '2026-09-01-v1', 'es-MX', '2026-09-01T00:00:00-06:00', '/legal/privacy'),
  ('rules_referee', '2026-09-01-v1', 'es-MX', '2026-09-01T00:00:00-06:00', '/legal/terms'),
  ('age_confirmation', '2026-09-01-v1', 'es-MX', '2026-09-01T00:00:00-06:00', '/legal/terms')
on conflict do nothing;

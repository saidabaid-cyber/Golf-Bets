-- The Backyard legal hotfix 2026-09-08.
-- Additive only: the legacy legal_acceptances table and its historical rows
-- remain untouched because production and beta currently share this project.

begin;

alter table public.legal_documents
  add column if not exists content_hash text;

insert into public.legal_documents (type, version, locale, effective_at, document_path, content_hash)
values
  ('terms', '2026-09-08-v2', 'es-MX', '2026-09-08T00:00:00-06:00', '/legal/terms', 'cf401c0d71d0cbb79e859538dda41f433e8959d8cfbab6ddf3d22d7a20fb461f'),
  ('privacy', '2026-09-08-v6+sha256-c441091d44899e8b', 'es-MX', '2026-09-08T00:00:00-06:00', '/legal/privacy', 'c441091d44899e8b84e6dff1edd68e99cf377c60ddf9c824ff046a9a8aa78780')
on conflict (type, version, locale) do update
set document_path = excluded.document_path,
    content_hash = excluded.content_hash;

create table if not exists public.legal_evidence_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('production', 'preview', 'development', 'test')),
  deployment_ref text,
  document_key text not null check (document_key in ('terms', 'privacy_integral', 'privacy_simplified')),
  purpose_key text not null check (purpose_key in ('terms', 'privacy_notice', 'age_declaration', 'financial_data', 'marketing', 'rules_referee')),
  document_version text not null check (length(trim(document_version)) > 0),
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  statement_key text not null check (length(trim(statement_key)) > 0),
  statement_text text not null check (length(trim(statement_text)) > 0),
  statement_hash text not null check (statement_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('presented', 'accepted', 'rejected', 'revoked')),
  locale text not null default 'es-MX',
  origin text not null check (length(trim(origin)) between 1 and 80),
  client_occurred_at timestamptz,
  server_received_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (user_id, environment, idempotency_key),
  check (
    (purpose_key = 'privacy_notice' and action = 'presented')
    or (purpose_key <> 'privacy_notice' and action in ('accepted', 'rejected', 'revoked'))
  )
);

create index if not exists legal_evidence_events_user_env_received_idx
  on public.legal_evidence_events (user_id, environment, server_received_at desc);

alter table public.legal_evidence_events enable row level security;

revoke all on table public.legal_evidence_events from public, anon, authenticated, service_role;
grant select on table public.legal_evidence_events to authenticated;
grant select, insert on table public.legal_evidence_events to service_role;

drop policy if exists legal_evidence_events_self_read on public.legal_evidence_events;
create policy legal_evidence_events_self_read
  on public.legal_evidence_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.legal_evidence_events is
  'Append-only evidence of legal notices and user choices. Ordinary clients can read only their own rows; writes are validated by the server.';
comment on column public.legal_evidence_events.server_received_at is
  'Authoritative receipt time assigned by PostgreSQL; distinct from the optional client clock.';

commit;

-- AI processing consent is intentionally separate from legal document
-- acceptances and from the express betting-data consent. Revocation keeps the
-- original acceptance row for auditability; it never deletes it.
create table if not exists public.ai_processing_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in (
    'AI_PROVIDER_PROCESSING_CONSENT',
    'AI_IMAGE_PROCESSING_CONSENT'
  )),
  policy_version text not null check (char_length(policy_version) between 1 and 80),
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz,
  locale text not null default 'es-MX' check (char_length(locale) between 2 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_processing_consents_revocation_order
    check (revoked_at is null or revoked_at >= accepted_at)
);

create unique index if not exists ai_processing_consents_one_active_scope_idx
  on public.ai_processing_consents (user_id, scope, policy_version)
  where revoked_at is null;

create index if not exists ai_processing_consents_owner_history_idx
  on public.ai_processing_consents (user_id, scope, policy_version, id desc);

alter table public.ai_processing_consents enable row level security;

revoke all on table public.ai_processing_consents from anon, authenticated;
grant select on table public.ai_processing_consents to authenticated;
grant select, insert, update on table public.ai_processing_consents to service_role;
grant usage, select on sequence public.ai_processing_consents_id_seq to service_role;

drop policy if exists ai_processing_consents_self_read on public.ai_processing_consents;
create policy ai_processing_consents_self_read
  on public.ai_processing_consents
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.ai_processing_consents is
  'Append-preserving ledger for explicit AI text/image processing consent. Revocation updates revoked_at; rows are not deleted during ordinary revocation.';

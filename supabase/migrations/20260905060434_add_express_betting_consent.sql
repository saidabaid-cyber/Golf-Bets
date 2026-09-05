-- Additive only: existing acceptances and legal documents remain untouched.
-- The published legal label stays 2026-09-02-v2; the content hash below
-- disambiguates it from the different draft that previously used that label.

alter table public.legal_acceptances
  drop constraint if exists legal_acceptances_type_check;

alter table public.legal_acceptances
  add constraint legal_acceptances_type_check
  check (type in ('terms', 'privacy', 'rules_referee', 'age_confirmation', 'betting_financial'));

insert into public.legal_documents (type, version, locale, effective_at, document_path)
values (
  'privacy',
  '2026-09-02-v2+sha256-af74adf0fb7bb96e',
  'es-MX',
  '2026-09-02T00:00:00-06:00',
  '/legal/privacy'
)
on conflict do nothing;

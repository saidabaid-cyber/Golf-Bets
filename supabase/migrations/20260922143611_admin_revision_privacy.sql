-- The revision ledger contains drafts, provenance and private Competition
-- payloads. Players consume explicitly filtered server APIs, never this table.
drop policy if exists admin_revision_read on public.admin_catalog_revisions;
create policy admin_revision_read on public.admin_catalog_revisions for select to authenticated
using(private.admin_has_scope_v1(entity_type,scope_type,scope_id,'READ'));

comment on table public.admin_catalog_revisions is
  'Admin-only version ledger. Player APIs expose only effective published projections according to product visibility policy.';

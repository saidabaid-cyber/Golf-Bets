-- Preserve existing owner/member visibility during INSERT ... RETURNING.
-- Version matches the migration recorded by the QA Management API.
-- The STABLE membership helper cannot see the just-inserted groups_v2 row
-- in its pre-statement snapshot. Evaluate its owner directly on that row.
-- No grants, write policies, membership rules or stored records change.
begin;

alter policy groups_v2_member_read on public.groups_v2
  using (
    owner_id = (select auth.uid())
    or private.is_group_member(id)
  );

commit;

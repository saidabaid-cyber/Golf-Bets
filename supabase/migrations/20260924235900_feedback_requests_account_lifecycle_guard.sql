begin;

do $$ begin
  if to_regprocedure('private.account_data_access_allowed()') is null then
    raise exception 'account_lifecycle_dependency_required';
  end if;
  if to_regclass('public.feedback_requests') is null then
    raise exception 'feedback_requests_dependency_required';
  end if;
end $$;

-- feedback_requests was created after the original account-lifecycle migration
-- installed its one-time policy loop. Close that ordering gap explicitly so an
-- archived/deleting account cannot retain owner reads through a stale JWT.
drop policy if exists account_active_access on public.feedback_requests;
create policy account_active_access
  on public.feedback_requests
  as restrictive
  for all
  to authenticated
  using ((select private.account_data_access_allowed()))
  with check ((select private.account_data_access_allowed()));

commit;

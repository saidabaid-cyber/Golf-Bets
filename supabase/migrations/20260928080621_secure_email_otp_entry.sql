-- Server-only exact account lookup used by the combined email-entry command.
-- It is deliberately unavailable to anon/authenticated clients so the browser
-- cannot turn it into a public user-directory endpoint.
create or replace function public.account_email_exists_v1(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where email is not null
      and lower(email) = lower(trim(p_email))
  );
$$;

revoke all on function public.account_email_exists_v1(text) from public;
revoke all on function public.account_email_exists_v1(text) from anon;
revoke all on function public.account_email_exists_v1(text) from authenticated;
grant execute on function public.account_email_exists_v1(text) to service_role;

comment on function public.account_email_exists_v1(text) is
  'Exact email existence check for the same-origin, rate-limited OTP command; service_role only.';

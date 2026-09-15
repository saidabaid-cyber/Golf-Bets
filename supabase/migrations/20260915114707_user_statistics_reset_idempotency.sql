-- Depends on 20260913205122_user_statistics_reset.sql. No historical round,
-- group or capture row is deleted. This migration has NOT been applied to the
-- shared Supabase project; apply and QA only against an isolated Preview DB.
begin;

create table if not exists public.user_statistics_reset_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  reset_at timestamptz not null,
  primary key (user_id, request_id)
);

alter table public.user_statistics_reset_requests enable row level security;
revoke all on table public.user_statistics_reset_requests from public, anon, authenticated;
grant select on table public.user_statistics_reset_requests to authenticated;

-- The older migration gave clients INSERT/UPDATE on the canonical marker.
-- Without revocation, REST could move reset_at without ELIMINAR, request ID
-- or an audit event. This new definer RPC is the only mutation path.
revoke insert, update, delete on table public.user_statistics_resets from public, anon, authenticated;
drop policy if exists "statistics reset owner insert" on public.user_statistics_resets;
drop policy if exists "statistics reset owner update" on public.user_statistics_resets;

drop policy if exists "statistics reset request owner read" on public.user_statistics_reset_requests;
create policy "statistics reset request owner read"
  on public.user_statistics_reset_requests for select to authenticated
  using (user_id = (select auth.uid()));
-- No direct INSERT grant: a caller may not forge request/clock records outside
-- the atomic RPC. Its SECURITY DEFINER scope is limited by auth.uid() below.
drop policy if exists "statistics reset request owner insert" on public.user_statistics_reset_requests;

-- The text-only function can otherwise shift the canonical boundary without
-- an idempotency key. Retain its definition for reversible rollout but revoke
-- its authenticated API permission.
revoke execute on function public.reset_my_statistics(text) from public, anon, authenticated;

create or replace function public.reset_my_statistics(confirmation_text text, request_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  stable_request_id uuid := request_id;
  request_time timestamptz;
  canonical_time timestamptz;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if confirmation_text is distinct from 'ELIMINAR' then raise exception 'strong_confirmation_required'; end if;
  if request_id is null or request_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'idempotency_key_required';
  end if;

  -- The primary key serializes retries of the same request, including a
  -- response timeout after commit. A duplicate never creates a second reset.
  insert into public.user_statistics_reset_requests(user_id, request_id, reset_at)
  values (current_user_id, stable_request_id, clock_timestamp())
  on conflict on constraint user_statistics_reset_requests_pkey do nothing
  returning reset_at into request_time;

  if request_time is not null then
    insert into public.user_statistics_resets(user_id, reset_at, strategy, updated_at)
    values (current_user_id, request_time, 'RESET_FROM_DATE', request_time)
    on conflict (user_id) do update
      set reset_at = greatest(public.user_statistics_resets.reset_at, excluded.reset_at),
          strategy = 'RESET_FROM_DATE',
          updated_at = greatest(public.user_statistics_resets.updated_at, excluded.updated_at);

    insert into public.product_usage_events_v2(id, owner_id, event_name, metadata, occurred_at)
    values ('stats-delete-' || replace(gen_random_uuid()::text, '-', ''),
      current_user_id, 'stats_deleted',
      jsonb_build_object('strategy', 'RESET_FROM_DATE', 'request_id', stable_request_id::text),
      request_time);
  else
    select reset_at into request_time
    from public.user_statistics_reset_requests as r
    where r.user_id = current_user_id and r.request_id = stable_request_id;
    if request_time is null then raise exception 'reset_confirmation_pending'; end if;
  end if;

  -- Distinct concurrent reset IDs never regress the boundary: the upsert
  -- uses greatest(), and retries return the latest canonical boundary.
  select reset_at into canonical_time
  from public.user_statistics_resets where user_id = current_user_id;
  if canonical_time is null then raise exception 'reset_confirmation_pending'; end if;
  return canonical_time;
end;
$$;

revoke all on function public.reset_my_statistics(text, uuid) from public, anon, authenticated;
grant execute on function public.reset_my_statistics(text, uuid) to authenticated;

commit;

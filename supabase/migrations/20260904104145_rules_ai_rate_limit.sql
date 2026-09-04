-- Persistent, server-only limiter for Rules AI. The client never receives
-- access to this table or function; Vercel calls it with the server key.
begin;

create table if not exists public.rules_ai_rate_limits (
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (key_hash, window_started_at)
);

alter table public.rules_ai_rate_limits enable row level security;

create or replace function public.consume_rules_ai_rate_limit(
  p_key_hash text,
  p_limit integer default 8,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if length(p_key_hash) <> 64 or p_limit < 1 or p_limit > 100 or p_window_seconds < 10 or p_window_seconds > 3600 then
    raise exception 'invalid_rate_limit_input';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rules_ai_rate_limits (key_hash, window_started_at, request_count, updated_at)
  values (p_key_hash, v_window, 1, clock_timestamp())
  on conflict (key_hash, window_started_at) do update
    set request_count = public.rules_ai_rate_limits.request_count + 1,
        updated_at = clock_timestamp()
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on table public.rules_ai_rate_limits from public, anon, authenticated;
revoke all on function public.consume_rules_ai_rate_limit(text, integer, integer) from public, anon, authenticated;
grant select, insert, update, delete on table public.rules_ai_rate_limits to service_role;
grant execute on function public.consume_rules_ai_rate_limit(text, integer, integer) to service_role;

comment on table public.rules_ai_rate_limits is
  'Server-only counters for Rules AI abuse/cost protection; no query content is stored.';

commit;

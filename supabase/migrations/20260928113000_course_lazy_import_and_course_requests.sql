-- QA/dev closure: shared Course Master lazy-provider coordination and a
-- dedicated review state for course requests. No provider entitlement is
-- granted here; golf_course_data_sources remains the authorization authority.
begin;

create table public.course_provider_lookup_cache (
  provider text not null check (length(trim(provider)) between 1 and 100),
  normalized_query text not null check (length(trim(normalized_query)) between 3 and 160),
  query_hash text not null check (query_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('RUNNING','SUCCESS','MISS','AMBIGUOUS','FAILED')),
  course_ids text[] not null default '{}',
  upstream_calls integer not null default 0 check (upstream_calls between 0 and 100),
  locked_until timestamptz,
  expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, normalized_query)
);
alter table public.course_provider_lookup_cache enable row level security;
revoke all on public.course_provider_lookup_cache from public, anon, authenticated;
grant all on public.course_provider_lookup_cache to service_role;
comment on table public.course_provider_lookup_cache is
  'Server-only deduplication/negative cache for authorized on-demand Course Master providers. Contains no golfer identity or credentials.';

create or replace function public.claim_course_provider_lookup_v1(target_provider text, target_query text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  cached public.course_provider_lookup_cache%rowtype;
  clean_provider text := upper(trim(target_provider));
  clean_query text := lower(trim(target_query));
begin
  if current_user not in ('service_role','postgres') then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if length(clean_provider) not between 1 and 100 or length(clean_query) not between 3 and 160 then
    raise exception 'INVALID_PROVIDER_QUERY' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(clean_provider || ':' || clean_query, 0));
  select * into cached from public.course_provider_lookup_cache
    where provider = clean_provider and normalized_query = clean_query for update;
  if cached.provider is not null and (
    (cached.status = 'RUNNING' and cached.locked_until > clock_timestamp())
    or (cached.status in ('SUCCESS','MISS','AMBIGUOUS') and cached.expires_at > clock_timestamp())
  ) then
    return jsonb_build_object('claimed',false,'status',cached.status,'courseIds',to_jsonb(cached.course_ids));
  end if;
  insert into public.course_provider_lookup_cache (
    provider,normalized_query,query_hash,status,course_ids,upstream_calls,locked_until,expires_at,last_error_code,updated_at
  ) values (
    clean_provider,clean_query,encode(extensions.digest(clean_query,'sha256'),'hex'),'RUNNING','{}',0,
    clock_timestamp() + interval '90 seconds',null,null,clock_timestamp()
  ) on conflict (provider,normalized_query) do update set
    status='RUNNING',course_ids='{}',upstream_calls=0,locked_until=excluded.locked_until,
    expires_at=null,last_error_code=null,updated_at=clock_timestamp();
  return jsonb_build_object('claimed',true,'status','RUNNING','courseIds','[]'::jsonb);
end;
$$;
revoke all on function public.claim_course_provider_lookup_v1(text,text) from public, anon, authenticated;
grant execute on function public.claim_course_provider_lookup_v1(text,text) to service_role;

create or replace function public.finish_course_provider_lookup_v1(
  target_provider text,target_query text,target_status text,target_course_ids text[],target_upstream_calls integer
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  clean_status text := upper(trim(target_status));
begin
  if current_user not in ('service_role','postgres') then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if clean_status not in ('SUCCESS','MISS','AMBIGUOUS','FAILED') or target_upstream_calls not between 0 and 100 then
    raise exception 'INVALID_PROVIDER_RESULT' using errcode = '22023';
  end if;
  update public.course_provider_lookup_cache set
    status=clean_status,course_ids=coalesce(target_course_ids,'{}'),upstream_calls=target_upstream_calls,
    locked_until=null,
    expires_at=clock_timestamp() + case clean_status when 'SUCCESS' then interval '30 days'
      when 'MISS' then interval '1 day' when 'AMBIGUOUS' then interval '1 hour' else interval '5 minutes' end,
    updated_at=clock_timestamp()
  where provider=upper(trim(target_provider)) and normalized_query=lower(trim(target_query));
  return found;
end;
$$;
revoke all on function public.finish_course_provider_lookup_v1(text,text,text,text[],integer) from public, anon, authenticated;
grant execute on function public.finish_course_provider_lookup_v1(text,text,text,text[],integer) to service_role;

alter table public.feedback_requests drop constraint if exists feedback_requests_request_status_check;
alter table public.feedback_requests add constraint feedback_requests_request_status_check
  check (request_status in ('NEW','PENDING_REVIEW','IN_REVIEW','RESOLVED','REJECTED','DUPLICATE'));

commit;

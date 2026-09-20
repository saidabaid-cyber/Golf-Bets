-- Additive extension of the existing Club / Course / Tee / Hole catalog.
-- Imported research remains PRIVATE and is served only by the isolated QA API.
begin;
alter table public.golf_clubs add column if not exists catalog_metadata jsonb not null default '{}';
alter table public.golf_courses add column if not exists catalog_metadata jsonb not null default '{}';
alter table public.golf_course_tees add column if not exists catalog_metadata jsonb not null default '{}';
alter table public.golf_tee_hole_yardages
  add column if not exists tee_par smallint check (tee_par between 3 and 6),
  add column if not exists tee_stroke_index smallint check (tee_stroke_index between 1 and 18);
create table public.golf_tee_nine_ratings (
  id text primary key,
  course_id text not null references public.golf_courses(id),
  tee_id text not null references public.golf_course_tees(id),
  segment text not null check (segment in ('FRONT','BACK','UNSPECIFIED')),
  rating numeric not null check (rating between 10 and 60),
  slope integer not null check (slope between 55 and 155),
  par integer not null check (par between 20 and 50),
  rating_category text,
  source_url text not null,
  observed_at date not null,
  source_payload jsonb not null
);
create index golf_tee_nine_ratings_tee_idx on public.golf_tee_nine_ratings(tee_id,segment);
create index golf_tee_nine_ratings_course_idx on public.golf_tee_nine_ratings(course_id);
alter table public.golf_tee_nine_ratings enable row level security;
revoke all on public.golf_tee_nine_ratings from public,anon,authenticated;
grant all on public.golf_tee_nine_ratings to service_role;

-- One course is imported atomically. Repeat imports are no-ops by content hash.
-- A changed source needs an explicit reviewed import; no other provider is overwritten.
create function public.import_review_course_v1(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare c jsonb := payload->'course'; cl jsonb := payload->'club'; t jsonb; h jsonb; n jsonb;
  existing jsonb; course_key text := c->>'id'; tee_key text; hole_key text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'IMPORT_NOT_AUTHORIZED'; end if;
  if payload->>'provider' <> 'OWNER_CATALOG_REVIEW' or c->>'rating_category' is not null
    or coalesce(payload->>'contentHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REVIEW_PAYLOAD'; end if;
  perform pg_advisory_xact_lock(hashtextextended(course_key,0));
  select catalog_metadata into existing from public.golf_courses where id=course_key;
  if found then
    if existing->>'contentHash'=payload->>'contentHash' then return jsonb_build_object('unchanged',true); end if;
    raise exception 'CATALOG_CONFLICT_REVIEW_REQUIRED';
  end if;
  if exists(select 1 from public.golf_clubs where id=cl->>'id' and provider <> 'OWNER_CATALOG_REVIEW') then
    raise exception 'CLUB_PROVIDER_CONFLICT_REVIEW_REQUIRED';
  end if;
  insert into public.golf_clubs(id,name,country,state_region,city,latitude,longitude,provider,provider_external_id,source_url,verified_at,visibility,catalog_metadata)
  values(cl->>'id',cl->>'name','México',cl->>'state',cl->>'city',(cl->>'latitude')::double precision,(cl->>'longitude')::double precision,
    'OWNER_CATALOG_REVIEW',cl->>'id',c->>'source_url',(c->>'observed_at')::timestamptz,'PRIVATE',cl)
  on conflict(id) do nothing;
  insert into public.golf_courses(id,club_id,name,holes,provider,provider_external_id,source_url,verified_at,visibility,catalog_metadata)
  values(course_key,cl->>'id',c->>'course_name',18,'OWNER_CATALOG_REVIEW',c->>'ghin_course_id',c->>'source_url',(c->>'observed_at')::timestamptz,'PRIVATE',
    c || jsonb_build_object('contentHash',payload->>'contentHash','dataVersion',payload->>'dataVersion','originalSourceId',payload->>'originalSourceId'));
  for t in select value from jsonb_array_elements(payload->'tees') loop
    tee_key:=t->>'id';
    if t->>'rating_category' is not null then raise exception 'RATING_CATEGORY_REVIEW_REQUIRED'; end if;
    insert into public.golf_course_tees(id,course_id,name,gender,rating,slope,par,total_yards,front_nine_rating,back_nine_rating,provider,provider_external_id,source_url,verified_at,catalog_metadata)
    values(tee_key,course_key,t->>'name',null,(t->>'course_rating')::numeric,(t->>'slope_rating')::int,(t->>'par')::int,(t->>'yards')::int,
      (t->>'front_course_rating')::numeric,(t->>'back_course_rating')::numeric,'OWNER_CATALOG_REVIEW',tee_key,c->>'source_url',(c->>'observed_at')::timestamptz,t);
    for h in select value from jsonb_array_elements(t->'holes') loop
      hole_key:=course_key||':hole:'||(h->>'hole_number');
      insert into public.golf_holes(id,course_id,hole_number,par,stroke_index,provider,provider_external_id,source_url,verified_at)
      values(hole_key,course_key,(h->>'hole_number')::int,(h->>'par')::int,(h->>'stroke_index')::int,'OWNER_CATALOG_REVIEW',hole_key,c->>'source_url',(c->>'observed_at')::timestamptz)
      on conflict(id) do nothing;
      insert into public.golf_tee_hole_yardages(id,course_id,tee_id,hole_id,yards,tee_par,tee_stroke_index,provider,provider_external_id,source_url,verified_at)
      values(tee_key||':hole:'||(h->>'hole_number'),course_key,tee_key,hole_key,(h->>'yards')::int,(h->>'par')::int,(h->>'stroke_index')::int,
        'OWNER_CATALOG_REVIEW',tee_key||':hole:'||(h->>'hole_number'),c->>'source_url',(c->>'observed_at')::timestamptz);
    end loop;
    for n in select value from jsonb_array_elements(t->'nineRatings') loop
      insert into public.golf_tee_nine_ratings(id,course_id,tee_id,segment,rating,slope,par,rating_category,source_url,observed_at,source_payload)
      values(n->>'id',course_key,tee_key,n->>'segment',(n->>'course_rating')::numeric,(n->>'slope_rating')::int,(n->>'par')::int,null,n->>'source_url',(n->>'observed_at')::date,n);
    end loop;
  end loop;
  return jsonb_build_object('imported',true);
end $$;
revoke all on function public.import_review_course_v1(jsonb) from public,anon,authenticated;
grant execute on function public.import_review_course_v1(jsonb) to service_role;

create table public.feedback_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check(category in ('COURSE','CLUB','BALL','SHAFT','BET','BUG','GENERAL')),
  payload jsonb not null,
  status text not null check(status in ('NOT_SENT','SENDING','ACCEPTED_BY_PROVIDER','FAILED','MAILTO_AVAILABLE')),
  provider_message_id text,
  error_code text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_requests_owner_created_idx on public.feedback_requests(user_id,created_at);
alter table public.feedback_requests enable row level security;
revoke all on public.feedback_requests from public,anon,authenticated;
grant select on public.feedback_requests to authenticated;
grant all on public.feedback_requests to service_role;
create policy feedback_owner_read on public.feedback_requests for select to authenticated using(user_id=(select auth.uid()));
create function public.claim_feedback_v1(request_id uuid, actor_id uuid, request_payload jsonb, mail_available boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.feedback_requests;
begin
  if current_user not in ('service_role','postgres') then raise exception 'NOT_AUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text,0));
  select * into r from public.feedback_requests where id=request_id for update;
  if found then
    if r.user_id<>actor_id or r.payload<>request_payload then raise exception 'REQUEST_CONFLICT'; end if;
    if r.status='ACCEPTED_BY_PROVIDER' or (r.status='SENDING' and r.updated_at>now()-interval '45 seconds') then
      return jsonb_build_object('send',false,'status',r.status,'id',r.id);
    end if;
    if r.attempts>=5 or r.created_at<now()-interval '23 hours' then raise exception 'RETRY_LIMIT'; end if;
  else
    if (select count(*) from public.feedback_requests where user_id=actor_id and created_at>now()-interval '1 day')>=10 then raise exception 'RATE_LIMIT'; end if;
    insert into public.feedback_requests(id,user_id,category,payload,status) values(request_id,actor_id,request_payload->>'category',request_payload,'NOT_SENT');
  end if;
  update public.feedback_requests set status=case when mail_available then 'SENDING' else 'MAILTO_AVAILABLE' end, attempts=attempts+1,updated_at=now() where id=request_id;
  return jsonb_build_object('send',mail_available,'status',case when mail_available then 'SENDING' else 'MAILTO_AVAILABLE' end,'id',request_id);
end $$;
revoke all on function public.claim_feedback_v1(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.claim_feedback_v1(uuid,uuid,jsonb,boolean) to service_role;
commit;

-- Additive DEV migration. No existing rounds/provider profiles are rewritten.
-- Operational rollback: disable the import route and stop writes; retain this
-- table as evidence. Do not DROP it or delete imported cards during rollback.
create table public.handicap_provider_scores (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'GHIN'),
  external_score_id text not null check (length(external_score_id) between 1 and 240),
  external_player_id text not null check (external_player_id ~ '^[0-9]{5,12}$'),
  played_on date not null,
  provider_course_id text,
  provider_course_name text,
  provider_tee_set_id text,
  provider_tee_name text,
  number_of_holes integer not null check (number_of_holes in (9,18)),
  gross_score integer check (gross_score between 9 and 250),
  adjusted_gross_score integer check (adjusted_gross_score between 9 and 250),
  score_differential numeric,
  course_rating numeric,
  slope_rating integer,
  score_type text,
  posting_method text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linked_round_id uuid references public.rounds_cloud(id) on delete restrict,
  linked_score_hash text,
  posting_fingerprint text check (posting_fingerprint is null or posting_fingerprint ~ '^[0-9a-f]{64}$'),
  match_status text not null check (match_status in ('GHIN_ONLY','EXACT_MATCH','HIGH_CONFIDENCE_MATCH','MATCH_REVIEW_REQUIRED')),
  candidate_round_ids uuid[] not null default '{}',
  primary key (owner_id,provider,external_score_id),
  check (gross_score is not null or adjusted_gross_score is not null),
  check ((linked_round_id is not null) = (match_status in ('EXACT_MATCH','HIGH_CONFIDENCE_MATCH')))
);
create index handicap_provider_scores_owner_date_idx on public.handicap_provider_scores(owner_id,played_on desc,external_score_id);
create index handicap_provider_scores_link_idx on public.handicap_provider_scores(linked_round_id) where linked_round_id is not null;
create unique index handicap_provider_scores_one_link_idx on public.handicap_provider_scores(owner_id,provider,external_player_id,linked_round_id) where linked_round_id is not null;
alter table public.handicap_provider_scores enable row level security;
revoke all on public.handicap_provider_scores from public, anon, authenticated, service_role;
grant select on public.handicap_provider_scores to authenticated;
grant select, insert, update on public.handicap_provider_scores to service_role;
create policy handicap_provider_scores_owner_read on public.handicap_provider_scores
for select to authenticated using (
  owner_id = (select auth.uid())
  and coalesce((select (auth.jwt()->>'is_anonymous')::boolean),false)=false
  and private.account_subject_active(owner_id)
);

-- One owner-scoped transaction makes repeat/concurrent imports idempotent.
-- JSON contains explicitly normalized columns only, never an upstream response.
create function public.import_ghin_scores_v1(p_owner_id uuid,p_external_player_id text,p_records jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare added integer; total integer; matched integer; ambiguous integer;
begin
  if current_user not in ('postgres','service_role') then raise exception 'GHIN_IMPORT_NOT_AUTHORIZED'; end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 1000 then raise exception 'GHIN_IMPORT_INVALID_BATCH'; end if;
  if not exists (select 1 from public.player_handicap_provider_profiles where owner_id=p_owner_id and provider='GHIN' and association_status='VERIFIED' and external_player_id=p_external_player_id)
    then raise exception 'GHIN_IMPORT_IDENTITY_MISMATCH'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ghin-import:'||p_owner_id::text,0));
  if exists (select 1 from jsonb_array_elements(p_records) r where r->>'linked_round_id' is not null
    and not exists (select 1 from public.rounds_cloud c where c.id=(r->>'linked_round_id')::uuid and c.owner_id=p_owner_id and c.snapshot->>'lifecycleState'='completed'))
    then raise exception 'GHIN_IMPORT_ROUND_OWNER_MISMATCH'; end if;
  if exists (select 1 from jsonb_array_elements(p_records) r, jsonb_array_elements_text(r->'candidate_round_ids') candidate
    where not exists (select 1 from public.rounds_cloud c where c.id=candidate::uuid and c.owner_id=p_owner_id))
    then raise exception 'GHIN_IMPORT_CANDIDATE_OWNER_MISMATCH'; end if;
  select count(*) into added from jsonb_array_elements(p_records) r where not exists (
    select 1 from public.handicap_provider_scores s where s.owner_id=p_owner_id and s.provider='GHIN' and s.external_score_id=r->>'external_score_id');
  insert into public.handicap_provider_scores (
    owner_id,provider,external_player_id,external_score_id,played_on,provider_course_id,provider_course_name,provider_tee_set_id,provider_tee_name,
    number_of_holes,gross_score,adjusted_gross_score,score_differential,course_rating,slope_rating,score_type,posting_method,
    linked_round_id,linked_score_hash,posting_fingerprint,match_status,candidate_round_ids)
  select p_owner_id,'GHIN',p_external_player_id,r.external_score_id,r.played_on,r.provider_course_id,r.provider_course_name,r.provider_tee_set_id,r.provider_tee_name,
    r.number_of_holes,r.gross_score,r.adjusted_gross_score,r.score_differential,r.course_rating,r.slope_rating,r.score_type,r.posting_method,
    r.linked_round_id,r.linked_score_hash,r.posting_fingerprint,r.match_status,coalesce(r.candidate_round_ids,'{}')
  from jsonb_to_recordset(p_records) as r (
    external_score_id text,played_on date,provider_course_id text,provider_course_name text,provider_tee_set_id text,provider_tee_name text,
    number_of_holes integer,gross_score integer,adjusted_gross_score integer,score_differential numeric,course_rating numeric,slope_rating integer,
    score_type text,posting_method text,linked_round_id uuid,linked_score_hash text,posting_fingerprint text,match_status text,candidate_round_ids uuid[])
  on conflict (owner_id,provider,external_score_id) do update set
    played_on=excluded.played_on,provider_course_id=excluded.provider_course_id,provider_course_name=excluded.provider_course_name,
    provider_tee_set_id=excluded.provider_tee_set_id,provider_tee_name=excluded.provider_tee_name,number_of_holes=excluded.number_of_holes,
    gross_score=excluded.gross_score,adjusted_gross_score=excluded.adjusted_gross_score,score_differential=excluded.score_differential,
    course_rating=excluded.course_rating,slope_rating=excluded.slope_rating,score_type=excluded.score_type,posting_method=excluded.posting_method,
    linked_round_id=excluded.linked_round_id,
    linked_score_hash=case when handicap_provider_scores.linked_round_id=excluded.linked_round_id then handicap_provider_scores.linked_score_hash else excluded.linked_score_hash end,
    posting_fingerprint=coalesce(handicap_provider_scores.posting_fingerprint,excluded.posting_fingerprint),
    match_status=excluded.match_status,candidate_round_ids=excluded.candidate_round_ids,updated_at=now();
  select count(*),count(*) filter(where linked_round_id is not null),count(*) filter(where match_status='MATCH_REVIEW_REQUIRED')
  into total,matched,ambiguous from public.handicap_provider_scores where owner_id=p_owner_id and provider='GHIN' and external_player_id=p_external_player_id;
  return jsonb_build_object('importedNew',added,'total',total,'matched',matched,'ambiguous',ambiguous,'ghinOnly',total-matched,'syncedAt',now());
end $$;
revoke all on function public.import_ghin_scores_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_ghin_scores_v1(uuid,text,jsonb) to service_role;
comment on table public.handicap_provider_scores is 'Owner-private normalized GHIN scores, read-only in the app. No auth material or fabricated hole-level data. Backyard rounds remain independent and are never overwritten by import.';

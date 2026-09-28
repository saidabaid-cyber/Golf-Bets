-- The original shared trigger referenced NEW.par even when PostgreSQL invoked
-- it for a profile-hole row, whose record has no par field. Read table-specific
-- fields through jsonb so tee and hole membership share one safe validator.
begin;

create or replace function private.validate_scorecard_profile_member_v1()
returns trigger language plpgsql set search_path = '' as $$
declare
  member jsonb := to_jsonb(new);
  profile_course_id text;
  member_course_id text;
  physical_par smallint;
  physical_yards integer;
  physical_meters integer;
  requested_par smallint;
  requested_yards integer;
  requested_meters integer;
begin
  select profile.course_id into profile_course_id
    from public.course_scorecard_profiles profile
    where profile.id = member->>'profile_id';
  if tg_table_name = 'course_scorecard_profile_tees' then
    select tee.course_id, tee.par, tee.total_yards, tee.total_meters
      into member_course_id, physical_par, physical_yards, physical_meters
      from public.golf_course_tees tee where tee.id = member->>'tee_id';
    requested_par := nullif(member->>'par','')::smallint;
    requested_yards := nullif(member->>'total_yards','')::integer;
    requested_meters := nullif(member->>'total_meters','')::integer;
  else
    select hole.course_id into member_course_id
      from public.golf_holes hole where hole.id = member->>'hole_id';
  end if;
  if profile_course_id is null or member_course_id is null or profile_course_id <> member_course_id then
    raise exception 'SCORECARD_PROFILE_LAYOUT_MISMATCH' using errcode = '23514';
  end if;
  if tg_table_name = 'course_scorecard_profile_tees' and (
    (requested_par is not null and physical_par is not null and requested_par <> physical_par)
    or (requested_yards is not null and physical_yards is not null and abs(requested_yards - physical_yards) > 1)
    or (requested_meters is not null and physical_meters is not null and abs(requested_meters - physical_meters) > 1)
  ) then
    raise exception 'SCORECARD_PROFILE_PHYSICAL_FACT_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;

commit;

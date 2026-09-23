-- Expose the reviewed owner catalog to authenticated players without granting
-- direct SELECT on private catalog rows or requiring a service-role key.
create or replace function public.read_owner_course_catalog_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'clubs', coalesce((
      select jsonb_agg(to_jsonb(club_row) order by club_row.id)
      from (
        select id, name, city, state_region, latitude, longitude, catalog_metadata
        from public.golf_clubs
        where provider = 'OWNER_CATALOG_REVIEW' and active = true
      ) club_row
    ), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(to_jsonb(course_row) order by course_row.id)
      from (
        select id, club_id, name, holes, source_url, verified_at, catalog_metadata
        from public.golf_courses
        where provider = 'OWNER_CATALOG_REVIEW' and active = true
      ) course_row
    ), '[]'::jsonb),
    'tees', coalesce((
      select jsonb_agg(to_jsonb(tee_row) order by tee_row.id)
      from (
        select id, course_id, catalog_metadata
        from public.golf_course_tees
        where provider = 'OWNER_CATALOG_REVIEW' and active = true
      ) tee_row
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.read_owner_course_catalog_v1() from public, anon;
grant execute on function public.read_owner_course_catalog_v1() to authenticated, service_role;


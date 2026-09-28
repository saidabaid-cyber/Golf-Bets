-- Provider-agnostic Backyard Course Master source registry and authenticated
-- read projection. This migration imports no third-party dataset and does not
-- grant permission to scrape or reuse any provider's data.
begin;

create table public.golf_course_data_sources (
  provider text primary key
    check (provider = upper(trim(provider)) and provider ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'),
  display_name text not null check (length(trim(display_name)) between 1 and 160),
  source_url text not null
    check (length(source_url) <= 1000 and source_url ~ '^https://[^[:space:]]+$'),
  terms_url text
    check (terms_url is null or (length(terms_url) <= 1000 and terms_url ~ '^https://[^[:space:]]+$')),
  authorization_status text not null
    check (authorization_status in ('AUTHORIZED','LEGAL_REVIEW_REQUIRED','BLOCKED_EXTERNAL')),
  authorization_basis text
    check (authorization_basis is null or length(trim(authorization_basis)) between 1 and 2000),
  authorized_for_import boolean not null default false,
  authorized_for_display boolean not null default false,
  rating_reuse_authorized boolean not null default false,
  reviewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf_course_data_sources_authorized_check check (
    not authorized_for_import
    or (
      authorization_status = 'AUTHORIZED'
      and authorization_basis is not null
      and authorized_for_display
    )
  ),
  constraint golf_course_data_sources_rating_reuse_check check (
    not rating_reuse_authorized
    or (authorization_status = 'AUTHORIZED' and authorized_for_display)
  )
);

create trigger golf_course_data_sources_touch
before insert or update on public.golf_course_data_sources
for each row execute function public.touch_golf_architecture_record();

alter table public.golf_course_data_sources enable row level security;
revoke all on public.golf_course_data_sources from public, anon, authenticated, service_role;
grant select on public.golf_course_data_sources to authenticated;
grant select, insert, update, delete on public.golf_course_data_sources to service_role;

create policy golf_course_data_sources_authenticated_read
on public.golf_course_data_sources for select to authenticated
using (
  (select auth.uid()) is not null
  and private.account_subject_active((select auth.uid()))
);

insert into public.golf_course_data_sources(
  provider, display_name, source_url, terms_url, authorization_status,
  authorization_basis, authorized_for_import, authorized_for_display,
  rating_reuse_authorized, reviewed_at
) values
  (
    'BACKYARD_INTERNAL', 'The Backyard', 'https://dev.thebackyard.com.mx', null,
    'AUTHORIZED', 'First-party records administered by The Backyard.',
    true, true, true, now()
  ),
  (
    'OWNER_CATALOG_REVIEW', 'Owner catalog review', 'https://dev.thebackyard.com.mx', null,
    'LEGAL_REVIEW_REQUIRED',
    'Existing QA research remains visible with rating reuse disabled until source rights and rating category are verified.',
    false, true, false, now()
  ),
  (
    'GHIN', 'GHIN', 'https://www.ghin.com/', 'https://www.usga.org/terms-and-conditions.html',
    'BLOCKED_EXTERNAL',
    'QA records already synchronized under controlled credentials may remain visible; this is not authorization for bulk or commercial ingestion.',
    false, true, false, now()
  ),
  (
    'USGA_NCRDB', 'USGA National Course Rating Database', 'https://ncrdb.usga.org/',
    'https://www.usga.org/terms-and-conditions.html', 'LEGAL_REVIEW_REQUIRED',
    'No documented public API, export or bulk feed was found. Automated extraction is not authorized by this registry.',
    false, false, false, now()
  )
on conflict (provider) do update set
  display_name = excluded.display_name,
  source_url = excluded.source_url,
  terms_url = excluded.terms_url,
  authorization_status = excluded.authorization_status,
  authorization_basis = excluded.authorization_basis,
  authorized_for_import = excluded.authorized_for_import,
  authorized_for_display = excluded.authorized_for_display,
  rating_reuse_authorized = excluded.rating_reuse_authorized,
  reviewed_at = excluded.reviewed_at;

-- Narrow player projection. Private provider tables and service credentials are
-- never exposed. A future licensed source becomes visible only after its source
-- registry row explicitly authorizes display.
create function public.read_backyard_course_master_v1()
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
  if not private.account_subject_active(auth.uid()) then
    raise exception 'account unavailable' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'clubs', coalesce((
      select jsonb_agg(to_jsonb(club_row) order by club_row.id)
      from (
        select
          club.id, club.name, club.country, club.state_region, club.city,
          club.address, club.latitude, club.longitude, club.timezone,
          club.source_url, club.verified_at,
          club.catalog_metadata || jsonb_build_object(
            'provider', club.provider,
            'provider_external_id', club.provider_external_id,
            'origin', club.origin,
            'provider_status', club.provider_status,
            'last_synced_at', club.last_synced_at
          ) as catalog_metadata
        from public.golf_clubs club
        where club.active = true
          and club.visibility = 'PUBLIC'
          and exists (
            select 1
            from public.golf_courses course
            left join public.golf_course_data_sources source on source.provider = course.provider
            where course.club_id = club.id
              and course.active = true
              and course.visibility = 'PUBLIC'
              and (
                course.provider = 'OWNER_CATALOG_REVIEW'
                or course.origin in ('GHIN','BACKYARD_PROVISIONAL')
                or source.authorized_for_display = true
              )
          )
      ) club_row
    ), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(to_jsonb(course_row) order by course_row.id)
      from (
        select
          course.id, course.club_id, course.name, course.holes,
          course.source_url, course.verified_at,
          course.catalog_metadata || jsonb_build_object(
            'provider', course.provider,
            'course_id', course.provider_external_id,
            'origin', course.origin,
            'is_provisional', course.is_provisional,
            'layout_type', course.layout_type,
            'operational_status', course.provider_status,
            'total_par', course.total_par,
            'last_synced_at', course.last_synced_at,
            'rating_reuse_status', case
              when source.rating_reuse_authorized then 'AUTHORIZED'
              else coalesce(course.catalog_metadata->>'rating_reuse_status', 'LEGAL_REVIEW_REQUIRED')
            end
          ) as catalog_metadata
        from public.golf_courses course
        left join public.golf_course_data_sources source on source.provider = course.provider
        where course.active = true
          and course.visibility = 'PUBLIC'
          and (
            course.provider = 'OWNER_CATALOG_REVIEW'
            or course.origin in ('GHIN','BACKYARD_PROVISIONAL')
            or source.authorized_for_display = true
          )
      ) course_row
    ), '[]'::jsonb),
    'tees', coalesce((
      select jsonb_agg(to_jsonb(tee_row) order by tee_row.id)
      from (
        select
          tee.id, tee.course_id,
          tee.catalog_metadata || jsonb_build_object(
            'provider', tee.provider,
            'provider_tee_set_rating_id', tee.provider_external_id,
            'provider_status', tee.provider_status,
            'displayName', coalesce(tee.display_name, tee.name),
            'name', tee.name,
            'gender', tee.gender,
            'course_rating', tee.rating,
            'slope_rating', tee.slope,
            'bogey_rating', tee.bogey_rating,
            'yards', tee.total_yards,
            'meters', tee.total_meters,
            'par', tee.par,
            'front_course_rating', tee.front_nine_rating,
            'front_slope_rating', tee.front_nine_slope,
            'back_course_rating', tee.back_nine_rating,
            'back_slope_rating', tee.back_nine_slope,
            'last_synced_at', tee.last_synced_at
          ) as catalog_metadata
        from public.golf_course_tees tee
        join public.golf_courses course on course.id = tee.course_id
        left join public.golf_course_data_sources source on source.provider = course.provider
        where tee.active = true
          and course.active = true
          and course.visibility = 'PUBLIC'
          and (
            course.provider = 'OWNER_CATALOG_REVIEW'
            or course.origin in ('GHIN','BACKYARD_PROVISIONAL')
            or source.authorized_for_display = true
          )
      ) tee_row
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.read_backyard_course_master_v1() from public, anon;
grant execute on function public.read_backyard_course_master_v1() to authenticated, service_role;

comment on table public.golf_course_data_sources is
  'Course Master source/license registry. A row records authorization state; it does not grant rights that have not been obtained externally.';
comment on function public.read_backyard_course_master_v1() is
  'Authenticated, read-only projection of the provider-agnostic Backyard Course Master. It exposes no credentials or raw provider payloads.';

commit;

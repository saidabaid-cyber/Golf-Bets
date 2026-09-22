-- Read-only metadata projection. Run only against isolated QA project
-- bymeopxkxapfizeeqeyb after independently verifying the connected project.
-- No Auth/users, hole scores, full cards, writes, or external services.
select jsonb_build_object(
  'projectRef', 'bymeopxkxapfizeeqeyb',
  'provider', 'OWNER_CATALOG_REVIEW',
  'observedAt', current_date::text,
  'queryId', 'nightly-course-audit-v1',
  'clubs', (select jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'latitude', latitude, 'longitude', longitude,
    'locationEvidence', catalog_metadata->'locationEvidence'
  ) order by id) from public.golf_clubs where active and provider = 'OWNER_CATALOG_REVIEW'),
  'courses', (select jsonb_agg(jsonb_build_object(
    'id', id, 'clubId', club_id, 'name', name, 'sourceUrl', source_url,
    'dataVersion', catalog_metadata->>'dataVersion'
  ) order by id) from public.golf_courses where active and provider = 'OWNER_CATALOG_REVIEW'),
  'tees', (select jsonb_agg(jsonb_build_object(
    'id', id, 'courseId', course_id, 'name', catalog_metadata->>'name',
    'holeCount', jsonb_array_length(coalesce(catalog_metadata->'holes', '[]'::jsonb)),
    'qaStatus', catalog_metadata->>'qa_status',
    'qaErrors', catalog_metadata#>'{qa,errors}',
    'ratingCategory', catalog_metadata->'rating_category',
    'hasRating', (catalog_metadata->>'course_rating') is not null,
    'hasSlope', (catalog_metadata->>'slope_rating') is not null,
    'sourceLimitation', catalog_metadata->>'source_limitation',
    'supplementSourceUrl', catalog_metadata#>>'{supplement,sourceUrl}',
    'supplementRatingCategory', catalog_metadata#>>'{supplement,ratingEvidence,category}'
  ) order by id) from public.golf_course_tees where active and provider = 'OWNER_CATALOG_REVIEW')
) as source;

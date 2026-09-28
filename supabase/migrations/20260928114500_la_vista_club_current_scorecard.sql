-- Preserve the provider-owned La Vista course while restoring the distinct
-- physical club card supplied by the owner. The 7,230 yd club card cannot be
-- a rating-only profile on the 7,122 yd GHIN layout, so it is a sibling
-- physical layout under the same facility. White remains one physical tee
-- with separate MEN/WOMEN rating rows.
begin;

-- Keep a fresh/ephemeral database migratable. QA already has this exact
-- canonical facility, so ON CONFLICT deliberately leaves its provider mapping
-- and reviewed metadata untouched.
insert into public.golf_clubs (
  id,name,country,state_region,city,address,timezone,website,provider,
  provider_external_id,source_url,verified_at,active,visibility
) values (
  'club-la-vista','La Vista Country Club','México','Puebla','San Andrés Cholula',
  'Boulevard Vista Hermosa 2004, Desarrollo Residencial La Vista Country Club, C.P. 72810',
  'America/Mexico_City','https://www.lavistacountryclub.com.mx/',
  'BACKYARD_INTERNAL','la-vista-country-club','https://www.lavistacountryclub.com.mx/',
  '2026-09-28T00:00:00Z',true,'PUBLIC'
) on conflict (id) do nothing;

insert into public.golf_courses (
  id,club_id,name,holes,provider,active,visibility,verified_at,catalog_metadata,
  origin,layout_type,is_provisional,provider_status,total_par
) values (
  'course-la-vista-club-current','club-la-vista','Par 72 — Tarjeta del club — Actual',18,
  'BACKYARD_INTERNAL',true,'PUBLIC','2026-09-28T00:00:00Z',
  jsonb_build_object(
    'provider','BACKYARD_INTERNAL','origin','BACKYARD_ADMIN','layout_type','STANDARD',
    'operational_status','ACTIVE','total_par',72,'rating_reuse_status','AUTHORIZED',
    'default_for_play',true,'dataVersion','la-vista-club-current-2026-09-28',
    'observed_at','2026-09-28T00:00:00Z',
    'search_aliases',jsonb_build_array('La Vista Par 72','La Vista tarjeta del club'),
    'source_limitation','Owner-supplied aggregate corrections; hole facts are preserved from the versioned Backyard catalog and no unknown values were inferred.'
  ),
  'BACKYARD_ADMIN','STANDARD',false,'ACTIVE',72
) on conflict (id) do update set
  club_id=excluded.club_id,name=excluded.name,holes=excluded.holes,provider=excluded.provider,
  active=true,visibility='PUBLIC',verified_at=excluded.verified_at,
  catalog_metadata=public.golf_courses.catalog_metadata || excluded.catalog_metadata,
  origin=excluded.origin,layout_type=excluded.layout_type,is_provisional=false,
  provider_status=excluded.provider_status,total_par=excluded.total_par;

with definitions(id,name,color,total_yards,yardages) as (values
  ('tee-la-vista-club-current-blue','Azules','BLUE',7230,array[435,187,416,538,419,367,191,425,562,538,388,158,393,505,605,418,213,471]::integer[]),
  ('tee-la-vista-club-current-white','Blancas','WHITE',6590,array[392,165,398,483,389,343,158,374,488,529,358,138,368,433,581,395,173,425]::integer[]),
  ('tee-la-vista-club-current-gold','Doradas','GOLD',6038,array[362,136,358,469,365,323,138,334,457,490,326,108,326,392,542,368,156,388]::integer[]),
  ('tee-la-vista-club-current-red','Rojas','RED',5476,array[331,115,297,447,319,270,116,306,430,446,306,99,292,364,503,343,135,357]::integer[])
), holes(hole_number,par,stroke_index) as (values
  (1,4,5),(2,3,17),(3,4,7),(4,5,1),(5,4,9),(6,4,13),(7,3,15),(8,4,3),(9,5,11),
  (10,5,12),(11,4,8),(12,3,18),(13,4,14),(14,4,2),(15,5,4),(16,4,10),(17,3,16),(18,4,6)
), rows as (
  select d.id,d.name,d.color,d.total_yards,d.yardages,
    jsonb_build_object(
      'provider','BACKYARD_INTERNAL','name',d.name,'displayName',d.name,'gender',null,
      'course_rating',null,'slope_rating',null,'yards',d.total_yards,'meters',null,'par',72,
      'rating_category',null,'qa_status','VERIFIED_COMPLETE','source_limitation',null,
      'nineRatings','[]'::jsonb,'qa',jsonb_build_object('status','VERIFIED_COMPLETE','errors','[]'::jsonb),
      'holes',(select jsonb_agg(jsonb_build_object(
        'hole_number',h.hole_number,'par',h.par,'stroke_index',h.stroke_index,'yards',d.yardages[h.hole_number]
      ) order by h.hole_number) from holes h)
    ) metadata
  from definitions d
)
insert into public.golf_course_tees (
  id,course_id,name,color,gender,rating,slope,par,total_yards,provider,verified_at,active,
  catalog_metadata,origin,display_name,provider_status
)
select id,'course-la-vista-club-current',name,color,null,null,null,72,total_yards,
  'BACKYARD_INTERNAL','2026-09-28T00:00:00Z',true,metadata,'BACKYARD_ADMIN',name,'ACTIVE'
from rows
on conflict (id) do update set
  course_id=excluded.course_id,name=excluded.name,color=excluded.color,gender=null,rating=null,slope=null,
  par=72,total_yards=excluded.total_yards,provider='BACKYARD_INTERNAL',verified_at=excluded.verified_at,
  active=true,catalog_metadata=excluded.catalog_metadata,origin='BACKYARD_ADMIN',display_name=excluded.display_name,
  provider_status='ACTIVE';

with holes(hole_number,par,stroke_index) as (values
  (1,4,5),(2,3,17),(3,4,7),(4,5,1),(5,4,9),(6,4,13),(7,3,15),(8,4,3),(9,5,11),
  (10,5,12),(11,4,8),(12,3,18),(13,4,14),(14,4,2),(15,5,4),(16,4,10),(17,3,16),(18,4,6)
)
insert into public.golf_holes (id,course_id,hole_number,par,stroke_index,provider,verified_at,origin,active,provider_status)
select 'course-la-vista-club-current-hole-'||hole_number,'course-la-vista-club-current',hole_number,par,stroke_index,
  'BACKYARD_INTERNAL','2026-09-28T00:00:00Z','BACKYARD_ADMIN',true,'ACTIVE' from holes
on conflict (id) do update set par=excluded.par,stroke_index=excluded.stroke_index,active=true,provider_status='ACTIVE';

with definitions(tee_id,yardages) as (values
  ('tee-la-vista-club-current-blue',array[435,187,416,538,419,367,191,425,562,538,388,158,393,505,605,418,213,471]::integer[]),
  ('tee-la-vista-club-current-white',array[392,165,398,483,389,343,158,374,488,529,358,138,368,433,581,395,173,425]::integer[]),
  ('tee-la-vista-club-current-gold',array[362,136,358,469,365,323,138,334,457,490,326,108,326,392,542,368,156,388]::integer[]),
  ('tee-la-vista-club-current-red',array[331,115,297,447,319,270,116,306,430,446,306,99,292,364,503,343,135,357]::integer[])
), expanded as (
  select tee_id,ordinality::integer hole_number,yards
  from definitions cross join lateral unnest(yardages) with ordinality as value(yards,ordinality)
)
insert into public.golf_tee_hole_yardages (id,course_id,tee_id,hole_id,yards,provider,verified_at,tee_par,tee_stroke_index)
select e.tee_id||':hole:'||e.hole_number,'course-la-vista-club-current',e.tee_id,
  'course-la-vista-club-current-hole-'||e.hole_number,e.yards,'BACKYARD_INTERNAL','2026-09-28T00:00:00Z',h.par,h.stroke_index
from expanded e join public.golf_holes h on h.course_id='course-la-vista-club-current' and h.hole_number=e.hole_number
on conflict (id) do update set yards=excluded.yards,tee_par=excluded.tee_par,tee_stroke_index=excluded.tee_stroke_index;

insert into public.course_scorecard_profiles (
  id,course_id,name,provenance,source_provider,source_external_id,evidence,verified_at,
  active,historical,default_for_play,status,notes
) values (
  'scorecard-la-vista-club-current','course-la-vista-club-current','Par 72 — Tarjeta del club — Actual',
  'CLUB_SCORECARD_VERIFIED','CLUB_SCORECARD','la-vista-club-current-2026-09-28',
  jsonb_build_array(
    jsonb_build_object('kind','OWNER_SUPPLIED_AGGREGATE_CORRECTION','receivedAt','2026-09-28'),
    jsonb_build_object('kind','VERSIONED_BACKYARD_HOLE_CARD','catalogVersion','la-vista-card-v2')
  ),
  '2026-09-28T00:00:00Z',true,false,true,'PUBLISHED',
  'Current club card. GHIN remains an independent provider-owned layout/profile.'
) on conflict (id) do update set
  name=excluded.name,provenance=excluded.provenance,source_provider=excluded.source_provider,
  source_external_id=excluded.source_external_id,evidence=excluded.evidence,verified_at=excluded.verified_at,
  active=true,historical=false,default_for_play=true,status='PUBLISHED',notes=excluded.notes;

insert into public.course_scorecard_profile_tees (
  profile_id,tee_id,rating_gender,par,course_rating,slope_rating,total_yards,provider_status,active
) values
  ('scorecard-la-vista-club-current','tee-la-vista-club-current-blue','MEN',72,74.3,146,7230,'ACTIVE',true),
  ('scorecard-la-vista-club-current','tee-la-vista-club-current-white','MEN',72,70.8,125,6590,'ACTIVE',true),
  ('scorecard-la-vista-club-current','tee-la-vista-club-current-white','WOMEN',72,77.4,153,6590,'ACTIVE',true),
  ('scorecard-la-vista-club-current','tee-la-vista-club-current-gold','MEN',72,68.4,121,6038,'ACTIVE',true),
  ('scorecard-la-vista-club-current','tee-la-vista-club-current-red','WOMEN',72,71.0,137,5476,'ACTIVE',true)
on conflict (profile_id,tee_id,rating_gender) do update set
  par=excluded.par,course_rating=excluded.course_rating,slope_rating=excluded.slope_rating,
  total_yards=excluded.total_yards,provider_status='ACTIVE',active=true;

insert into public.course_scorecard_profile_holes (profile_id,hole_id,rating_gender,hole_number,stroke_index)
select 'scorecard-la-vista-club-current',id,'UNSPECIFIED',hole_number,stroke_index
from public.golf_holes where course_id='course-la-vista-club-current'
on conflict (profile_id,hole_id,rating_gender) do update set
  hole_number=excluded.hole_number,stroke_index=excluded.stroke_index;

commit;

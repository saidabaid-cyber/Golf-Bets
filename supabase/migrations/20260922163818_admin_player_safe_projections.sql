-- Player-safe, least-privilege projections for Preview/runtime catalog reads.
-- Drafts, actor IDs, internal notes, audit rows and private documents never
-- cross these functions. The Admin ledger itself remains inaccessible to anon.

create or replace function public.player_published_catalog_v1(
  requested_entity_types text[] default array['COURSE','CLUB_EQUIPMENT','BALL','SHAFT']::text[]
)
returns table(
  entity_type text,
  entity_id text,
  version integer,
  status text,
  payload jsonb,
  effective_from timestamptz,
  effective_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select revision.entity_type, revision.entity_id, revision.version,
         revision.status,
         case revision.entity_type
           when 'COURSE' then jsonb_strip_nulls(jsonb_build_object(
             'sourceName', revision.payload->'sourceName',
             'sourceUrl', revision.payload->'sourceUrl',
             'verifiedAt', revision.payload->'verifiedAt',
             'club', jsonb_strip_nulls(jsonb_build_object(
               'id', revision.payload#>'{club,id}',
               'name', revision.payload#>'{club,name}',
               'aliases', coalesce(revision.payload#>'{club,aliases}', '[]'::jsonb),
               'country', revision.payload#>'{club,country}',
               'stateRegion', revision.payload#>'{club,stateRegion}',
               'city', revision.payload#>'{club,city}',
               'address', revision.payload#>'{club,address}',
               'latitude', revision.payload#>'{club,latitude}',
               'longitude', revision.payload#>'{club,longitude}',
               'timezone', revision.payload#>'{club,timezone}',
               'website', revision.payload#>'{club,website}',
               'active', revision.payload#>'{club,active}'
             )),
             'course', jsonb_strip_nulls(jsonb_build_object(
               'id', revision.payload#>'{course,id}',
               'clubId', revision.payload#>'{course,clubId}',
               'name', revision.payload#>'{course,name}',
               'aliases', coalesce(revision.payload#>'{course,aliases}', '[]'::jsonb),
               'holes', revision.payload#>'{course,holes}',
               'latitude', revision.payload#>'{course,latitude}',
               'longitude', revision.payload#>'{course,longitude}',
               'active', revision.payload#>'{course,active}'
             )),
             'tees', coalesce(revision.payload->'tees', '[]'::jsonb),
             'holes', coalesce(revision.payload->'holes', '[]'::jsonb),
             'teeHoleYardages', coalesce(revision.payload->'teeHoleYardages', '[]'::jsonb)
           ))
           else jsonb_strip_nulls(jsonb_build_object(
             'id', revision.payload->'id',
             'aliases', coalesce(revision.payload->'aliases', '[]'::jsonb),
             'brand', revision.payload->'brand',
             'model', revision.payload->'model',
             'generation', revision.payload->'generation',
             'year', revision.payload->'year',
             'active', revision.payload->'active',
             'bagEligible', revision.payload->'bagEligible',
             'fitEligible', revision.payload->'fitEligible',
             'sourceName', revision.payload->'sourceName',
             'sourceUrl', revision.payload->'sourceUrl',
             'sourceType', revision.payload->'sourceType',
             'confidence', revision.payload->'confidence',
             'verifiedAt', revision.payload->'verifiedAt',
             'officialUrl', revision.payload->'officialUrl',
             'category', revision.payload->'category',
             'subCategory', revision.payload->'subCategory',
             'handedness', coalesce(revision.payload->'handedness', '[]'::jsonb),
             'lofts', coalesce(revision.payload->'lofts', '[]'::jsonb),
             'variants', coalesce(revision.payload->'variants', '[]'::jsonb),
             'standardLength', revision.payload->'standardLength',
             'lie', revision.payload->'lie',
             'headVolume', revision.payload->'headVolume',
             'setMakeup', revision.payload->'setMakeup',
             'stockShafts', coalesce(revision.payload->'stockShafts', '[]'::jsonb),
             'stockFlexes', coalesce(revision.payload->'stockFlexes', '[]'::jsonb),
             'usage', revision.payload->'usage',
             'oemStockOrAftermarket', revision.payload->'oemStockOrAftermarket',
             'weightOptions', coalesce(revision.payload->'weightOptions', '[]'::jsonb),
             'flexOptions', coalesce(revision.payload->'flexOptions', '[]'::jsonb),
             'weight', revision.payload->'weight',
             'flex', coalesce(revision.payload->'flex', '[]'::jsonb),
             'launch', revision.payload->'launch',
             'spin', revision.payload->'spin',
             'material', revision.payload->'material',
             'torqueRange', coalesce(revision.payload->'torqueRange', '[]'::jsonb)
           ) || jsonb_build_object(
             'torque', revision.payload->'torque',
             'tipDiameter', revision.payload->'tipDiameter',
             'buttDiameter', revision.payload->'buttDiameter',
             'coverMaterial', revision.payload->'coverMaterial',
             'construction', revision.payload->'construction',
             'constructionPieces', revision.payload->'constructionPieces',
             'compression', revision.payload->'compression',
             'compressionType', revision.payload->'compressionType',
             'compressionSource', revision.payload->'compressionSource',
             'compressionSourceUrl', revision.payload->'compressionSourceUrl',
             'flight', revision.payload->'flight',
             'driverSpin', revision.payload->'driverSpin',
             'ironSpin', revision.payload->'ironSpin',
             'shortGameSpin', revision.payload->'shortGameSpin',
             'feel', revision.payload->'feel',
             'colors', coalesce(revision.payload->'colors', '[]'::jsonb),
             'priceTier', revision.payload->'priceTier',
             'targetProfile', coalesce(revision.payload->'targetProfile', '[]'::jsonb)
           ))
         end as payload,
         revision.effective_from,
         revision.effective_until
  from public.admin_catalog_revisions revision
  where revision.entity_type = any(
    array(
      select requested
      from unnest(coalesce(requested_entity_types, array[]::text[])) requested
      where requested = any(array['COURSE','CLUB_EQUIPMENT','BALL','SHAFT']::text[])
    )
  )
    and revision.status in ('PUBLISHED','SUPERSEDED','ARCHIVED')
  order by revision.entity_type, revision.entity_id, revision.version;
$$;

revoke all on function public.player_published_catalog_v1(text[]) from public;
grant execute on function public.player_published_catalog_v1(text[]) to anon, authenticated, service_role;

create or replace function public.player_course_operations_v1(
  requested_course_id text,
  effective_at timestamptz default now(),
  requested_competition_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with public_competition as (
    select revision.entity_id::uuid as id, revision.version,
      jsonb_strip_nulls(jsonb_build_object(
        'id', revision.payload->'id',
        'name', revision.payload->'name',
        'type', revision.payload->'type',
        'courseId', revision.payload->'courseId',
        'startsAt', revision.payload->'startsAt',
        'endsAt', revision.payload->'endsAt',
        'status', revision.payload->'status',
        'organizer', revision.payload->'organizer',
        'visibility', revision.payload->'visibility',
        'description', revision.payload->'description',
        'format', revision.payload->'format',
        'handicapMaximum', revision.payload->'handicapMaximum',
        'handicapPercentage', revision.payload->'handicapPercentage',
        'tees', coalesce(revision.payload->'tees', '[]'::jsonb),
        'prizes', revision.payload->'prizes',
        'closestToPin', revision.payload->'closestToPin',
        'tieBreak', revision.payload->'tieBreak',
        'specialRules', revision.payload->'specialRules'
      )) as payload
    from public.admin_catalog_revisions revision
    where requested_competition_id is not null
      and revision.entity_type = 'COMPETITION'
      and revision.entity_id = requested_competition_id::text
      and revision.status = 'PUBLISHED'
      and (revision.effective_from is null or revision.effective_from <= effective_at)
      and (revision.effective_until is null or revision.effective_until > effective_at)
      and revision.payload->>'visibility' = 'PUBLIC'
      and revision.payload->>'courseId' = requested_course_id
    order by revision.version desc
    limit 1
  ), eligible_configurations as (
    select configuration.*
    from public.course_configurations configuration
    where configuration.course_id = requested_course_id
      and configuration.status in ('SCHEDULED','PUBLISHED')
      and (configuration.effective_from is null or configuration.effective_from <= effective_at)
      and (configuration.effective_until is null or configuration.effective_until > effective_at)
      and (
        configuration.scope_type = 'COURSE'
        or (
          configuration.scope_type = 'COMPETITION'
          and configuration.competition_id = (select id from public_competition)
        )
      )
  ), configuration_projection as (
    select jsonb_build_object(
      'id', configuration.id,
      'courseId', configuration.course_id,
      'competitionId', configuration.competition_id,
      'scopeType', configuration.scope_type,
      'status', configuration.status,
      'version', configuration.version,
      'revisionHash', configuration.revision_hash,
      'effectiveFrom', configuration.effective_from,
      'effectiveUntil', configuration.effective_until,
      'holes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', hole.id,
          'sequence', hole.sequence,
          'runtimeHoleNumber', hole.runtime_hole_number,
          'displayLabel', hole.display_label,
          'sourceBaseHoleId', hole.source_base_hole_id,
          'sourceBaseHoleNumber', hole.source_base_hole_number,
          'kind', hole.kind,
          'playable', hole.playable,
          'parOverride', hole.par_override,
          'strokeIndexOverride', hole.stroke_index_override,
          'notes', hole.notes,
          'temporaryGreen', hole.temporary_green,
          'temporaryTee', hole.temporary_tee,
          'dropZoneNote', hole.drop_zone_note,
          'operationalNote', hole.operational_note
        ) order by hole.sequence)
        from public.course_configuration_holes hole
        where hole.configuration_id = configuration.id
      ), '[]'::jsonb),
      'teeHoles', coalesce((
        select jsonb_agg(jsonb_build_object(
          'configurationHoleId', yardage.configuration_hole_id,
          'teeId', yardage.tee_id,
          'yardsOverride', yardage.yards_override,
          'source', yardage.source,
          'verifiedAt', yardage.verified_at
        ))
        from public.course_configuration_tee_holes yardage
        join public.course_configuration_holes hole on hole.id = yardage.configuration_hole_id
        where hole.configuration_id = configuration.id
      ), '[]'::jsonb),
      'ratings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'teeId', rating.tee_id,
          'rating', rating.rating,
          'slope', rating.slope,
          'category', rating.category,
          'source', rating.source,
          'verifiedAt', rating.verified_at
        ))
        from public.course_configuration_ratings rating
        where rating.configuration_id = configuration.id
      ), '[]'::jsonb)
    ) as value
    from eligible_configurations configuration
  ), effective_local_rules as (
    select coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', rule->'id',
        'title', rule->'title',
        'body', rule->'body',
        'shortSummary', rule->'shortSummary',
        'category', rule->'category',
        'holeRefs', coalesce(rule->'holeRefs', '[]'::jsonb),
        'displayOrder', rule->'displayOrder',
        'active', rule->'active'
      )))
      from jsonb_array_elements(coalesce(revision.payload->'rules', '[]'::jsonb)) rule
    ), '[]'::jsonb) as rules, revision.version
    from public.admin_catalog_revisions revision
    where revision.entity_type = 'LOCAL_RULE_SET'
      and revision.scope_type = 'COURSE'
      and revision.scope_id = requested_course_id
      and revision.status = 'PUBLISHED'
      and (revision.effective_from is null or revision.effective_from <= effective_at)
      and (revision.effective_until is null or revision.effective_until > effective_at)
    order by revision.version desc
    limit 1
  ), approved_documents as (
    select jsonb_build_object(
      'id', document.id,
      'name', document.original_name,
      'mimeType', document.mime_type,
      'attribution', document.attribution,
      'ownerEntityType', document.owner_entity_type
    ) as value
    from public.admin_documents document
    where document.scope_type = 'COURSE'
      and document.scope_id = requested_course_id
      and document.rights_status = 'APPROVED'
      and document.visibility = 'PLAYER'
      and document.owner_entity_type in ('COURSE','LOCAL_RULE_SET')
  ), competition_rule_projection as (
    select jsonb_build_object('id', rule_set.id, 'version', rule_set.version, 'title', rule_set.title) as value
    from public.competition_rule_sets rule_set
    join public_competition competition on competition.id = rule_set.competition_id
    where rule_set.status = 'PUBLISHED' and rule_set.version = competition.version
    limit 1
  )
  select jsonb_build_object(
    'configurations', coalesce((select jsonb_agg(value) from configuration_projection), '[]'::jsonb),
    'localRules', coalesce((select rules from effective_local_rules), '[]'::jsonb),
    'localRuleVersion', (select version from effective_local_rules),
    'documents', coalesce((select jsonb_agg(value) from approved_documents), '[]'::jsonb),
    'competition', (select payload from public_competition),
    'competitionId', (select id from public_competition),
    'competitionRuleSet', (select value from competition_rule_projection)
  );
$$;

revoke all on function public.player_course_operations_v1(text,timestamptz,uuid) from public;
grant execute on function public.player_course_operations_v1(text,timestamptz,uuid) to anon, authenticated, service_role;

create or replace function public.player_competition_rules_v1(requested_competition_id uuid, effective_at timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with competition as (
    select revision.version, jsonb_strip_nulls(jsonb_build_object(
      'id', revision.payload->'id',
      'name', revision.payload->'name',
      'type', revision.payload->'type',
      'courseId', revision.payload->'courseId',
      'startsAt', revision.payload->'startsAt',
      'endsAt', revision.payload->'endsAt',
      'status', revision.payload->'status',
      'organizer', revision.payload->'organizer',
      'visibility', revision.payload->'visibility',
      'description', revision.payload->'description',
      'format', revision.payload->'format',
      'handicapMaximum', revision.payload->'handicapMaximum',
      'handicapPercentage', revision.payload->'handicapPercentage',
      'tees', coalesce(revision.payload->'tees', '[]'::jsonb),
      'prizes', revision.payload->'prizes',
      'closestToPin', revision.payload->'closestToPin',
      'tieBreak', revision.payload->'tieBreak',
      'specialRules', revision.payload->'specialRules'
    )) as payload
    from public.admin_catalog_revisions revision
    where revision.entity_type = 'COMPETITION'
      and revision.entity_id = requested_competition_id::text
      and revision.status = 'PUBLISHED'
      and (revision.effective_from is null or revision.effective_from <= effective_at)
      and (revision.effective_until is null or revision.effective_until > effective_at)
      and revision.payload->>'visibility' = 'PUBLIC'
    order by revision.version desc
    limit 1
  ), rule_set as (
    select rules.id, rules.title, rules.version
    from public.competition_rule_sets rules
    join competition on competition.version = rules.version
    where rules.competition_id = requested_competition_id and rules.status = 'PUBLISHED'
    limit 1
  )
  select case when not exists(select 1 from competition) then null else jsonb_build_object(
    'competition', (select payload from competition),
    'ruleSet', (select jsonb_build_object('id', id, 'title', title, 'version', version) from rule_set),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rule.id,
        'category', rule.category,
        'title', rule.title,
        'body', rule.body,
        'displayOrder', rule.display_order,
        'active', rule.active
      ) order by rule.display_order)
      from public.competition_rules rule
      where rule.rule_set_id = (select id from rule_set) and rule.active
    ), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.player_competition_rules_v1(uuid,timestamptz) from public;
grant execute on function public.player_competition_rules_v1(uuid,timestamptz) to anon, authenticated, service_role;

comment on function public.player_published_catalog_v1(text[]) is 'Player-safe published/historical catalog projection; excludes drafts, actors, internal notes and audit data.';
comment on function public.player_course_operations_v1(text,timestamptz,uuid) is 'Effective player-safe Course operations projection; excludes draft and private competition data.';
comment on function public.player_competition_rules_v1(uuid,timestamptz) is 'Public Competition regulation projection with only published, effective content.';

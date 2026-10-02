-- PREPARED ONLY: requires explicit controlled DEV apply approval.
-- Preserves the existing public contract, historical versions and privileges.
-- Installs a read filter and permits status-only archival of retired metadata.
-- No catalog/account rows are changed on apply. Republish/edits stay blocked.
begin;
create or replace function public.player_published_catalog_v1(
  requested_entity_types text[] default array['COURSE','CLUB_EQUIPMENT','BALL','SHAFT']::text[]
)
returns table(entity_type text,entity_id text,version integer,status text,payload jsonb,effective_from timestamptz,effective_until timestamptz)
language sql stable security definer set search_path=''
as $$
  select revision.entity_type,revision.entity_id,revision.version,revision.status,
    case revision.entity_type
      when 'COURSE' then jsonb_strip_nulls(jsonb_build_object(
        'dataEnvironment',revision.data_environment,
        'sourceName',revision.payload->'sourceName','sourceUrl',revision.payload->'sourceUrl','verifiedAt',revision.payload->'verifiedAt',
        'club',jsonb_strip_nulls(jsonb_build_object(
          'id',revision.payload#>'{club,id}','name',revision.payload#>'{club,name}','aliases',coalesce(revision.payload#>'{club,aliases}','[]'::jsonb),
          'country',revision.payload#>'{club,country}','stateRegion',revision.payload#>'{club,stateRegion}','city',revision.payload#>'{club,city}',
          'address',revision.payload#>'{club,address}','latitude',revision.payload#>'{club,latitude}','longitude',revision.payload#>'{club,longitude}',
          'timezone',revision.payload#>'{club,timezone}','website',revision.payload#>'{club,website}','active',revision.payload#>'{club,active}'
        )),
        'course',jsonb_strip_nulls(jsonb_build_object(
          'id',revision.payload#>'{course,id}','clubId',revision.payload#>'{course,clubId}','name',revision.payload#>'{course,name}',
          'aliases',coalesce(revision.payload#>'{course,aliases}','[]'::jsonb),'holes',revision.payload#>'{course,holes}',
          'latitude',revision.payload#>'{course,latitude}','longitude',revision.payload#>'{course,longitude}','active',revision.payload#>'{course,active}'
        )),
        'tees',coalesce(revision.payload->'tees','[]'::jsonb),'holes',coalesce(revision.payload->'holes','[]'::jsonb),
        'teeHoleYardages',coalesce(revision.payload->'teeHoleYardages','[]'::jsonb)
      ))
      else jsonb_strip_nulls(jsonb_build_object(
        'dataEnvironment',revision.data_environment,
        'id',revision.payload->'id','aliases',coalesce(revision.payload->'aliases','[]'::jsonb),'brand',revision.payload->'brand',
        'model',revision.payload->'model','generation',revision.payload->'generation','year',revision.payload->'year',
        'active',revision.payload->'active','bagEligible',revision.payload->'bagEligible','fitEligible',revision.payload->'fitEligible',
        'sourceName',revision.payload->'sourceName','sourceUrl',revision.payload->'sourceUrl','sourceType',revision.payload->'sourceType',
        'confidence',revision.payload->'confidence','verifiedAt',revision.payload->'verifiedAt','officialUrl',revision.payload->'officialUrl',
        'category',revision.payload->'category','subCategory',revision.payload->'subCategory','handedness',coalesce(revision.payload->'handedness','[]'::jsonb),
        'lofts',coalesce(revision.payload->'lofts','[]'::jsonb),'variants',coalesce(revision.payload->'variants','[]'::jsonb),
        'standardLength',revision.payload->'standardLength','lie',revision.payload->'lie','headVolume',revision.payload->'headVolume',
        'setMakeup',revision.payload->'setMakeup','stockShafts',coalesce(revision.payload->'stockShafts','[]'::jsonb),
        'stockFlexes',coalesce(revision.payload->'stockFlexes','[]'::jsonb),'usage',revision.payload->'usage',
        'oemStockOrAftermarket',revision.payload->'oemStockOrAftermarket','weightOptions',coalesce(revision.payload->'weightOptions','[]'::jsonb),
        'flexOptions',coalesce(revision.payload->'flexOptions','[]'::jsonb),'weight',revision.payload->'weight',
        'flex',coalesce(revision.payload->'flex','[]'::jsonb),'launch',revision.payload->'launch','spin',revision.payload->'spin',
        'material',revision.payload->'material','torqueRange',coalesce(revision.payload->'torqueRange','[]'::jsonb)
      ) || jsonb_build_object(
        'torque',revision.payload->'torque','tipDiameter',revision.payload->'tipDiameter','buttDiameter',revision.payload->'buttDiameter',
        'coverMaterial',revision.payload->'coverMaterial','construction',revision.payload->'construction',
        'constructionPieces',revision.payload->'constructionPieces','compression',revision.payload->'compression',
        'compressionType',revision.payload->'compressionType','compressionSource',revision.payload->'compressionSource',
        'compressionSourceUrl',revision.payload->'compressionSourceUrl','flight',revision.payload->'flight',
        'driverSpin',revision.payload->'driverSpin','ironSpin',revision.payload->'ironSpin','shortGameSpin',revision.payload->'shortGameSpin',
        'feel',revision.payload->'feel','colors',coalesce(revision.payload->'colors','[]'::jsonb),'priceTier',revision.payload->'priceTier',
        'targetProfile',coalesce(revision.payload->'targetProfile','[]'::jsonb)
      )) end,
    revision.effective_from,revision.effective_until
  from public.admin_catalog_revisions revision
  where revision.entity_type=any(array(
    select requested from unnest(coalesce(requested_entity_types,array[]::text[])) requested
    where requested=any(array['COURSE','CLUB_EQUIPMENT','BALL','SHAFT']::text[])
  ))
    and revision.status in ('PUBLISHED','SUPERSEDED','ARCHIVED')
    and revision.data_environment='PRODUCTION'
    and (revision.status<>'PUBLISHED' or not exists (
      select 1 from public.admin_catalog_lifecycle lifecycle
      where lifecycle.entity_type=revision.entity_type
        and lifecycle.entity_id=revision.entity_id and lifecycle.state='DELETED'
    ))
  order by revision.entity_type,revision.entity_id,revision.version;
$$;
revoke all on function public.player_published_catalog_v1(text[]) from public;
grant execute on function public.player_published_catalog_v1(text[]) to anon,authenticated,service_role;

create or replace function private.admin_ux_revision_guard_v3()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.admin_catalog_lifecycle
    where entity_type=new.entity_type and entity_id=new.entity_id and state='DELETED') then
    if tg_op='UPDATE' and new.status='ARCHIVED' and old.status<>'ARCHIVED'
      and (to_jsonb(new)-array['status','updated_at']::text[])
        =(to_jsonb(old)-array['status','updated_at']::text[])
      and private.admin_has_scope_v1(new.entity_type,new.scope_type,new.scope_id,'ARCHIVE') then
      return new;
    end if;
    raise exception 'ENTITY_PERMANENTLY_RETIRED';
  end if;
  return new;
end $$;
revoke all on function private.admin_ux_revision_guard_v3() from public,anon,authenticated;

commit;


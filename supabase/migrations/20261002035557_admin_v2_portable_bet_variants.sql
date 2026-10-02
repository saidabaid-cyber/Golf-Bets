-- Portable schema/logic replacement; installs no fixtures or automatic data actions.
begin;
create table if not exists public.admin_bet_variant_versions(
 id uuid primary key default gen_random_uuid(),variant_id uuid not null,version integer not null,base_version integer not null,
 status text not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
 payload jsonb not null check(jsonb_typeof(payload)='object'),preview_hash text,
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now(),
 published_by uuid references auth.users(id) on delete restrict,published_at timestamptz,unique(variant_id,version)
);
create unique index if not exists bet_variant_current_v3 on public.admin_bet_variant_versions(variant_id) where status='PUBLISHED';
create index if not exists bet_variant_status_v3 on public.admin_bet_variant_versions(status,created_at desc);
alter table public.admin_bet_variant_versions enable row level security;
revoke all on public.admin_bet_variant_versions from public,anon,authenticated;
grant select on public.admin_bet_variant_versions to authenticated;
drop policy if exists bet_variant_admin_read_v3 on public.admin_bet_variant_versions;
create policy bet_variant_admin_read_v3 on public.admin_bet_variant_versions for select to authenticated
using(private.account_data_access_allowed() and private.admin_has_scope_v1('BET_PRESENTATION','GLOBAL',null,'READ'));

-- Contract generated from betVariantCapability and checked by regression tests.
create or replace function private.admin_validate_bet_variant_v3(values_json jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare contracts jsonb:='{"rabbits":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"hcpPct","label":"Handicap · porcentaje","type":"number","min":0,"max":100},{"key":"mode","label":"Modalidad","type":"select","options":["continuous","three_hole_blocks"]},{"key":"accumulate","label":"Acumular","type":"checkbox"}],"defaults":{"value":100,"hcpPct":100,"mode":"continuous","accumulate":true},"minimum":2,"maximum":5},"skins":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"hcpPct","label":"Handicap · porcentaje","type":"number","min":0,"max":100},{"key":"mode","label":"Carry","type":"select","options":["carry","no_carry"]}],"defaults":{"value":50,"hcpPct":100,"mode":"carry"},"minimum":2,"maximum":5},"units":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000}],"defaults":{"value":100},"minimum":2,"maximum":5},"foursome":{"fields":[{"key":"fixedValue","label":"Monto fijo","type":"number","min":0.01,"max":1000000},{"key":"pointValue","label":"Monto por punto","type":"number","min":0.01,"max":1000000},{"key":"hcpPct","label":"Handicap · porcentaje","type":"number","min":0,"max":100},{"key":"pressureMultiplier","label":"Multiplicador de presión","type":"number","min":1,"max":5}],"defaults":{"fixedValue":200,"pointValue":100,"hcpPct":100,"pressureMultiplier":1},"minimum":4,"maximum":4},"ball_friend":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"hcpPct","label":"Handicap · porcentaje","type":"number","min":0,"max":100}],"defaults":{"value":20,"hcpPct":100},"minimum":4,"maximum":4},"monkey":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"hcpPct","label":"Handicap · porcentaje","type":"number","min":0,"max":100}],"defaults":{"value":20,"hcpPct":100},"minimum":3,"maximum":3},"polla_first":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"hcpPct","label":"Handicap · porcentaje","type":"number","min":0,"max":100}],"defaults":{"value":100,"hcpPct":100},"minimum":2,"maximum":5},"polla_second":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"hcpPct","label":"Handicap · porcentaje","type":"number","min":0,"max":100}],"defaults":{"value":100,"hcpPct":100},"minimum":2,"maximum":5},"polla_total":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"hcpPct","label":"Handicap · porcentaje","type":"number","min":0,"max":100}],"defaults":{"value":100,"hcpPct":100},"minimum":2,"maximum":5},"mini_polla":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"hcpPct","label":"Handicap · porcentaje","type":"number","min":0,"max":100}],"defaults":{"value":100,"hcpPct":100},"minimum":2,"maximum":5},"vipers":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"secondNinePressed","label":"Presión segunda vuelta","type":"checkbox"},{"key":"secondNineMultiplier","label":"Multiplicador de presión","type":"number","min":1,"max":5}],"defaults":{"value":100,"secondNinePressed":false,"secondNineMultiplier":2},"minimum":2,"maximum":5},"camels":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"secondNinePressed","label":"Presión segunda vuelta","type":"checkbox"},{"key":"secondNineMultiplier","label":"Multiplicador de presión","type":"number","min":1,"max":5}],"defaults":{"value":100,"secondNinePressed":false,"secondNineMultiplier":2},"minimum":2,"maximum":5},"fish":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"secondNinePressed","label":"Presión segunda vuelta","type":"checkbox"},{"key":"secondNineMultiplier","label":"Multiplicador de presión","type":"number","min":1,"max":5}],"defaults":{"value":100,"secondNinePressed":false,"secondNineMultiplier":2},"minimum":2,"maximum":5},"loba":{"fields":[{"key":"value","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"unitValue","label":"Monto predeterminado","type":"number","min":0.01,"max":1000000},{"key":"hcpPct","label":"Handicap · porcentaje","type":"number","min":0,"max":100}],"defaults":{"value":100,"unitValue":100,"hcpPct":100},"minimum":4,"maximum":4},"individual_nassau":{"fields":[{"key":"baseValue","label":"Monto por componente","type":"number","min":0.01,"max":1000000},{"key":"carryEnabled","label":"Carry","type":"checkbox"},{"key":"pressureMultiplier","label":"Multiplicador de presión","type":"number","min":1,"max":5}],"defaults":{"baseValue":100,"carryEnabled":false,"pressureMultiplier":1},"minimum":2,"maximum":5}}'::jsonb;cap jsonb;field jsonb;key text;value jsonb;number_value numeric;
begin
 if jsonb_typeof(values_json) is distinct from 'object' or pg_column_size(values_json)>20000 then raise exception 'INVALID_VARIANT';end if;
 cap:=contracts->(values_json->>'engine');if cap is null then raise exception 'ENGINE_REQUIRES_DEVELOPMENT';end if;
 for key in select jsonb_object_keys(values_json) loop if key<>all(array['engine','title','description','active','order','minPlayers','maxPlayers','config']) then raise exception 'PROTECTED_FIELD';end if;end loop;
 if jsonb_typeof(values_json->'title') is distinct from 'string' or length(trim(values_json->>'title')) not between 1 and 160
  or jsonb_typeof(values_json->'description') is distinct from 'string' or length(values_json->>'description')>2000
  or jsonb_typeof(values_json->'active') is distinct from 'boolean'
  or jsonb_typeof(values_json->'config') is distinct from 'object' then raise exception 'INVALID_VARIANT';end if;
 foreach key in array array['minPlayers','maxPlayers','order'] loop
  if jsonb_typeof(values_json->key) is distinct from 'number' or (values_json->>key)::numeric<>trunc((values_json->>key)::numeric) then raise exception 'INVALID_RANGE';end if;
 end loop;
 if (values_json->>'minPlayers')::integer<(cap->>'minimum')::integer or (values_json->>'maxPlayers')::integer>(cap->>'maximum')::integer
 or (values_json->>'minPlayers')::integer>(values_json->>'maxPlayers')::integer or (values_json->>'order')::integer not between 0 and 1000 then raise exception 'INVALID_RANGE';end if;
 for key in select jsonb_object_keys(values_json->'config') loop
  if not exists(select 1 from jsonb_array_elements(cap->'fields') f where f->>'key'=key) then raise exception 'UNSUPPORTED_ENGINE_OPTION';end if;
 end loop;
 for field in select * from jsonb_array_elements(cap->'fields') loop
  key:=field->>'key';value:=values_json->'config'->key;
  if field->>'type'='checkbox' then if jsonb_typeof(value) is distinct from 'boolean' then raise exception 'INVALID_OPTION';end if;
  elsif field->>'type'='number' then
   if jsonb_typeof(value) is distinct from 'number' then raise exception 'INVALID_OPTION';end if;
   number_value:=(value#>>'{}')::numeric;
   if number_value<(field->>'min')::numeric or number_value>(field->>'max')::numeric or key like '%Multiplier' and number_value<>trunc(number_value) then raise exception 'INVALID_OPTION';end if;
  else if not (field->'options' ? (value#>>'{}')) then raise exception 'INVALID_OPTION';end if;
  end if;
 end loop;
end $$;
revoke all on function private.admin_validate_bet_variant_v3(jsonb) from public,anon,authenticated;

create or replace function public.admin_bet_variant_operation_v3(variant_key uuid,operation text,input_values jsonb default null,expected_version integer default 0,revision_id uuid default null,expected_hash text default null,change_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate public.admin_bet_variant_versions;prior public.admin_bet_variant_versions;key uuid;current_version integer;next_version integer;hash text;
begin
 if not private.account_data_access_allowed() or not private.admin_has_scope_v1('BET_PRESENTATION','GLOBAL',null,case operation when 'draft' then 'CREATE_DRAFT' when 'preview' then 'READ' when 'archive' then 'ARCHIVE' else 'PUBLISH' end) then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
 if operation='draft' then
  perform private.admin_validate_bet_variant_v3(input_values);
  key:=coalesce(variant_key,gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended('bet-variant:'||key::text,0));
  select * into prior from public.admin_bet_variant_versions where variant_id=key and status='PUBLISHED';
  current_version:=coalesce(prior.version,0);
  if expected_version is null or expected_version<>current_version then raise exception 'STALE_VARIANT' using errcode='40001';end if;
  if prior.id is not null and prior.payload->>'engine' is distinct from input_values->>'engine' then raise exception 'ENGINE_IMMUTABLE';end if;
  select coalesce(max(version),0)+1 into next_version from public.admin_bet_variant_versions where variant_id=key;
  insert into public.admin_bet_variant_versions(variant_id,version,base_version,payload,created_by) values(key,next_version,current_version,input_values,(select auth.uid())) returning * into candidate;
  perform private.admin_audit_v1('SAVE_BET_VARIANT','BET_PRESENTATION',key::text,prior.payload,candidate.payload,'Guardar variante',null);
  return jsonb_build_object('id',candidate.id,'variantId',key,'status','DRAFT');
 end if;
 select variant_id into key from public.admin_bet_variant_versions where id=revision_id;
 if key is null then raise exception 'VARIANT_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('bet-variant:'||key::text,0));
 select * into candidate from public.admin_bet_variant_versions where id=revision_id for update;
 select * into prior from public.admin_bet_variant_versions where variant_id=key and status='PUBLISHED' for update;
 if operation='preview' then
  if candidate.status<>'DRAFT' then raise exception 'DRAFT_REQUIRED';end if;
  hash:=encode(sha256(convert_to(candidate.payload::text,'UTF8')),'hex');
  update public.admin_bet_variant_versions set preview_hash=hash where id=candidate.id;
  perform private.admin_audit_v1('PREVIEW_BET_VARIANT','BET_PRESENTATION',key::text,prior.payload,candidate.payload,null,null);
  return jsonb_build_object('id',candidate.id,'previewHash',hash,'before',coalesce(prior.payload,'{}'::jsonb),'after',candidate.payload);
 end if;
 if length(trim(coalesce(change_reason,''))) not between 3 and 1000 then raise exception 'REASON_REQUIRED';end if;
 if operation='archive' then
  if candidate.status<>'PUBLISHED' then raise exception 'PUBLISHED_REQUIRED';end if;
  update public.admin_bet_variant_versions set status='ARCHIVED' where id=candidate.id;
  perform private.admin_audit_v1('ARCHIVE_BET_VARIANT','BET_PRESENTATION',key::text,candidate.payload,jsonb_build_object('status','ARCHIVED'),change_reason,null);
  return jsonb_build_object('status','ARCHIVED');
 end if;
 if operation<>'publish' or candidate.status<>'DRAFT' or expected_hash is null or candidate.preview_hash is distinct from expected_hash or expected_hash<>encode(sha256(convert_to(candidate.payload::text,'UTF8')),'hex')
  or candidate.base_version<>coalesce(prior.version,0) then raise exception 'STALE_PREVIEW_OR_VARIANT';end if;
 perform private.admin_validate_bet_variant_v3(candidate.payload);
 update public.admin_bet_variant_versions set status='SUPERSEDED' where id=prior.id;
 update public.admin_bet_variant_versions set status='PUBLISHED',published_by=(select auth.uid()),published_at=now() where id=candidate.id;
 perform private.admin_audit_v1('PUBLISH_BET_VARIANT','BET_PRESENTATION',key::text,prior.payload,candidate.payload,change_reason,null);
 return jsonb_build_object('id',candidate.id,'variantId',key,'status','PUBLISHED');
end $$;
revoke all on function public.admin_bet_variant_operation_v3(uuid,text,jsonb,integer,uuid,text,text) from public,anon;
grant execute on function public.admin_bet_variant_operation_v3(uuid,text,jsonb,integer,uuid,text,text) to authenticated;

create or replace function public.player_bet_variants_v3() returns table(id uuid,version integer,engine text,title text,description text,active boolean,"order" integer,"minPlayers" integer,"maxPlayers" integer,config jsonb)
language sql stable security definer set search_path='' as $$
 select variant_id,version,payload->>'engine',payload->>'title',payload->>'description',true,(payload->>'order')::integer,(payload->>'minPlayers')::integer,(payload->>'maxPlayers')::integer,payload->'config'
 from public.admin_bet_variant_versions where status='PUBLISHED' and payload->>'active'='true' order by (payload->>'order')::integer,created_at limit 200
$$;
revoke all on function public.player_bet_variants_v3() from public;
grant execute on function public.player_bet_variants_v3() to anon,authenticated;
commit;

-- REVIEW DRAFT ONLY: NOT APPLIED. Target only gvzeymebltssgjkvksxt.
-- Original automatic data reconciliation/cleanup omitted pending explicit approval.
-- Shared history must not retain an Auth UUID inside composite local player
-- keys such as `account:<uuid>` or `qa-player-<uuid>`. Replace the UUID in
-- every JSON key/scalar consistently within its canonical container while
-- preserving scores, putts, bets and unrelated participants.

begin;


create or replace function private.account_deleted_identity_token(
  container_namespace text,
  target_user uuid
)
returns text
language sql
immutable
strict
set search_path=''
as $$
  -- Keep the replacement exactly UUID-sized (36 characters). Several
  -- relational player-key contracts cap the complete key at 120 characters,
  -- so expanding a UUID in-place could otherwise make account deletion fail.
  select 'deleted-'||left(encode(
    extensions.digest(
      convert_to(container_namespace||':'||target_user::text,'UTF8'),
      'sha256'
    ),
    'hex'
  ),28)
$$;

revoke all on function private.account_deleted_identity_token(text,uuid) from public,anon,authenticated;


create or replace function private.account_replace_deleted_identity_text(
  value text,
  target_user uuid,
  container_namespace text
)
returns text
language sql
immutable
strict
set search_path=''
as $$
  -- UUID text is semantically case-insensitive. Normalize both a raw UUID and
  -- a previously emitted tombstone so uppercase/offline copies cannot bypass
  -- stale-write protections or create a second spelling of the same identity.
  select regexp_replace(
    regexp_replace(
      value,
      target_user::text,
      private.account_deleted_identity_token(container_namespace,target_user),
      'gi'
    ),
    private.account_deleted_identity_token(container_namespace,target_user),
    private.account_deleted_identity_token(container_namespace,target_user),
    'gi'
  )
$$;

revoke all on function private.account_replace_deleted_identity_text(text,uuid,text) from public,anon,authenticated;


create or replace function private.account_scrub_marked_deleted_json(value jsonb)
returns jsonb
language plpgsql
immutable
strict
set search_path=''
as $$
declare
  output jsonb;
  member record;
  marked boolean;
begin
  if jsonb_typeof(value)='array' then
    select coalesce(jsonb_agg(private.account_scrub_marked_deleted_json(item) order by ordinal),'[]'::jsonb)
    into output from jsonb_array_elements(value) with ordinality as element(item,ordinal);
    return output;
  elsif jsonb_typeof(value)='object' then
    marked:=lower(coalesce(value->>'identityDeleted','false'))='true';
    output:='{}'::jsonb;
    for member in select key,nested from jsonb_each(value) as item(key,nested)
    loop
      -- A marker alone no longer identifies which UUID was deleted. Redact
      -- visual/contact PII, but never guess that another actor/author field in
      -- the same object belongs to the deleted account.
      if marked and member.key in (
        'name','playerName','opponentName','displayName','display_name',
        'firstName','lastName','first_name','last_name','username',
        'recipientLabel','recipient_label','ownerName','owner_name'
      ) then
        output:=output||jsonb_build_object(member.key,'Jugador eliminado');
      elsif marked and member.key in (
        'email','replyEmail','reply_email','phone','avatar','avatarUrl',
        'avatar_url','avatarConfig','photoUrl','photo_url','photoDataUrl',
        'emoji','profilePhoto','profile_photo','ownerAvatar','owner_avatar',
        'ownerPhoto','owner_photo','ownerPlayerSnapshot','ownerBagSnapshot'
      ) then
        output:=output||jsonb_build_object(member.key,null);
      else
        output:=output||jsonb_build_object(member.key,private.account_scrub_marked_deleted_json(member.nested));
      end if;
    end loop;
    return output;
  end if;
  return value;
end;
$$;

revoke all on function private.account_scrub_marked_deleted_json(jsonb) from public,anon,authenticated;


-- Replace the earlier generic anonymizer with a provenance-safe definition.
-- A matching createdBy/actorId is unlinked, but does not make the surrounding
-- catalog/course/activity entity itself a deleted player. The signature stays
-- unchanged so existing lifecycle and Admin guard functions use this version.
create or replace function private.anonymize_account_json(
  value jsonb,
  target uuid,
  player_keys text[] default '{}'
)
returns jsonb
language plpgsql
immutable
set search_path=''
as $$
declare
  output jsonb;
  pair record;
  matched boolean;
  local_keys text[]:=player_keys;
  owner_matches boolean;
  target_text text:=target::text;
  subject_identity_keys constant text[]:=array[
    'accountUserId','profileId','userId','linkedUserId',
    'account_user_id','profile_id','user_id','linked_user_id',
    'id','playerId','player_id','roundPlayerId','round_player_id',
    'opponentId','opponent_id','localPlayerId','local_player_id','playerKey','player_key'
  ];
  nullable_identity_keys constant text[]:=array[
    'accountUserId','profileId','userId','actorId','authorId','createdBy','updatedBy',
    'inviterId','inviteeId','linkedUserId','confirmedBy','enteredBy','reviewedBy','verifiedBy','publishedBy',
    'account_user_id','profile_id','user_id','actor_id','author_id','created_by','updated_by',
    'inviter_id','invitee_id','linked_user_id','confirmed_by','entered_by','reviewed_by','verified_by','published_by',
    'requester_id','addressee_id','claimant_id','assigned_by','granted_by','recipient_id','target_user_id',
    'attester_id','source_equipment_user_id','changed_by'
  ];
begin
  if jsonb_typeof(value)='object' and jsonb_typeof(value->'players')='array' then
    select local_keys||coalesce(array_agg(player->>'id') filter(where player->>'id' is not null),'{}')
    into local_keys
    from jsonb_array_elements(value->'players') player
    where exists(
      select 1 from jsonb_each_text(player) identity
      where identity.key=any(subject_identity_keys)
        and position(target_text in lower(identity.value))>0
    );
  end if;

  if jsonb_typeof(value)='array' then
    select coalesce(jsonb_agg(private.anonymize_account_json(item,target,local_keys)),'[]'::jsonb)
    into output from jsonb_array_elements(value) item;
    return output;
  elsif jsonb_typeof(value)='object' then
    select exists(
      select 1 from jsonb_each_text(value) identity
      where identity.key=any(subject_identity_keys)
        and position(target_text in lower(identity.value))>0
    ) into matched;
    matched:=coalesce(matched,false)
      or value->>'id'=any(local_keys)
      or value->>'playerId'=any(local_keys)
      or value->>'roundPlayerId'=any(local_keys)
      or value->>'opponentId'=any(local_keys);
    owner_matches:=position(target_text in lower(coalesce(value->>'ownerId','')))>0
      or position(target_text in lower(coalesce(value->>'owner_id','')))>0
      or value->>'ownerId'=any(local_keys)
      or value->>'owner_id'=any(local_keys);

    output:='{}'::jsonb;
    for pair in select key,nested from jsonb_each(value) as item(key,nested)
    loop
      if pair.key=any(nullable_identity_keys)
        and jsonb_typeof(pair.nested)='string'
        and position(target_text in lower(pair.nested #>> '{}'))>0 then
        output:=output||jsonb_build_object(pair.key,null);
      elsif coalesce(matched,false) and pair.key in (
        'name','playerName','opponentName','displayName','display_name',
        'firstName','lastName','first_name','last_name','username',
        'recipientLabel','recipient_label'
      ) then
        output:=output||jsonb_build_object(pair.key,'Jugador eliminado');
      elsif coalesce(matched,false) and pair.key in (
        'email','replyEmail','reply_email','phone','avatar','avatarUrl',
        'avatar_url','avatarConfig','photoUrl','photo_url','photoDataUrl',
        'emoji','profilePhoto','profile_photo'
      ) then
        output:=output||jsonb_build_object(pair.key,null);
      elsif coalesce(owner_matches,false) and pair.key in ('ownerName','owner_name') then
        output:=output||jsonb_build_object(pair.key,'Jugador eliminado');
      elsif coalesce(owner_matches,false) and pair.key in (
        'ownerAvatar','owner_avatar','ownerPhoto','owner_photo',
        'ownerPlayerSnapshot','ownerBagSnapshot'
      ) then
        output:=output||jsonb_build_object(pair.key,null);
      else
        output:=output||jsonb_build_object(pair.key,private.anonymize_account_json(pair.nested,target,local_keys));
      end if;
    end loop;
    if coalesce(matched,false) then output:=output||'{"identityDeleted":true}'::jsonb; end if;
    return output;
  end if;
  return value;
end;
$$;

revoke all on function private.anonymize_account_json(jsonb,uuid,text[]) from public,anon,authenticated;


create or replace function private.account_scrub_json_uuid(
  value jsonb,
  target_user uuid,
  container_namespace text
)
returns jsonb
language plpgsql
immutable
strict
set search_path=''
as $$
declare
  output jsonb;
  target_text text:=target_user::text;
  replacement text:=private.account_deleted_identity_token(container_namespace,target_user);
  collision boolean;
  identity_matched boolean;
  owner_matched boolean;
  member record;
  subject_identity_keys constant text[]:=array[
    'accountUserId','profileId','userId','linkedUserId',
    'account_user_id','profile_id','user_id','linked_user_id',
    'id','playerId','player_id','roundPlayerId','round_player_id',
    'opponentId','opponent_id','localPlayerId','local_player_id','playerKey','player_key'
  ];
  nullable_identity_keys constant text[]:=array[
    'accountUserId','profileId','userId','actorId','authorId','createdBy','updatedBy',
    'inviterId','inviteeId','linkedUserId','confirmedBy','enteredBy','reviewedBy','verifiedBy','publishedBy',
    'account_user_id','profile_id','user_id','actor_id','author_id','created_by','updated_by',
    'inviter_id','invitee_id','linked_user_id','confirmed_by','entered_by','reviewed_by','verified_by','published_by',
    'requester_id','addressee_id','claimant_id','assigned_by','granted_by','recipient_id','target_user_id',
    'attester_id','source_equipment_user_id','changed_by'
  ];
begin
  if jsonb_typeof(value)='array' then
    select coalesce(
      jsonb_agg(
        private.account_scrub_json_uuid(item,target_user,container_namespace)
        order by ordinal
      ),
      '[]'::jsonb
    )
    into output
    from jsonb_array_elements(value) with ordinality as element(item,ordinal);
    return output;
  elsif jsonb_typeof(value)='object' then
    -- Only subject/player keys anchor visual PII. Provenance fields such as
    -- createdBy/updatedBy/actorId are unlinked below but must not turn the name
    -- of a course, catalog entry or activity into "Jugador eliminado".
    select exists(
      select 1 from jsonb_each_text(value) identity
      where identity.key=any(subject_identity_keys) and (
        position(target_text in lower(identity.value))>0
        or position(lower(replacement) in lower(identity.value))>0
      )
    ) into identity_matched;
    owner_matched:=position(target_text in lower(coalesce(value->>'ownerId','')))>0
      or position(target_text in lower(coalesce(value->>'owner_id','')))>0
      or position(lower(replacement) in lower(coalesce(value->>'ownerId','')))>0
      or position(lower(replacement) in lower(coalesce(value->>'owner_id','')))>0;

    select count(*)<>count(distinct private.account_replace_deleted_identity_text(key,target_user,container_namespace))
    into collision
    from jsonb_each(value);
    if collision then
      raise exception using
        errcode='23505',
        message='account_lifecycle_player_key_collision',
        detail='A shared JSON object collides after replacing a deleted identity key.';
    end if;

    output:='{}'::jsonb;
    for member in select key,nested from jsonb_each(value) as item(key,nested)
    loop
      if member.key=any(nullable_identity_keys)
        and jsonb_typeof(member.nested)='string'
        and (
          position(target_text in lower(member.nested #>> '{}'))>0
          or position(lower(replacement) in lower(member.nested #>> '{}'))>0
        ) then
        output:=output||jsonb_build_object(
          private.account_replace_deleted_identity_text(member.key,target_user,container_namespace),null
        );
      elsif identity_matched and member.key in (
        'name','playerName','opponentName','displayName','display_name',
        'firstName','lastName','first_name','last_name','username',
        'recipientLabel','recipient_label'
      ) then
        output:=output||jsonb_build_object(private.account_replace_deleted_identity_text(member.key,target_user,container_namespace),'Jugador eliminado');
      elsif identity_matched and member.key in (
        'email','replyEmail','reply_email','phone','avatar','avatarUrl',
        'avatar_url','avatarConfig','photoUrl','photo_url','photoDataUrl',
        'emoji','profilePhoto','profile_photo'
      ) then
        output:=output||jsonb_build_object(private.account_replace_deleted_identity_text(member.key,target_user,container_namespace),null);
      elsif owner_matched and member.key in ('ownerName','owner_name') then
        output:=output||jsonb_build_object(private.account_replace_deleted_identity_text(member.key,target_user,container_namespace),'Jugador eliminado');
      elsif owner_matched and member.key in (
        'ownerAvatar','owner_avatar','ownerPhoto','owner_photo',
        'ownerPlayerSnapshot','ownerBagSnapshot'
      ) then
        output:=output||jsonb_build_object(private.account_replace_deleted_identity_text(member.key,target_user,container_namespace),null);
      else
        output:=output||jsonb_build_object(
          private.account_replace_deleted_identity_text(member.key,target_user,container_namespace),
          private.account_scrub_json_uuid(member.nested,target_user,container_namespace)
        );
      end if;
    end loop;
    if identity_matched then output:=output||'{"identityDeleted":true}'::jsonb; end if;
    return output;
  elsif jsonb_typeof(value)='string' then
    return to_jsonb(private.account_replace_deleted_identity_text(value #>> '{}',target_user,container_namespace));
  end if;

  return value;
end;
$$;

revoke all on function private.account_scrub_json_uuid(jsonb,uuid,text) from public,anon,authenticated;


create or replace function private.account_anonymize_json_document(
  value jsonb,
  target_user uuid,
  container_namespace text
)
returns jsonb
language sql
immutable
strict
set search_path=''
as $$
  select private.account_scrub_marked_deleted_json(
    private.account_scrub_json_uuid(
      private.anonymize_account_json(value,target_user),
      target_user,
      container_namespace
    )
  )
$$;

revoke all on function private.account_anonymize_json_document(jsonb,uuid,text) from public,anon,authenticated;


create or replace function private.account_json_container_namespace(
  source_table text,
  document jsonb
)
returns text
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  canonical_round uuid;
  candidate text;
begin
  if source_table='rounds_cloud' and document->>'id' is not null then
    return 'round:'||(document->>'id');
  end if;

  if source_table='cloud_record_versions' and document->>'entity_type'='round' then
    select round.id into canonical_round
    from public.rounds_cloud round
    where coalesce(round.local_id,round.local_round_id)=document->>'local_id'
      and (
        round.owner_id=(document->>'owner_id')::uuid
        or round.owner_id is null
      )
    order by (round.owner_id=(document->>'owner_id')::uuid) desc
    limit 1;
    if canonical_round is not null then return 'round:'||canonical_round::text; end if;
  end if;

  if document->>'round_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return 'round:'||(document->>'round_id');
  end if;
  if source_table='groups_v2' and document->>'id' is not null then
    return 'group:'||(document->>'id');
  end if;
  if document->>'group_id' is not null then
    return 'group:'||(document->>'group_id');
  end if;

  candidate:=coalesce(
    document->>'id',document->>'local_id',document->>'owner_id',
    document->>'user_id','shared'
  );
  return source_table||':'||candidate;
end;
$$;

revoke all on function private.account_json_container_namespace(text,jsonb) from public,anon,authenticated;


create or replace function private.account_rekey_round_references(
  target_round uuid,
  target_user uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  target record;
  namespace text:='round:'||target_round::text;
  target_text text:=target_user::text;
  replacement text:=private.account_deleted_identity_token(namespace,target_user);
begin
  update public.round_players_cloud
  set local_player_id=private.account_replace_deleted_identity_text(local_player_id,target_user,namespace),
      name='Jugador eliminado'
  where round_id=target_round and position(target_text in lower(coalesce(local_player_id,'')))>0;

  update public.round_group_snapshot_players_v2 snapshot_player
  set display_name_snapshot='Jugador eliminado'
  where snapshot_player.round_id=target_round
    and exists(
      select 1 from public.round_players_cloud round_player
      where round_player.id=snapshot_player.round_player_id
        and round_player.round_id=target_round
        and position(lower(replacement) in lower(coalesce(round_player.local_player_id,'')))>0
    );

  update public.round_participants_v2 set player_key=private.account_replace_deleted_identity_text(player_key,target_user,namespace)
  where round_id=target_round and position(target_text in lower(coalesce(player_key,'')))>0;
  update public.live_round_operations_v2 set player_key=private.account_replace_deleted_identity_text(player_key,target_user,namespace)
  where round_id=target_round and position(target_text in lower(coalesce(player_key,'')))>0;
  update public.round_activity_v2 set player_key=private.account_replace_deleted_identity_text(player_key,target_user,namespace)
  where round_id=target_round and position(target_text in lower(coalesce(player_key,'')))>0;
  update public.round_shots_v2 set player_key=private.account_replace_deleted_identity_text(player_key,target_user,namespace)
  where round_id=target_round and position(target_text in lower(coalesce(player_key,'')))>0;
  -- social_round_account_links_v3 belongs to the Auth identity and cascades
  -- when that identity is deleted. Re-keying it early would violate its
  -- self/owner confirmation guard while the source snapshot is still OLD.

  update public.round_course_handicap_snapshots handicap
  set player_key=private.account_replace_deleted_identity_text(player_key,target_user,namespace)
  where position(target_text in lower(coalesce(handicap.player_key,'')))>0
    and exists(
      select 1 from public.rounds_cloud round
      where round.id=target_round
        and handicap.round_id=coalesce(round.local_id,round.local_round_id)
        and (
          round.owner_id=handicap.user_id
          or exists(
            select 1 from public.round_participants_v2 participant
            where participant.round_id=round.id and participant.user_id=handicap.user_id
          )
          or exists(
            select 1 from public.social_round_account_links_v3 link
            where link.round_id=round.id and link.user_id=handicap.user_id
          )
          or exists(
            select 1 from jsonb_array_elements(
              case when jsonb_typeof(round.snapshot->'players')='array'
                then round.snapshot->'players' else '[]'::jsonb end
            ) player
            where player->>'accountUserId'=handicap.user_id::text
          )
        )
    );

  -- Re-key compound player references in every round-scoped JSON projection.
  for target in
    select json_column.table_name,json_column.column_name
    from information_schema.columns json_column
    where json_column.table_schema='public' and json_column.udt_name='jsonb'
      and json_column.table_name<>'rounds_cloud'
      and exists(
        select 1 from information_schema.columns round_column
        where round_column.table_schema='public'
          and round_column.table_name=json_column.table_name
          and round_column.column_name='round_id' and round_column.udt_name='uuid'
      )
  loop
    execute format(
      'update public.%I set %I=private.account_anonymize_json_document(%I,$2,$3) where round_id=$1 and %I::text ilike $4',
      target.table_name,target.column_name,target.column_name,target.column_name
    ) using target_round,target_user,namespace,'%'||target_text||'%';
  end loop;
end;
$$;

revoke all on function private.account_rekey_round_references(uuid,uuid) from public,anon,authenticated;


create or replace function private.account_reconcile_deleted_round_snapshot(
  value jsonb,
  target_round uuid,
  target_user uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $$
begin
  perform private.account_rekey_round_references(target_round,target_user);
  return private.account_anonymize_json_document(value,target_user,'round:'||target_round::text);
end;
$$;

revoke all on function private.account_reconcile_deleted_round_snapshot(jsonb,uuid,uuid) from public,anon,authenticated;


-- Requested jobs are admitted only inside the validated lifecycle lease.
create or replace function private.account_scrub_deleted_snapshot()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  document jsonb:=to_jsonb(new);
  target record;
  column_name text;
  lifecycle_actor uuid:=private.account_lifecycle_context_actor();
  container_namespace text;
begin
  container_namespace:=private.account_json_container_namespace(tg_table_name,document);
  foreach column_name in array tg_argv loop
    if document->column_name is null then continue; end if;
    document:=jsonb_set(document,array[column_name],private.account_scrub_marked_deleted_json(document->column_name));
    for target in
      select distinct state.user_id
      from private.account_lifecycle_state state
      join private.account_lifecycle_jobs job on job.user_id=state.user_id
      where job.data_policy='delete_golf_data'
        and (job.stage<>'requested' or state.account_status='deleted' or lifecycle_actor=state.user_id)
        and (
          (document->column_name)::text ilike '%'||state.user_id::text||'%'
          or (document->column_name)::text ilike '%'||private.account_deleted_identity_token(container_namespace,state.user_id)||'%'
        )
    loop
      if tg_table_schema='public' and tg_table_name='rounds_cloud' and column_name='snapshot' then
        document:=jsonb_set(document,array[column_name],private.account_reconcile_deleted_round_snapshot(
          document->column_name,(document->>'id')::uuid,target.user_id
        ));
      else
        document:=jsonb_set(document,array[column_name],private.account_anonymize_json_document(
          document->column_name,target.user_id,container_namespace
        ));
      end if;
    end loop;
  end loop;
  new:=jsonb_populate_record(new,document);
  return new;
end;
$$;

revoke all on function private.account_scrub_deleted_snapshot() from public,anon,authenticated;


-- Admin/audit JSON tables were added after the original stale-write trigger
-- installer. Wire the current scrubber into future lifecycle runs so the
-- backfill below is not a one-time repair only.
do $$
declare target record;
begin
  for target in
    select table_name,string_agg(quote_literal(column_name),',' order by ordinal_position) args
    from information_schema.columns
    where table_schema='public' and udt_name='jsonb' and table_name in (
      'admin_import_jobs','admin_import_rows','competition_definitions',
      'competition_rules','product_usage_events_v2','admin_audit_log'
    )
    group by table_name
  loop
    execute format('drop trigger if exists account_scrub_deleted_snapshot on public.%I',target.table_name);
    execute format(
      'create trigger account_scrub_deleted_snapshot before insert or update on public.%I for each row execute function private.account_scrub_deleted_snapshot(%s)',
      target.table_name,target.args
    );
  end loop;
end;
$$;


-- The existing Admin revision guard validates the legacy lifecycle update
-- first. This alphabetically-later BEFORE trigger then removes UUIDs embedded
-- in compound ids and recomputes existing hashes under the same validated
-- lease. Ordinary Admin writes have no lifecycle actor and are unchanged.
create or replace function private.account_scrub_admin_revision_deleted_identity()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  lifecycle_actor uuid:=private.account_lifecycle_context_actor();
  target record;
  scrubbed jsonb;
  payload_hash text;
begin
  scrubbed:=private.account_scrub_marked_deleted_json(new.payload);
  for target in
    select distinct state.user_id
    from private.account_lifecycle_state state
    join private.account_lifecycle_jobs job on job.user_id=state.user_id
    where job.data_policy='delete_golf_data'
      and (job.stage<>'requested' or state.account_status='deleted' or lifecycle_actor=state.user_id)
      and (
        scrubbed::text ilike '%'||state.user_id::text||'%'
        or scrubbed::text ilike '%'||private.account_deleted_identity_token(
          'admin_catalog_revisions:'||new.id::text,state.user_id
        )||'%'
      )
  loop
    scrubbed:=private.account_anonymize_json_document(
      scrubbed,target.user_id,'admin_catalog_revisions:'||new.id::text
    );
  end loop;
  if scrubbed is not distinct from new.payload then return new; end if;

  payload_hash:=encode(extensions.digest(convert_to(scrubbed::text,'UTF8'),'sha256'),'hex');
  new.payload:=scrubbed;
  if new.preview_hash is not null then new.preview_hash:=payload_hash; end if;
  if new.revision_hash is not null then new.revision_hash:=payload_hash; end if;
  return new;
end;
$$;

revoke all on function private.account_scrub_admin_revision_deleted_identity() from public,anon,authenticated;

drop trigger if exists zz_account_scrub_deleted_identity on public.admin_catalog_revisions;

create trigger zz_account_scrub_deleted_identity
before insert or update of payload on public.admin_catalog_revisions
for each row execute function private.account_scrub_admin_revision_deleted_identity();


-- JSON triggers cannot protect scalar relational player keys. Reconcile a
-- stale offline INSERT/UPDATE against the same canonical per-round tombstone,
-- and scrub the frozen display name where that column exists.
create or replace function private.account_scrub_deleted_round_player_key()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  document jsonb:=to_jsonb(new);
  key_column text:=tg_argv[0];
  round_column text:=tg_argv[1];
  reference_kind text:=tg_argv[2];
  name_column text:=nullif(tg_argv[3],'');
  player_key text:=document->>key_column;
  round_reference text:=document->>round_column;
  canonical_round uuid;
  mapping_count integer;
  container_namespace text;
  lifecycle_actor uuid:=private.account_lifecycle_context_actor();
  target record;
begin
  if player_key is null or round_reference is null then return new; end if;

  -- UUID-backed projections already identify their canonical round. Resolve
  -- the namespace before selecting identities so a later name-only write can
  -- recognize a tombstone that no longer contains the original Auth UUID.
  if reference_kind='UUID' then
    canonical_round:=round_reference::uuid;
    container_namespace:='round:'||canonical_round::text;
  end if;

  for target in
    select distinct state.user_id
    from private.account_lifecycle_state state
    join private.account_lifecycle_jobs job on job.user_id=state.user_id
    where job.data_policy='delete_golf_data'
      and (job.stage<>'requested' or state.account_status='deleted' or lifecycle_actor=state.user_id)
      and (
        position(state.user_id::text in lower(player_key))>0
        or (
          reference_kind='UUID'
          and position(lower(private.account_deleted_identity_token(container_namespace,state.user_id)) in lower(player_key))>0
        )
      )
  loop
    if reference_kind<>'UUID' then
      select count(*),(min(round.id::text))::uuid into mapping_count,canonical_round
      from public.rounds_cloud round
      where coalesce(round.local_id,round.local_round_id)=round_reference
        and (
          round.owner_id=nullif(document->>'user_id','')::uuid
          or exists(
            select 1 from public.round_participants_v2 participant
            where participant.round_id=round.id
              and participant.user_id=nullif(document->>'user_id','')::uuid
          )
          or exists(
            select 1 from public.social_round_account_links_v3 link
            where link.round_id=round.id
              and link.user_id=nullif(document->>'user_id','')::uuid
          )
          or exists(
            select 1 from jsonb_array_elements(
              case when jsonb_typeof(round.snapshot->'players')='array'
                then round.snapshot->'players' else '[]'::jsonb end
            ) player
            where player->>'accountUserId'=document->>'user_id'
          )
        );
      if mapping_count<>1 then
        raise exception using
          errcode=case when mapping_count=0 then '23503' else '21000' end,
          message='account_lifecycle_round_mapping_required',
          detail='A stale handicap player key did not map to exactly one canonical round.';
      end if;
    end if;
    container_namespace:='round:'||canonical_round::text;
    player_key:=private.account_replace_deleted_identity_text(player_key,target.user_id,container_namespace);
    if name_column is not null then
      document:=jsonb_set(document,array[name_column],to_jsonb('Jugador eliminado'::text));
    end if;
  end loop;
  document:=jsonb_set(document,array[key_column],to_jsonb(player_key));
  new:=jsonb_populate_record(new,document);
  return new;
end;
$$;

revoke all on function private.account_scrub_deleted_round_player_key() from public,anon,authenticated;


drop trigger if exists account_scrub_deleted_player_key on public.round_players_cloud;

create trigger account_scrub_deleted_player_key
before insert or update of local_player_id,name on public.round_players_cloud
for each row execute function private.account_scrub_deleted_round_player_key('local_player_id','round_id','UUID','name');

drop trigger if exists account_scrub_deleted_player_key on public.round_participants_v2;

create trigger account_scrub_deleted_player_key
before insert or update of player_key on public.round_participants_v2
for each row execute function private.account_scrub_deleted_round_player_key('player_key','round_id','UUID','');

drop trigger if exists account_scrub_deleted_player_key on public.live_round_operations_v2;

create trigger account_scrub_deleted_player_key
before insert or update of player_key on public.live_round_operations_v2
for each row execute function private.account_scrub_deleted_round_player_key('player_key','round_id','UUID','');

drop trigger if exists account_scrub_deleted_player_key on public.round_activity_v2;

create trigger account_scrub_deleted_player_key
before insert or update of player_key on public.round_activity_v2
for each row execute function private.account_scrub_deleted_round_player_key('player_key','round_id','UUID','');

drop trigger if exists account_scrub_deleted_player_key on public.round_shots_v2;

create trigger account_scrub_deleted_player_key
before insert or update of player_key on public.round_shots_v2
for each row execute function private.account_scrub_deleted_round_player_key('player_key','round_id','UUID','');

drop trigger if exists account_scrub_deleted_player_key on public.round_course_handicap_snapshots;

create trigger account_scrub_deleted_player_key
before insert or update of player_key on public.round_course_handicap_snapshots
for each row execute function private.account_scrub_deleted_round_player_key('player_key','round_id','LOCAL','');


drop trigger if exists account_scrub_deleted_snapshot on public.round_shots_v2;

create trigger account_scrub_deleted_snapshot
before insert or update on public.round_shots_v2
for each row execute function private.account_scrub_deleted_snapshot('club_snapshot','start_location','end_location');


create or replace function private.account_scrub_deleted_group_snapshot_player_name()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if exists(
    select 1 from public.round_players_cloud round_player
    where round_player.id=new.round_player_id
      and round_player.round_id=new.round_id
      and round_player.name='Jugador eliminado'
  ) then new.display_name_snapshot:='Jugador eliminado'; end if;
  return new;
end;
$$;

revoke all on function private.account_scrub_deleted_group_snapshot_player_name() from public,anon,authenticated;

drop trigger if exists account_scrub_deleted_player_name on public.round_group_snapshot_players_v2;

create trigger account_scrub_deleted_player_name
before insert or update of round_player_id,display_name_snapshot on public.round_group_snapshot_players_v2
for each row execute function private.account_scrub_deleted_group_snapshot_player_name();


create or replace function private.account_reject_deleted_player_preference()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if exists(
    select 1
    from private.account_lifecycle_state state
    join private.account_lifecycle_jobs job on job.user_id=state.user_id
    where job.data_policy='delete_golf_data'
      and new.player_key ilike '%'||state.user_id::text||'%'
  ) then
    raise exception using
      errcode='23514',
      message='account_lifecycle_deleted_player_preference',
      detail='A tee preference cannot reference a closing or deleted account.';
  end if;
  return new;
end;
$$;

revoke all on function private.account_reject_deleted_player_preference() from public,anon,authenticated;

drop trigger if exists account_reject_deleted_player_preference on public.player_course_tee_preferences;

create trigger account_reject_deleted_player_preference
before insert or update of player_key on public.player_course_tee_preferences
for each row execute function private.account_reject_deleted_player_preference();


create or replace function private.account_reconcile_relational_identifiers(target_user uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare target record;
begin
  -- A tee preference is private mutable state, not shared history. Remove a
  -- survivor-owned preference for the deleted player rather than preserving a
  -- permanent cross-account identifier.
  delete from public.player_course_tee_preferences preference
  where preference.player_key ilike '%'||target_user::text||'%';

  -- A local round id is not globally unique. Refuse to mutate any historical
  -- handicap row unless its surviving owner/participant maps it to exactly one
  -- canonical round.
  if exists(
    select 1
    from public.round_course_handicap_snapshots handicap
    where handicap.player_key ilike '%'||target_user::text||'%'
      and (
        select count(*)
        from public.rounds_cloud round
        where coalesce(round.local_id,round.local_round_id)=handicap.round_id
          and (
            round.owner_id=handicap.user_id
            or exists(select 1 from public.round_participants_v2 participant where participant.round_id=round.id and participant.user_id=handicap.user_id)
            or exists(select 1 from public.social_round_account_links_v3 link where link.round_id=round.id and link.user_id=handicap.user_id)
            or exists(
              select 1 from jsonb_array_elements(
                case when jsonb_typeof(round.snapshot->'players')='array' then round.snapshot->'players' else '[]'::jsonb end
              ) player where player->>'accountUserId'=handicap.user_id::text
            )
          )
      )<>1
  ) then
    raise exception using
      errcode='23514',
      message='account_lifecycle_round_mapping_required',
      detail='A handicap player key did not map to exactly one canonical round.';
  end if;

  for target in
    select round.id
    from public.rounds_cloud round
    where round.snapshot::text ilike '%'||target_user::text||'%'
      or exists(select 1 from public.round_players_cloud row where row.round_id=round.id and row.local_player_id ilike '%'||target_user::text||'%')
      or exists(select 1 from public.round_participants_v2 row where row.round_id=round.id and row.player_key ilike '%'||target_user::text||'%')
      or exists(select 1 from public.live_round_operations_v2 row where row.round_id=round.id and row.player_key ilike '%'||target_user::text||'%')
      or exists(select 1 from public.round_activity_v2 row where row.round_id=round.id and row.player_key ilike '%'||target_user::text||'%')
      or exists(select 1 from public.round_shots_v2 row where row.round_id=round.id and row.player_key ilike '%'||target_user::text||'%')
      or exists(
        select 1 from public.round_course_handicap_snapshots handicap
        where handicap.round_id=coalesce(round.local_id,round.local_round_id)
          and handicap.player_key ilike '%'||target_user::text||'%'
          and (
            round.owner_id=handicap.user_id
            or exists(select 1 from public.round_participants_v2 participant where participant.round_id=round.id and participant.user_id=handicap.user_id)
            or exists(select 1 from public.social_round_account_links_v3 link where link.round_id=round.id and link.user_id=handicap.user_id)
            or exists(
              select 1 from jsonb_array_elements(
                case when jsonb_typeof(round.snapshot->'players')='array' then round.snapshot->'players' else '[]'::jsonb end
              ) player where player->>'accountUserId'=handicap.user_id::text
            )
          )
      )
  loop
    perform private.account_rekey_round_references(target.id,target_user);
  end loop;

  if exists(select 1 from public.round_players_cloud row where row.local_player_id ilike '%'||target_user::text||'%')
    or exists(select 1 from public.round_participants_v2 row where row.player_key ilike '%'||target_user::text||'%')
    or exists(select 1 from public.live_round_operations_v2 row where row.player_key ilike '%'||target_user::text||'%')
    or exists(select 1 from public.round_activity_v2 row where row.player_key ilike '%'||target_user::text||'%')
    or exists(select 1 from public.round_shots_v2 row where row.player_key ilike '%'||target_user::text||'%')
    or exists(select 1 from public.round_course_handicap_snapshots row where row.player_key ilike '%'||target_user::text||'%')
  then
    raise exception using
      errcode='23514',
      message='account_lifecycle_relational_identity_unmapped',
      detail='A deleted identity remains in a relational player key.';
  end if;
end;
$$;

revoke all on function private.account_reconcile_relational_identifiers(uuid) from public,anon,authenticated;


create or replace function public.account_lifecycle_reconcile_identifiers(operation_id uuid,lease uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare job private.account_lifecycle_jobs;
begin
  select * into job from private.account_lifecycle_jobs where request_id=operation_id for update;
  if not found or lease is null or job.lease_token is distinct from lease
    or job.lease_until is null or job.lease_until<=clock_timestamp()
    or job.data_policy<>'delete_golf_data' or job.stage<>'data_prepared'
  then raise insufficient_privilege; end if;
  perform set_config('backyard.account_lifecycle_operation',operation_id::text,true);
  perform set_config('backyard.account_lifecycle_lease',lease::text,true);
  if private.account_lifecycle_context_actor() is distinct from job.user_id then
    raise insufficient_privilege using message='account_lifecycle_context_invalid';
  end if;
  perform private.account_reconcile_relational_identifiers(job.user_id);
  return to_jsonb(job)-'token_hash';
end;
$$;

revoke all on function public.account_lifecycle_reconcile_identifiers(uuid,uuid) from public,anon,authenticated;

grant execute on function public.account_lifecycle_reconcile_identifiers(uuid,uuid) to service_role;


commit;
-- Performance only; prepared for review, NOT authorized for remote apply.
-- No application rows, triggers, policies, roles, timeout or retention changes.
-- Preserve case-insensitive UUID/tombstone replacement and exact 23505 collisions.
-- Same public lifecycle signatures, snapshot trigger and fail-closed semantics.
-- Compute the immutable namespace token once per document, not per JSON node.
-- Cached native regex expressions keep collision validation before recursion.
-- No backfill, reconciliation, lifecycle call or automatic cleanup is executed.
begin;

create or replace function private.account_replace_deleted_identity_text(
  value text, target_user uuid, container_namespace text
) returns text
language plpgsql immutable strict set search_path=''
as $function$
declare
  target_text text:=target_user::text;
  value_text text:=lower(value);
  replacement text;
begin
  -- Identity-free keys/scalars need neither SHA nor regular expressions.
  -- The token prefix gate is only a fast negative test: any candidate still
  -- compares the exact container-specific token and normalizes its case.
  if position(target_text in value_text)=0 and position('deleted-' in value_text)=0 then
    return value;
  end if;
  replacement:=private.account_deleted_identity_token(container_namespace,target_user);
  return regexp_replace(
    regexp_replace(value,target_text,replacement,'gi'),replacement,replacement,'gi'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.account_scrub_json_uuid_with_token(value jsonb, target_user uuid, container_namespace text, replacement text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
declare
  output jsonb;
  target_text text:=target_user::text;
  value_text text;
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
  -- With neither the UUID nor this container's tombstone anywhere in the
  -- subtree, this function cannot alter a key, value or visual identity.
  -- Marker-only PII is still handled by account_scrub_marked_deleted_json
  -- in the existing document pipeline. Do not skip that separate stage.
  value_text:=lower(value::text);
  if position(target_text in value_text)=0
    and position(lower(replacement) in value_text)=0 then
    return value;
  end if;

  if jsonb_typeof(value)='array' then
    select coalesce(
      jsonb_agg(
        private.account_scrub_json_uuid_with_token(item,target_user,container_namespace,replacement)
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

    select count(*)<>count(distinct regexp_replace(regexp_replace(key,target_text,replacement,'gi'),replacement,replacement,'gi'))
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
          regexp_replace(regexp_replace(member.key,target_text,replacement,'gi'),replacement,replacement,'gi'),null
        );
      elsif identity_matched and member.key in (
        'name','playerName','opponentName','displayName','display_name',
        'firstName','lastName','first_name','last_name','username',
        'recipientLabel','recipient_label'
      ) then
        output:=output||jsonb_build_object(regexp_replace(regexp_replace(member.key,target_text,replacement,'gi'),replacement,replacement,'gi'),'Jugador eliminado');
      elsif identity_matched and member.key in (
        'email','replyEmail','reply_email','phone','avatar','avatarUrl',
        'avatar_url','avatarConfig','photoUrl','photo_url','photoDataUrl',
        'emoji','profilePhoto','profile_photo'
      ) then
        output:=output||jsonb_build_object(regexp_replace(regexp_replace(member.key,target_text,replacement,'gi'),replacement,replacement,'gi'),null);
      elsif owner_matched and member.key in ('ownerName','owner_name') then
        output:=output||jsonb_build_object(regexp_replace(regexp_replace(member.key,target_text,replacement,'gi'),replacement,replacement,'gi'),'Jugador eliminado');
      elsif owner_matched and member.key in (
        'ownerAvatar','owner_avatar','ownerPhoto','owner_photo',
        'ownerPlayerSnapshot','ownerBagSnapshot'
      ) then
        output:=output||jsonb_build_object(regexp_replace(regexp_replace(member.key,target_text,replacement,'gi'),replacement,replacement,'gi'),null);
      else
        output:=output||jsonb_build_object(
          regexp_replace(regexp_replace(member.key,target_text,replacement,'gi'),replacement,replacement,'gi'),
          private.account_scrub_json_uuid_with_token(member.nested,target_user,container_namespace,replacement)
        );
      end if;
    end loop;
    if identity_matched then output:=output||'{"identityDeleted":true}'::jsonb; end if;
    return output;
  elsif jsonb_typeof(value)='string' then
    return to_jsonb(regexp_replace(regexp_replace(value #>> '{}',target_text,replacement,'gi'),replacement,replacement,'gi'));
  end if;

  return value;
end;
$function$;

create or replace function private.account_scrub_json_uuid(
  value jsonb, target_user uuid, container_namespace text
) returns jsonb
language sql immutable strict set search_path=''
as $function$
  select private.account_scrub_json_uuid_with_token(
    value,target_user,container_namespace,
    private.account_deleted_identity_token(container_namespace,target_user)
  )
$function$;

CREATE OR REPLACE FUNCTION private.account_scrub_deleted_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  document jsonb:=to_jsonb(new);
  target record;
  column_name text;
  lifecycle_actor uuid:=private.account_lifecycle_context_actor();
  container_namespace text;
  value_text text;
begin
  container_namespace:=private.account_json_container_namespace(tg_table_name,document);
  foreach column_name in array tg_argv loop
    if document->column_name is null then continue; end if;
    document:=jsonb_set(document,array[column_name],private.account_scrub_marked_deleted_json(document->column_name));
    -- Serialize and case-normalize once per column, rather than per account.
    value_text:=lower((document->column_name)::text);
    for target in
      select distinct state.user_id
      from private.account_lifecycle_state state
      join private.account_lifecycle_jobs job on job.user_id=state.user_id
      where job.data_policy='delete_golf_data'
        and (job.stage<>'requested' or state.account_status='deleted' or lifecycle_actor=state.user_id)
        and (
          position(state.user_id::text in value_text)>0
          or case when position('deleted-' in value_text)>0 then
            position(private.account_deleted_identity_token(container_namespace,state.user_id) in value_text)>0
          else false end
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
$function$;

CREATE OR REPLACE FUNCTION private.anonymize_account_json(value jsonb, target uuid, player_keys text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  output jsonb;
  pair record;
  matched boolean;
  local_keys text[]:=player_keys;
  owner_matches boolean;
  target_text text:=target::text;
  value_text text;
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
  -- The legacy pass also propagates local player IDs. A UUID-only gate would
  -- miss those aliases in sibling scores/player objects, so retain branches
  -- containing ANY inherited local key (including an empty key).
  value_text:=value::text;
  if position(target_text in lower(value_text))=0 and not exists(
    select 1 from unnest(player_keys) player_key
    where position(player_key in value_text)>0
  ) then
    return value;
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION private.account_scrub_marked_deleted_json(value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
declare
  output jsonb;
  member record;
  marked boolean;
  value_text text;
begin
  -- JSONB emits normalized separators; both accepted boolean and string
  -- markers are recognized case-insensitively. Values lacking either cannot
  -- be modified by this marker-only pass. PII policy and marker handling stay.
  value_text:=lower(value::text);
  if position('"identitydeleted": true' in value_text)=0
    and position('"identitydeleted": "true"' in value_text)=0 then
    return value;
  end if;
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
$function$;

revoke all on function private.anonymize_account_json(jsonb,uuid,text[]) from public,anon,authenticated;
revoke all on function private.account_scrub_marked_deleted_json(jsonb) from public,anon,authenticated;
revoke all on function private.account_replace_deleted_identity_text(text,uuid,text) from public,anon,authenticated;
revoke all on function private.account_scrub_json_uuid_with_token(jsonb,uuid,text,text) from public,anon,authenticated;
revoke all on function private.account_scrub_json_uuid(jsonb,uuid,text) from public,anon,authenticated;
revoke all on function private.account_scrub_deleted_snapshot() from public,anon,authenticated;

commit;

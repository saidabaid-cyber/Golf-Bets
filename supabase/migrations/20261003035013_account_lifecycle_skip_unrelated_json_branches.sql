-- Function-only performance fix. No data backfill, cleanup or lifecycle execution.
-- Same signature, security, tombstones, collision checks and data policy.
-- Reversible by restoring the previous account_scrub_json_uuid definition.

begin;

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
  value_text text;
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

commit;

-- Account delete / fresh-start reconciliation for the isolated QA line.
--
-- This migration deliberately keeps Auth RESTRICT constraints in place. The
-- leased lifecycle must first anonymize every shared reference; an unexpected
-- application FK fails with a named diagnostic instead of being cascaded.
begin;

-- Admin provenance is historical metadata, not ownership. Preserve the shared
-- object without silently transferring it to another administrator.
alter table public.admin_catalog_revisions
  alter column created_by drop not null,
  alter column reviewed_by drop not null,
  alter column verified_by drop not null,
  alter column published_by drop not null;
alter table public.course_configurations
  alter column created_by drop not null,
  alter column published_by drop not null;
alter table public.course_local_rule_sets
  alter column created_by drop not null,
  alter column published_by drop not null;
alter table public.admin_documents alter column created_by drop not null;
alter table public.competition_definitions
  alter column created_by drop not null,
  alter column published_by drop not null;
alter table public.competition_rule_sets
  alter column created_by drop not null,
  alter column published_by drop not null;
alter table public.admin_import_jobs
  alter column created_by drop not null,
  alter column confirmed_by drop not null;
alter table public.admin_request_drafts
  alter column created_by drop not null,
  alter column feedback_request_id drop not null;

-- A custom setting by itself is never authority. Trigger bypasses below only
-- activate while it names a live delete-golf-data job and its exact lease.
create or replace function private.account_lifecycle_context_actor()
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  operation_text text:=nullif(current_setting('backyard.account_lifecycle_operation',true),'');
  lease_text text:=nullif(current_setting('backyard.account_lifecycle_lease',true),'');
  context_actor uuid;
begin
  if operation_text is null or lease_text is null then return null; end if;
  begin
    select job.user_id into context_actor
    from private.account_lifecycle_jobs job
    where job.request_id=operation_text::uuid
      and job.lease_token=lease_text::uuid
      and job.lease_until>clock_timestamp()
      and job.data_policy='delete_golf_data'
      and job.stage in ('requested','data_prepared');
  exception when invalid_text_representation then
    return null;
  end;
  return context_actor;
end;
$$;
revoke all on function private.account_lifecycle_context_actor() from public,anon,authenticated;
grant execute on function private.account_lifecycle_context_actor() to service_role;

-- Cover both product snapshots and Admin/audit row images. A field is scrubbed
-- only when the same JSON object is anchored to the deleted UUID; unrelated
-- free-form names are never guessed.
create or replace function private.anonymize_account_json(value jsonb,target uuid,player_keys text[] default '{}')
returns jsonb language plpgsql immutable set search_path=''
as $$
declare
  output jsonb;
  pair record;
  matched boolean;
  local_keys text[]:=player_keys;
  owner_matches boolean;
  identity_keys constant text[]:=array[
    'accountUserId','profileId','userId','ownerId','actorId','authorId','createdBy','updatedBy',
    'inviterId','inviteeId','linkedUserId','confirmedBy','enteredBy','reviewedBy','verifiedBy','publishedBy',
    'account_user_id','profile_id','user_id','owner_id','actor_id','author_id','created_by','updated_by',
    'inviter_id','invitee_id','linked_user_id','confirmed_by','entered_by','reviewed_by','verified_by','published_by',
    'requester_id','addressee_id','claimant_id','assigned_by','granted_by','recipient_id','target_user_id',
    'attester_id','source_equipment_user_id','changed_by'
  ];
begin
  if jsonb_typeof(value)='object' and jsonb_typeof(value->'players')='array' then
    select local_keys || coalesce(array_agg(p->>'id') filter(where p->>'id' is not null),'{}') into local_keys
    from jsonb_array_elements(value->'players') p where p->>'accountUserId'=target::text;
  end if;
  if jsonb_typeof(value)='array' then
    select coalesce(jsonb_agg(private.anonymize_account_json(item,target,local_keys)),'[]'::jsonb) into output
    from jsonb_array_elements(value) item;
    return output;
  elsif jsonb_typeof(value)='object' then
    select exists(
      select 1 from jsonb_each_text(value) identity
      where identity.key=any(identity_keys) and identity.value=target::text
    ) into matched;
    matched:=coalesce(matched,false) or value->>'id'=target::text
      or value->>'id'=any(local_keys) or value->>'playerId'=any(local_keys)
      or value->>'roundPlayerId'=any(local_keys) or value->>'opponentId'=any(local_keys);
    owner_matches:=value->>'ownerId'=any(local_keys) or value->>'owner_id'=target::text;
    output:='{}'::jsonb;
    for pair in select * from jsonb_each(value) loop
      if (coalesce(matched,false) and pair.key in (
          'name','playerName','opponentName','displayName','display_name','firstName','lastName','first_name','last_name','username',
          'recipientLabel','recipient_label'))
        or (coalesce(owner_matches,false) and pair.key in ('ownerName','owner_name')) then
        output:=output||jsonb_build_object(pair.key,'Jugador eliminado');
      elsif (coalesce(matched,false) and pair.key in (
          'email','replyEmail','reply_email','phone','avatar','avatarUrl','avatar_url','avatarConfig','photoUrl','photo_url',
          'photoDataUrl','emoji','profilePhoto','profile_photo'))
        or (coalesce(owner_matches,false) and pair.key in ('ownerAvatar','owner_avatar','ownerPhoto','owner_photo','ownerPlayerSnapshot','ownerBagSnapshot'))
        or (pair.key=any(identity_keys) and pair.value=to_jsonb(target::text)) then
        output:=output||jsonb_build_object(pair.key,null);
      else
        output:=output||jsonb_build_object(pair.key,private.anonymize_account_json(pair.value,target,local_keys));
      end if;
    end loop;
    if coalesce(matched,false) then output:=output||'{"identityDeleted":true}'::jsonb; end if;
    return output;
  end if;
  return value;
end;
$$;
revoke all on function private.anonymize_account_json(jsonb,uuid,text[]) from public,anon,authenticated;

-- Published revision immutability stays intact. The sole exception is an
-- actor-to-NULL provenance scrub under the validated lifecycle lease.
create or replace function private.guard_admin_revision_v1()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare
  allowed boolean:=false;
  internal_publish boolean:=coalesce(current_setting('backyard.admin_publish',true),'')='on';
  lifecycle_actor uuid;
  lifecycle_payload_hash text;
begin
  -- Ordinary authenticated Admin updates have no lifecycle setting and never
  -- need EXECUTE on the private lease validator. The SECURITY DEFINER account
  -- RPC reaches this branch as its owner only after setting the scoped context.
  if current_user in ('service_role','postgres')
    and nullif(current_setting('backyard.account_lifecycle_operation',true),'') is not null
    and (
      (old.created_by is not null and new.created_by is null)
      or (old.reviewed_by is not null and new.reviewed_by is null)
      or (old.verified_by is not null and new.verified_by is null)
      or (old.published_by is not null and new.published_by is null)
      or new.payload is distinct from old.payload
      or new.preview_hash is distinct from old.preview_hash
      or new.revision_hash is distinct from old.revision_hash
    ) then
    lifecycle_actor:=private.account_lifecycle_context_actor();
  end if;
  if lifecycle_actor is not null then
    lifecycle_payload_hash:=encode(
      extensions.digest(convert_to(new.payload::text,'UTF8'),'sha256'),
      'hex'
    );
    if (
        (old.created_by=lifecycle_actor and new.created_by is null)
        or (old.reviewed_by=lifecycle_actor and new.reviewed_by is null)
        or (old.verified_by=lifecycle_actor and new.verified_by is null)
        or (old.published_by=lifecycle_actor and new.published_by is null)
        or (
          new.payload is distinct from old.payload
          and new.payload=private.anonymize_account_json(old.payload,lifecycle_actor)
        )
      )
      and (new.created_by is not distinct from old.created_by or (old.created_by=lifecycle_actor and new.created_by is null))
      and (new.reviewed_by is not distinct from old.reviewed_by or (old.reviewed_by=lifecycle_actor and new.reviewed_by is null))
      and (new.verified_by is not distinct from old.verified_by or (old.verified_by=lifecycle_actor and new.verified_by is null))
      and (new.published_by is not distinct from old.published_by or (old.published_by=lifecycle_actor and new.published_by is null))
      and (
        new.payload is not distinct from old.payload
        or new.payload=private.anonymize_account_json(old.payload,lifecycle_actor)
      )
      and (
        new.preview_hash is not distinct from old.preview_hash
        or (new.payload is distinct from old.payload and old.preview_hash is not null and new.preview_hash=lifecycle_payload_hash)
      )
      and (
        new.revision_hash is not distinct from old.revision_hash
        or (new.payload is distinct from old.payload and old.revision_hash is not null and new.revision_hash=lifecycle_payload_hash)
      )
      and (to_jsonb(new)-array['created_by','reviewed_by','verified_by','published_by','payload','preview_hash','revision_hash','updated_at']::text[])
        =(to_jsonb(old)-array['created_by','reviewed_by','verified_by','published_by','payload','preview_hash','revision_hash','updated_at']::text[])
    then
      new.updated_at:=now();
      return new;
    end if;
  end if;
  if old.status is distinct from new.status then
    allowed:=case old.status
      when 'DRAFT' then new.status in ('REVIEWED','ARCHIVED')
      when 'REVIEWED' then new.status in ('DRAFT','VERIFIED','ARCHIVED')
      when 'VERIFIED' then new.status in ('DRAFT','PUBLISHED','ARCHIVED')
      when 'PUBLISHED' then new.status in ('SUPERSEDED','ARCHIVED')
      when 'SUPERSEDED' then new.status='ARCHIVED'
      else false end;
    if not allowed then raise exception 'INVALID_PUBLICATION_TRANSITION' using errcode='23514'; end if;
    if new.status='PUBLISHED' and not internal_publish then raise exception 'PUBLISH_RPC_REQUIRED' using errcode='42501'; end if;
    if new.status='REVIEWED' then new.reviewed_by:=(select auth.uid()); end if;
    if new.status='VERIFIED' then
      if new.provenance_status<>'VERIFIED' or new.source_type is null or new.source_name is null or new.verified_at is null then
        raise exception 'VERIFIED_EVIDENCE_REQUIRED' using errcode='23514';
      end if;
      new.verified_by:=(select auth.uid());
    end if;
    if new.status='PUBLISHED' then
      perform private.admin_validate_revision_payload_v1(new);
      new.published_by:=(select auth.uid());
      new.published_at:=now();
    end if;
  end if;
  if old.status not in ('DRAFT','REVIEWED','VERIFIED') and not internal_publish and (
    old.entity_type is distinct from new.entity_type or old.entity_id is distinct from new.entity_id
    or old.scope_type is distinct from new.scope_type or old.scope_id is distinct from new.scope_id
    or old.version is distinct from new.version or old.payload is distinct from new.payload
    or old.source_type is distinct from new.source_type or old.source_name is distinct from new.source_name
    or old.source_url is distinct from new.source_url or old.provenance_status is distinct from new.provenance_status
    or old.verified_at is distinct from new.verified_at or old.confidence is distinct from new.confidence
    or old.internal_notes is distinct from new.internal_notes or old.effective_from is distinct from new.effective_from
    or old.effective_until is distinct from new.effective_until or old.supersedes_revision_id is distinct from new.supersedes_revision_id
    or old.preview_hash is distinct from new.preview_hash or old.revision_hash is distinct from new.revision_hash
    or old.created_by is distinct from new.created_by or old.created_at is distinct from new.created_at
  ) then raise exception 'PUBLISHED_REVISION_IMMUTABLE' using errcode='23514'; end if;
  new.updated_at:=now();
  return new;
end;
$$;
revoke all on function private.guard_admin_revision_v1() from public,anon,authenticated;

-- Lifecycle provenance changes must not create a second audit image containing
-- the UUID being erased. Normal Admin writes retain their existing audit path.
create or replace function private.audit_admin_revision_row_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
declare row_value public.admin_catalog_revisions:=new;
begin
  if private.account_lifecycle_context_actor() is not null then return new; end if;
  perform private.admin_audit_v1(
    case when tg_op='INSERT' then 'CREATE_DRAFT' when old.status is distinct from new.status then 'STATUS_'||new.status else 'EDIT_DRAFT' end,
    row_value.entity_type,row_value.entity_id,
    case when tg_op='INSERT' then null else to_jsonb(old) end,to_jsonb(new),null,null,row_value.scope_type,row_value.scope_id
  );
  return new;
end;
$$;
revoke all on function private.audit_admin_revision_row_v1() from public,anon,authenticated;

create or replace function private.audit_admin_scoped_row_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  row_data jsonb:=to_jsonb(new);
  old_data jsonb:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  entity_type text:=tg_argv[0];
  scope_type_value text:=tg_argv[1];
  scope_field text:=tg_argv[2];
  scope_id_value text;
  entity_id_value text:=row_data->>'id';
begin
  if private.account_lifecycle_context_actor() is not null then return new; end if;
  if left(scope_type_value,1)='@' then scope_type_value:=row_data->>substring(scope_type_value from 2); end if;
  scope_id_value:=case when scope_field='' then null else row_data->>scope_field end;
  if entity_type='COURSE_CONFIGURATION' and scope_type_value='COMPETITION' then scope_id_value:=row_data->>'competition_id'; end if;
  perform private.admin_audit_v1(case when tg_op='INSERT' then 'CREATE_DRAFT' else 'UPDATE' end,
    entity_type,entity_id_value,old_data,row_data,null,null,scope_type_value,scope_id_value);
  return new;
end;
$$;
revoke all on function private.audit_admin_scoped_row_v1() from public,anon,authenticated;

-- A retry may inspect Storage after SQL preparation. The API still removes
-- objects through Storage.remove(), never with direct SQL.
create or replace function public.account_lifecycle_storage_rehomes(operation_id uuid,lease uuid)
returns table(document_id uuid,bucket_id text,name text,replacement_name text)
language plpgsql security definer set search_path=''
as $$
declare actor uuid;
begin
  select user_id into actor from private.account_lifecycle_jobs
  where request_id=operation_id and lease_token=lease and lease_until>clock_timestamp()
    and data_policy='delete_golf_data' and stage in ('requested','data_prepared');
  if actor is null or lease is null then raise insufficient_privilege; end if;
  return query
    select document.id,object.bucket_id,object.name,
      'account-lifecycle-shared/'||document.id::text||case document.mime_type
        when 'application/pdf' then '.pdf'
        when 'image/png' then '.png'
        when 'image/jpeg' then '.jpg'
        when 'image/webp' then '.webp'
      end
    from public.admin_documents document
    join storage.objects object
      on object.bucket_id='admin-documents-private' and object.name=document.storage_path
    where object.owner_id=actor::text or object.owner=actor
    order by document.id
    limit 100;
end;
$$;

-- Storage.copy() is performed with the server-only service key. It creates an
-- ownerless replacement before this RPC atomically retargets the shared DB
-- reference. A failed attempt is resumable without ever breaking the link.
create or replace function public.account_lifecycle_commit_storage_rehome(
  operation_id uuid,lease uuid,target_document_id uuid,source_name text,replacement_name text
)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
  actor uuid;
  document public.admin_documents;
  expected_name text;
begin
  select user_id into actor from private.account_lifecycle_jobs
  where request_id=operation_id and lease_token=lease and lease_until>clock_timestamp()
    and data_policy='delete_golf_data' and stage in ('requested','data_prepared');
  if actor is null or lease is null then raise insufficient_privilege; end if;
  select * into document from public.admin_documents where id=target_document_id for update;
  if not found then raise exception 'account_lifecycle_storage_document_missing' using errcode='P0002'; end if;
  expected_name:='account-lifecycle-shared/'||document.id::text||case document.mime_type
    when 'application/pdf' then '.pdf'
    when 'image/png' then '.png'
    when 'image/jpeg' then '.jpg'
    when 'image/webp' then '.webp'
  end;
  if replacement_name is distinct from expected_name then
    raise exception 'account_lifecycle_storage_rehome_invalid' using errcode='22023';
  end if;
  if not exists(
    select 1 from storage.objects object
    where object.bucket_id='admin-documents-private' and object.name=replacement_name
      and object.owner is null and nullif(object.owner_id,'') is null
  ) then
    raise exception 'account_lifecycle_storage_rehome_incomplete' using errcode='P0001';
  end if;
  if document.storage_path=replacement_name then return true; end if;
  if document.storage_path is distinct from source_name or not exists(
    select 1 from storage.objects object
    where object.bucket_id='admin-documents-private' and object.name=source_name
      and (object.owner=actor or object.owner_id=actor::text)
  ) then
    raise exception 'account_lifecycle_storage_rehome_source_invalid' using errcode='P0001';
  end if;
  perform set_config('backyard.account_lifecycle_operation',operation_id::text,true);
  perform set_config('backyard.account_lifecycle_lease',lease::text,true);
  update public.admin_documents set storage_path=replacement_name where id=document.id;
  perform set_config('backyard.account_lifecycle_operation','',true);
  perform set_config('backyard.account_lifecycle_lease','',true);
  return true;
end;
$$;

create or replace function public.account_lifecycle_storage(operation_id uuid,lease uuid)
returns table(bucket_id text,name text) language plpgsql security definer set search_path=''
as $$
declare actor uuid;
begin
  select user_id into actor from private.account_lifecycle_jobs
  where request_id=operation_id and lease_token=lease and lease_until>clock_timestamp()
    and data_policy='delete_golf_data' and stage in ('requested','data_prepared');
  if actor is null or lease is null then raise insufficient_privilege; end if;
  return query
    select object.bucket_id,object.name from storage.objects object
    where (
      object.owner_id=actor::text or object.owner=actor
      or (object.bucket_id in ('scorecard-photos','feedback-private') and split_part(object.name,'/',1)=actor::text)
    )
      and not exists(
        select 1 from public.admin_documents document
        where object.bucket_id='admin-documents-private' and document.storage_path=object.name
      )
    order by object.bucket_id,object.name limit 100;
end;
$$;

create or replace function public.account_lifecycle_prepare(operation_id uuid,lease uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  job private.account_lifecycle_jobs;
  actor uuid;
  actor_email text;
  target record;
  remains boolean;
  configuration_ids uuid[];
  blocking_club_id text;
  blocking_course_id text;
begin
  select * into job from private.account_lifecycle_jobs where request_id=operation_id for update;
  if not found or lease is null or job.lease_token is distinct from lease or job.lease_until is null or job.lease_until<=clock_timestamp() then
    raise insufficient_privilege;
  end if;
  if job.stage='completed' then return to_jsonb(job)-'token_hash'; end if;
  if job.stage not in ('requested','data_prepared') then raise insufficient_privilege; end if;
  actor:=job.user_id;

  if job.data_policy='delete_golf_data' then
    perform set_config('backyard.account_lifecycle_operation',operation_id::text,true);
    perform set_config('backyard.account_lifecycle_lease',lease::text,true);
    if private.account_lifecycle_context_actor() is distinct from actor then
      raise insufficient_privilege using message='account_lifecycle_context_invalid';
    end if;

    select lower(trim(email)) into actor_email from auth.users
    where id=actor and email_confirmed_at is not null;
    if actor_email is not null then
      -- Otherwise a new Auth identity with the same verified email would see a
      -- pending invitation created for the deleted identity.
      delete from private.group_email_invitations
      where invitee_id is null and lower(trim(recipient_email))=actor_email;
      if to_regclass('public.marketing_waitlist') is not null then
        execute 'delete from public.marketing_waitlist where lower(trim(email))=$1' using actor_email;
      end if;
    end if;

    -- A private feedback row cascades with Auth. Preserve an Admin work item
    -- only as a content-free shell, never as a back-reference to private PII.
    update public.admin_request_drafts draft
    set feedback_request_id=null,
        created_by=case when draft.created_by=actor then null else draft.created_by end
    where exists(
      select 1 from public.feedback_requests request
      where request.id=draft.feedback_request_id and request.user_id=actor
    );

    -- Preserve Admin/catalog evidence and remove all seventeen actor provenance
    -- references. No row receives a replacement owner or administrator.
    update public.admin_memberships set created_by=null where created_by=actor;
    update public.admin_catalog_revisions set
      created_by=case when created_by=actor then null else created_by end,
      reviewed_by=case when reviewed_by=actor then null else reviewed_by end,
      verified_by=case when verified_by=actor then null else verified_by end,
      published_by=case when published_by=actor then null else published_by end
    where actor in (created_by,reviewed_by,verified_by,published_by);
    select coalesce(array_agg(id),'{}'::uuid[]) into configuration_ids
    from public.course_configurations where actor in (created_by,published_by);
    update public.course_configurations set
      created_by=case when created_by=actor then null else created_by end,
      published_by=case when published_by=actor then null else published_by end
    where actor in (created_by,published_by);
    update public.course_configurations configuration
    set revision_hash=encode(extensions.digest(
      convert_to(private.admin_configuration_payload_v1(configuration.id)::text,'UTF8'),'sha256'
    ),'hex')
    where configuration.id=any(configuration_ids) and configuration.revision_hash is not null;
    update public.course_local_rule_sets set
      created_by=case when created_by=actor then null else created_by end,
      published_by=case when published_by=actor then null else published_by end
    where actor in (created_by,published_by);
    update public.admin_documents set created_by=null where created_by=actor;
    update public.competition_definitions set
      created_by=case when created_by=actor then null else created_by end,
      published_by=case when published_by=actor then null else published_by end
    where actor in (created_by,published_by);
    update public.competition_rule_sets set
      created_by=case when created_by=actor then null else created_by end,
      published_by=case when published_by=actor then null else published_by end
    where actor in (created_by,published_by);
    update public.admin_import_jobs set
      created_by=case when created_by=actor then null else created_by end,
      confirmed_by=case when confirmed_by=actor then null else confirmed_by end
    where actor in (created_by,confirmed_by);
    update public.admin_request_drafts set created_by=null where created_by=actor;

    -- Private-only owned rounds can be removed. Shared canonical rounds stay;
    -- participant reads remain governed by existing participant RLS.
    delete from public.rounds_cloud round where round.owner_id=actor
      and not exists(select 1 from public.round_participants_v2 participant where participant.round_id=round.id and participant.user_id is not null and participant.user_id<>actor)
      and not exists(select 1 from public.social_round_account_links_v3 link where link.round_id=round.id and link.user_id<>actor)
      and not exists(
        select 1
        from jsonb_array_elements(case when jsonb_typeof(round.snapshot->'players')='array' then round.snapshot->'players' else '[]'::jsonb end) player
        join auth.users account on account.id::text=player->>'accountUserId'
        where account.id<>actor
      );
    update public.rounds_cloud set owner_id=null where owner_id=actor;
    update public.round_players_cloud projection set name='Jugador eliminado'
    where exists(
      select 1 from public.rounds_cloud round,
      jsonb_array_elements(coalesce(round.snapshot->'players','[]')) player
      where round.id=projection.round_id and player->>'accountUserId'=actor::text and player->>'id'=projection.local_player_id
    );
    update public.round_group_snapshot_players_v2 snapshot set display_name_snapshot='Jugador eliminado'
    where exists(select 1 from public.round_players_cloud player where player.id=snapshot.round_player_id and player.name='Jugador eliminado');
    -- A player row is normally private to owner_id and can disappear with the
    -- account. Preserve it only when another account's tournament still points
    -- at it; otherwise an Auth CASCADE would silently erase the shared player's
    -- canonical link (tournament_players.player_id is only SET NULL).
    update public.tournament_players historical set
      name='Jugador eliminado',profile_id=null,pin_hash=null,claimed_at=null
    where historical.profile_id=actor or exists(
      select 1
      from public.players player
      join public.tournaments tournament on tournament.id=historical.tournament_id
      where player.id=historical.player_id and player.owner_id=actor
        and (
          tournament.created_by is distinct from actor
          or exists(select 1 from public.tournament_access access
            where access.tournament_id=tournament.id and access.user_id is not null and access.user_id<>actor)
          or exists(
            select 1 from public.tournament_players participant
            left join public.players linked_player on linked_player.id=participant.player_id
            where participant.tournament_id=tournament.id and (
              (participant.profile_id is not null and participant.profile_id<>actor)
              or (linked_player.profile_id is not null and linked_player.profile_id<>actor)
              or (linked_player.owner_id is not null and linked_player.owner_id<>actor)
            )
          )
        )
    );
    update public.players player set
      name='Jugador eliminado',owner_id=null,profile_id=null,
      snapshot=private.anonymize_account_json(
        coalesce(player.snapshot,'{}')||jsonb_build_object('accountUserId',actor),actor
      )
    where player.owner_id=actor and exists(
      select 1
      from public.tournament_players participant
      join public.tournaments tournament on tournament.id=participant.tournament_id
      where participant.player_id=player.id and (
        tournament.created_by is distinct from actor
        or exists(select 1 from public.tournament_access access
          where access.tournament_id=tournament.id and access.user_id is not null and access.user_id<>actor)
        or exists(
          select 1 from public.tournament_players other_participant
          left join public.players linked_player on linked_player.id=other_participant.player_id
          where other_participant.tournament_id=tournament.id and (
            (other_participant.profile_id is not null and other_participant.profile_id<>actor)
            or (linked_player.profile_id is not null and linked_player.profile_id<>actor)
            or (linked_player.owner_id is not null and linked_player.owner_id<>actor)
          )
        )
      )
    );
    update public.players set name='Jugador eliminado',profile_id=null,
      snapshot=private.anonymize_account_json(coalesce(snapshot,'{}')||jsonb_build_object('accountUserId',actor),actor)
    where profile_id=actor;
    delete from public.players where owner_id=actor;
    update public.guest_players_v2 set display_name='Jugador eliminado',linked_user_id=null,linked_at=null where linked_user_id=actor;

    delete from public.groups_v2 group_row where group_row.owner_id=actor
      and not exists(select 1 from public.group_memberships_v2 member where member.group_id=group_row.id and member.user_id is not null and member.user_id<>actor);
    update public.groups_v2 set owner_id=null where owner_id=actor;
    update public.guest_players_v2 guest set owner_id=null where owner_id=actor and (
      exists(select 1 from public.round_participants_v2 participant where participant.guest_player_id=guest.id)
      or exists(select 1 from public.group_memberships_v2 member where member.guest_player_id=guest.id)
    );
    update public.group_memories_v2 set updated_by=null where updated_by=actor;
    delete from public.group_invites_v2 where inviter_id=actor;
    delete from public.round_invites_v2 where inviter_id=actor;
    delete from public.guest_player_claims_v2 where created_by=actor;
    update public.live_round_operations_v2 set actor_id=null where actor_id=actor;
    update public.round_activity_v2 set actor_id=null where actor_id=actor;
    -- These records are strictly private to the creator. Leaving an ownerless
    -- row would make stale golf data inaccessible but still linkable on a
    -- fresh account. Child versions/tees/holes follow their existing CASCADEs.
    delete from public.courses_cloud where owner_id=actor;
    update public.course_versions set created_by=null where created_by=actor;
    -- USER_MANUAL courses are private owner data. The later nine-rating table
    -- predates explicit CASCADE clauses, so remove those leaf rows before tees
    -- and holes cascade from the course. A manual club must never cascade-delete
    -- a child course owned by somebody else (or catalog-owned); that malformed
    -- cross-owner graph is a named, transactional fail-closed condition.
    select club.id,course.id into blocking_club_id,blocking_course_id
    from public.golf_clubs club
    join public.golf_courses course on course.club_id=club.id
    where club.created_by=actor and club.provider='USER_MANUAL'
      and (course.provider<>'USER_MANUAL' or course.created_by is distinct from actor)
    order by club.id,course.id
    limit 1;
    if blocking_club_id is not null then
      raise exception using errcode='23503',message='account_lifecycle_shared_manual_club',
        detail=format('golf_clubs.%s has non-owned child golf_courses.%s',blocking_club_id,blocking_course_id);
    end if;
    delete from public.golf_tee_nine_ratings rating
    where exists(
      select 1 from public.golf_courses course
      where course.id=rating.course_id and course.created_by=actor and course.provider='USER_MANUAL'
    ) or exists(
      select 1
      from public.golf_course_tees tee
      join public.golf_courses course on course.id=tee.course_id
      where tee.id=rating.tee_id and course.created_by=actor and course.provider='USER_MANUAL'
    );
    delete from public.golf_tee_hole_yardages yardage where exists(
      select 1 from public.golf_courses course
      where course.id=yardage.course_id and course.created_by=actor and course.provider='USER_MANUAL'
    );
    delete from public.golf_hole_geo_features feature where exists(
      select 1
      from public.golf_holes hole
      join public.golf_courses course on course.id=hole.course_id
      where hole.id=feature.hole_id and course.created_by=actor and course.provider='USER_MANUAL'
    );
    delete from public.golf_tee_provider_links link where exists(
      select 1 from public.golf_courses course
      where course.id=link.course_id and course.created_by=actor and course.provider='USER_MANUAL'
    );
    delete from public.golf_course_tees tee where exists(
      select 1 from public.golf_courses course
      where course.id=tee.course_id and course.created_by=actor and course.provider='USER_MANUAL'
    );
    delete from public.golf_holes hole where exists(
      select 1 from public.golf_courses course
      where course.id=hole.course_id and course.created_by=actor and course.provider='USER_MANUAL'
    );
    delete from public.golf_course_provider_links link where exists(
      select 1 from public.golf_courses course
      where course.id=link.course_id and course.created_by=actor and course.provider='USER_MANUAL'
    );
    delete from public.golf_courses where created_by=actor and provider='USER_MANUAL';
    delete from public.golf_clubs where created_by=actor and provider='USER_MANUAL';

    -- Break only the legacy projection that points at a tournament which is
    -- about to be removed. Shared tournaments and their Admin definitions stay.
    update public.competition_definitions definition set legacy_tournament_id=null
    where exists(
      select 1 from public.tournaments tournament
      where tournament.id=definition.legacy_tournament_id and tournament.created_by=actor
        and not exists(select 1 from public.tournament_access access where access.tournament_id=tournament.id and access.user_id is not null and access.user_id<>actor)
        and not exists(
          select 1 from public.tournament_players participant
          left join public.players linked_player on linked_player.id=participant.player_id
          where participant.tournament_id=tournament.id and (
            (participant.profile_id is not null and participant.profile_id<>actor)
            or (linked_player.profile_id is not null and linked_player.profile_id<>actor)
            or (linked_player.owner_id is not null and linked_player.owner_id<>actor)
          )
        )
    );
    delete from public.tournaments tournament where tournament.created_by=actor
      and not exists(select 1 from public.tournament_access access where access.tournament_id=tournament.id and access.user_id is not null and access.user_id<>actor)
      and not exists(
        select 1 from public.tournament_players participant
        left join public.players linked_player on linked_player.id=participant.player_id
        where participant.tournament_id=tournament.id and (
          (participant.profile_id is not null and participant.profile_id<>actor)
          or (linked_player.profile_id is not null and linked_player.profile_id<>actor)
          or (linked_player.owner_id is not null and linked_player.owner_id<>actor)
        )
      );
    update public.tournaments set created_by=null where created_by=actor;
    update public.tournament_groups set confirmed_by=null where confirmed_by=actor;
    update public.tournament_scores set entered_by=null,access_id=null
      where entered_by=actor or access_id in(select id from public.tournament_access where user_id=actor);
    update public.tournament_oyes set entered_by=null,access_id=null
      where entered_by=actor or access_id in(select id from public.tournament_access where user_id=actor);
    update public.score_audit_log set changed_by=null,reason=null where changed_by=actor;

    update public.admin_audit_log audit set
      actor_id=null,
      actor_role=case when audit.actor_id=actor then 'DELETED_ACCOUNT' else audit.actor_role end,
      entity_id=case when audit.entity_id=actor::text then 'deleted-account' else audit.entity_id end,
      before_state=private.anonymize_account_json(audit.before_state,actor),
      after_state=private.anonymize_account_json(audit.after_state,actor),
      reason=null
    where audit.actor_id=actor or audit.entity_id=actor::text
      or coalesce(audit.before_state::text,'') like '%'||actor::text||'%'
      or coalesce(audit.after_state::text,'') like '%'||actor::text||'%';

    -- Revision payloads are legal/shared evidence. Scrub only actor-anchored
    -- identity and recalculate any existing content hashes over the new bytes.
    update public.admin_catalog_revisions revision set
      payload=private.anonymize_account_json(revision.payload,actor),
      preview_hash=case when revision.preview_hash is null then null else encode(extensions.digest(
        convert_to(private.anonymize_account_json(revision.payload,actor)::text,'UTF8'),'sha256'
      ),'hex') end,
      revision_hash=case when revision.revision_hash is null then null else encode(extensions.digest(
        convert_to(private.anonymize_account_json(revision.payload,actor)::text,'UTF8'),'sha256'
      ),'hex') end
    where revision.payload::text like '%'||actor::text||'%';

    -- JSON columns are frozen snapshots. Only UUID-anchored objects are scrubbed;
    -- unlinked names remain untouched.
    for target in
      select table_name,column_name from information_schema.columns
      where table_schema='public' and udt_name='jsonb' and table_name in (
        'rounds_cloud','round_bet_configs','round_bet_results','personal_bets_cloud','manual_bets_cloud','expenses_cloud',
        'round_course_handicap_snapshots','user_cloud_state','players','frequent_groups_cloud','personal_rivals_cloud','groups_v2',
        'group_memories_v2','group_bet_templates_v2','live_round_operations_v2','cloud_record_versions',
        'admin_import_jobs','admin_import_rows','competition_definitions','competition_rules','product_usage_events_v2'
      ) and not (table_name='admin_audit_log')
    loop
      execute format(
        'update public.%I set %I=private.anonymize_account_json(%I,$1) where %I::text like $2',
        target.table_name,target.column_name,target.column_name,target.column_name
      ) using actor,'%'||actor::text||'%';
    end loop;

    -- Fail closed if a newer migration introduces an application/storage Auth
    -- FK that this reconciliation has not classified. Never hide it as a generic
    -- Auth Admin 500/503.
    for target in
      select namespace.nspname schema_name,relation.relname table_name,constraint_row.conname,
        attribute.attname column_name,cardinality(constraint_row.conkey) key_count
      from pg_constraint constraint_row
      join pg_class relation on relation.oid=constraint_row.conrelid
      join pg_namespace namespace on namespace.oid=relation.relnamespace
      join pg_attribute attribute on attribute.attrelid=relation.oid and attribute.attnum=constraint_row.conkey[1]
      where constraint_row.contype='f' and constraint_row.confrelid='auth.users'::regclass
        and constraint_row.confdeltype in ('a','r') and namespace.nspname<>'auth'
    loop
      if target.key_count<>1 then
        raise exception using errcode='23503',message='account_lifecycle_unresolved_auth_fk',
          detail=format('%I.%I constraint %I has unsupported composite key',target.schema_name,target.table_name,target.conname);
      end if;
      execute format('select exists(select 1 from %I.%I where %I=$1)',target.schema_name,target.table_name,target.column_name)
        into remains using actor;
      if remains then
        raise exception using errcode='23503',message='account_lifecycle_unresolved_auth_fk',
          detail=format('%I.%I.%I (%I)',target.schema_name,target.table_name,target.column_name,target.conname);
      end if;
    end loop;

    perform set_config('backyard.account_lifecycle_operation','',true);
    perform set_config('backyard.account_lifecycle_lease','',true);
  end if;

  update private.account_lifecycle_jobs set stage='data_prepared',lease_until=clock_timestamp()+interval '2 minutes'
  where request_id=operation_id returning * into job;
  return to_jsonb(job)-'token_hash';
end;
$$;

revoke all on function public.account_lifecycle_storage_rehomes(uuid,uuid) from public,anon,authenticated;
revoke all on function public.account_lifecycle_commit_storage_rehome(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.account_lifecycle_storage(uuid,uuid) from public,anon,authenticated;
revoke all on function public.account_lifecycle_prepare(uuid,uuid) from public,anon,authenticated;
grant execute on function public.account_lifecycle_storage_rehomes(uuid,uuid) to service_role;
grant execute on function public.account_lifecycle_commit_storage_rehome(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.account_lifecycle_storage(uuid,uuid) to service_role;
grant execute on function public.account_lifecycle_prepare(uuid,uuid) to service_role;

comment on function public.account_lifecycle_prepare(uuid,uuid) is
  'Leased, service-only delete reconciliation. Idempotent for requested/data_prepared and fail-closed on unknown Auth RESTRICT references.';

commit;

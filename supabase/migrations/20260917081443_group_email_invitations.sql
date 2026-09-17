-- Group email invitations: identity-verified acceptance, private delivery data.
-- Additive; intended for isolated Phase 2 QA only. No Auth/SMTP configuration.
begin;

alter table public.groups_v2 add column if not exists owner_local_id text;
create unique index if not exists groups_v2_owner_local_uidx on public.groups_v2(owner_id, owner_local_id) where owner_local_id is not null;

create table private.group_email_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups_v2(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid references auth.users(id) on delete cascade,
  recipient_email text not null,
  recipient_label text not null,
  token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  state text not null default 'PENDING' check(state in ('PENDING','ACCEPTED','DECLINED','REVOKED')),
  delivery_status text not null default 'NOT_SENT' check(delivery_status in ('NOT_SENT','SENDING','ACCEPTED_BY_PROVIDER','FAILED')),
  provider_message_id text,
  error_code text,
  attempts integer not null default 0,
  lease_until timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique(group_id, recipient_email)
);
alter table private.group_email_invitations enable row level security;
revoke all on private.group_email_invitations from public, anon, authenticated, service_role;
create index group_email_invites_inviter_idx on private.group_email_invitations(inviter_id, created_at);
create index group_email_invites_invitee_idx on private.group_email_invitations(invitee_id);
create index group_email_invites_recipient_idx on private.group_email_invitations(recipient_email, state);

-- Exact email matching never returns email. Public identities or actual friends
-- only; both directions of blocking and lifecycle remain enforced.
create function private.search_group_users(query_text text)
returns table(user_id uuid, username text, display_name text, avatar_url text, is_friend boolean)
language sql stable security definer set search_path = '' as $$
  select s.user_id,s.username,s.display_name,s.avatar_url,
    exists(select 1 from public.friendships f where (f.user_a_id=auth.uid() and f.user_b_id=s.user_id) or (f.user_b_id=auth.uid() and f.user_a_id=s.user_id))
  from public.social_profiles s join auth.users u on u.id=s.user_id
  where auth.uid() is not null and private.account_subject_active(auth.uid()) and private.account_subject_active(s.user_id)
    and s.user_id<>auth.uid() and length(trim(query_text)) between 2 and 254
    and (s.privacy='PUBLIC' or (s.privacy='FRIENDS' and exists(select 1 from public.friendships f where (f.user_a_id=auth.uid() and f.user_b_id=s.user_id) or (f.user_b_id=auth.uid() and f.user_a_id=s.user_id))))
    and not exists(select 1 from public.blocked_connections b where (b.owner_id=auth.uid() and b.blocked_user_id=s.user_id) or (b.owner_id=s.user_id and b.blocked_user_id=auth.uid()))
    and (case when position('@' in trim(query_text))>1 then lower(u.email)=lower(trim(query_text)) else
      position(lower(ltrim(trim(query_text),'@')) in lower(s.username))>0 or position(lower(trim(query_text)) in lower(s.display_name))>0 end)
  order by s.display_name,s.user_id limit 20;
$$;
revoke all on function private.search_group_users(text) from public,anon,authenticated,service_role;
grant execute on function private.search_group_users(text) to authenticated;
create function public.search_group_users_v1(query_text text)
returns table(user_id uuid, username text, display_name text, avatar_url text, is_friend boolean)
language sql stable security invoker set search_path = '' as $$ select * from private.search_group_users(query_text); $$;
revoke all on function public.search_group_users_v1(text) from public,anon,service_role;
grant execute on function public.search_group_users_v1(text) to authenticated;

create function private.group_invitation_action(action text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); actor_email text; grp public.groups_v2; inv private.group_email_invitations;
  snap jsonb; recipient text; label text; target uuid; member jsonb; response jsonb; members jsonb; local_group_id text;
begin
  if actor is null or not private.account_subject_active(actor) then raise insufficient_privilege using message='AUTH_REQUIRED'; end if;
  select lower(email) into actor_email from auth.users where id=actor and email_confirmed_at is not null;
  if actor_email is null then raise insufficient_privilege using message='VERIFIED_EMAIL_REQUIRED'; end if;
  if coalesce(jsonb_typeof(payload),'null')<>'object' then raise invalid_parameter_value using message='INVALID_PAYLOAD'; end if;
  if action='ensure' then
    snap:=payload->'group';
    if coalesce(jsonb_typeof(snap),'null')<>'object' or length(trim(coalesce(snap->>'id',''))) not between 1 and 200
      or length(trim(coalesce(snap->>'name',''))) not between 1 and 100 or coalesce(jsonb_typeof(snap->'players'),'null')<>'array'
      or octet_length(snap::text)>200000 then raise invalid_parameter_value using message='INVALID_GROUP'; end if;
    -- A tab may still hold a draft from before another person accepted. Its
    -- template edits must not erase verified relational members on save.
    select * into grp from public.groups_v2 where owner_id=actor and owner_local_id=snap->>'id' for update;
    if found then
      for target,label in select gm.user_id,coalesce(p.display_name,gm.display_name_snapshot,'Jugador')
        from public.group_memberships_v2 gm left join public.profiles p on p.id=gm.user_id
        where gm.group_id=grp.id and gm.user_id is not null and private.account_subject_active(gm.user_id)
      loop
        if not exists(select 1 from jsonb_array_elements(snap->'players') p where p->>'accountUserId'=target::text) then
          snap:=jsonb_set(snap,'{players}',(snap->'players')||jsonb_build_array(jsonb_build_object('memberId','account-'||target,'kind','account','accountUserId',target,'name',label,'handicap',null)));
        end if;
      end loop;
    end if;
    insert into public.groups_v2(owner_id,owner_local_id,name,default_template)
      values(actor,snap->>'id',trim(snap->>'name'),snap)
      on conflict(owner_id,owner_local_id) where owner_local_id is not null do update set name=excluded.name, default_template=excluded.default_template, updated_at=now()
      returning * into grp;
    insert into public.group_memberships_v2(group_id,user_id,role,display_name_snapshot)
      values(grp.id,actor,'ADMIN',coalesce((select display_name from public.profiles where id=actor),'Jugador'))
      on conflict(group_id,user_id) where user_id is not null do nothing;
    return jsonb_build_object('groupId',grp.id,'groupSnapshot',snap||jsonb_build_object('sourceGroupId',grp.id));
  elsif action='list' then
    if payload ? 'localGroupId' then
      local_group_id:=payload->>'localGroupId';
      if coalesce(jsonb_typeof(payload->'localGroupId'),'null')<>'string' or length(trim(local_group_id)) not between 1 and 200 then raise invalid_parameter_value using message='INVALID_GROUP'; end if;
      -- A client-local ID is never authority to read another owner's group.
      select * into grp from public.groups_v2 where owner_id=actor and owner_local_id=local_group_id;
      if not found then return jsonb_build_object('invitations','[]'::jsonb,'acceptedMembers','[]'::jsonb); end if;
    end if;
    select coalesce(jsonb_agg(x),'[]') into response from (
      select i.id,i.group_id,g.name as group_name,i.recipient_label,i.state,i.delivery_status,i.error_code,i.expires_at,
        (i.inviter_id=actor) as outgoing, i.accepted_at
      from private.group_email_invitations i join public.groups_v2 g on g.id=i.group_id
      where (i.inviter_id=actor or i.invitee_id=actor or i.recipient_email=actor_email)
        and (payload->>'groupId' is null or i.group_id=(payload->>'groupId')::uuid)
        and (local_group_id is null or i.group_id=grp.id)
      order by i.created_at desc limit 100
    ) x;
    if local_group_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('memberId','account-'||gm.user_id,'kind','account','accountUserId',gm.user_id,
        'name',coalesce(p.display_name,gm.display_name_snapshot,'Jugador'),'avatarUrl',coalesce(p.avatar_url,''),'handicap',null)
        order by gm.joined_at,gm.user_id),'[]'::jsonb) into members
      from public.group_memberships_v2 gm left join public.profiles p on p.id=gm.user_id
      where gm.group_id=grp.id and gm.user_id is not null and gm.user_id<>actor and private.account_subject_active(gm.user_id);
      return jsonb_build_object('invitations',response,'groupId',grp.id,'acceptedMembers',members);
    end if;
    return jsonb_build_object('invitations',response);
  elsif action='create' then
    select * into grp from public.groups_v2 where id=(payload->>'groupId')::uuid for update;
    if not found or not private.is_group_manager(grp.id) then raise insufficient_privilege using message='GROUP_FORBIDDEN'; end if;
    if payload->>'targetUserId' is not null then
      target:=(payload->>'targetUserId')::uuid;
      if not exists(select 1 from public.social_profiles s where s.user_id=target and private.account_subject_active(target)
        and (s.privacy='PUBLIC' or (s.privacy='FRIENDS' and exists(select 1 from public.friendships f where (f.user_a_id=actor and f.user_b_id=target) or (f.user_b_id=actor and f.user_a_id=target))))) then
        raise insufficient_privilege using message='GROUP_FORBIDDEN'; end if;
      select lower(email) into recipient from auth.users where id=target and email_confirmed_at is not null;
      select coalesce(nullif(username,''),display_name,'Usuario Backyard') into label from public.social_profiles where user_id=target;
    else
      recipient:=lower(trim(payload->>'email')); label:=recipient;
      select id into target from auth.users where lower(email)=recipient and email_confirmed_at is not null limit 1;
    end if;
    if recipient is null or length(recipient)>254 or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise invalid_parameter_value using message='INVALID_EMAIL'; end if;
    if recipient=actor_email or target=actor or (target is not null and not private.account_subject_active(target)) or exists(select 1 from public.blocked_connections b where (b.owner_id=actor and b.blocked_user_id=target) or (b.owner_id=target and b.blocked_user_id=actor)) then raise insufficient_privilege using message='GROUP_FORBIDDEN'; end if;
    if exists(select 1 from public.group_memberships_v2 where group_id=grp.id and user_id=target) then return jsonb_build_object('alreadyMember',true); end if;
    select * into inv from private.group_email_invitations where group_id=grp.id and recipient_email=recipient;
    if not found then
      if (select count(*) from private.group_email_invitations where inviter_id=actor and created_at>now()-interval '1 day')>=30 then raise exception using errcode='P0001',message='RATE_LIMIT'; end if;
      insert into private.group_email_invitations(group_id,inviter_id,invitee_id,recipient_email,recipient_label)
        values(grp.id,actor,target,recipient,label) returning * into inv;
    end if;
    return jsonb_build_object('invitationId',inv.id,'state',inv.state,'deliveryStatus',inv.delivery_status);
  elsif action='accept' then
    select * into inv from private.group_email_invitations where id=(payload->>'invitationId')::uuid for update;
    if not found or actor_email is null or inv.recipient_email<>actor_email or (inv.invitee_id is not null and inv.invitee_id<>actor)
      or inv.inviter_id=actor then raise insufficient_privilege using message='INVITATION_FORBIDDEN'; end if;
    if inv.state='ACCEPTED' then return jsonb_build_object('accepted',true,'groupId',inv.group_id); end if;
    if payload->>'token' is not null and payload->>'token'<>inv.token then raise insufficient_privilege using message='INVITATION_FORBIDDEN'; end if;
    if inv.state<>'PENDING' or inv.expires_at<=now() then raise invalid_parameter_value using message='INVITATION_EXPIRED'; end if;
    if exists(select 1 from public.blocked_connections b where (b.owner_id=actor and b.blocked_user_id=inv.inviter_id) or (b.owner_id=inv.inviter_id and b.blocked_user_id=actor)) then raise insufficient_privilege using message='INVITATION_FORBIDDEN'; end if;
    select * into grp from public.groups_v2 where id=inv.group_id for update;
    if grp.owner_id is null or not private.account_subject_active(grp.owner_id) then raise insufficient_privilege using message='GROUP_FORBIDDEN'; end if;
    label:=coalesce((select display_name from public.profiles where id=actor),'Jugador');
    insert into public.group_memberships_v2(group_id,user_id,role,display_name_snapshot) values(grp.id,actor,'MEMBER',label)
      on conflict(group_id,user_id) where user_id is not null do nothing;
    update private.group_email_invitations set state='ACCEPTED',invitee_id=actor,accepted_at=now(),token='' where id=inv.id;
    snap:=grp.default_template;
    member:=jsonb_build_object('memberId','account-'||actor,'kind','account','accountUserId',actor,'name',label,'handicap',null);
    if not exists(select 1 from jsonb_array_elements(coalesce(snap->'players','[]')) p where p->>'accountUserId'=actor::text) then
      snap:=jsonb_set(snap,'{players}',coalesce(snap->'players','[]')||jsonb_build_array(member));
    end if;
    snap:=snap||jsonb_build_object('updatedAt',now());
    update public.groups_v2 set default_template=snap,updated_at=now() where id=grp.id;
    -- Preserve the owner's current template; append only the accepted identity.
    update public.frequent_groups_cloud f set snapshot=jsonb_set(f.snapshot,'{players}',coalesce(f.snapshot->'players','[]')||jsonb_build_array(member))||jsonb_build_object('updatedAt',now()),updated_at=now()
      where f.owner_id=grp.owner_id and f.local_id=grp.owner_local_id and not exists(select 1 from jsonb_array_elements(coalesce(f.snapshot->'players','[]')) p where p->>'accountUserId'=actor::text);
    snap:=snap||jsonb_build_object('id','joined-'||grp.id,'sourceGroupId',grp.id);
    insert into public.frequent_groups_cloud(owner_id,local_id,name,snapshot,updated_at)
      values(actor,'joined-'||grp.id,grp.name,snap,now()) on conflict(owner_id,local_id) do nothing;
    return jsonb_build_object('accepted',true,'groupId',grp.id);
  end if;
  raise invalid_parameter_value using message='INVALID_ACTION';
end; $$;
revoke all on function private.group_invitation_action(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.group_invitation_action(text,jsonb) to authenticated;
create function public.group_invitation_action_v1(action text,payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select private.group_invitation_action(action,payload); $$;
revoke all on function public.group_invitation_action_v1(text,jsonb) from public,anon,service_role;
grant execute on function public.group_invitation_action_v1(text,jsonb) to authenticated;

-- Only the backend can obtain an email/token or acknowledge a provider response.
create function public.group_invitation_delivery_v1(invitation_id uuid, actor_id uuid, operation text, result jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare inv private.group_email_invitations; grp public.groups_v2;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise insufficient_privilege; end if;
  select * into inv from private.group_email_invitations where id=invitation_id for update;
  if not found or inv.inviter_id<>actor_id or not private.account_subject_active(actor_id) then raise insufficient_privilege; end if;
  select * into grp from public.groups_v2 where id=inv.group_id;
  if grp.owner_id is null or not private.account_subject_active(grp.owner_id)
    or (inv.invitee_id is not null and not private.account_subject_active(inv.invitee_id))
    or (grp.owner_id<>actor_id and not exists(select 1 from public.group_memberships_v2 where group_id=grp.id and user_id=actor_id and role='ADMIN'))
    or exists(select 1 from public.blocked_connections b where (b.owner_id=actor_id and b.blocked_user_id=inv.invitee_id) or (b.owner_id=inv.invitee_id and b.blocked_user_id=actor_id))
    then raise insufficient_privilege; end if;
  if operation='claim' then
    if inv.state<>'PENDING' or inv.delivery_status='ACCEPTED_BY_PROVIDER' then return jsonb_build_object('send',false,'status',inv.delivery_status); end if;
    if inv.lease_until>now() then return jsonb_build_object('send',false,'status','SENDING'); end if;
    if inv.attempts>=8 then raise exception using errcode='P0001',message='RATE_LIMIT'; end if;
    if inv.expires_at<=now() then raise invalid_parameter_value using message='INVITATION_EXPIRED'; end if;
    update private.group_email_invitations set delivery_status='SENDING',lease_until=now()+interval '45 seconds',attempts=attempts+1,error_code=null where id=inv.id;
    return jsonb_build_object('send',true,'email',inv.recipient_email,'token',inv.token,'groupName',grp.name,'attempt',inv.attempts+1);
  elsif operation='finish' then
    if inv.state<>'PENDING' then return jsonb_build_object('status',inv.state); end if;
    -- A timeout's older attempt and duplicate completion cannot reverse a
    -- provider acknowledgement. Only the current outstanding lease may finish.
    if inv.delivery_status<>'SENDING' or coalesce((result->>'attempt')::integer,-1)<>inv.attempts then return jsonb_build_object('status',inv.delivery_status); end if;
    update private.group_email_invitations set delivery_status=case when coalesce(result->>'messageId','')<>'' then 'ACCEPTED_BY_PROVIDER' else 'FAILED' end,
      provider_message_id=nullif(result->>'messageId',''), error_code=left(result->>'errorCode',80),lease_until=null where id=inv.id returning * into inv;
    return jsonb_build_object('status',inv.delivery_status,'errorCode',inv.error_code);
  end if;
  raise invalid_parameter_value;
end; $$;
revoke all on function public.group_invitation_delivery_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.group_invitation_delivery_v1(uuid,uuid,text,jsonb) to service_role;
commit;

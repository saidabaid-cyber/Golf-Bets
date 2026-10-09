-- DEV: preserve every existing preference/event, RLS policy and account consent.
begin;
alter table public.notification_preferences_v2 drop constraint if exists notification_preferences_v2_event_type_check;
alter table public.notification_preferences_v2 add constraint notification_preferences_v2_event_type_check check(event_type in (
  'friend_request','friend_accepted','group_invite','round_invite','round_started','round_finished','scorecard_ready',
  'like','comment','attest','attest_request','friend_achievement','equipment'));

-- Existing onboarding/settings RPCs keep their consent ledgers. Mirror only a
-- notification flag they actually changed, in that same transaction.
create or replace function public.sync_changed_social_notification_preferences_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare event_name text;new_choice boolean;old_choice boolean;
begin
  if auth.uid() is distinct from new.user_id or current_setting('backyard.atomic_notification_preference',true)='on' then return new;end if;
  for event_name,new_choice,old_choice in select * from (values
    ('like',new.notify_like,old.notify_like),('comment',new.notify_comment,old.notify_comment),
    ('attest',new.notify_attest,old.notify_attest),('attest_request',new.notify_attest,old.notify_attest),
    ('friend_request',new.notify_friend_request,old.notify_friend_request),
    ('friend_achievement',new.notify_friend_achievement,old.notify_friend_achievement),('equipment',new.notify_equipment,old.notify_equipment)) choices loop
    if new_choice is distinct from old_choice then
      insert into public.notification_preferences_v2(user_id,event_type,in_app,push) values(new.user_id,event_name,coalesce(new_choice,false),false)
        on conflict(user_id,event_type) do update set in_app=excluded.in_app,updated_at=now();
    end if;
  end loop;return new;
end;$$;
revoke all on function public.sync_changed_social_notification_preferences_v1() from public,anon,authenticated;
drop trigger if exists sync_changed_social_notification_preferences_v1 on public.social_activity_preferences_v3;
create trigger sync_changed_social_notification_preferences_v1 after update on public.social_activity_preferences_v3 for each row execute function public.sync_changed_social_notification_preferences_v1();

create or replace function public.set_my_notification_event_preference_v1(requested_type text, requested_in_app boolean default null, requested_push boolean default null)
returns void language plpgsql security invoker set search_path='' as $$
declare
  account_id uuid:=auth.uid();
  legacy boolean;
  attest_gate boolean;
begin
  if account_id is null then raise exception 'Authentication required' using errcode='42501';end if;
  if requested_type is null or requested_type not in ('friend_request','friend_accepted','group_invite','round_invite','round_started','round_finished','scorecard_ready','like','comment','attest','attest_request','friend_achievement','equipment')
    or (requested_in_app is null and requested_push is null) then raise exception 'Invalid preference' using errcode='22023';end if;
  -- Serialize this account's categories, including the shared outer Atest gate.
  perform pg_advisory_xact_lock(hashtextextended(account_id::text,71281));
  perform set_config('backyard.atomic_notification_preference','on',true);
  select case requested_type when 'like' then p.notify_like when 'comment' then p.notify_comment
    when 'attest' then p.notify_attest when 'attest_request' then p.notify_attest when 'friend_request' then p.notify_friend_request
    when 'friend_achievement' then p.notify_friend_achievement when 'equipment' then p.notify_equipment else true end
    into legacy from public.social_activity_preferences_v3 p where p.user_id=account_id;
  legacy:=coalesce(legacy,requested_type not in ('friend_achievement','equipment'));
  insert into public.notification_preferences_v2(user_id,event_type,in_app,push)
    values(account_id,requested_type,coalesce(requested_in_app,legacy),coalesce(requested_push,false))
    on conflict(user_id,event_type) do update set
      in_app=coalesce(requested_in_app,public.notification_preferences_v2.in_app),
      push=coalesce(requested_push,public.notification_preferences_v2.push),updated_at=now();
  if requested_in_app is not null then
    insert into public.social_activity_preferences_v3(user_id) values(account_id) on conflict(user_id) do nothing;
    select coalesce((select n.in_app from public.notification_preferences_v2 n where n.user_id=account_id and n.event_type='attest'),legacy)
      or coalesce((select n.in_app from public.notification_preferences_v2 n where n.user_id=account_id and n.event_type='attest_request'),legacy) into attest_gate;
    update public.social_activity_preferences_v3 set
      notify_like=case when requested_type='like' then requested_in_app else notify_like end,
      notify_comment=case when requested_type='comment' then requested_in_app else notify_comment end,
      notify_attest=case when requested_type in ('attest','attest_request') then attest_gate else notify_attest end,
      notify_friend_request=case when requested_type='friend_request' then requested_in_app else notify_friend_request end,
      notify_friend_achievement=case when requested_type='friend_achievement' then requested_in_app else notify_friend_achievement end,
      notify_equipment=case when requested_type='equipment' then requested_in_app else notify_equipment end,
      updated_at=now() where user_id=account_id;
  end if;
end;$$;
revoke all on function public.set_my_notification_event_preference_v1(text,boolean,boolean) from public,anon;
grant execute on function public.set_my_notification_event_preference_v1(text,boolean,boolean) to authenticated;
comment on function public.set_my_notification_event_preference_v1(text,boolean,boolean) is 'Atomic self-only channel choice under existing RLS; retains sharing, consent, push/email and other categories.';
commit;

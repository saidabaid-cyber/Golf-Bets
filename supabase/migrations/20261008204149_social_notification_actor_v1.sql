-- DEV-only controlled application. Additive metadata; no golf/account changes.
-- Existing recipient/audience RLS and read_at-only UPDATE grants stay in place.
alter table public.notification_events_v2
  add column if not exists actor_id uuid,
  add column if not exists reaction_id text;

-- Recover only exact, unambiguous trigger-transaction matches. Never guess an
-- actor from the activity owner, newest reaction, display name or nearby time.
with candidates as (
  select e.id, l.user_id actor_id,
    'like:' || l.activity_id || ':' || l.user_id || ':' || l.expected_hash reaction_id
  from public.notification_events_v2 e join public.social_likes_v3 l
    on e.event_type='like' and e.resource_id=l.activity_id::text and e.created_at=l.created_at
  where l.user_id<>e.recipient_id and e.actor_id is null
  union all
  select e.id, c.author_id, c.id::text
  from public.notification_events_v2 e join public.social_comments_v3 c
    on e.event_type='comment' and e.resource_id=c.activity_id::text and e.created_at=c.created_at
  where c.author_id<>e.recipient_id and e.actor_id is null
), certain as (
  select id, (array_agg(actor_id))[1] actor_id, (array_agg(reaction_id))[1] reaction_id
  from candidates group by id having count(*)=1
)
update public.notification_events_v2 e set actor_id=c.actor_id,reaction_id=c.reaction_id
from certain c where e.id=c.id;

-- Keep every legacy event/read status. Deduplication applies to new insertions
-- through a stable notification UUID; no deletion or unique-index backfill.
create or replace function private.notify_social_reaction_v3()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  recipient uuid; actor uuid; event_name text; permitted boolean;
  reaction text; notice_id uuid;
begin
  if tg_table_name='social_likes_v3' then
    event_name:='like'; actor:=new.user_id;
    reaction:='like:'||new.activity_id||':'||actor||':'||new.expected_hash;
    select author_id into recipient from public.social_activities_v3 where id=new.activity_id;
  elsif tg_table_name='social_comments_v3' then
    event_name:='comment'; actor:=new.author_id; reaction:=new.id::text;
    select author_id into recipient from public.social_activities_v3 where id=new.activity_id;
  else
    event_name:='attest'; actor:=new.attester_id; recipient:=new.target_user_id;
    reaction:=new.id::text;
  end if;
  if recipient is null or recipient=actor then return new; end if;
  select case when event_name='like' then p.notify_like
    when event_name='comment' then p.notify_comment else p.notify_attest end
    into permitted from public.social_activity_preferences_v3 p where p.user_id=recipient;
  if not coalesce(permitted,true) then return new; end if;
  -- Internal delivery is independent of OS push permission/configuration.
  if not exists(select 1 from public.user_preferences p where p.user_id=recipient
      and p.notifications_enabled and p.notification_internal_enabled is not false)
    or exists(select 1 from public.notification_preferences_v2 p
      where p.user_id=recipient and p.event_type=event_name and not p.in_app) then return new; end if;
  if exists(select 1 from public.notification_events_v2 e
    where e.recipient_id=recipient and e.event_type=event_name and e.reaction_id=reaction) then return new; end if;
  notice_id:=md5('social-notice-v1:'||recipient||':'||event_name||':'||reaction)::uuid;
  insert into public.notification_events_v2(id,recipient_id,event_type,resource_type,resource_id,actor_id,reaction_id)
    values(notice_id,recipient,event_name,'ROUND',new.activity_id::text,actor,reaction)
    on conflict(id) do nothing;
  return new;
end;
$$;
comment on column public.notification_events_v2.actor_id is 'Actor captured by the existing social reaction trigger; never supplied by the notification recipient.';
comment on column public.notification_events_v2.reaction_id is 'Stable like/version key or comment/attestation ID; retains history across read/unlike/deletion.';
-- Reversible without removing metadata/history: reapply the previous definition
-- of private.notify_social_reaction_v3 from 20260915183026_social_activity_v3.sql.

begin;
-- Optional, owner-only declarations, not an Index or authorization claim.
create table public.profile_completion_choices (
 user_id uuid primary key references auth.users(id) on delete cascade,
 handicap_choice text check(handicap_choice in ('MANUAL','UNKNOWN')),
 manual_hcp numeric check(manual_hcp between -10 and 54),
 not_applicable text[] not null default '{}' check(not_applicable <@ array['golf','equipment','ball','fitting']::text[]),
 updated_at timestamptz not null default now(),
 check ((handicap_choice='MANUAL' and manual_hcp is not null) or (handicap_choice is distinct from 'MANUAL' and manual_hcp is null))
);
alter table public.profile_completion_choices enable row level security;
revoke all on public.profile_completion_choices from public, anon, authenticated;
grant select, insert, update on public.profile_completion_choices to authenticated;
create policy completion_owner on public.profile_completion_choices for all to authenticated
 using (user_id=(select auth.uid()) and private.account_subject_active((select auth.uid())))
 with check(user_id=(select auth.uid()) and private.account_subject_active((select auth.uid())));

-- Stable QR identifiers expose only the same minimal social identity, never email/location.
create function private.social_profile_card(target uuid)
returns table(user_id uuid, username text, display_name text, avatar_url text)
language sql stable security definer set search_path='' as $$
 select s.user_id,s.username,s.display_name,s.avatar_url from public.social_profiles s
 where s.user_id=target and auth.uid() is not null
 and private.account_subject_active(auth.uid()) and private.account_subject_active(target)
 and not exists(select 1 from public.blocked_connections b where
  (b.owner_id=auth.uid() and b.blocked_user_id=target) or (b.owner_id=target and b.blocked_user_id=auth.uid()))
 and (target=auth.uid() or s.privacy='PUBLIC'
  or exists(select 1 from public.friendships f where (f.user_a_id=auth.uid() and f.user_b_id=target) or (f.user_b_id=auth.uid() and f.user_a_id=target))
  or exists(select 1 from public.friend_requests r where r.state='PENDING' and
   ((r.requester_id=auth.uid() and r.addressee_id=target) or (r.requester_id=target and r.addressee_id=auth.uid()))));
$$;
revoke all on function private.social_profile_card(uuid) from public,anon,service_role;
grant execute on function private.social_profile_card(uuid) to authenticated;
create function public.social_profile_card_v1(target uuid)
returns table(user_id uuid, username text, display_name text, avatar_url text)
language sql stable security invoker set search_path='' as $$ select * from private.social_profile_card(target); $$;
revoke all on function public.social_profile_card_v1(uuid) from public,anon,service_role;
grant execute on function public.social_profile_card_v1(uuid) to authenticated;

create function private.notify_friend_request_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state='PENDING' then
  insert into public.notification_events_v2(id,recipient_id,event_type,resource_type,resource_id)
   values(new.id,new.addressee_id,'friend_request','FRIEND',new.id::text) on conflict do nothing;
 end if;
 return new;
end; $$;
revoke all on function private.notify_friend_request_v1() from public,anon,authenticated;
create trigger notify_friend_request_v1 after insert on public.friend_requests for each row execute function private.notify_friend_request_v1();
-- Read status is the sole client-writable notification field.
revoke update on public.notification_events_v2 from authenticated;
grant update(read_at) on public.notification_events_v2 to authenticated;
commit;

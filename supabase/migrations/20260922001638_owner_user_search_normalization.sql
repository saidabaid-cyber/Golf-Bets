-- Repair authenticated social discovery without exposing private profile data.
-- Additive and idempotent; apply only through the controlled QA migration flow.
begin;

-- Older accounts can predate the social projection. Project only real, usable
-- profile data and only when that owner already chose a discoverable audience.
insert into public.social_profiles(user_id, username, display_name, avatar_url, privacy, updated_at)
select p.id,
  lower(trim(p.username)),
  coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.name), '')),
  p.avatar_url,
  upper(p.profile_visibility),
  now()
from public.profiles p
where p.profile_visibility in ('public', 'friends')
  and p.username is not null
  and lower(trim(p.username)) ~ '^[a-z0-9][a-z0-9._]{1,39}$'
  and coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.name), '')) is not null
  and private.account_subject_active(p.id)
on conflict do nothing;

create index if not exists social_profiles_display_name_search_idx
  on public.social_profiles
  ((lower(regexp_replace(trim(display_name), '[[:space:]]+', ' ', 'g'))) text_pattern_ops);

-- Name, username and exact-email lookup all share one privacy boundary. Email
-- is used only as an exact predicate and is never projected in the result.
create or replace function private.search_group_users(query_text text)
returns table(user_id uuid, username text, display_name text, avatar_url text, is_friend boolean)
language sql stable security definer set search_path = '' as $$
  with normalized as (
    select lower(regexp_replace(trim(coalesce(query_text, '')), '[[:space:]]+', ' ', 'g')) as value
  ), query as (
    select value,
      case when left(value, 1) = '@' then ltrim(value, '@') else value end as identity_value,
      position('@' in value) > 1 as is_email
    from normalized
  ), candidates as (
    select s.user_id, s.username, s.display_name, s.avatar_url,
      exists(
        select 1 from public.friendships f
        where (f.user_a_id = auth.uid() and f.user_b_id = s.user_id)
           or (f.user_b_id = auth.uid() and f.user_a_id = s.user_id)
      ) as is_friend,
      q.value, q.identity_value, q.is_email
    from public.social_profiles s
    join auth.users u on u.id = s.user_id
    cross join query q
    where auth.uid() is not null
      and private.account_subject_active(auth.uid())
      and private.account_subject_active(s.user_id)
      and s.user_id <> auth.uid()
      and length(q.value) between 2 and 254
      and not exists(
        select 1 from public.blocked_connections b
        where (b.owner_id = auth.uid() and b.blocked_user_id = s.user_id)
           or (b.owner_id = s.user_id and b.blocked_user_id = auth.uid())
      )
      and (
        s.privacy = 'PUBLIC'
        or (s.privacy = 'FRIENDS' and exists(
          select 1 from public.friendships f
          where (f.user_a_id = auth.uid() and f.user_b_id = s.user_id)
             or (f.user_b_id = auth.uid() and f.user_a_id = s.user_id)
        ))
      )
      and case when q.is_email then lower(u.email) = q.value else
        lower(s.username) like q.identity_value || '%'
        or lower(regexp_replace(trim(s.display_name), '[[:space:]]+', ' ', 'g')) like q.value || '%'
      end
  )
  select c.user_id, c.username, c.display_name, c.avatar_url, c.is_friend
  from candidates c
  order by
    case when lower(c.username) = c.identity_value then 0
      when lower(regexp_replace(trim(c.display_name), '[[:space:]]+', ' ', 'g')) = c.value then 1
      when lower(c.username) like c.identity_value || '%' then 2 else 3 end,
    lower(c.display_name), c.user_id
  limit 20;
$$;
revoke all on function private.search_group_users(text) from public, anon, authenticated, service_role;
grant execute on function private.search_group_users(text) to authenticated;

create or replace function public.search_group_users_v1(query_text text)
returns table(user_id uuid, username text, display_name text, avatar_url text, is_friend boolean)
language sql stable security invoker set search_path = '' as $$
  select * from private.search_group_users(query_text);
$$;
revoke all on function public.search_group_users_v1(text) from public, anon, service_role;
grant execute on function public.search_group_users_v1(text) to authenticated;

-- Choosing a discoverable audience must also repair a missing legacy social
-- projection. The source remains the owner's canonical profile; no placeholder
-- username or display name is invented.
create or replace function public.set_my_profile_visibility(requested_visibility text)
returns text language plpgsql security invoker set search_path = '' as $$
declare owner_id uuid := (select auth.uid()); saved text; profile_row record;
begin
  if owner_id is null then raise insufficient_privilege using message = 'authentication_required'; end if;
  if requested_visibility is null or requested_visibility not in ('public', 'friends') then
    raise invalid_parameter_value using message = 'invalid_profile_audience';
  end if;
  select * into profile_row from public.profiles where id = owner_id for update;
  if not found then raise insufficient_privilege using message = 'profile_not_available'; end if;
  if profile_row.username is null or lower(trim(profile_row.username)) !~ '^[a-z0-9][a-z0-9._]{1,39}$'
    or coalesce(nullif(trim(profile_row.display_name), ''), nullif(trim(profile_row.name), '')) is null then
    raise invalid_parameter_value using message = 'social_identity_incomplete';
  end if;
  update public.profiles set profile_visibility = requested_visibility
    where id = owner_id returning profile_visibility into saved;
  insert into public.social_profiles(user_id, username, display_name, avatar_url, privacy, updated_at)
    values(owner_id, lower(trim(profile_row.username)),
      coalesce(nullif(trim(profile_row.display_name), ''), nullif(trim(profile_row.name), '')),
      profile_row.avatar_url, upper(requested_visibility), now())
    on conflict(user_id) do update set
      username = excluded.username,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      privacy = excluded.privacy,
      updated_at = excluded.updated_at;
  return saved;
end;
$$;
revoke all on function public.set_my_profile_visibility(text) from public, anon;
grant execute on function public.set_my_profile_visibility(text) to authenticated;

comment on function public.search_group_users_v1(text) is
  'Authenticated minimal social directory: normalized name/username or exact email; returns no email and enforces audience, block and lifecycle rules.';

commit;

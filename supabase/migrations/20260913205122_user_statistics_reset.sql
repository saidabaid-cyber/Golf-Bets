-- Additive privacy control. Historical rounds remain intact; analytics only
-- include rounds completed after reset_at (RESET_FROM_DATE strategy).
begin;

create table if not exists public.user_statistics_resets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reset_at timestamptz not null,
  strategy text not null default 'RESET_FROM_DATE' check (strategy = 'RESET_FROM_DATE'),
  updated_at timestamptz not null default now()
);

alter table public.user_statistics_resets enable row level security;
revoke all on table public.user_statistics_resets from public, anon, authenticated;
grant select, insert, update on table public.user_statistics_resets to authenticated;

drop policy if exists "statistics reset owner read" on public.user_statistics_resets;
create policy "statistics reset owner read" on public.user_statistics_resets for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));
drop policy if exists "statistics reset owner insert" on public.user_statistics_resets;
create policy "statistics reset owner insert" on public.user_statistics_resets for insert to authenticated
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
drop policy if exists "statistics reset owner update" on public.user_statistics_resets;
create policy "statistics reset owner update" on public.user_statistics_resets for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

alter table public.product_usage_events_v2 drop constraint if exists product_usage_events_v2_event_name_check;
alter table public.product_usage_events_v2 add constraint product_usage_events_v2_event_name_check check (event_name in (
  'signup_completed','round_created','round_completed','group_created','friend_added',
  'ai_round_setup','card_ai_used','game_used','gps_used','shot_recorded','ball_fit_completed',
  'course_selected','round_invite_sent','round_invite_accepted','membership_benefits_viewed','ai_insight_viewed',
  'stats_deleted','account_delete_requested'
));

-- Keep the non-sensitive account deletion request event after the Auth row is
-- removed. No email, name, scores or other user content is stored in metadata.
alter table public.product_usage_events_v2 alter column owner_id drop not null;
alter table public.product_usage_events_v2 drop constraint if exists product_usage_events_v2_owner_id_fkey;
alter table public.product_usage_events_v2 add constraint product_usage_events_v2_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete set null;

create or replace function public.reset_my_statistics(confirmation_text text)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  reset_time timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if confirmation_text is distinct from 'ELIMINAR' then raise exception 'strong_confirmation_required'; end if;

  insert into public.user_statistics_resets(user_id, reset_at, strategy, updated_at)
  values (current_user_id, reset_time, 'RESET_FROM_DATE', reset_time)
  on conflict (user_id) do update set reset_at = excluded.reset_at, strategy = excluded.strategy, updated_at = excluded.updated_at;

  insert into public.product_usage_events_v2(id, owner_id, event_name, metadata, occurred_at)
  values ('stats-delete-' || replace(gen_random_uuid()::text, '-', ''), current_user_id, 'stats_deleted', jsonb_build_object('strategy', 'RESET_FROM_DATE'), reset_time);
  return reset_time;
end;
$$;

revoke all on function public.reset_my_statistics(text) from public, anon, authenticated;
grant execute on function public.reset_my_statistics(text) to authenticated;

commit;

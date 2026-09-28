-- Finish the SELF_ATTESTED retirement by projecting an already-declared
-- manual HCP into the existing profile source used by the app. Existing
-- explicit profile/preference handicaps always win.
begin;

alter table private.ghin_legacy_self_attested_migrations
  add column if not exists profile_handicap_before numeric(5,1),
  add column if not exists preference_handicap_before numeric(5,1),
  add column if not exists canonical_manual_handicap numeric(5,1),
  add column if not exists profile_handicap_after numeric(5,1),
  add column if not exists preference_handicap_after numeric(5,1);

-- Capture the pre-migration state once. The legacy provider value itself is
-- never promoted when the user has made a separate manual declaration.
update private.ghin_legacy_self_attested_migrations audit
set profile_handicap_before = profile.default_handicap,
    preference_handicap_before = preferences.default_handicap,
    canonical_manual_handicap = choices.manual_hcp
from public.profile_completion_choices choices
join public.profiles profile on profile.id = choices.user_id
left join public.user_preferences preferences on preferences.user_id = choices.user_id
where audit.owner_id = choices.user_id
  and audit.provider = 'GHIN'
  and audit.canonical_manual_handicap is null
  and choices.handicap_choice = 'MANUAL'
  and choices.manual_hcp between -10 and 54;

update public.profiles profile
set default_handicap = audit.canonical_manual_handicap,
    updated_at = now()
from private.ghin_legacy_self_attested_migrations audit
where profile.id = audit.owner_id
  and audit.canonical_manual_handicap between -10 and 54
  and profile.default_handicap is null;

insert into public.user_preferences (user_id, default_handicap, updated_at)
select audit.owner_id, audit.canonical_manual_handicap, now()
from private.ghin_legacy_self_attested_migrations audit
where audit.canonical_manual_handicap between -10 and 54
on conflict (user_id) do update
set default_handicap = excluded.default_handicap,
    updated_at = excluded.updated_at
where public.user_preferences.default_handicap is null;

update private.ghin_legacy_self_attested_migrations audit
set profile_handicap_after = profile.default_handicap,
    preference_handicap_after = preferences.default_handicap
from public.profiles profile
left join public.user_preferences preferences on preferences.user_id = profile.id
where audit.owner_id = profile.id
  and audit.provider = 'GHIN'
  and audit.canonical_manual_handicap is not null;

comment on column private.ghin_legacy_self_attested_migrations.canonical_manual_handicap is
  'Existing owner-declared manual HCP preserved independently from the retired GHIN projection.';

commit;

-- Close account-deletion gaps introduced by migrations that landed after the
-- lifecycle graph was hardened. Shared scorecard definitions survive without
-- creator provenance; private legacy GHIN audit rows follow their Auth owner.
begin;

alter table public.course_scorecard_profiles
  drop constraint if exists course_scorecard_profiles_created_by_fkey;
alter table public.course_scorecard_profiles
  add constraint course_scorecard_profiles_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- A prior account deletion can have left an audit row orphaned because this
-- private table originally had no Auth FK. Remove only those already-orphaned
-- rows before making future deletion automatic and transactional.
delete from private.ghin_legacy_self_attested_migrations audit
where not exists(select 1 from auth.users account where account.id=audit.owner_id);

alter table private.ghin_legacy_self_attested_migrations
  drop constraint if exists ghin_legacy_self_attested_migrations_owner_id_fkey;
alter table private.ghin_legacy_self_attested_migrations
  add constraint ghin_legacy_self_attested_migrations_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete cascade;

comment on constraint course_scorecard_profiles_created_by_fkey on public.course_scorecard_profiles is
  'Shared scorecard profiles remain usable after creator account deletion; creator provenance is removed.';
comment on constraint ghin_legacy_self_attested_migrations_owner_id_fkey on private.ghin_legacy_self_attested_migrations is
  'Legacy GHIN migration audit is private owner data and is purged with the Auth identity.';

commit;

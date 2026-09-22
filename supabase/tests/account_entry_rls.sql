-- Account-entry owner isolation and lifecycle behavior. Synthetic fixtures only;
-- the transaction always rolls back.
begin;

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('40000000-0000-4000-8000-000000000001','authenticated','authenticated','account-a@backyard.invalid','',now(),'{}','{}',now(),now()),
('40000000-0000-4000-8000-000000000002','authenticated','authenticated','account-b@backyard.invalid','',now(),'{}','{}',now(),now()),
('40000000-0000-4000-8000-000000000003','authenticated','authenticated','account-new@backyard.invalid','',now(),'{}','{}',now(),now()),
('40000000-0000-4000-8000-000000000004','authenticated','authenticated','account-closed@backyard.invalid','',now(),'{}','{}',now(),now());

insert into public.profiles(id,name,display_name,onboarding_completed_at)
values
('40000000-0000-4000-8000-000000000001','Account A','Account A',now()),
('40000000-0000-4000-8000-000000000002','Account B','Account B',now())
on conflict(id) do update set onboarding_completed_at=excluded.onboarding_completed_at;

delete from public.profiles where id in (
  '40000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000004'
);

insert into public.legal_acceptances(user_id,type,version,accepted_at,locale)
values
('40000000-0000-4000-8000-000000000001','terms','qa-v1',now(),'es-MX'),
('40000000-0000-4000-8000-000000000001','privacy','qa-v1',now(),'es-MX'),
('40000000-0000-4000-8000-000000000002','terms','qa-v1',now(),'es-MX');

insert into private.account_lifecycle_state(user_id,account_status)
values('40000000-0000-4000-8000-000000000004','archived');

set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$ declare visible integer; status text; begin
  select public.account_access_status() into status;
  if status <> 'active' then raise exception 'existing active account was not active: %', status; end if;
  select count(*) into visible from public.profiles where id='40000000-0000-4000-8000-000000000001';
  if visible <> 1 then raise exception 'owner profile was not readable'; end if;
  select count(*) into visible from public.profiles where id='40000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'another user profile was readable'; end if;
  select count(*) into visible from public.legal_acceptances where user_id='40000000-0000-4000-8000-000000000001';
  if visible <> 2 then raise exception 'owner legal acceptances were not readable'; end if;
  select count(*) into visible from public.legal_acceptances where user_id='40000000-0000-4000-8000-000000000002';
  if visible <> 0 then raise exception 'another user legal acceptance was readable'; end if;
end $$;

select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ declare visible integer; status text; begin
  select public.account_access_status() into status;
  if status <> 'active' then raise exception 'new account without lifecycle row was not active: %', status; end if;
  select count(*) into visible from public.profiles where id='40000000-0000-4000-8000-000000000003';
  if visible <> 0 then raise exception 'new-account fixture unexpectedly has a profile'; end if;
  select count(*) into visible from public.legal_acceptances where user_id='40000000-0000-4000-8000-000000000003';
  if visible <> 0 then raise exception 'new-account fixture unexpectedly has legal acceptances'; end if;
end $$;

select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
do $$ declare status text; begin
  select public.account_access_status() into status;
  if status <> 'archived' then raise exception 'closed account was not archived: %', status; end if;
end $$;

reset role;
rollback;

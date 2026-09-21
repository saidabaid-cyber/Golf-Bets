-- Include server-uploaded private support attachments in the existing leased
-- account-delete storage manifest. No data is deleted by this migration.
-- Ownership, policy, lease validation, batching and grants remain unchanged.
create or replace function public.account_lifecycle_storage(operation_id uuid,lease uuid)
returns table(bucket_id text,name text) language plpgsql security definer set search_path='' as $$
declare actor uuid; begin
  select user_id into actor from private.account_lifecycle_jobs where request_id=operation_id and lease_token=lease
    and lease_until>clock_timestamp() and data_policy='delete_golf_data' and stage='requested';
  if actor is null or lease is null then raise insufficient_privilege; end if;
  return query select o.bucket_id,o.name from storage.objects o
    where o.owner_id=actor::text or o.owner=actor
      or (o.bucket_id in ('scorecard-photos','feedback-private') and split_part(o.name,'/',1)=actor::text)
    order by o.bucket_id,o.name limit 100;
end $$;

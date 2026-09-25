import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("feedback request and private attachment RLS contract passes transactionally", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema private;
      create schema storage;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table private.account_lifecycle_state (user_id uuid primary key, account_status text not null);
      create function private.account_data_access_allowed() returns boolean
      language sql stable security definer set search_path='' as $$
        select (select auth.uid()) is null or (
          exists(select 1 from auth.users where id=(select auth.uid()))
          and not exists(select 1 from private.account_lifecycle_state where user_id=(select auth.uid()))
        )
      $$;
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key,
        bucket_id text not null references storage.buckets(id),
        name text not null,
        owner uuid,
        owner_id text,
        unique(bucket_id,name)
      );
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      grant select,insert,update,delete on storage.objects to authenticated,service_role;

      create table public.feedback_requests (
        id uuid primary key,
        user_id uuid not null references auth.users(id) on delete cascade,
        category text not null,
        payload jsonb not null,
        status text not null,
        provider_message_id text,
        error_code text,
        attempts integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table public.feedback_requests enable row level security;
      revoke all on public.feedback_requests from public,anon,authenticated;
      grant select on public.feedback_requests to authenticated;
      grant all on public.feedback_requests to service_role;
      create policy feedback_owner_read on public.feedback_requests for select to authenticated
        using(user_id=(select auth.uid()));
    `);
    await db.exec(readFileSync("supabase/migrations/20260921002925_feedback_internal_requests.sql", "utf8"));
    await db.exec("alter table public.feedback_requests add column data_environment text not null default 'PRODUCTION'");
    await db.exec(readFileSync("supabase/migrations/20260924235900_feedback_requests_account_lifecycle_guard.sql", "utf8"));
    await db.exec(readFileSync("supabase/tests/feedback_requests_rls.sql", "utf8"));

    const users = await db.query<{ count: number }>(
      "select count(*)::int as count from auth.users where id::text like '46000000-%'",
    );
    const requests = await db.query<{ count: number }>(
      "select count(*)::int as count from public.feedback_requests where id::text like '46100000-%'",
    );
    const objects = await db.query<{ count: number }>(
      "select count(*)::int as count from storage.objects where id::text like '46200000-%'",
    );
    assert.deepEqual([users.rows[0]?.count, requests.rows[0]?.count, objects.rows[0]?.count], [0, 0, 0]);

    const forceFlags = await db.query<{ relforcerowsecurity: boolean }>(`
      select relforcerowsecurity from pg_class
      where oid in ('public.feedback_requests'::regclass, 'storage.objects'::regclass)
      order by oid
    `);
    assert.deepEqual(forceFlags.rows.map((row) => row.relforcerowsecurity), [false, false]);
  } finally {
    await db.close();
  }
});

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// Isolated PostgreSQL/WASM. No network, credentials or remote data.
const db = new PGlite({ extensions: { pg_trgm } });
const repair = "20260917070829_group_owner_returning_read.sql";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const q = (sql, values) => db.query(sql, values);
const asUser = (id) => db.exec(`set role authenticated; set request.jwt.claim.sub='${id}';`);
const admin = () => db.exec("reset role; reset request.jwt.claim.sub;");
async function denied(action) {
  let failure;
  try { await action(); } catch (error) { failure = error; }
  assert.equal(failure?.code, "42501", failure?.message || "expected access denial");
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create publication supabase_realtime;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(),banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid references auth.users(id),owner_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    -- Only compile existing legacy PIN functions; cryptography is not under test.
    create function extensions.crypt(text,text) returns text language sql immutable as $$ select md5($1||$2) $$;
    create function extensions.gen_salt(text) returns text language sql immutable as $$ select $1 $$;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$ select decode(md5($1),'hex') $$;
    create function extensions.gen_random_bytes(integer) returns bytea language sql volatile as $$ select substring(decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex') from 1 for $1) $$;
    grant usage on schema auth,storage,extensions to anon,authenticated,service_role;
  `);
  for (const file of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql") && name !== repair).sort()) {
    const sql = readFileSync(`supabase/migrations/${file}`, "utf8")
      .replace(/create extension if not exists pgcrypto(?: with schema extensions)?;/gi, "");
    await db.exec(sql);
  }
  await q("insert into auth.users(id,email) values($1,'group-a@example.invalid'),($2,'group-b@example.invalid')", [A, B]);

  await asUser(A);
  assert.equal((await q("select id from public.groups_v2 limit 0")).rows.length, 0, "table SELECT was already permitted");
  await denied(() => q("insert into public.groups_v2(owner_id,name) values($1,'Before repair') returning id", [A]));
  await q("insert into public.groups_v2(owner_id,name) values($1,'Separate read works')", [A]);
  assert.equal((await q("select id from public.groups_v2 where name='Separate read works'")).rows.length, 1);
  assert.equal((await q("select id from public.groups_v2 where name='Before repair'")).rows.length, 0, "failed statement rolled back");

  await admin();
  await db.exec(readFileSync(`supabase/migrations/${repair}`, "utf8"));
  await asUser(A);
  const created = (await q("insert into public.groups_v2(owner_id,name) values($1,'Returning works') returning id,owner_id,name", [A])).rows[0];
  assert.equal(created.owner_id, A);
  assert.equal(created.name, "Returning works");
  assert.equal((await q("select id from public.groups_v2 where id=$1", [created.id])).rows.length, 1);

  await asUser(B);
  assert.equal((await q("select id from public.groups_v2 where id=$1", [created.id])).rows.length, 0, "unrelated user cannot read");
  assert.equal((await q("update public.groups_v2 set name='Foreign edit' where id=$1 returning id", [created.id])).rows.length, 0);
  assert.equal((await q("delete from public.groups_v2 where id=$1 returning id", [created.id])).rows.length, 0);
  await denied(() => q("insert into public.groups_v2(owner_id,name) values($1,'Forged owner') returning id", [A]));

  await asUser(A);
  await q("insert into public.group_memberships_v2(group_id,user_id,display_name_snapshot,role) values($1,$2,'B','MEMBER')", [created.id, B]);
  await asUser(B);
  assert.equal((await q("select id from public.groups_v2 where id=$1", [created.id])).rows.length, 1, "existing member read remains allowed");
  assert.equal((await q("update public.groups_v2 set name='Member cannot manage' where id=$1 returning id", [created.id])).rows.length, 0);

  await admin();
  await db.exec("set role anon;");
  await denied(() => q("select id from public.groups_v2"));
  await admin();
  await db.exec("set role service_role;");
  await denied(() => q("select id from public.groups_v2"));
  await admin();
  await q("insert into private.account_lifecycle_state(user_id,account_status) values($1,'archived')", [A]);
  await asUser(A);
  assert.equal((await q("select id from public.groups_v2")).rows.length, 0, "restrictive lifecycle policy still blocks archived owner");
  await denied(() => q("insert into public.groups_v2(owner_id,name) values($1,'Archived owner') returning id", [A]));
  console.log("PASS: reproduced pre-fix RETURNING failure; direct-owner SELECT repairs creation, retaining stranger/member/write/anon/service/lifecycle isolation.");
} catch (error) {
  console.error(error.code || "ASSERTION", error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}

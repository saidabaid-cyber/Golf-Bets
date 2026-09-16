import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL in WASM. No shared/remote Preview or Production DB is touched.
const db = new PGlite();
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FRESH = "33333333-3333-4333-8333-333333333333";
const TEXT = "AI_PROVIDER_PROCESSING_CONSENT";
const PHOTO = "AI_IMAGE_PROCESSING_CONSENT";
const LAUNCH = "AI_LAUNCH_MONITOR_PROCESSING_CONSENT";
const choices = (text, photo, launch = false) => [{ scope: TEXT, accepted: text }, { scope: PHOTO, accepted: photo }, { scope: LAUNCH, accepted: launch }];
const call = async (owner, decisions, source = "onboarding", version = "current") => (
  await db.query("select * from public.record_ai_processing_consent_decisions($1::uuid, $2, $3::jsonb, $4)",
    [owner, version, JSON.stringify(decisions), source])
).rows;
const expectError = async (action, code) => {
  try { await action(); assert.fail(`Expected PostgreSQL ${code}`); }
  catch (error) { assert.equal(error.code, code, error.message); }
};
const statuses = (rows) => Object.fromEntries(rows.map((row) => [row.scope, row.decision_status]));
const results = [];
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to authenticated, service_role;
    insert into auth.users values ('${OWNER}'), ('${OTHER}'), ('${FRESH}');
  `);
  await db.exec(readFileSync("supabase/migrations/20260908134650_ai_processing_consents.sql", "utf8"));
  await db.exec(`insert into public.ai_processing_consents(user_id,scope,policy_version,accepted_at,revoked_at)
    values ('${OWNER}','${TEXT}','legacy','2026-09-01','2026-09-02'),
           ('${OWNER}','${PHOTO}','legacy','2026-09-01',null);`);
  const migration = readFileSync("supabase/migrations/20260916020557_ai_consent_onboarding_decisions.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(readFileSync("supabase/tests/ai_processing_consents_rls.sql", "utf8"));
  await db.exec(`create schema private;
    create function private.account_data_access_allowed() returns boolean language sql stable as $$select true$$;
    grant usage on schema private to authenticated;
    create policy account_active_access on public.ai_processing_consents as restrictive for all to authenticated
      using ((select private.account_data_access_allowed())) with check ((select private.account_data_access_allowed()));`);
  await db.exec(readFileSync("supabase/tests/ai_processing_consents_rls.sql", "utf8"));
  const legacy = (await db.query("select * from public.ai_processing_consents order by id")).rows;
  assert.equal(legacy[0].decision_status, "revoked");
  assert.equal(legacy[1].decision_status, "accepted");
  assert.ok(legacy.every((row) => row.source === "legacy"));
  results.push("migration and repeat apply preserve legacy acceptance/revocation without retroactive consent");

  await db.exec("set role service_role;");
  const first = await call(OWNER, choices(true, false));
  assert.deepEqual(statuses(first), { [PHOTO]: "declined", [TEXT]: "accepted", [LAUNCH]: "declined" });
  assert.ok(first.every((row) => row.source === "onboarding" && row.decided_at instanceof Date));
  assert.equal(first.find((row) => row.scope === PHOTO).accepted_at, null);
  assert.ok(first.find((row) => row.scope === TEXT).accepted_at instanceof Date);
  const retry = await call(OWNER, choices(false, true), "account_update");
  assert.deepEqual(retry, first, "resolved choices are never overwritten by checkpoint retry/stale device");
  results.push("atomic onboarding accepts text, records explicit photo decline, retry does not alter choices");

  const revoke = await call(OWNER, [{ scope: TEXT, accepted: false }], "settings");
  assert.equal(revoke.find((row) => row.scope === TEXT).decision_status, "revoked");
  assert.ok(revoke.find((row) => row.scope === TEXT).revoked_at instanceof Date);
  assert.equal(revoke.find((row) => row.scope === TEXT).source, "onboarding", "original acceptance source preserved");
  const stale = await call(OWNER, choices(true, true), "onboarding");
  assert.deepEqual(stale, revoke, "stale onboarding cannot resurrect revoked/declined scope");
  const reaccepted = await call(OWNER, [{ scope: TEXT, accepted: true }], "settings");
  assert.equal(reaccepted.find((row) => row.scope === TEXT).source, "settings");
  assert.equal(reaccepted.find((row) => row.scope === TEXT).decision_status, "accepted");
  const preserved = (await db.query("select decision_status from public.ai_processing_consents where user_id=$1 and scope=$2 and policy_version='current' order by id", [OWNER, TEXT])).rows;
  assert.deepEqual(preserved.map((row) => row.decision_status), ["revoked", "accepted"]);
  results.push("settings revoke/reauthorize preserve audit; checkpoint cannot resurrect an authorization");

  const photoOnly = await call(OWNER, [{ scope: PHOTO, accepted: true }], "settings");
  assert.equal(photoOnly.find((item) => item.scope === PHOTO).decision_status, "accepted");
  assert.equal(photoOnly.find((item) => item.scope === LAUNCH).decision_status, "declined");
  results.push("scorecard authorization never grants separate launch-monitor processing");

  const optionalDecline = await call(OTHER, choices(false, false), "account_update");
  assert.ok(optionalDecline.every((row) => row.decision_status === "declined" && row.accepted_at === null));
  const nextPolicy = await call(OTHER, choices(true, false), "account_update", "new-policy");
  assert.equal(nextPolicy.length, 3);
  assert.equal((await db.query("select count(*)::int as n from public.ai_processing_consents where user_id=$1", [OTHER])).rows[0].n, 6);
  results.push("existing account opt-out resolves all three choices; new policy keeps independent decision history");

  await expectError(() => call(FRESH, [{ scope: TEXT, accepted: true }, { scope: PHOTO, accepted: "yes" }]), "22023");
  await expectError(() => call(FRESH, [{ scope: TEXT, accepted: true }, { scope: TEXT, accepted: false }]), "22023");
  await expectError(() => call(FRESH, [{ scope: TEXT, accepted: true, userId: OWNER }]), "22023");
  await expectError(() => call(FRESH, choices(true, true), "feature_popup"), "22023");
  assert.equal((await db.query("select count(*)::int as n from public.ai_processing_consents where user_id=$1", [FRESH])).rows[0].n, 0);
  results.push("strict decision shape/source validation never produces partial records");

  await db.exec(`reset role;
    create function public.fail_second_consent_qa() returns trigger language plpgsql as $$
    begin if new.user_id = '${FRESH}' and new.scope='${PHOTO}' then raise exception 'QA injected failure'; end if; return new; end $$;
    create trigger fail_second_consent_qa before insert on public.ai_processing_consents
      for each row execute function public.fail_second_consent_qa();
    set role service_role;`);
  await expectError(() => call(FRESH, choices(true, true)), "P0001");
  assert.equal((await db.query("select count(*)::int as n from public.ai_processing_consents where user_id=$1", [FRESH])).rows[0].n, 0);
  await db.exec("reset role; drop trigger fail_second_consent_qa on public.ai_processing_consents;");
  results.push("real SQL failure on second scope rolls back first scope too");

  await db.exec(`set role authenticated; set request.jwt.claim.sub='${OWNER}';`);
  assert.ok((await db.query("select * from public.ai_processing_consents")).rows.every((row) => row.user_id === OWNER));
  await expectError(() => call(OTHER, choices(true, true)), "42501");
  await expectError(() => db.query("update public.ai_processing_consents set decision_status='accepted'"), "42501");
  await expectError(() => db.query("delete from public.ai_processing_consents"), "42501");
  await db.exec("reset role; set role anon;");
  await expectError(() => call(OWNER, choices(true, true)), "42501");
  await db.exec("reset role;");
  const definer = (await db.query("select prosecdef from pg_proc where proname='record_ai_processing_consent_decisions'")).rows[0].prosecdef;
  assert.equal(definer, false);
  results.push("RLS owner-only reads; browser/anonymous RPC and mutation denied; no SECURITY DEFINER escalation");
  console.log(JSON.stringify({ status: "PASS", database: "local PGlite only", checks: results }, null, 2));
} finally { await db.close(); }

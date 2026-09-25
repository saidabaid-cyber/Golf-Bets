import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { previewDatabaseEnvironment, REQUIRED_RLS_TESTS } from "./run-preview-rls-tests.mjs";

const previewRef = "bymeopxkxapfizeeqeyb";
const productionRef = "zhqmlpljloumldaczcfp";
const sslRootCert = fileURLToPath(import.meta.url);
const base = {
  SUPABASE_PREVIEW_PROJECT_REF: previewRef,
  SUPABASE_PRODUCTION_PROJECT_REF: productionRef,
  SUPABASE_PREVIEW_DB_SSLROOTCERT: sslRootCert,
  PATH: "synthetic-path",
  PGHOSTADDR: "203.0.113.10",
  pghostaddr: "203.0.113.11",
  PGSERVICE: "untrusted",
  PGSERVICEFILE: "untrusted",
  PGPASSFILE: "untrusted",
  PGOPTIONS: "-c search_path=untrusted",
  PGSSLMODE: "disable",
};

test("Preview RLS runner includes every 17-file canonical contract exactly once", () => {
  const repositoryContracts = readdirSync("supabase/tests")
    .filter((filename) => filename.endsWith("_rls.sql"))
    .sort();
  assert.equal(REQUIRED_RLS_TESTS.length, 17);
  assert.equal(new Set(REQUIRED_RLS_TESTS).size, REQUIRED_RLS_TESTS.length);
  assert.deepEqual([...REQUIRED_RLS_TESTS].sort(), repositoryContracts);
  assert.ok(REQUIRED_RLS_TESTS.includes("feedback_requests_rls.sql"));
  assert.ok(REQUIRED_RLS_TESTS.includes("polla_live_rls.sql"));
  const feedbackContract = readFileSync("supabase/tests/feedback_requests_rls.sql", "utf8");
  assert.match(feedbackContract, /^--[^\n]*\n--[^\n]*\nbegin;/);
  assert.match(feedbackContract, /rollback;\s*$/);
  const pollaContract = readFileSync("supabase/tests/polla_live_rls.sql", "utf8");
  assert.match(pollaContract, /^--[^\n]*\n--[^\n]*\nbegin;/);
  assert.match(pollaContract, /owner A created a tournament for owner B/);
  assert.match(pollaContract, /owner A could not create its own tournament/);
  assert.match(pollaContract, /old_score = 4[\s\S]*new_score = 5/);
  assert.match(pollaContract, /archived owner retained tournament access/);
  assert.match(pollaContract, /raw Polla tables must not be published through Realtime/);
  assert.match(pollaContract, /sanitized Polla leaderboard event signal is not published/);
  assert.match(pollaContract, /rollback;\s*$/);
});

test("Preview RLS DB environment accepts only the exact direct project host and scrubs inherited libpq controls", () => {
  const environment = previewDatabaseEnvironment({
    ...base,
    SUPABASE_PREVIEW_DB_URL: `postgresql://postgres:synthetic-password@db.${previewRef}.supabase.co:5432/postgres?sslmode=verify-full`,
  });
  assert.equal(environment.PGHOST, `db.${previewRef}.supabase.co`);
  assert.equal(environment.PGUSER, "postgres");
  assert.equal(environment.PGSSLMODE, "verify-full");
  assert.equal(environment.PGSSLROOTCERT, sslRootCert);
  assert.equal(environment.PGHOSTADDR, undefined);
  assert.equal(environment.pghostaddr, undefined);
  assert.equal(environment.PGSERVICE, undefined);
  assert.equal(environment.PGOPTIONS, undefined);
  assert.equal(environment.SUPABASE_PRODUCTION_PROJECT_REF, undefined);
  assert.equal(environment.PATH, "synthetic-path");
});

test("Preview RLS DB environment accepts only an exact Supabase pooler identity", () => {
  const environment = previewDatabaseEnvironment({
    ...base,
    SUPABASE_PREVIEW_DB_URL: `postgresql://postgres.${previewRef}:synthetic-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  });
  assert.equal(environment.PGHOST, "aws-0-us-east-1.pooler.supabase.com");
  assert.equal(environment.PGUSER, `postgres.${previewRef}`);
});

test("Preview RLS DB environment rejects spoofed refs, hosts, TLS and libpq URL controls", () => {
  for (const url of [
    `postgresql://postgres.${previewRef}:synthetic-password@evil.example:5432/postgres?sslmode=verify-full`,
    `postgresql://postgres.${previewRef}suffix:synthetic-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    `postgresql://postgres:synthetic-password@db.${previewRef}.supabase.co:5432/postgres?sslmode=disable`,
    `postgresql://postgres:synthetic-password@db.${previewRef}.supabase.co:6543/postgres?sslmode=verify-full`,
    `postgresql://postgres:synthetic-password@db.${previewRef}.supabase.co:5432/postgres?sslmode=verify-full&hostaddr=203.0.113.10`,
  ]) assert.throws(() => previewDatabaseEnvironment({ ...base, SUPABASE_PREVIEW_DB_URL: url }));
});

test("Preview RLS DB environment rejects malformed or Production-equal refs", () => {
  const validUrl = `postgresql://postgres:synthetic-password@db.${previewRef}.supabase.co:5432/postgres?sslmode=verify-full`;
  assert.throws(() => previewDatabaseEnvironment({ ...base, SUPABASE_PREVIEW_PROJECT_REF: `${previewRef}x`, SUPABASE_PREVIEW_DB_URL: validUrl }), /exact 20-character/);
  assert.throws(() => previewDatabaseEnvironment({ ...base, SUPABASE_PRODUCTION_PROJECT_REF: previewRef, SUPABASE_PREVIEW_DB_URL: validUrl }), /identical/);
  const productionUrl = `postgresql://postgres:synthetic-password@db.${productionRef}.supabase.co:5432/postgres?sslmode=verify-full`;
  assert.throws(() => previewDatabaseEnvironment({
    ...base,
    SUPABASE_PREVIEW_PROJECT_REF: productionRef,
    SUPABASE_PRODUCTION_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa",
    SUPABASE_PREVIEW_DB_URL: productionUrl,
  }), /canonical isolated QA/);
});

test("Preview RLS DB errors never echo malformed credential-bearing URLs", () => {
  for (const value of [
    "postgresql://postgres:RLS_SENTINEL_SECRET@[::1",
    `postgresql://postgres.%RLS_SENTINEL_SECRET:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  ]) {
    let failure;
    try { previewDatabaseEnvironment({ ...base, SUPABASE_PREVIEW_DB_URL: value }); } catch (error) { failure = error; }
    assert.ok(failure instanceof Error);
    assert.doesNotMatch(String(failure?.stack || failure), /RLS_SENTINEL_SECRET/);
  }
});

test("Preview RLS runner rejects decoded control characters before spawn without echoing the password", () => {
  const sentinel = "RLS_SENTINEL_SECRET";
  const result = spawnSync(process.execPath, ["scripts/run-preview-rls-tests.mjs"], {
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      SUPABASE_PREVIEW_PROJECT_REF: previewRef,
      SUPABASE_PRODUCTION_PROJECT_REF: productionRef,
      SUPABASE_PREVIEW_DB_SSLROOTCERT: sslRootCert,
      SUPABASE_PREVIEW_DB_URL: `postgresql://postgres:${sentinel}%00TAIL@db.${previewRef}.supabase.co:5432/postgres?sslmode=verify-full`,
    },
  });
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, null);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(`${sentinel}|TAIL`));
  assert.match(result.stderr, /credentials contain invalid characters/);
});

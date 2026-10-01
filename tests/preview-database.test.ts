import test from "node:test";
import assert from "node:assert/strict";
import { isolatedPreviewDatabaseEnabled, previewDatabaseFeaturesAvailable, reviewedCourseDatabaseEnabled } from "../lib/preview-database";

const preview = {
  PREVIEW_DB_REF: "bymeopxkxapfizeeqeyb",
  NEXT_PUBLIC_SUPABASE_URL: "https://bymeopxkxapfizeeqeyb.supabase.co",
  VERCEL_ENV: "preview",
};

const adminPreview = {
  VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "production",
  VERCEL_GIT_COMMIT_REF: "feature/admin-mode-v2",
  ADMIN_MODE_V2_ENABLED: "true",
  ADMIN_MODE_ISOLATED_DB_REF: "gvzeymebltssgjkvksxt",
  NEXT_PUBLIC_SUPABASE_URL: "https://gvzeymebltssgjkvksxt.supabase.co",
};

test("read-only courses accept Admin V2 isolation without enabling destructive QA", () => {
  assert.equal(reviewedCourseDatabaseEnabled(adminPreview), true);
  assert.equal(isolatedPreviewDatabaseEnabled(adminPreview), false);
  assert.equal(reviewedCourseDatabaseEnabled(preview), true);
  assert.equal(reviewedCourseDatabaseEnabled({}), false);
});

test("Admin V2 course reads reject DEV fallback, wrong branches and invalid bindings", () => {
  for (const overrides of [
    { ADMIN_MODE_V2_ENABLED: "false" },
    { ADMIN_MODE_ISOLATED_DB_REF: undefined },
    { VERCEL_ENV: "production" },
    { VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_GIT_COMMIT_REF: "beta" },
    { VERCEL_GIT_COMMIT_REF: "integration/backyard-current" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://gvzeymebltssgjkvksxt.supabase.co.attacker.test" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://gvzeymebltssgjkvksxt.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://gvzeymebltssgjkvksxt.supabase.co/path" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://user:secret@gvzeymebltssgjkvksxt.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://gvzeymebltssgjkvksxt.supabase.co?project=shared" },
    { PREVIEW_DB_REF: preview.PREVIEW_DB_REF, NEXT_PUBLIC_SUPABASE_URL: preview.NEXT_PUBLIC_SUPABASE_URL },
    { ADMIN_MODE_ISOLATED_DB_REF: "bymeopxkxapfizeeqeyb", NEXT_PUBLIC_SUPABASE_URL: preview.NEXT_PUBLIC_SUPABASE_URL },
    { ADMIN_MODE_ISOLATED_DB_REF: "zhqmlpljloumldaczcfp", NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co" },
  ]) assert.equal(reviewedCourseDatabaseEnabled({ ...adminPreview, ...overrides }), false, JSON.stringify(overrides));
});

test("isolated Preview requires an explicit matching project binding", () => {
  assert.equal(isolatedPreviewDatabaseEnabled(preview), true);
  assert.equal(isolatedPreviewDatabaseEnabled({ ...preview, VERCEL_ENV: undefined }), true);
  assert.equal(isolatedPreviewDatabaseEnabled({}), false);
  for (const override of [
    { PREVIEW_DB_REF: undefined },
    { PREVIEW_DB_REF: "abcdefghijklmnopqrst", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" },
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" },
    { VERCEL: "1", VERCEL_ENV: undefined },
    { VERCEL: "", VERCEL_ENV: undefined },
    { VERCEL: "1", VERCEL_ENV: "Preview" },
    { VERCEL: "1", VERCEL_ENV: " preview " },
    { PREVIEW_DB_REF: "zhqmlpljloumldaczcfp", NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co" },
  ]) assert.equal(isolatedPreviewDatabaseEnabled({ ...preview, ...override }), false);
});

test("isolated Preview rejects credential-bearing, deceptive or non-HTTPS URLs", () => {
  for (const url of [
    "http://bymeopxkxapfizeeqeyb.supabase.co", "https://bymeopxkxapfizeeqeyb.supabase.co.attacker.test",
    "https://user:secret@bymeopxkxapfizeeqeyb.supabase.co", "https://bymeopxkxapfizeeqeyb.supabase.co:8443",
    "https://bymeopxkxapfizeeqeyb.supabase.co/path", "https://bymeopxkxapfizeeqeyb.supabase.co?project=shared",
    "https://bymeopxkxapfizeeqeyb.supabase.co#shared", "not-a-url",
  ]) assert.equal(isolatedPreviewDatabaseEnabled({ ...preview, NEXT_PUBLIC_SUPABASE_URL: url }), false);
});

test("cloud and OAuth features accept only recognized Vercel deployment environments", () => {
  for (const VERCEL_ENV of ["development", "production"]) {
    assert.equal(previewDatabaseFeaturesAvailable({ VERCEL: "1", VERCEL_ENV }), true);
  }
  assert.equal(previewDatabaseFeaturesAvailable({ ...preview, VERCEL: "1" }), true);

  for (const VERCEL of ["", "0", "1", "false", " "]) {
    for (const VERCEL_ENV of [undefined, "", "staging", "test", "Preview", " preview ", "PRODUCTION"]) {
      assert.equal(
        previewDatabaseFeaturesAvailable({ ...preview, VERCEL, VERCEL_ENV }),
        false,
        `VERCEL=${JSON.stringify(VERCEL)} VERCEL_ENV=${JSON.stringify(VERCEL_ENV)} must fail closed`,
      );
    }
  }
});

test("cloud and OAuth features fail closed on a Vercel Preview with a shared or mismatched database", () => {
  assert.equal(previewDatabaseFeaturesAvailable({ ...preview, VERCEL: "1" }), true);
  assert.equal(previewDatabaseFeaturesAvailable({
    ...preview,
    VERCEL: "1",
    PREVIEW_DB_REF: "bymeopxkxapfizeeqeyb",
    NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co",
  }), false);
  assert.equal(previewDatabaseFeaturesAvailable({ ...preview, VERCEL: "1", PREVIEW_DB_REF: undefined }), false);
});

test("cloud and OAuth features preserve non-Vercel local and self-hosted behavior", () => {
  assert.equal(previewDatabaseFeaturesAvailable({}), true);
  assert.equal(previewDatabaseFeaturesAvailable({ ...preview, VERCEL_ENV: undefined }), true);
  assert.equal(previewDatabaseFeaturesAvailable({ ...preview, VERCEL_ENV: "production" }), true);
  assert.equal(previewDatabaseFeaturesAvailable({ ...preview, VERCEL_ENV: "development" }), true);
  assert.equal(previewDatabaseFeaturesAvailable({ ...preview, VERCEL_ENV: "staging" }), true);
});

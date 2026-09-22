import test from "node:test";
import assert from "node:assert/strict";
import { isolatedPreviewDatabaseEnabled, previewDatabaseFeaturesAvailable } from "../lib/preview-database";

const preview = {
  PREVIEW_DB_REF: "abcdefghijklmnopqrst",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  VERCEL_ENV: "preview",
};

test("isolated Preview requires an explicit matching project binding", () => {
  assert.equal(isolatedPreviewDatabaseEnabled(preview), true);
  assert.equal(isolatedPreviewDatabaseEnabled({ ...preview, VERCEL_ENV: undefined }), true);
  assert.equal(isolatedPreviewDatabaseEnabled({}), false);
  for (const override of [
    { PREVIEW_DB_REF: undefined }, { PREVIEW_DB_REF: "anotherprojectrefxxxx" },
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" },
    { VERCEL: "1", VERCEL_ENV: undefined },
    { PREVIEW_DB_REF: "zhqmlpljloumldaczcfp", NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co" },
  ]) assert.equal(isolatedPreviewDatabaseEnabled({ ...preview, ...override }), false);
});

test("isolated Preview rejects credential-bearing, deceptive or non-HTTPS URLs", () => {
  for (const url of [
    "http://abcdefghijklmnopqrst.supabase.co", "https://abcdefghijklmnopqrst.supabase.co.attacker.test",
    "https://user:secret@abcdefghijklmnopqrst.supabase.co", "https://abcdefghijklmnopqrst.supabase.co:8443",
    "https://abcdefghijklmnopqrst.supabase.co/path", "https://abcdefghijklmnopqrst.supabase.co?project=shared",
    "https://abcdefghijklmnopqrst.supabase.co#shared", "not-a-url",
  ]) assert.equal(isolatedPreviewDatabaseEnabled({ ...preview, NEXT_PUBLIC_SUPABASE_URL: url }), false);
});

test("cloud and OAuth features fail closed on a Vercel Preview with a shared or mismatched database", () => {
  assert.equal(previewDatabaseFeaturesAvailable(preview), true);
  assert.equal(previewDatabaseFeaturesAvailable({ ...preview, VERCEL_ENV: "production" }), true);
  assert.equal(previewDatabaseFeaturesAvailable({
    ...preview,
    PREVIEW_DB_REF: "bymeopxkxapfizeeqeyb",
    NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co",
  }), false);
  assert.equal(previewDatabaseFeaturesAvailable({ ...preview, PREVIEW_DB_REF: undefined }), false);
});

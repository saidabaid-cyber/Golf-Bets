import test from "node:test";
import assert from "node:assert/strict";
import { socialPreviewEnabled } from "../lib/social-preview-gate";
const env = { SOCIAL_ACTIVITY_ENABLED: "true", SOCIAL_PREVIEW_DB_REF: "bymeopxkxapfizeeqeyb", NEXT_PUBLIC_SUPABASE_URL: "https://bymeopxkxapfizeeqeyb.supabase.co", VERCEL_ENV: "preview" };
test("Social gate accepts only explicit isolated Preview target", () => { assert.equal(socialPreviewEnabled(env), true); assert.equal(socialPreviewEnabled({}), false); });
test("Social gate rejects shared DB even if operator accidentally enables flag", () => { assert.equal(socialPreviewEnabled({ ...env, SOCIAL_PREVIEW_DB_REF: "zhqmlpljloumldaczcfp", NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co" }), false); });
test("Social gate rejects production and wrong project/host", () => {
  for (const values of [{ VERCEL_ENV: "production" }, { NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }, { SOCIAL_ACTIVITY_ENABLED: "false" }, { SOCIAL_PREVIEW_DB_REF: "" }]) assert.equal(socialPreviewEnabled({ ...env, ...values }), false);
});
test("Social uses common Preview binding, rejects contradictory legacy binding and deceptive URLs", () => {
  assert.equal(socialPreviewEnabled({ ...env, PREVIEW_DB_REF: env.SOCIAL_PREVIEW_DB_REF, SOCIAL_PREVIEW_DB_REF: undefined }), true);
  assert.equal(socialPreviewEnabled({ ...env, PREVIEW_DB_REF: "bbbbbbbbbbbbbbbbbbbb" }), false);
  for (const url of [
    "http://bymeopxkxapfizeeqeyb.supabase.co", "https://bymeopxkxapfizeeqeyb.supabase.co.attacker.invalid",
    "https://user:password@bymeopxkxapfizeeqeyb.supabase.co", "https://bymeopxkxapfizeeqeyb.supabase.co/path",
    "https://bymeopxkxapfizeeqeyb.supabase.co:8443", "https://bymeopxkxapfizeeqeyb.supabase.co?project=other",
  ]) assert.equal(socialPreviewEnabled({ ...env, NEXT_PUBLIC_SUPABASE_URL: url }), false);
  assert.equal(socialPreviewEnabled({ ...env, VERCEL: "1", VERCEL_ENV: undefined }), false);
});

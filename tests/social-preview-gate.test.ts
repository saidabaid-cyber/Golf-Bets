import test from "node:test";
import assert from "node:assert/strict";
import { socialPreviewEnabled } from "../lib/social-preview-gate";
const env = { SOCIAL_ACTIVITY_ENABLED: "true", SOCIAL_PREVIEW_DB_REF: "abcdefghijklmnopqrst", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", VERCEL_ENV: "preview" };
test("Social gate accepts only explicit isolated Preview target", () => { assert.equal(socialPreviewEnabled(env), true); assert.equal(socialPreviewEnabled({}), false); });
test("Social gate rejects shared DB even if operator accidentally enables flag", () => { assert.equal(socialPreviewEnabled({ ...env, SOCIAL_PREVIEW_DB_REF: "zhqmlpljloumldaczcfp", NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co" }), false); });
test("Social gate rejects production and wrong project/host", () => {
  for (const values of [{ VERCEL_ENV: "production" }, { NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }, { SOCIAL_ACTIVITY_ENABLED: "false" }, { SOCIAL_PREVIEW_DB_REF: "" }]) assert.equal(socialPreviewEnabled({ ...env, ...values }), false);
});

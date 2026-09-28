import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { processEmailOtpEntry } from "../lib/auth-email-entry";

test("cuenta existente en Login envía OTP sin crear usuario", async () => {
  const calls: string[] = [];
  const result = await processEmailOtpEntry({
    email: " EXISTING@example.com ", intent: "login",
    accountExists: async (email) => { calls.push(`lookup:${email}`); return true; },
    sendOtp: async (email, intent) => { calls.push(`send:${email}:${intent}`); },
  });
  assert.deepEqual(result, { sent: true });
  assert.deepEqual(calls, ["lookup:existing@example.com", "send:existing@example.com:login"]);
});

test("cuenta inexistente en Login no envía OTP", async () => {
  let sends = 0;
  const result = await processEmailOtpEntry({
    email: "missing@example.com", intent: "login",
    accountExists: async () => false,
    sendOtp: async () => { sends += 1; },
  });
  assert.deepEqual(result, { sent: false, code: "ACCOUNT_NOT_FOUND" });
  assert.equal(sends, 0);
});

test("Crear cuenta envía OTP solo después del intent explícito y no hace lookup", async () => {
  let lookups = 0;
  const sends: string[] = [];
  const result = await processEmailOtpEntry({
    email: "new@example.com", intent: "create",
    accountExists: async () => { lookups += 1; return false; },
    sendOtp: async (_email, intent) => { sends.push(intent); },
  });
  assert.deepEqual(result, { sent: true });
  assert.equal(lookups, 0);
  assert.deepEqual(sends, ["create"]);
});

test("la resolución exacta vive en un comando same-origin y su RPC es solo service_role", () => {
  const route = readFileSync("app/api/auth/email-otp/route.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260928080621_secure_email_otp_entry.sql", "utf8");
  assert.match(route, /isCrossSiteRequest/);
  assert.match(route, /SlidingWindowRateLimiter/);
  assert.match(route, /processEmailOtpEntry/);
  assert.match(route, /shouldCreateUser: requestedIntent === "create"/);
  assert.match(migration, /revoke all on function public\.account_email_exists_v1\(text\) from anon/);
  assert.match(migration, /revoke all on function public\.account_email_exists_v1\(text\) from authenticated/);
  assert.match(migration, /grant execute on function public\.account_email_exists_v1\(text\) to service_role/);
});

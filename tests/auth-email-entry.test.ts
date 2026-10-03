import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { processEmailOtpEntry, emailOtpFailure, EMAIL_RATE_LIMIT_MESSAGE } from "../lib/auth-email-entry";
import { requestEmailOtp, EmailOtpRequestError, otpRetrySeconds, OtpSendGate } from "../lib/auth-flow";

test("provider 429 and email rate-limit code retain semantics without exposing diagnostics", () => {
  for (const error of [{ status: 429, message: "private diagnostic" }, { code: "over_email_send_rate_limit" }, { code: "over_request_rate_limit" }]) {
    assert.deepEqual(emailOtpFailure(error), { status: 429, code: "RATE_LIMITED", message: EMAIL_RATE_LIMIT_MESSAGE });
  }
  assert.equal(emailOtpFailure({ status: 500 }).status, 502);
});

test("browser receives 429 cooldown and cannot duplicate a send during the wait", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "RATE_LIMITED", error: EMAIL_RATE_LIMIT_MESSAGE }),
    { status: 429, headers: { "retry-after": "120", "content-type": "application/json" } });
  try {
    await assert.rejects(() => requestEmailOtp("qa@example.invalid", "login"), (error: unknown) => {
      assert.ok(error instanceof EmailOtpRequestError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 120);
      const gate = new OtpSendGate();
      gate.nextSendAt = 1_000 + error.retryAfterSeconds * 1_000;
      assert.equal(otpRetrySeconds(gate.nextSendAt, 1_000), 120);
      assert.equal(gate.begin(120_000), false);
      assert.equal(gate.begin(121_000), true);
      return true;
    });
  } finally { globalThis.fetch = previousFetch; }
});

test("invalid or missing retry headers use a bounded cooldown", () => {
  for (const value of [0, -1, NaN]) assert.equal(new EmailOtpRequestError("Wait", "RATE_LIMITED", 429, value).retryAfterSeconds, 60);
  assert.equal(new EmailOtpRequestError("Wait", "RATE_LIMITED", 429, 1e9).retryAfterSeconds, 86_400);
});

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

test("Crear cuenta verifica que no exista y envía OTP con intent explícito", async () => {
  let lookups = 0;
  const sends: string[] = [];
  const result = await processEmailOtpEntry({
    email: "new@example.com", intent: "create",
    accountExists: async () => { lookups += 1; return false; },
    sendOtp: async (_email, intent) => { sends.push(intent); },
  });
  assert.deepEqual(result, { sent: true });
  assert.equal(lookups, 1);
  assert.deepEqual(sends, ["create"]);
});

test("Crear cuenta con correo existente ofrece Login sin enviar OTP", async () => {
  let sends = 0;
  const result = await processEmailOtpEntry({
    email: " EXISTING@example.com ", intent: "create",
    accountExists: async (email) => { assert.equal(email, "existing@example.com"); return true; },
    sendOtp: async () => { sends += 1; },
  });
  assert.deepEqual(result, { sent: false, code: "ACCOUNT_ALREADY_EXISTS" });
  assert.equal(sends, 0);
});

test("fallo de lookup no envía OTP ni crea cuentas en ninguna intención", async () => {
  for (const intent of ["create", "login"] as const) {
    let sends = 0;
    await assert.rejects(processEmailOtpEntry({
      email: "qa@example.invalid", intent,
      accountExists: async () => { throw new Error("lookup unavailable"); },
      sendOtp: async () => { sends += 1; },
    }), /lookup unavailable/);
    assert.equal(sends, 0);
  }
});

test("la resolución exacta vive en un comando same-origin y su RPC es solo service_role", () => {
  const route = readFileSync("app/api/auth/email-otp/route.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260928083858_secure_email_otp_entry.sql", "utf8");
  assert.match(route, /isCrossSiteRequest/);
  assert.match(route, /SlidingWindowRateLimiter/);
  assert.match(route, /processEmailOtpEntry/);
  assert.match(route, /shouldCreateUser: requestedIntent === "create"/);
  assert.match(migration, /revoke all on function public\.account_email_exists_v1\(text\) from anon/);
  assert.match(migration, /revoke all on function public\.account_email_exists_v1\(text\) from authenticated/);
  assert.match(migration, /grant execute on function public\.account_email_exists_v1\(text\) to service_role/);
});

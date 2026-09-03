import assert from "node:assert/strict";
import test from "node:test";

import { closeAuthSession, restoreAuthSession, sendEmailOtp, startSocialOAuth, verifyEmailOtp, type AuthFlowClient } from "../lib/auth-flow";

function authMock(overrides: Partial<AuthFlowClient> = {}) {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const session = { access_token: "test-token", user: { id: "user-1" } } as never;
  const auth: AuthFlowClient = {
    signInWithOtp: async (input) => { calls.push({ method: "otp-send", input }); return { error: null }; },
    verifyOtp: async (input) => { calls.push({ method: "otp-verify", input }); return { data: { session }, error: null }; },
    signInWithOAuth: async (input) => { calls.push({ method: "oauth", input }); return { error: null }; },
    getSession: async () => { calls.push({ method: "restore" }); return { data: { session }, error: null }; },
    signOut: async () => { calls.push({ method: "logout" }); return { error: null }; },
    ...overrides,
  };
  return { auth, calls, session };
}

test("Email OTP mock envía código y verifica una sesión de seis dígitos", async () => {
  const { auth, calls, session } = authMock();
  await sendEmailOtp(auth, " jugador@example.com ", "http://localhost:3000/auth/callback");
  const restored = await verifyEmailOtp(auth, "jugador@example.com", "123456");
  assert.equal(restored, session);
  assert.deepEqual(calls.map((call) => call.method), ["otp-send", "otp-verify"]);
  assert.deepEqual((calls[0].input as { email: string }).email, "jugador@example.com");
});

test("OTP incorrecto/expirado propaga error y permite reintentar sin sesión falsa", async () => {
  let attempts = 0;
  const { auth } = authMock({ verifyOtp: async () => ({ data: { session: null }, error: new Error(++attempts === 1 ? "invalid token" : "token expired") }) });
  await assert.rejects(() => verifyEmailOtp(auth, "a@b.com", "111111"), /invalid/);
  await assert.rejects(() => verifyEmailOtp(auth, "a@b.com", "222222"), /expired/);
  assert.equal(attempts, 2);
});

test("Google y Apple usan OAuth mock con callback, nunca proveedor real", async () => {
  const { auth, calls } = authMock();
  await startSocialOAuth(auth, "google", "https://golf-bets-psi.vercel.app/auth/callback");
  await startSocialOAuth(auth, "apple", "https://golf-bets-psi.vercel.app/auth/callback");
  assert.deepEqual(calls.map((call) => call.method), ["oauth", "oauth"]);
  assert.deepEqual(calls.map((call) => (call.input as { provider: string }).provider), ["google", "apple"]);
});

test("restauración y logout usan el cliente mock", async () => {
  const { auth, calls, session } = authMock();
  assert.equal(await restoreAuthSession(auth), session);
  await closeAuthSession(auth);
  assert.deepEqual(calls.map((call) => call.method), ["restore", "logout"]);
});

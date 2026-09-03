import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "@supabase/supabase-js";

import { closeAuthSession, isAccountSession, restoreAuthSession, sendEmailOtp, startSocialOAuth, verifyEmailOtp, type AuthFlowClient } from "../lib/auth-flow";
import { readFileSync } from "node:fs";

function authMock(overrides: Partial<AuthFlowClient> = {}) {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const session = { access_token: "test-token", refresh_token: "test-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "user-1", email: "jugador@example.com" } } as Session;
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
  assert.deepEqual(calls.map((call) => call.method), ["otp-send", "otp-verify", "restore"]);
  assert.equal((calls[1].input as { type: string }).type, "email");
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

for (const provider of ["google", "apple"] as const) test(`${provider} fallido no autentica ni consulta una sesión inventada`, async () => {
  const { auth, calls } = authMock({ signInWithOAuth: async () => ({ error: new Error("provider disabled") }) });
  await assert.rejects(() => startSocialOAuth(auth, provider, "https://preview.example/auth/callback"), /disabled/);
  assert.equal(calls.length, 0);
});

test("enviar correo no verifica ni activa sesión; envío fallido se propaga", async () => {
  const { auth, calls } = authMock();
  assert.equal(await sendEmailOtp(auth, "jugador@example.com", "http://localhost:3000/auth/callback"), undefined);
  assert.deepEqual(calls.map(c => c.method), ["otp-send"]);
  auth.signInWithOtp = async () => ({ error: new Error("network error") });
  await assert.rejects(() => sendEmailOtp(auth, "jugador@example.com", "http://localhost:3000/auth/callback"), /network/);
});

test("OTP válido sin sesión persistida no deja entrar", async () => {
  const { auth } = authMock({ getSession: async () => ({ data: { session: null }, error: null }) });
  await assert.rejects(() => verifyEmailOtp(auth, "jugador@example.com", "123456"), /account_session_missing/);
});

test("OTP rechaza sesión de otra identidad, correo o expiración", async () => {
  const { auth, session } = authMock();
  for (const user of [{ id: "other", email: "jugador@example.com" }, { id: "user-1", email: "other@example.com" }]) {
    auth.getSession = async () => ({ data: { session: { ...session, user } as never }, error: null });
    await assert.rejects(() => verifyEmailOtp(auth, "jugador@example.com", "123456"), /account_session_missing/);
  }
  auth.getSession = async () => ({ data: { session: { ...session, expires_at: 1 } }, error: null });
  await assert.rejects(() => verifyEmailOtp(auth, "jugador@example.com", "123456"), /account_session_missing/);
});

test("sesión invitada/anónima, sin JWT o refresh no es cuenta autenticada", () => {
  const { session } = authMock();
  assert.equal(isAccountSession(session), true);
  for (const candidate of [null, { ...session, access_token: "" }, { ...session, refresh_token: "" }, { ...session, user: { id: "guest" } }, { ...session, user: { id: "user-1", is_anonymous: true } }]) {
    assert.equal(isAccountSession(candidate as never), false);
  }
});

test("OTP malformed no llama Supabase; restore fallido no crea cuenta", async () => {
  const { auth, calls } = authMock({ getSession: async () => ({ data: { session: null }, error: new Error("network") }) });
  await assert.rejects(() => verifyEmailOtp(auth, "jugador@example.com", "12abcd"), /invalid/);
  assert.equal(calls.length, 0);
  await assert.rejects(() => restoreAuthSession(auth), /network/);
});

test("pantalla OTP tiene captura, regreso y separación explícita de invitado", () => {
  const ui = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(ui, /Código de verificación/);
  assert.match(ui, /id="access-otp"/);
  assert.match(ui, /autoComplete="one-time-code"/);
  assert.match(ui, /setCodeSent\(true\)/);
  assert.match(ui, /onAuthenticated\(await verifyEmailOtp/);
  assert.match(ui, /Todavía no has iniciado sesión/);
  assert.match(ui, /Regresar al acceso/);
  assert.match(ui, /disabled=\{busy \|\| !available\}/);
  assert.match(ui, /pendiente de configuración/);
  assert.match(ui, /restoreAuthSession\(supabase.auth\)/);
});

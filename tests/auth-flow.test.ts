import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "@supabase/supabase-js";

import { AuthSessionRecoveryError, closeAuthSession, isAccountSession, recoverAuthSession, restoreAuthSession, sendEmailOtp, startSocialOAuth, verifyEmailOtp, type AuthFlowClient } from "../lib/auth-flow";
import { readFileSync } from "node:fs";

function authMock(overrides: Partial<AuthFlowClient> = {}) {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const session = { access_token: "test-token", refresh_token: "test-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "user-1", email: "jugador@example.com" } } as Session;
  const auth: AuthFlowClient = {
    signInWithOtp: async (input) => { calls.push({ method: "otp-send", input }); return { error: null }; },
    verifyOtp: async (input) => { calls.push({ method: "otp-verify", input }); return { data: { session }, error: null }; },
    signInWithOAuth: async (input) => { calls.push({ method: "oauth", input }); return { error: null }; },
    getSession: async () => { calls.push({ method: "restore" }); return { data: { session }, error: null }; },
    refreshSession: async () => { calls.push({ method: "refresh" }); return { data: { session }, error: null }; },
    getUser: async () => { calls.push({ method: "user" }); return { data: { user: session.user }, error: null }; },
    signOut: async () => { calls.push({ method: "logout" }); return { error: null }; },
    ...overrides,
  };
  return { auth, calls, session };
}

test("Email OTP mock envía código y verifica una sesión de ocho dígitos", async () => {
  const { auth, calls, session } = authMock();
  await sendEmailOtp(auth, " jugador@example.com ", "http://localhost:3000/auth/callback");
  const restored = await verifyEmailOtp(auth, "jugador@example.com", "00123456");
  assert.equal(restored, session);
  assert.deepEqual(calls.map((call) => call.method), ["otp-send", "otp-verify", "restore", "user"]);
  assert.equal((calls[1].input as { type: string }).type, "email");
  assert.equal((calls[1].input as { token: string }).token, "00123456");
  assert.deepEqual((calls[0].input as { email: string }).email, "jugador@example.com");
});

test("OTP incorrecto/expirado propaga error y permite reintentar sin sesión falsa", async () => {
  let attempts = 0;
  const { auth } = authMock({ verifyOtp: async () => ({ data: { session: null }, error: new Error(++attempts === 1 ? "invalid token" : "token expired") }) });
  await assert.rejects(() => verifyEmailOtp(auth, "a@b.com", "11111111"), /invalid/);
  await assert.rejects(() => verifyEmailOtp(auth, "a@b.com", "22222222"), /expired/);
  assert.equal(attempts, 2);
});

test("Google y Apple usan OAuth mock con callback, nunca proveedor real", async () => {
  const { auth, calls } = authMock();
  await startSocialOAuth(auth, "google", "https://golf-bets-psi.vercel.app/auth/callback");
  await startSocialOAuth(auth, "apple", "https://golf-bets-psi.vercel.app/auth/callback");
  assert.deepEqual(calls.map((call) => call.method), ["oauth", "oauth"]);
  assert.deepEqual(calls.map((call) => (call.input as { provider: string }).provider), ["google", "apple"]);
  assert.deepEqual((calls[0].input as { options: { queryParams: Record<string, string> } }).options.queryParams, { prompt: "select_account" });
  assert.equal((calls[1].input as { options: { queryParams?: Record<string, string> } }).options.queryParams, undefined);
});

test("restauración y logout usan el cliente mock", async () => {
  const { auth, calls, session } = authMock();
  assert.equal(await restoreAuthSession(auth), session);
  await closeAuthSession(auth);
  assert.deepEqual(calls.map((call) => call.method), ["restore", "user", "logout"]);
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
  await assert.rejects(() => verifyEmailOtp(auth, "jugador@example.com", "12345678"), /account_session_missing/);
});

test("OTP rechaza sesión de otra identidad o correo", async () => {
  const { auth, session } = authMock();
  for (const user of [{ id: "other", email: "jugador@example.com" }, { id: "user-1", email: "other@example.com" }]) {
    auth.getSession = async () => ({ data: { session: { ...session, user } as never }, error: null });
    await assert.rejects(() => verifyEmailOtp(auth, "jugador@example.com", "12345678"), /account_session_missing/);
  }
});

test("token vencido con refresh válido se renueva y valida sin sacar al usuario", async () => {
  const { auth, calls, session } = authMock({
    getSession: async () => ({ data: { session: { ...authMock().session, expires_at: 1 } }, error: null }),
  });
  const recovered = await recoverAuthSession(auth, { now: Date.now() });
  assert.equal(recovered?.user.id, session.user.id);
  assert.deepEqual(calls.map(call => call.method), ["refresh", "user"]);
});

test("refresh inválido se distingue de una caída transitoria y nunca borra datos por sí mismo", async () => {
  const { auth } = authMock({
    getSession: async () => ({ data: { session: { ...authMock().session, expires_at: 1 } }, error: null }),
    refreshSession: async () => ({ data: { session: null }, error: { status: 401, message: "Invalid Refresh Token" } }),
  });
  await assert.rejects(() => recoverAuthSession(auth), (error: unknown) => error instanceof AuthSessionRecoveryError && error.failure === "invalid");

  const transient = authMock({ getSession: async () => { throw new TypeError("Failed to fetch"); } }).auth;
  await assert.rejects(() => recoverAuthSession(transient), (error: unknown) => error instanceof AuthSessionRecoveryError && error.failure === "transient");
});

test("reintento fuerza refresh, valida getUser y conserva la identidad", async () => {
  const { auth, calls, session } = authMock();
  const recovered = await recoverAuthSession(auth, { forceRefresh: true });
  assert.equal(recovered?.user.id, session.user.id);
  assert.deepEqual(calls.map(call => call.method), ["restore", "refresh", "user"]);
});

test("una rotación concurrente adopta la sesión nueva en vez de declarar inválida la cuenta", async () => {
  const expired = { ...authMock().session, access_token: "access-old", refresh_token: "refresh-old", expires_at: 1 } as Session;
  const rotated = { ...authMock().session, access_token: "access-new", refresh_token: "refresh-new", expires_at: Math.floor(Date.now() / 1000) + 3600 } as Session;
  let reads = 0;
  let refreshInput: unknown = "not-called";
  const { auth } = authMock({
    getSession: async () => ({ data: { session: reads++ === 0 ? expired : rotated }, error: null }),
    refreshSession: async (input) => {
      refreshInput = input;
      return { data: { session: null }, error: { status: 401, code: "refresh_token_already_used" } };
    },
    getUser: async (jwt) => ({ data: { user: jwt === rotated.access_token ? rotated.user : null }, error: null }),
  });
  const recovered = await recoverAuthSession(auth);
  assert.equal(recovered?.access_token, "access-new");
  assert.equal(refreshInput, undefined, "Supabase debe refrescar desde su sesión persistida, no con un token capturado");
  assert.equal(reads, 2);
});

test("un access token rechazado se refresca y reintenta getUser exactamente una vez", async () => {
  const initial = authMock().session;
  const renewed = { ...initial, access_token: "renewed", refresh_token: "renewed-refresh" } as Session;
  const seen: string[] = [];
  let refreshes = 0;
  const { auth } = authMock({
    getSession: async () => ({ data: { session: initial }, error: null }),
    refreshSession: async () => { refreshes += 1; return { data: { session: renewed }, error: null }; },
    getUser: async (jwt) => {
      seen.push(String(jwt));
      return jwt === "renewed"
        ? { data: { user: renewed.user }, error: null }
        : { data: { user: null }, error: { status: 401, message: "invalid jwt" } };
    },
  });
  assert.equal((await recoverAuthSession(auth, { refreshSkewSeconds: 0 }))?.access_token, "renewed");
  assert.equal(refreshes, 1);
  assert.deepEqual(seen, [initial.access_token, "renewed"]);
});

test("dos recuperaciones concurrentes aceptan la misma rotación sin invalidarse", async () => {
  const initial = { ...authMock().session, access_token: "old", refresh_token: "old-refresh", expires_at: 1 } as Session;
  const renewed = { ...initial, access_token: "new", refresh_token: "new-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600 } as Session;
  let stored = initial;
  let refreshes = 0;
  const { auth } = authMock({
    getSession: async () => ({ data: { session: stored }, error: null }),
    refreshSession: async () => {
      refreshes += 1;
      await new Promise(resolve => setTimeout(resolve, 1));
      if (stored === initial) { stored = renewed; return { data: { session: renewed }, error: null }; }
      return { data: { session: null }, error: { status: 401, code: "refresh_token_already_used" } };
    },
    getUser: async () => ({ data: { user: renewed.user }, error: null }),
  });
  const recovered = await Promise.all([recoverAuthSession(auth), recoverAuthSession(auth)]);
  assert.deepEqual(recovered.map(session => session?.access_token), ["new", "new"]);
  assert.equal(refreshes, 2);
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
  await assert.rejects(
    () => restoreAuthSession(auth),
    (error: unknown) => error instanceof AuthSessionRecoveryError && error.failure === "transient" && error.cause instanceof Error && error.cause.message === "network",
  );
});

test("OTP con menos de ocho dígitos no llama verifyOtp", async () => {
  const { auth, calls } = authMock();
  await assert.rejects(() => verifyEmailOtp(auth, "jugador@example.com", "1234567"), /invalid/);
  assert.equal(calls.length, 0);
});

test("pantalla OTP tiene captura, regreso y separación explícita de invitado", () => {
  const ui = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(ui, /Código de verificación/);
  assert.match(ui, /id="access-otp"/);
  assert.match(ui, /autoComplete="one-time-code"/);
  assert.match(ui, /maxLength=\{8\}/);
  assert.match(ui, /otp\.length !== 8/);
  assert.match(ui, /disabled=\{busy \|\| otp\.length !== 8\}/);
  assert.match(ui, /setCodeSent\(true\)/);
  assert.match(ui, /onAuthenticated\(await verifyEmailOtp/);
  assert.match(ui, /Todavía no has iniciado sesión/);
  assert.match(ui, /Regresar al acceso/);
  assert.match(ui, /disabled=\{busy \|\| !available\}/);
  assert.match(ui, /pendiente de configuración/);
  assert.match(ui, /restoreAuthSession\(supabase.auth\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { authCallbackError, authErrorMessage } from "../lib/account-state";

test("OTP delivery errors distinguish unavailable mail configuration, invalid email, rate limits and outage", () => {
  assert.match(authErrorMessage({ code: "email_address_not_authorized", status: 403 }), /envío.*no está habilitado.*entorno/);
  assert.match(authErrorMessage({ code: "email_address_invalid", status: 422 }), /correo.*dirección válida/);
  assert.match(authErrorMessage({ code: "over_email_send_rate_limit", status: 429 }), /Demasiados intentos/);
  assert.match(authErrorMessage({ code: "over_request_rate_limit" }), /Demasiados intentos/);
  assert.match(authErrorMessage({ code: "unexpected_failure", status: 500 }), /temporalmente/);
  assert.match(authErrorMessage({ status: 503 }), /temporalmente/);
  assert.match(authErrorMessage({ code: "otp_disabled" }), /pendiente de configuración/);
});

test("auth errors never disclose whether an account exists, is archived or uses another identity", () => {
  const results = ["user_not_found", "user_already_exists", "email_exists", "identity_already_exists", "signup_disabled", "user_banned", "invalid_credentials"]
    .map(code => authErrorMessage({ code, status: 400, message: "victim@example.com private account details" }));
  assert.equal(new Set(results).size, 1);
  for (const message of results) assert.doesNotMatch(message, /victim|@|registrad|existe|archivad|banned/);
});

test("legacy OTP signup rejection uses the same safe access guidance, with numeric or absent code", () => {
  const expected = authErrorMessage({ code: "signup_disabled" });
  for (const error of [
    { code: 422, msg: "Signups not allowed for otp" },
    { status: 422, code: 422, message: "Signups not allowed for otp" },
    { status: 422, code: "otp_disabled", message: "Signups not allowed for otp" },
    { status: 422, message: "Signups not allowed for otp" },
    new Error("Signups not allowed for otp"),
  ]) {
    const message = authErrorMessage(error, "email");
    assert.equal(message, expected);
    assert.match(message, /Inicio.*elegir cómo entrar/);
    assert.doesNotMatch(message, /existe|registrad|signup|422/i);
  }
});

test("provider and callback configuration errors are actionable without leaking raw descriptions", () => {
  const privateDetail = "redirect_uri_mismatch: https://internal.invalid/auth?token=private-secret user@example.com";
  for (const code of ["redirect_uri_mismatch", "invalid_client", "unauthorized_client"]) {
    const message = authErrorMessage({ code, message: privateDetail }, "callback");
    assert.match(message, /corrección de configuración/);
    assert.doesNotMatch(message, /internal|secret|token|@|https/);
  }
  assert.match(authErrorMessage({ code: "provider_disabled" }, "google"), /Google.*configuración/);
  assert.match(authErrorMessage({ code: "provider_disabled" }, "callback"), /el proveedor.*configuración/);
  assert.match(authErrorMessage({ code: "access_denied" }, "callback"), /cancelado o no autorizado/);
});

test("callback uses session recovery instructions rather than claiming an email could not be sent", () => {
  for (const code of ["bad_code_verifier", "flow_state_expired", "flow_state_not_found", "bad_oauth_state", "bad_oauth_callback"]) {
    assert.match(authErrorMessage({ code }, "callback"), /mismo navegador/);
  }
  assert.match(authErrorMessage(new Error("PKCE code verifier not found"), "callback"), /mismo navegador/);
  assert.match(authErrorMessage(new Error("account_session_missing"), "callback"), /inicia sesión nuevamente/);
  assert.match(authErrorMessage(new Error("unknown internal error"), "callback"), /completar el acceso/);
  assert.doesNotMatch(authErrorMessage(new Error("unknown internal error"), "callback"), /enviar el código|internal/);
});

test("callback parser keeps error_code over generic error, and never treats a success code as an error", () => {
  assert.deepEqual(authCallbackError(new URLSearchParams("error=access_denied&error_code=bad_oauth_callback&error_description=private")), { code: "bad_oauth_callback", message: "private" });
  assert.deepEqual(authCallbackError(new URLSearchParams("error=access_denied")), { code: "access_denied", message: "" });
  assert.equal(authCallbackError(new URLSearchParams("code=one-time-authorization-code")), null);
});

async function runCallback(search: string, exchangeError?: unknown) {
  const errors: string[] = []; const redirects: string[] = []; const exchanges: string[] = [];
  let effect: (() => void) | undefined; let restores = 0;
  const exports: { default?: () => unknown } = {};
  const source = ts.transpileModule(readFileSync("app/auth/callback/page.tsx", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(source, {
    exports, URLSearchParams,
    window: { location: { search, replace: (url: string) => redirects.push(url) }, setTimeout: () => 1, clearTimeout: () => {} },
    require: (name: string) => {
      if (name === "react") return { useState: () => ["", (value: string) => errors.push(value)], useEffect: (fn: () => void) => { effect = fn; } };
      if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
      if (name === "next/link" || name.endsWith("brand-lockup")) return {};
      if (name.endsWith("/account-state")) return { authErrorMessage, authCallbackError };
      if (name.endsWith("/supabase/client")) return { getSupabaseBrowser: () => ({ auth: { exchangeCodeForSession: async (code: string) => { exchanges.push(code); return { error: exchangeError || null }; } } }) };
      if (name.endsWith("/auth-flow")) return { restoreAuthSession: async () => { restores++; return { user: { id: "verified-user" } }; } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  exports.default!();
  assert.ok(effect); effect();
  await new Promise<void>(resolve => setImmediate(resolve));
  return { errors, redirects, exchanges, restores };
}

test("real callback handler surfaces sanitized provider failure before any session exchange", async () => {
  const result = await runCallback("?error=server_error&error_code=redirect_uri_mismatch&error_description=user%40example.com");
  assert.match(result.errors[0], /corrección de configuración/);
  assert.doesNotMatch(result.errors[0], /user@/);
  assert.deepEqual(result.exchanges, []); assert.deepEqual(result.redirects, []); assert.equal(result.restores, 0);
});

test("real callback handler uses PKCE recovery copy after failed exchange, not OTP send error", async () => {
  const result = await runCallback("?code=single-use-code", { code: "bad_code_verifier" });
  assert.deepEqual(result.exchanges, ["single-use-code"]);
  assert.match(result.errors[0], /mismo navegador/);
  assert.deepEqual(result.redirects, []); assert.equal(result.restores, 0);
});

test("real callback handler still exchanges, validates session and enters app on success", async () => {
  const result = await runCallback("?code=single-use-code");
  assert.deepEqual(result.exchanges, ["single-use-code"]);
  assert.deepEqual(result.errors, []); assert.equal(result.restores, 1);
  assert.deepEqual(result.redirects, ["/?auth=complete"]);
});

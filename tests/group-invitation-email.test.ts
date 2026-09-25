import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as contract from "../lib/group-invitations";

type Send = (input: { id: string; token: string; email: string; groupName: string; origin: string }, options: { env: Record<string,string>; fetcher: typeof fetch }) => Promise<{ messageId?: string; errorCode?: string }>;
function emailModule() {
  const exports: { sendGroupInvitationEmail?: Send } = {};
  runInNewContext(ts.transpileModule(readFileSync("lib/group-invitation-email.server.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, URL, AbortSignal, process: { env: {} }, require: (name: string) => name === "server-only" ? {}
      : name.endsWith("app-origin") ? { CANONICAL_QA_APP_ORIGIN: "https://dev.thebackyard.com.mx", PRODUCTION_APP_ORIGIN: "https://app.thebackyard.com.mx" } : contract,
  });
  return exports.sendGroupInvitationEmail!;
}
const invitation = { id: "11111111-1111-4111-8111-111111111111", token: "a".repeat(64), email: "recipient@example.test", groupName: "Grupo <QA>", origin: "https://qa.example.test" };
const env = { GROUP_INVITES_RESEND_API_KEY: "synthetic-group-only-key", GROUP_INVITES_FROM_EMAIL: "groups@example.test", GROUP_INVITES_APP_URL: "https://dev.thebackyard.com.mx" };

test("group email validation rejects malformed input and normalizes without implying account existence", () => {
  for (const input of ["", "hi", "x@", "x@y", "x y@example.com", "a@b.com\nBcc:c@d.com"]) assert.equal(contract.normalizedInvitationEmail(input), null);
  assert.equal(contract.normalizedInvitationEmail("  Player@Example.com  "), "player@example.com");
});
test("missing dedicated email credential cannot borrow Auth SMTP/RESEND key or claim a send", async () => {
  let calls = 0;
  const result = await emailModule()(invitation, { env: { RESEND_API_KEY: "do-not-borrow", SMTP_PASSWORD: "do-not-borrow" }, fetcher: (async () => { calls++; return Response.json({ id: "fake" }); }) as typeof fetch });
  assert.equal(result.errorCode, "GROUP_EMAIL_NOT_CONFIGURED"); assert.equal(calls, 0);
});
test("provider accepted response includes idempotency, safe HTML and valid acceptance fragment", async () => {
  let sent = false;
  const result = await emailModule()(invitation, { env, fetcher: (async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    const headers = init!.headers as Record<string,string>;
    assert.equal(headers["Idempotency-Key"], `backyard-group-${invitation.id}`);
    const body = JSON.parse(String(init!.body));
    assert.equal(body.to[0], invitation.email);
    assert.ok(body.html.includes("Grupo &lt;QA&gt;"));
    assert.ok(body.text.includes(`https://dev.thebackyard.com.mx/#groupInvite=${invitation.id}&token=${invitation.token}`));
    sent = true; return Response.json({ id: "provider-test-id" });
  }) as typeof fetch });
  assert.equal(result.messageId, "provider-test-id"); assert.equal(sent, true);
});
for (const status of [400, 401, 403, 422, 429, 500]) test(`HTTP ${status} never counts as sent`, async () => {
  const result = await emailModule()(invitation, { env, fetcher: (async () => Response.json({ message: "private provider detail" }, { status })) as typeof fetch });
  assert.equal(result.messageId, undefined);
  assert.equal(result.errorCode, status === 429 ? "EMAIL_RATE_LIMIT" : "EMAIL_PROVIDER_REJECTED");
});
test("timeout and malformed successful response remain unconfirmed", async () => {
  assert.equal((await emailModule()(invitation, { env, fetcher: (async () => { throw new Error("secret network error"); }) as typeof fetch })).errorCode, "EMAIL_PROVIDER_UNAVAILABLE");
  assert.equal((await emailModule()(invitation, { env, fetcher: (async () => Response.json({})) as typeof fetch })).errorCode, "EMAIL_PROVIDER_INVALID_RESPONSE");
});
test("acceptance link validates token shape and rejects arbitrary auth fragments", () => {
  assert.deepEqual(contract.parseGroupInvitationLink(`#groupInvite=${invitation.id}&token=${invitation.token}`), { invitationId: invitation.id, token: invitation.token });
  for (const hash of ["#access_token=abc", "#groupInvite=abc&token=abc", `#groupInvite=${invitation.id}&token=bad`]) assert.equal(contract.parseGroupInvitationLink(hash), null);
});
test("Preview invitations use only the configured stable origin across redeploys", async () => {
  const bodies: string[] = [];
  const fetcher = (async (_url, init) => { bodies.push(String(init!.body)); return Response.json({ id: "provider-id" }); }) as typeof fetch;
  const previewEnv = { ...env, VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "must-not-be-used.example.test" };
  await emailModule()({ ...invitation, origin: "https://deployment-one.example.test" }, { env: previewEnv, fetcher });
  await emailModule()({ ...invitation, origin: "https://deployment-two.example.test" }, { env: previewEnv, fetcher });
  assert.equal(bodies[0], bodies[1]);
  assert.match(bodies[0], /https:\/\/dev\.thebackyard\.com\.mx/);
  assert.doesNotMatch(bodies[0], /must-not-be-used|deployment-one|deployment-two/);
});
test("email delivery fails closed before network when the stable origin is missing or invalid", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return Response.json({ id: "must-not-send" }); }) as typeof fetch;
  const missing = await emailModule()(invitation, { env: { ...env, GROUP_INVITES_APP_URL: "" }, fetcher });
  assert.equal(missing.errorCode, "GROUP_EMAIL_NOT_CONFIGURED");
  const invalid = await emailModule()(invitation, { env: { ...env, GROUP_INVITES_APP_URL: "https://dev.thebackyard.com.mx/path" }, fetcher });
  assert.equal(invalid.errorCode, "GROUP_EMAIL_ORIGIN_INVALID");
  const randomPreview = await emailModule()(invitation, { env: { ...env, GROUP_INVITES_APP_URL: "https://synthetic-preview-test-only.vercel.app" }, fetcher });
  assert.equal(randomPreview.errorCode, "GROUP_EMAIL_ORIGIN_INVALID");
  const productionFromPreview = await emailModule()(invitation, { env: { ...env, VERCEL_ENV: "preview", GROUP_INVITES_APP_URL: "https://app.thebackyard.com.mx" }, fetcher });
  assert.equal(productionFromPreview.errorCode, "GROUP_EMAIL_ORIGIN_INVALID");
  const previewFromProduction = await emailModule()(invitation, { env: { ...env, VERCEL_ENV: "production" }, fetcher });
  assert.equal(previewFromProduction.errorCode, "GROUP_EMAIL_ORIGIN_INVALID");
  const arbitraryProduction = await emailModule()(invitation, { env: { ...env, VERCEL_ENV: "production", GROUP_INVITES_APP_URL: "https://evil.example" }, fetcher });
  assert.equal(arbitraryProduction.errorCode, "GROUP_EMAIL_ORIGIN_INVALID");
  assert.equal(calls, 0);
});
test("UI distinguishes provider acceptance from delivery and refuses local invitation labels", () => {
  const item = { id: "1", group_id: "2", group_name: "QA", recipient_label: "QA", state: "PENDING", delivery_status: "ACCEPTED_BY_PROVIDER", expires_at: "2099-01-01", outgoing: true } as const;
  assert.match(contract.invitationStatus(item), /entrega no confirmada/);
  assert.match(contract.invitationStatus({ ...item, delivery_status: "FAILED" }), /Envío fallido/);
  assert.equal(contract.invitationStatus({ ...item, state: "ACCEPTED" }), "Aceptada");
  assert.ok(!readFileSync("app/components/beta-onboarding-flow.tsx", "utf8").includes("Invitación local"));
});

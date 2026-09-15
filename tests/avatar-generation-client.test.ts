import assert from "node:assert/strict";
import test from "node:test";
import { avatarGenerationAvailability, generateProfileAvatar, commitGeneratedProfileAvatar, type AvatarGenerationDraft } from "../lib/avatar-generation-client";
import { BACKYARD_AI_PROVIDER_CONSENT_VERSION, AI_PROVIDER_PROCESSING_CONSENT, AI_IMAGE_PROCESSING_CONSENT } from "../lib/backyard-ai/privacy";
import { profileAvatarType } from "../lib/profile-avatar";

const draft: AvatarGenerationDraft = { source: "description", description: "Golfista con gorra verde", style: "illustrated" };
const png = "data:image/png;base64,aGVsbG8=";
const avatarUrl = "https://isolated.example.test/storage/v1/object/public/avatars/generated-avatar/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp";
function acceptance(scope = AI_PROVIDER_PROCESSING_CONSENT as string) {
  return Response.json({ active: true, scope, policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION, acceptedAt: "2026-09-15T10:00:00Z", revokedAt: null });
}

test("avatar: no authentication or affirmative consent means no transport", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({}); });
  await assert.rejects(generateProfileAvatar(null, "owner", draft, true), /Inicia sesión/);
  await assert.rejects(generateProfileAvatar("token", "owner", draft, false), /Autoriza/);
  await assert.rejects(generateProfileAvatar("token", "owner", { ...draft, source: "photo" }, true), /Selecciona/);
  assert.equal(calls, 0);
});

test("avatar: failed durable consent never sends content to generation endpoint", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    urls.push(String(url));
    return Response.json({ error: "Consentimiento no persistido" }, { status: 503 });
  });
  await assert.rejects(generateProfileAvatar("token", "owner", draft, true), /Consentimiento no persistido/);
  assert.deepEqual(urls, ["/api/backyard-ai/consent"]);
});

test("avatar: description persists authorization first and cannot silently transmit an old photo", async (t) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token");
    return String(url).endsWith("consent") ? acceptance() : Response.json({ imageDataUrl: png, generationToken: "signed-proof" });
  });
  const preview = await generateProfileAvatar("token", "owner", { ...draft, photoDataUrl: "NEVER-SEND" }, true);
  assert.equal(preview.imageDataUrl, png);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.scope, AI_PROVIDER_PROCESSING_CONSENT);
  assert.equal(calls[1].body.photoDataUrl, undefined);
  assert.equal(calls[1].url, "/api/profile/avatar/generate");
  assert.equal(calls.some((call) => call.url.endsWith("/use")), false);
});

test("avatar: volunteered photo requests image consent and only transmits provided optimized source", async (t) => {
  const calls: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return String(url).endsWith("consent") ? acceptance(AI_IMAGE_PROCESSING_CONSENT) : Response.json({ imageDataUrl: png, generationToken: "proof" });
  });
  await generateProfileAvatar("token", "owner", { ...draft, source: "photo", photoDataUrl: png }, true);
  assert.equal(calls[0].scope, AI_IMAGE_PROCESSING_CONSENT);
  assert.equal(calls[1].photoDataUrl, png);
});

test("avatar: cancel between consent and generation prevents provider request", async (t) => {
  const abort = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; abort.abort(); return acceptance(); });
  await assert.rejects(generateProfileAvatar("token", "owner", draft, true, abort.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("avatar: provider malformed image rejected before use", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => String(url).endsWith("consent") ? acceptance() : Response.json({ imageDataUrl: "https://untrusted.test", generationToken: "proof" }));
  await assert.rejects(generateProfileAvatar("token", "owner", draft, true), /no es válida/);
});

test("avatar: use requests storage explicitly and stable asset URL restores generated type", async (t) => {
  let body: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(url, "/api/profile/avatar/use");
    body = JSON.parse(String(init?.body));
    return Response.json({ avatarUrl, avatarType: "generated_avatar", assetId: "22222222-2222-4222-8222-222222222222" });
  });
  const result = await commitGeneratedProfileAvatar("token", { imageDataUrl: png, generationToken: "proof" });
  assert.equal(body.generationToken, "proof");
  assert.equal(result, avatarUrl);
  assert.equal(profileAvatarType(JSON.parse(JSON.stringify({ avatarUrl: result })).avatarUrl), "generated_avatar");
  assert.equal(profileAvatarType("https://photo.test/regular.webp"), "photo");
  assert.equal(profileAvatarType("😎"), "emoji");
  assert.equal(profileAvatarType(""), "none");
});

test("avatar: storage failure cannot become successful selection", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "No se pudo guardar la imagen" }, { status: 503 }));
  await assert.rejects(commitGeneratedProfileAvatar("token", { imageDataUrl: png, generationToken: "proof" }), /No se pudo guardar/);
});

test("avatar: availability exposes only explicit readiness and credential names, never generated content", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token");
    return Response.json({ available: false, code: "BLOCKED_EXTERNAL_IMAGE_PROVIDER", missing: ["OPENAI_AVATAR_IMAGE_MODEL", 2] });
  });
  const result = await avatarGenerationAvailability("token");
  assert.equal(result.available, false);
  assert.deepEqual(result.missing, ["OPENAI_AVATAR_IMAGE_MODEL"]);
});

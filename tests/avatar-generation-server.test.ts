import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  AVATAR_GENERATION_CONSENT_VERSION,
  avatarGenerationConfig,
  decodeAvatarDataUrl,
} from "../lib/avatar-generation";
import { optimizeGeneratedAvatarDataUrl } from "../lib/avatar-generation-image";
import { classifyAvatarProviderFailure } from "../lib/avatar-generation-provider";
import { avatarCapabilities, generateAvatarCandidate, commitGeneratedAvatar, type AvatarGenerationDeps } from "../lib/avatar-generation-service";
import { reconcileGeneratedAvatarUpload } from "../lib/avatar-generation-storage";
import { AI_IMAGE_PROCESSING_CONSENT, AI_PROVIDER_PROCESSING_CONSENT } from "../lib/backyard-ai/privacy";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ASSET = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://isolated-preview.example.test";
const NOW = 1_000_000;
const description = {
  source: "description",
  description: "Golfista con gorra verde",
  style: "illustrated",
  consent: true,
  consentVersion: AVATAR_GENERATION_CONSENT_VERSION,
};

function fullEnv() {
  return {
    VERCEL_ENV: "preview",
    BACKYARD_AVATAR_GENERATION_ENABLED: "true",
    OPENAI_API_KEY: "sk-mock-only",
    OPENAI_AVATAR_IMAGE_MODEL: "gpt-image-1.5",
    BACKYARD_AVATAR_SIGNING_SECRET: "a-test-secret-of-at-least-thirty-two-bytes",
    BACKYARD_AVATAR_STORAGE_BUCKET: "avatars",
    NEXT_PUBLIC_SUPABASE_URL: ORIGIN,
    BACKYARD_AVATAR_PREVIEW_SUPABASE_URL: ORIGIN,
    BACKYARD_AI_CONSENT_PREVIEW_SUPABASE_URL: ORIGIN,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-mock-only",
    SUPABASE_SECRET_KEY: "service-mock-only",
    CLOUD_ENABLED: "true",
  };
}

async function sourceImage() {
  const bytes = await sharp({ create: { width: 1024, height: 512, channels: 3, background: { r: 40, g: 160, b: 70 } } }).png().toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function deps(providerImage: string, overrides: Partial<AvatarGenerationDeps> = {}) {
  const calls = { auth: 0, consent: [] as string[], bucket: 0, limit: 0, provider: 0, upload: 0 };
  const values: AvatarGenerationDeps = {
    config: avatarGenerationConfig(fullEnv()),
    authenticate: async () => { calls.auth++; return { ok: true, userId: OWNER }; },
    verifyConsent: async scope => { calls.consent.push(scope); return { ok: true, userId: OWNER }; },
    publicBucket: async () => { calls.bucket++; return { ok: true }; },
    consumeLimit: async () => { calls.limit++; return true; },
    generate: async () => { calls.provider++; return providerImage; },
    optimize: optimizeGeneratedAvatarDataUrl,
    upload: async (path) => { calls.upload++; return { path, publicUrl: `${ORIGIN}/storage/v1/object/public/avatars/${path}` }; },
    now: () => NOW,
    assetId: () => ASSET,
    ...overrides,
  };
  return { values, calls };
}

test("avatar config: Preview isolation, model, signer and storage are explicit; no Production opt-in", () => {
  const ready = avatarGenerationConfig(fullEnv());
  assert.equal(ready.available, true);
  assert.equal(avatarGenerationConfig({ ...fullEnv(), VERCEL_ENV: "production" }).available, false);
  const shared = avatarGenerationConfig({ ...fullEnv(), BACKYARD_AVATAR_PREVIEW_SUPABASE_URL: "https://shared.example.test" });
  assert.equal(shared.available, false);
  assert.ok(shared.missing.includes("BACKYARD_AVATAR_PREVIEW_SUPABASE_URL"));
  const missing = avatarGenerationConfig({ ...fullEnv(), OPENAI_AVATAR_IMAGE_MODEL: "", BACKYARD_AVATAR_SIGNING_SECRET: "short" });
  assert.deepEqual(missing.missing.filter(value => value.startsWith("OPENAI_AVATAR") || value.startsWith("BACKYARD_AVATAR_SIGN")),
    ["OPENAI_AVATAR_IMAGE_MODEL", "BACKYARD_AVATAR_SIGNING_SECRET"]);
});

test("avatar capability: unavailable config exposes credential names without Auth, Storage or provider calls", async () => {
  const fixture = deps(await sourceImage(), { config: avatarGenerationConfig({}) });
  const result = await avatarCapabilities(fixture.values);
  assert.equal(result.status, 200);
  assert.equal(result.body.available, false);
  assert.equal(result.body.code, "BLOCKED_EXTERNAL_IMAGE_PROVIDER");
  assert.ok((result.body.missing as string[]).includes("OPENAI_API_KEY"));
  assert.deepEqual(fixture.calls, { auth: 0, consent: [], bucket: 0, limit: 0, provider: 0, upload: 0 });
});

test("avatar generated preview: real centered 512 WebP <=180k, signed, never uploaded before USAR", async () => {
  const fixture = deps(await sourceImage());
  const result = await generateAvatarCandidate(description, fixture.values);
  assert.equal(result.status, 200);
  const dataUrl = result.body.imageDataUrl as string;
  assert.ok(dataUrl.startsWith("data:image/webp;base64,"));
  assert.ok(dataUrl.length <= 180_000);
  const image = decodeAvatarDataUrl(dataUrl, 180_000, 134_900);
  assert.ok(image);
  assert.deepEqual(await sharp(image.bytes).metadata().then(({ width, height, format }) => [width, height, format]), [512, 512, "webp"]);
  assert.equal(typeof result.body.generationToken, "string");
  assert.deepEqual(fixture.calls.consent, [AI_PROVIDER_PROCESSING_CONSENT]);
  assert.equal(fixture.calls.provider, 1);
  assert.equal(fixture.calls.upload, 0);
});

test("avatar centered crop does not stretch a rectangular source", async () => {
  const width = 1024, height = 512;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 3;
    const color = x < 256 ? [240, 0, 0] : x >= 768 ? [0, 0, 240] : [0, 220, 0];
    pixels.set(color, offset);
  }
  const encoded = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const optimized = await optimizeGeneratedAvatarDataUrl(`data:image/png;base64,${encoded.toString("base64")}`);
  const image = decodeAvatarDataUrl(optimized, 180_000, 134_900);
  assert.ok(image);
  const samples = await sharp(image.bytes).raw().toBuffer();
  const corner = samples.subarray(0, 3);
  const center = samples.subarray((256 * 512 + 256) * 3, (256 * 512 + 256) * 3 + 3);
  assert.ok(corner[1] > 150 && corner[0] < 100 && corner[2] < 100);
  assert.ok(center[1] > 150 && center[0] < 100 && center[2] < 100);
});

test("avatar: absent consent or mismatched owner is fail closed before provider", async () => {
  const image = await sourceImage();
  const fixture = deps(image, { verifyConsent: async () => ({ ok: false, status: 403, code: "CONSENT_REQUIRED", error: "Autoriza IA." }) });
  assert.equal((await generateAvatarCandidate(description, fixture.values)).status, 403);
  assert.equal(fixture.calls.provider, 0);
  const otherConsent = deps(image, { verifyConsent: async () => ({ ok: true, userId: OTHER }) });
  assert.equal((await generateAvatarCandidate(description, otherConsent.values)).body.code, "CONSENT_IDENTITY_MISMATCH");
  assert.equal(otherConsent.calls.provider, 0);
  const deniedInline = deps(image);
  assert.equal((await generateAvatarCandidate({ ...description, consent: false }, deniedInline.values)).body.code, "CONSENT_REQUIRED");
  assert.equal(deniedInline.calls.provider, 0);
});

test("avatar: selected photo alone is re-decoded and re-encoded before OpenAI; description never reuses it", async () => {
  const image = await sourceImage();
  let providerPhoto: Buffer | undefined;
  const fixture = deps(image, { generate: async input => { providerPhoto = input.photo?.bytes; return image; } });
  const result = await generateAvatarCandidate({ ...description, source: "photo", description: "", photoDataUrl: image }, fixture.values);
  assert.equal(result.status, 200);
  assert.deepEqual(fixture.calls.consent, [AI_IMAGE_PROCESSING_CONSENT]);
  assert.ok(providerPhoto);
  assert.deepEqual(await sharp(providerPhoto).metadata().then(({ width, height, format }) => [width, height, format]), [512, 512, "webp"]);
  const stale = deps(image, { generate: async input => { assert.equal(input.photo, undefined); return image; } });
  assert.equal((await generateAvatarCandidate({ ...description, photoDataUrl: image }, stale.values)).body.code, "INVALID_REQUEST");
  assert.equal(stale.calls.provider, 0);
});

test("avatar: valid compact PNG with decompression dimensions above bound is rejected before provider", async () => {
  const bomb = await sharp({ create: { width: 4096, height: 4096, channels: 3, background: "black" } }).png().toBuffer();
  const dataUrl = `data:image/png;base64,${bomb.toString("base64")}`;
  assert.ok(dataUrl.length < 180_000);
  assert.ok(decodeAvatarDataUrl(dataUrl, 180_000, 140_000));
  const fixture = deps(await sourceImage());
  const result = await generateAvatarCandidate({ ...description, source: "photo", photoDataUrl: dataUrl }, fixture.values);
  assert.equal(result.body.code, "INVALID_PHOTO");
  assert.equal(fixture.calls.provider, 0);
});

test("avatar: signed proof binds user, bytes and expiry; only valid USAR uploads to exact path", async () => {
  const fixture = deps(await sourceImage());
  const preview = await generateAvatarCandidate(description, fixture.values);
  assert.equal(preview.status, 200);
  const request = { imageDataUrl: preview.body.imageDataUrl, generationToken: preview.body.generationToken, consentVersion: AVATAR_GENERATION_CONSENT_VERSION };
  const wrongUser = { ...fixture.values, authenticate: async () => ({ ok: true as const, userId: OTHER }) };
  assert.equal((await commitGeneratedAvatar(request, wrongUser)).body.code, "GENERATION_PROOF_INVALID");
  assert.equal((await commitGeneratedAvatar({ ...request, imageDataUrl: await optimizeGeneratedAvatarDataUrl(await sharp({ create: { width: 300, height: 300, channels: 3, background: "red" } }).png().toBuffer().then(bytes => `data:image/png;base64,${bytes.toString("base64")}`)) }, fixture.values)).body.code, "GENERATION_PROOF_INVALID");
  const expired = { ...fixture.values, now: () => NOW + 11 * 60_000 };
  assert.equal((await commitGeneratedAvatar(request, expired)).body.code, "GENERATION_PROOF_INVALID");
  assert.equal(fixture.calls.upload, 0);
  const committed = await commitGeneratedAvatar(request, fixture.values);
  assert.equal(committed.status, 200);
  assert.equal(committed.body.avatarType, "generated_avatar");
  assert.equal(committed.body.avatarUrl, `${ORIGIN}/storage/v1/object/public/avatars/generated-avatar/${OWNER}/${ASSET}.webp`);
  assert.equal(fixture.calls.upload, 1);
});

test("avatar: public bucket and persistent limiter fail closed before paid generation or upload", async () => {
  const image = await sourceImage();
  const bucket = deps(image, { publicBucket: async () => ({ ok: false, status: 503, code: "PUBLIC_BUCKET_REQUIRED", error: "No bucket" }) });
  assert.equal((await generateAvatarCandidate(description, bucket.values)).body.code, "BLOCKED_EXTERNAL_IMAGE_PROVIDER");
  assert.equal(bucket.calls.provider, 0);
  const limiter = deps(image, { consumeLimit: async () => { throw new Error("rpc missing"); } });
  assert.equal((await generateAvatarCandidate(description, limiter.values)).body.code, "RATE_LIMIT_UNAVAILABLE");
  assert.equal(limiter.calls.provider, 0);
});

test("avatar: provider failures expose categories, never provider response or prompt", async () => {
  const secret = "secret prompt / unauthorized API key";
  const fixture = deps(await sourceImage(), { generate: async () => { throw Object.assign(new Error(secret), { status: 401 }); } });
  const result = await generateAvatarCandidate(description, fixture.values);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "BLOCKED_EXTERNAL_IMAGE_PROVIDER");
  assert.equal(JSON.stringify(result.body).includes(secret), false);
  assert.deepEqual(classifyAvatarProviderFailure({ name: "APIConnectionTimeoutError" }),
    { status: 504, body: { code: "IMAGE_PROVIDER_TIMEOUT", error: "El proveedor tardó demasiado. Reintenta la generación." } });
  assert.equal(classifyAvatarProviderFailure({ status: 429 }).body.code, "IMAGE_PROVIDER_QUOTA");
});

test("avatar upload: ambiguous response and 409 reconcile only identical signed bytes; no overwrite", async () => {
  const optimized = decodeAvatarDataUrl(await optimizeGeneratedAvatarDataUrl(await sourceImage()), 180_000, 134_900);
  assert.ok(optimized);
  const path = `generated-avatar/${OWNER}/${ASSET}.webp`;
  const url = `${ORIGIN}/storage/v1/object/public/avatars/${path}`;
  const first = await reconcileGeneratedAvatarUpload(path, optimized, {
    upload: async () => ({ path, error: null }), download: async () => { throw new Error("should not download"); }, publicUrl: () => url,
  });
  assert.equal(first.publicUrl, url);
  const retry = await reconcileGeneratedAvatarUpload(path, optimized, {
    upload: async () => ({ path: null, error: { statusCode: "409" } }), download: async () => optimized.bytes, publicUrl: () => url,
  });
  assert.equal(retry.publicUrl, url);
  const uncertain = await reconcileGeneratedAvatarUpload(path, optimized, {
    upload: async () => { throw new Error("timeout after upload"); }, download: async () => optimized.bytes, publicUrl: () => url,
  });
  assert.equal(uncertain.publicUrl, url);
  await assert.rejects(reconcileGeneratedAvatarUpload(path, optimized, {
    upload: async () => ({ path: null, error: { statusCode: "409" } }),
    download: async () => Buffer.alloc(optimized.bytes.length, 1), publicUrl: () => url,
  }), /mismatch/);
  await assert.rejects(reconcileGeneratedAvatarUpload(path, optimized, {
    upload: async () => ({ path: null, error: new Error("unavailable") }), download: async () => null, publicUrl: () => url,
  }), /unconfirmed/);
});

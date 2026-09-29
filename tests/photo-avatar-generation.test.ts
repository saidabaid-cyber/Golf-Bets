import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import {
  MAX_PHOTO_AVATAR_VARIANTS,
  PHOTO_AVATAR_GENERATION_ENDPOINT,
  PHOTO_AVATAR_GENERATION_STYLE,
  PhotoAvatarGenerationError,
  readPhotoAvatarGenerationCapability,
  requestPhotoAvatarGeneration,
} from "../lib/photo-avatar-generation";
import * as privacy from "../lib/backyard-ai/privacy";
import * as security from "../lib/backyard-ai/server/http-security";

function fetcher(handler: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>) {
  return handler as typeof fetch;
}

function jpegDataUrl() {
  return `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]).toString("base64")}`;
}

test("cliente consulta capacidad y envía crop, variante, token y consentimiento sólo al endpoint server-side", async () => {
  const capability = await readPhotoAvatarGenerationCapability(fetcher(() => Response.json({
    available: true,
    provider: "openai",
    model: "gpt-image-test",
  })));
  assert.deepEqual(capability, { available: true, provider: "openai", model: "gpt-image-test" });

  const capturedCalls: Array<{ url: string; init?: RequestInit; body: Record<string, unknown> }> = [];
  const result = await requestPhotoAvatarGeneration({
    sourceImageDataUrl: jpegDataUrl(),
    variant: 2,
    accessToken: "account-token",
    fetcher: fetcher((input, init) => {
      capturedCalls.push({ url: String(input), init, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return Response.json({
        avatarDataUrl: `data:image/webp;base64,${Buffer.from("generated").toString("base64")}`,
        provider: "openai",
        model: "gpt-image-test",
        variant: 2,
      });
    }),
  });
  const captured = capturedCalls[0];
  assert.equal(captured.url, PHOTO_AVATAR_GENERATION_ENDPOINT);
  assert.equal((captured.init?.headers as Record<string, string>).authorization, "Bearer account-token");
  assert.equal(captured.body.sourceImageDataUrl, jpegDataUrl());
  assert.equal(captured.body.style, PHOTO_AVATAR_GENERATION_STYLE);
  assert.equal(captured.body.variant, 2);
  assert.deepEqual(captured.body.consent, privacy.backyardAiProviderConsent(privacy.AI_IMAGE_PROCESSING_CONSENT));
  assert.equal(result.variant, 2);
});

test("cliente conserva error recuperable del proveedor y rechaza una respuesta de imagen inválida", async () => {
  await assert.rejects(
    requestPhotoAvatarGeneration({
      sourceImageDataUrl: jpegDataUrl(), variant: 1, accessToken: "token",
      fetcher: fetcher(() => Response.json({ error: "No pudimos crear el avatar. Intenta nuevamente.", code: "provider_error" }, { status: 502 })),
    }),
    (error: unknown) => error instanceof PhotoAvatarGenerationError && error.code === "provider_error" && error.status === 502,
  );
  await assert.rejects(
    requestPhotoAvatarGeneration({
      sourceImageDataUrl: jpegDataUrl(), variant: 1, accessToken: "token",
      fetcher: fetcher(() => Response.json({ avatarDataUrl: "https://unexpected.invalid/avatar", provider: "openai", model: "test", variant: 1 })),
    }),
    (error: unknown) => error instanceof PhotoAvatarGenerationError && error.code === "invalid_generation",
  );
});

type ServerHelper = {
  parsePhotoAvatarSourceDataUrl: (value: unknown) => { bytes: Buffer; mimeType: string; extension: string } | null;
  premiumGolfAvatarPrompt: (variant: number) => string;
  generatePremiumGolfAvatar: (input: Record<string, unknown>) => Promise<string>;
};

function serverHelper(): ServerHelper {
  const compiled = ts.transpileModule(readFileSync("lib/photo-avatar-generation.server.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports: Partial<ServerHelper> = {};
  runInNewContext(compiled, {
    exports,
    Buffer,
    require: (id: string) => {
      if (id === "server-only") return {};
      if (id === "node:buffer") return { Buffer };
      if (id === "openai") return { __esModule: true, default: class {}, toFile: async (value: unknown, name: string, options: unknown) => ({ value, name, options }) };
      if (id.endsWith("/photo-avatar-generation")) return {
        MAX_GENERATED_AVATAR_DATA_URL_LENGTH: 4_000_000,
        MAX_PHOTO_AVATAR_SOURCE_DATA_URL_LENGTH: 180_000,
        MAX_PHOTO_AVATAR_VARIANTS,
      };
      if (id.endsWith("/profile-image")) return { profileImageFormatFromBytes: (bytes: Uint8Array) => bytes[0] === 0xff ? "jpeg" : null };
      throw new Error(id);
    },
  });
  return exports as ServerHelper;
}

test("adaptador OpenAI valida la foto, exige alta fidelidad y devuelve una imagen base64 acotada", async () => {
  const helper = serverHelper();
  const source = helper.parsePhotoAvatarSourceDataUrl(jpegDataUrl());
  assert.ok(source);
  assert.equal(source.mimeType, "image/jpeg");
  assert.equal(helper.parsePhotoAvatarSourceDataUrl(jpegDataUrl().replace("image/jpeg", "image/png")), null);
  assert.match(helper.premiumGolfAvatarPrompt(2), /Preserve the same person's recognizable identity/);
  assert.match(helper.premiumGolfAvatarPrompt(2), /Do not add any real brand, logo, text or trademark/);

  const providerInputs: Array<Record<string, unknown>> = [];
  const encoded = Buffer.from("provider-avatar").toString("base64");
  const avatar = await helper.generatePremiumGolfAvatar({
    apiKey: "server-secret",
    model: "gpt-image-test",
    source,
    variant: 2,
    userHash: "opaque-user",
    client: { images: { edit: async (input: Record<string, unknown>) => { providerInputs.push(input); return { data: [{ b64_json: encoded }], output_format: "webp" }; } } },
  });
  const providerInput = providerInputs[0];
  assert.equal(avatar, `data:image/webp;base64,${encoded}`);
  assert.equal(providerInput?.input_fidelity, "high");
  assert.equal(providerInput?.output_format, "webp");
  assert.equal(providerInput?.user, "opaque-user");
  assert.equal("apiKey" in providerInput, false);
  await assert.rejects(helper.generatePremiumGolfAvatar({
    apiKey: "server-secret", model: "gpt-image-test", source, variant: 1, userHash: "opaque-user",
    client: { images: { edit: async () => ({ data: [] }) } },
  }), /invalid_image_output/);
});

type RouteExports = { GET: () => Promise<Response>; POST: (request: Request) => Promise<Response> };

function avatarRoute(input: {
  configured?: boolean;
  consent?: { ok: true; authenticated: boolean; userId: string | null } | { ok: false; status: number; code: string; error: string };
  generate?: (value: Record<string, unknown>) => Promise<string>;
  generatedInputs?: Array<Record<string, unknown>>;
  verifiedScopes?: string[];
} = {}): RouteExports {
  const compiled = ts.transpileModule(readFileSync("app/api/profile/avatar-from-photo/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports: Partial<RouteExports> = {};
  const configured = input.configured ?? true;
  runInNewContext(compiled, {
    exports,
    Request,
    Response,
    process: { env: { OPENAI_API_KEY: configured ? "server-secret" : "" } },
    console: { info: () => undefined, error: () => undefined },
    require: (id: string) => {
      if (id === "server-only") return {};
      if (id === "node:crypto") return { createHmac };
      if (id === "next/server") return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      if (id.endsWith("/photo-avatar-generation")) return { MAX_PHOTO_AVATAR_VARIANTS, PHOTO_AVATAR_GENERATION_STYLE };
      if (id.endsWith("/photo-avatar-generation.server")) return {
        parsePhotoAvatarSourceDataUrl: (value: unknown) => typeof value === "string" && value.startsWith("data:image/") ? { bytes: Buffer.from("photo"), mimeType: "image/jpeg", extension: "jpg" } : null,
        generatePremiumGolfAvatar: async (value: Record<string, unknown>) => {
          input.generatedInputs?.push(value);
          return input.generate ? input.generate(value) : `data:image/webp;base64,${Buffer.from("avatar").toString("base64")}`;
        },
      };
      if (id.endsWith("/privacy")) return privacy;
      if (id.endsWith("/config")) return { backyardAiConfig: () => ({
        enabled: true, configured, providerConfigured: configured, limiterConfigured: true, ready: configured, avatarImageModel: "gpt-image-test",
      }) };
      if (id.endsWith("/http-security")) return security;
      if (id.endsWith("/openai-structured")) return { classifyBackyardAiFailure: (error: unknown) => {
        const candidate = error as { status?: number; code?: string };
        return { status: candidate?.status || 502, code: candidate?.code || "provider_error", message: "provider error" };
      } };
      if (id.endsWith("/processing-consent")) return { verifyStoredAiProcessingConsent: async (_request: Request, scope: string) => {
        input.verifiedScopes?.push(scope);
        return input.consent ?? { ok: true, authenticated: true, userId: "qa-user" };
      } };
      if (id.endsWith("/rate-limit")) return { consumeBackyardAiLimit: () => true };
      if (id.endsWith("/rules-ai-rate-limit")) return { consumePersistentRulesAiLimit: async () => true };
      if (id.endsWith("/supabase/server")) return { getSupabaseAdmin: () => ({ rpc: async () => ({ data: true, error: null }) }) };
      throw new Error(id);
    },
  });
  return exports as RouteExports;
}

function avatarRequest(overrides: Record<string, unknown> = {}) {
  return new Request("https://dev.example/api/profile/avatar-from-photo", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer qa-token" },
    body: JSON.stringify({
      sourceImageDataUrl: jpegDataUrl(),
      style: PHOTO_AVATAR_GENERATION_STYLE,
      variant: 1,
      consent: privacy.backyardAiProviderConsent(privacy.AI_IMAGE_PROCESSING_CONSENT),
      ...overrides,
    }),
  });
}

test("endpoint exige configuración, autenticación y consentimiento antes de llamar al proveedor", async () => {
  const unavailable = avatarRoute({ configured: false });
  assert.deepEqual(await unavailable.GET().then((response) => response.json()), {
    available: false, provider: "openai", model: "gpt-image-test", reason: "missing_config",
  });
  assert.equal((await unavailable.POST(avatarRequest())).status, 503);

  const verifiedScopes: string[] = [];
  const route = avatarRoute({ verifiedScopes });
  const badConsent = await route.POST(avatarRequest({ consent: privacy.backyardAiProviderConsent(privacy.AI_PROVIDER_PROCESSING_CONSENT) }));
  assert.equal(badConsent.status, 403);
  assert.deepEqual(verifiedScopes, []);
  const unauthenticated = avatarRoute({ consent: { ok: true, authenticated: false, userId: null } });
  assert.equal((await unauthenticated.POST(avatarRequest())).status, 401);
});

test("endpoint genera una variante real server-side y convierte fallas del proveedor en un error recuperable", async () => {
  const generatedInputs: Array<Record<string, unknown>> = [];
  const verifiedScopes: string[] = [];
  const route = avatarRoute({ generatedInputs, verifiedScopes });
  const response = await route.POST(avatarRequest({ variant: 2 }));
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.provider, "openai");
  assert.equal(body.model, "gpt-image-test");
  assert.equal(body.variant, 2);
  assert.match(String(body.avatarDataUrl), /^data:image\/webp;base64,/);
  assert.deepEqual(verifiedScopes, [privacy.AI_IMAGE_PROCESSING_CONSENT]);
  assert.equal(generatedInputs[0]?.variant, 2);
  assert.equal(generatedInputs[0]?.model, "gpt-image-test");
  assert.notEqual(generatedInputs[0]?.apiKey, undefined, "the provider key exists only inside the server adapter call");

  const failed = avatarRoute({ generate: async () => { throw Object.assign(new Error("provider"), { status: 502 }); } });
  const failedResponse = await failed.POST(avatarRequest());
  assert.equal(failedResponse.status, 502);
  assert.deepEqual(await failedResponse.json(), { error: "No pudimos crear el avatar. Intenta nuevamente.", code: "provider_error" });
});

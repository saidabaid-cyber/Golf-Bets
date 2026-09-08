import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { backyardAiConfig, DEFAULT_BACKYARD_AI_MODEL } from "../lib/backyard-ai/server/config";
import {
  BACKYARD_AI_PRIVATE_HEADERS,
  backyardAiClientAddress,
  hasOnlyKeys,
  isCrossSiteRequest,
  readJsonBodyWithLimit,
} from "../lib/backyard-ai/server/http-security";
import {
  backyardAiLimiterSizeForTests,
  consumeBackyardAiLimit,
  resetBackyardAiLimitsForTests,
} from "../lib/backyard-ai/server/rate-limit";
import {
  MAX_SCORECARD_REQUEST_BYTES,
  MAX_SCORECARD_PHOTO_ID_LENGTH,
  MAX_SCORECARD_TOTAL_DATA_URL_LENGTH,
  MAX_SCORECARD_TOTAL_IMAGE_BYTES,
  parseScorecardPhotos,
  parseScorecardRoundHint,
  restoreCallerPhotoIds,
  scorecardPhotoPayloadExceedsAggregateLimit,
} from "../lib/backyard-ai/server/scorecard-request";
import type { ScorecardExtraction } from "../lib/backyard-ai/schemas/scorecard";
import { AI_IMAGE_PROCESSING_CONSENT, AI_PROVIDER_PROCESSING_CONSENT, BACKYARD_AI_PROVIDER_CONSENT_VERSION, parseBackyardAiProviderConsent } from "../lib/backyard-ai/privacy";

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://app.example/api/backyard-ai/test", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body,
  });
}

function jpegDataUrl() {
  return `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]).toString("base64")}`;
}

function jpegDataUrlWithByteLength(byteLength: number) {
  const bytes = Buffer.alloc(Math.max(6, byteLength));
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

test("bounded JSON reader accepts UTF-8 JSON and enforces the streamed byte limit", async () => {
  const accepted = await readJsonBodyWithLimit(jsonRequest(JSON.stringify({ input: "Jugamos mañana ⛳" })), 1_000);
  assert.deepEqual(accepted, { ok: true, value: { input: "Jugamos mañana ⛳" } });

  const oversized = await readJsonBodyWithLimit(jsonRequest(JSON.stringify({ input: "x".repeat(200) }), { "content-length": "1" }), 40);
  assert.deepEqual(oversized, { ok: false, reason: "too_large" });

  const declaredOversized = await readJsonBodyWithLimit(jsonRequest("{}", { "content-length": "200" }), 40);
  assert.deepEqual(declaredOversized, { ok: false, reason: "too_large" });
});

test("bounded JSON reader rejects invalid media type, length and JSON", async () => {
  const wrongMedia = new Request("https://app.example/api", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.deepEqual(await readJsonBodyWithLimit(wrongMedia, 100), { ok: false, reason: "unsupported_media_type" });
  assert.deepEqual(await readJsonBodyWithLimit(jsonRequest("{}", { "content-length": "nope" }), 100), { ok: false, reason: "invalid_length" });
  assert.deepEqual(await readJsonBodyWithLimit(jsonRequest("{"), 100), { ok: false, reason: "invalid_json" });
});

test("request security identifies browser cross-site calls and only accepts real IP addresses", () => {
  const crossSite = jsonRequest("{}", { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
  const sameSite = jsonRequest("{}", { origin: "https://app.example", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  const spoofed = jsonRequest("{}", { "x-forwarded-for": "attacker-controlled-bucket" });
  assert.equal(isCrossSiteRequest(crossSite), true);
  assert.equal(isCrossSiteRequest(sameSite), false);
  assert.equal(backyardAiClientAddress(sameSite), "203.0.113.9");
  assert.equal(backyardAiClientAddress(spoofed), "unknown");
  assert.equal(hasOnlyKeys({ input: "ok" }, ["input"]), true);
  assert.equal(hasOnlyKeys({ input: "ok", privateProfile: {} }, ["input"]), false);
  assert.equal(BACKYARD_AI_PRIVATE_HEADERS["cache-control"], "private, no-store");
});

test("scorecard photos require canonical base64 and a MIME-matching file signature", () => {
  const valid = parseScorecardPhotos([{ id: "round-photo_1", dataUrl: jpegDataUrl() }]);
  assert.ok(valid);
  assert.equal(valid[0].providerId, "photo-1");
  assert.equal(valid[0].id, "round-photo_1");
  assert.equal(valid[0].mimeType, "image/jpeg");

  const jpegBytes = jpegDataUrl().split(",")[1];
  assert.equal(parseScorecardPhotos([{ id: "photo", dataUrl: `data:image/png;base64,${jpegBytes}` }]), null);
  assert.equal(parseScorecardPhotos([{ id: "photo", dataUrl: jpegDataUrl().replace("base64,", "base64,\n") }]), null);
  assert.equal(parseScorecardPhotos([{ id: "photo", dataUrl: jpegDataUrl(), ignored: "private" }]), null);
  assert.equal(parseScorecardPhotos([{ id: "same", dataUrl: jpegDataUrl() }, { id: "same", dataUrl: jpegDataUrl() }]), null);
  assert.equal(parseScorecardPhotos([{ id: "x".repeat(MAX_SCORECARD_PHOTO_ID_LENGTH + 1), dataUrl: jpegDataUrl() }]), null);
});

test("Card AI reserva margen bajo 4.5 MB y rechaza exceso agregado antes del proveedor", () => {
  assert.ok(MAX_SCORECARD_REQUEST_BYTES < 4_500_000);
  assert.ok(MAX_SCORECARD_TOTAL_DATA_URL_LENGTH < MAX_SCORECARD_REQUEST_BYTES);

  const perPhotoBytes = Math.floor(MAX_SCORECARD_TOTAL_IMAGE_BYTES / 4) + 1;
  const aggregate = Array.from({ length: 4 }, (_, index) => ({
    id: `photo-${index + 1}`,
    dataUrl: jpegDataUrlWithByteLength(perPhotoBytes),
  }));
  assert.equal(scorecardPhotoPayloadExceedsAggregateLimit(aggregate), true);
  assert.equal(parseScorecardPhotos(aggregate), null);

  const oversizedDataUrls = [
    { id: "photo-1", dataUrl: "x".repeat(Math.floor(MAX_SCORECARD_TOTAL_DATA_URL_LENGTH / 2) + 1) },
    { id: "photo-2", dataUrl: "x".repeat(Math.floor(MAX_SCORECARD_TOTAL_DATA_URL_LENGTH / 2) + 1) },
  ];
  assert.equal(scorecardPhotoPayloadExceedsAggregateLimit(oversizedDataUrls), true);

  const route = readFileSync("app/api/backyard-ai/scorecard/route.ts", "utf8");
  assert.match(route, /readJsonBodyWithLimit\(request, MAX_SCORECARD_REQUEST_BYTES\)/);
  assert.match(route, /scorecardPhotoPayloadExceedsAggregateLimit\(source\.photos\)[\s\S]*?request_too_large/);
  assert.doesNotMatch(route, /MAX_REQUEST_BYTES\s*=\s*18_000_000/);
});

test("scorecard round hints allow only the minimum recognition context", () => {
  assert.deepEqual(parseScorecardRoundHint({
    courseName: "La Vista",
    playerNames: ["Said", "Pedro"],
    roundHoles: 18,
  }), {
    expectedCourse: "La Vista",
    expectedPlayers: ["Said", "Pedro"],
    expectedHoles: 18,
  });
  assert.equal(parseScorecardRoundHint({ playerNames: ["Said"], handicaps: [4] }), null);
  assert.equal(parseScorecardRoundHint({ playerNames: Array.from({ length: 13 }, (_, index) => `P${index}`) }), null);
  assert.equal(parseScorecardRoundHint({ roundHoles: 12 }), null);
});

test("el boundary AI exige consentimiento afirmativo y versionado", () => {
  assert.deepEqual(parseBackyardAiProviderConsent({ granted: true, version: BACKYARD_AI_PROVIDER_CONSENT_VERSION, scope: AI_PROVIDER_PROCESSING_CONSENT }, AI_PROVIDER_PROCESSING_CONSENT), {
    granted: true,
    version: BACKYARD_AI_PROVIDER_CONSENT_VERSION,
    scope: AI_PROVIDER_PROCESSING_CONSENT,
  });
  assert.equal(parseBackyardAiProviderConsent({ granted: true, version: BACKYARD_AI_PROVIDER_CONSENT_VERSION }, AI_PROVIDER_PROCESSING_CONSENT), null);
  assert.equal(parseBackyardAiProviderConsent({ granted: true, version: BACKYARD_AI_PROVIDER_CONSENT_VERSION, scope: AI_PROVIDER_PROCESSING_CONSENT }, AI_IMAGE_PROCESSING_CONSENT), null);
  assert.equal(parseBackyardAiProviderConsent({ granted: false, version: BACKYARD_AI_PROVIDER_CONSENT_VERSION, scope: AI_PROVIDER_PROCESSING_CONSENT }, AI_PROVIDER_PROCESSING_CONSENT), null);
  assert.equal(parseBackyardAiProviderConsent({ granted: true, version: "anterior", scope: AI_PROVIDER_PROCESSING_CONSENT }, AI_PROVIDER_PROCESSING_CONSENT), null);
  assert.equal(parseBackyardAiProviderConsent({ granted: true, version: BACKYARD_AI_PROVIDER_CONSENT_VERSION, scope: AI_PROVIDER_PROCESSING_CONSENT, extra: true }, AI_PROVIDER_PROCESSING_CONSENT), null);
});

test("provider receives opaque photo ordinals and response evidence restores caller IDs", () => {
  const photos = parseScorecardPhotos([{ id: "local-private-round-photo", dataUrl: jpegDataUrl() }]);
  assert.ok(photos);
  const source = { photoId: "photo-1" };
  const extraction: ScorecardExtraction = {
    version: 1,
    sourceIds: ["photo-1"],
    course: { value: "La Vista", confidence: 0.9, source },
    players: [{ playerName: "Said", confidence: 0.9, source }],
    cells: [{ playerName: "Said", hole: 1, value: 4, confidence: 0.95, source }],
    pars: [{ hole: 1, value: 4, confidence: 0.99, source }],
    totals: [{ playerName: "Said", kind: "out", value: 40, confidence: 0.8, source }],
  };
  const restored = restoreCallerPhotoIds(extraction, photos);
  assert.deepEqual(restored.sourceIds, ["local-private-round-photo"]);
  assert.equal(restored.course?.source.photoId, "local-private-round-photo");
  assert.equal(restored.cells[0].source.photoId, "local-private-round-photo");
});

test("rate limiter rejects invalid configuration and bounds process-local memory", () => {
  resetBackyardAiLimitsForTests();
  assert.equal(consumeBackyardAiLimit("", 1, 1_000, 0), false);
  assert.equal(consumeBackyardAiLimit("valid", 0, 1_000, 0), false);
  for (let index = 0; index < 5_010; index += 1) assert.equal(consumeBackyardAiLimit(`key-${index}`, 1, 60_000, 0), true);
  assert.ok(backyardAiLimiterSizeForTests() <= 5_000);
  resetBackyardAiLimitsForTests();
});

test("invalid model environment values cannot become provider identifiers", () => {
  assert.equal(backyardAiConfig({ OPENAI_API_KEY: "x", OPENAI_BACKYARD_MODEL: "model\nignore-instructions" }).roundSetupModel, DEFAULT_BACKYARD_AI_MODEL);
  assert.equal(backyardAiConfig({ OPENAI_API_KEY: "x", OPENAI_SCORECARD_MODEL: "../unsafe" }).scorecardModel, DEFAULT_BACKYARD_AI_MODEL);
});

test("AI routes retain stateless strict-output and no-money boundary contracts", () => {
  const helper = readFileSync("lib/backyard-ai/server/openai-structured.ts", "utf8");
  const roundRoute = readFileSync("app/api/backyard-ai/round-setup/route.ts", "utf8");
  const scorecardRoute = readFileSync("app/api/backyard-ai/scorecard/route.ts", "utf8");
  assert.match(helper, /store:\s*false/);
  assert.match(helper, /type:\s*"json_schema"/);
  assert.match(helper, /strict:\s*true/);
  assert.doesNotMatch(helper, /\btools\s*:/);
  assert.doesNotMatch(roundRoute, /request\.text\(\)/);
  assert.doesNotMatch(scorecardRoute, /request\.text\(\)/);
  assert.match(roundRoute, /runtime\s*=\s*"nodejs"/);
  assert.match(scorecardRoute, /runtime\s*=\s*"nodejs"/);
  assert.match(roundRoute, /Never calculate scores, handicaps, bets, balances, money results or settlement/);
  assert.match(scorecardRoute, /Never calculate bets, money, handicaps, net scores/);
  assert.match(roundRoute, /parseBackyardAiProviderConsent\(source\.consent, AI_PROVIDER_PROCESSING_CONSENT\)/);
  assert.match(scorecardRoute, /parseBackyardAiProviderConsent\(source\.consent, AI_IMAGE_PROCESSING_CONSENT\)/);
  assert.match(roundRoute, /verifyStoredAiProcessingConsent\(request, AI_PROVIDER_PROCESSING_CONSENT\)/);
  assert.match(scorecardRoute, /verifyStoredAiProcessingConsent\(request, AI_IMAGE_PROCESSING_CONSENT\)/);
  assert.doesNotMatch(scorecardRoute, /digitalScores|handicap[s]?\s*:/i);
  assert.doesNotMatch(scorecardRoute, /extraction:\s*normalized\.extraction,\s*model:/);
  assert.doesNotMatch(roundRoute, /from\s+["'][^"']*engine["']/);
  assert.doesNotMatch(scorecardRoute, /from\s+["'][^"']*engine["']/);
});

test("AI routes combine a bounded burst limit with the existing persistent Supabase limiter", () => {
  for (const route of ["app/api/backyard-ai/round-setup/route.ts", "app/api/backyard-ai/scorecard/route.ts"]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /consumeBackyardAiLimit/);
    assert.match(source, /consumePersistentRulesAiLimit/);
    assert.match(source, /getSupabaseAdmin\("cloud"\)/);
    assert.match(source, /rate_limit_unavailable/);
    assert.match(source, /parseBackyardAiProviderConsent/);
  }
  assert.match(readFileSync("app/api/backyard-ai/round-setup/route.ts", "utf8"), /validateCanonicalRoundCommand/);
});

test("AI routes enforce global call budgets and count every scorecard photo before parallel provider calls", () => {
  const roundRoute = readFileSync("app/api/backyard-ai/round-setup/route.ts", "utf8");
  const scorecardRoute = readFileSync("app/api/backyard-ai/scorecard/route.ts", "utf8");
  assert.match(roundRoute, /GLOBAL_RATE_LIMIT\s*=\s*100/);
  assert.match(roundRoute, /round-setup:global-budget/);
  assert.match(scorecardRoute, /PHOTO_CALL_RATE_LIMIT\s*=\s*12/);
  assert.match(scorecardRoute, /GLOBAL_PHOTO_CALL_RATE_LIMIT\s*=\s*100/);
  const limiterMigration = readFileSync("supabase/migrations/20260904104145_rules_ai_rate_limit.sql", "utf8");
  assert.match(limiterMigration, /p_limit > 100/);
  assert.match(scorecardRoute, /for \(let index = 0; index < photos\.length; index \+= 1\)/);
  assert.ok(scorecardRoute.indexOf("globalPhotoLimiterKey") < scorecardRoute.indexOf("Promise.all"));
  assert.ok(roundRoute.indexOf("parseBackyardAiProviderConsent") < roundRoute.indexOf("round-setup:global-budget"));
});

test("AI consent is persistent, owner-scoped and independent for instructions and photos", () => {
  const setup = readFileSync("app/components/backyard-ai/ai-round-setup.tsx", "utf8");
  const scorecard = readFileSync("app/components/backyard-ai/scorecard-scanner.tsx", "utf8");
  const consentModule = readFileSync("lib/backyard-ai/processing-consent.ts", "utf8");
  assert.match(setup, /hasActiveAiProcessingConsent/);
  assert.match(setup, /AiProcessingConsentPrompt/);
  assert.match(setup, /AI_PROVIDER_PROCESSING_CONSENT/);
  assert.doesNotMatch(setup, /setProviderConsent\(false\)/);
  assert.match(scorecard, /hasActiveAiProcessingConsent/);
  assert.match(scorecard, /AiProcessingConsentPrompt/);
  assert.match(scorecard, /AI_IMAGE_PROCESSING_CONSENT/);
  assert.doesNotMatch(scorecard, /setConsent\(false\)/);
  assert.match(consentModule, /userId: string/);
  assert.match(consentModule, /policyVersion: string/);
  assert.match(consentModule, /acceptedAt: string/);
  assert.match(consentModule, /revokedAt: string \| null/);
  assert.match(consentModule, /scope: BackyardAiProcessingConsentScope/);
});

test("OpenAI adapter sends a stateless strict request and rejects incomplete responses", () => {
  const script = String.raw`
    const { generateBackyardAiJson, classifyBackyardAiFailure } = require('./.test-dist/lib/backyard-ai/server/openai-structured.js');
    (async () => {
      let captured;
      const result = await generateBackyardAiJson({
        client: { responses: { create: async (request) => { captured = request; return { status: 'completed', output_text: '{"ok":true}' }; } } },
        model: 'test-model',
        instructions: 'interpret only',
        input: 'hello',
        format: { name: 'test_schema', description: 'test', schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } }, required: ['ok'] } },
      });
      let incompleteCode = '';
      try {
        await generateBackyardAiJson({
          client: { responses: { create: async () => ({ status: 'incomplete', output_text: '{"ok":true}' }) } },
          model: 'test-model', instructions: 'interpret only', input: 'hello',
          format: { name: 'test_schema', description: 'test', schema: { type: 'object' } },
        });
      } catch (error) { incompleteCode = error.code; }
      process.stdout.write(JSON.stringify({ captured, result, incompleteCode, quota: classifyBackyardAiFailure({ status: 429, code: 'insufficient_quota' }) }));
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  const executed = spawnSync(process.execPath, ["--conditions=react-server", "-e", script], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(executed.status, 0, executed.stderr);
  const output = JSON.parse(executed.stdout) as {
    captured: Record<string, unknown> & { text: { format: Record<string, unknown> } };
    result: { ok: boolean };
    incompleteCode: string;
    quota: { code: string };
  };
  assert.equal(output.result.ok, true);
  assert.equal(output.captured.store, false);
  assert.equal(output.captured.text.format.type, "json_schema");
  assert.equal(output.captured.text.format.strict, true);
  assert.equal("tools" in output.captured, false);
  assert.equal(output.incompleteCode, "incomplete_response");
  assert.equal(output.quota.code, "quota");
});

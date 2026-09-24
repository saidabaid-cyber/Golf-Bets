import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routePath = "app/api/admin/dev/ghin/route.ts";
const pagePath = "app/admin/dev/ghin/page.tsx";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("GHIN diagnostic route stays Preview-only, authenticated and admin-scoped", () => {
  const route = source(routePath);
  const runtime = source("lib/ghin/runtime.server.ts");
  const config = source("lib/ghin/config.ts");

  assert.match(route, /resolveGhinRuntime\(\)/);
  assert.match(runtime, /resolveGhinPreviewCapabilities\(env\)/);
  assert.match(runtime, /!capabilities\.previewOnly/);
  assert.match(config, /env\.VERCEL_ENV\s*===\s*["']preview["']/);
  assert.match(route, /authenticatedRequest\(request\)/);
  assert.match(route, /isCrossSiteRequest\(request\)/);
  assert.match(
    route,
    /\.from\(["']admin_memberships["']\)[\s\S]*?\.eq\(["']user_id["'],\s*\w+\.userId\)[\s\S]*?\.eq\(["']active["'],\s*true\)/,
  );
});

test("GHIN diagnostic route bounds request bodies and rate limits by authenticated user", () => {
  const route = source(routePath);
  const bodyReader = source("lib/backyard-ai/server/http-security.ts");

  assert.match(route, /MAX_BODY_BYTES\s*=\s*\d+/);
  assert.match(route, /readJsonBodyWithLimit\(request,\s*MAX_BODY_BYTES\)/);
  assert.match(bodyReader, /headers\.get\(["']content-length["']\)/i);
  assert.match(bodyReader, /totalBytes\s*>\s*maxBytes/);
  assert.match(route, /SlidingWindowRateLimiter/);
  assert.match(route, /\.consume\(\s*\w+\.userId(?:\s*,[^)]*)?\)/);
});

test("GHIN diagnostic responses are private, non-cacheable and MIME-sniff protected", () => {
  const route = source(routePath);
  const headers = source("lib/backyard-ai/server/http-security.ts");

  assert.match(route, /BACKYARD_AI_PRIVATE_HEADERS/);
  assert.match(headers, /["']cache-control["']\s*:\s*["']private,\s*no-store["']/i);
  assert.match(headers, /["']x-content-type-options["']\s*:\s*["']nosniff["']/i);
  assert.match(route, /NextResponse\.json\([\s\S]*?headers\s*:/);
});

test("GHIN diagnostic route is pinned to the authorized golfer and La Vista read-only probe", () => {
  const route = source(routePath);

  assert.match(route, /(?:const\s+\w*(?:GHIN|GOLFER)\w*\s*=\s*)["']11103349["']/i);
  assert.match(route, /(?:const\s+\w*(?:COURSE|CLUB)\w*\s*=\s*)["'][^"']*LA VISTA[^"']*["']/i);

  assert.doesNotMatch(route, /\.postScore\s*\(/i);
  assert.doesNotMatch(route, /\.(?:create|update|delete|submit)Score\s*\(/i);
  assert.doesNotMatch(route, /export\s+(?:async\s+)?function\s+(?:PUT|PATCH|DELETE)\s*\(/);
  assert.doesNotMatch(route, /fetch\([^)]*scores[^)]*method\s*:\s*["']POST["']/i);
});

test("GHIN admin page never references server credential environment names", () => {
  const page = source(pagePath);

  for (const secretName of [
    "GHIN_TEST_LOGIN",
    "GHIN_TEST_PASSWORD",
    "GHIN_LOGIN_BOOTSTRAP_TOKEN",
    "GHIN_API_BASE_URL",
  ]) {
    assert.doesNotMatch(page, new RegExp(secretName));
  }
  assert.doesNotMatch(page, /process\.env/);
});

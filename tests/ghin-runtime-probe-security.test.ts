import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routePath = "app/api/admin/dev/ghin/runtime-probe/route.ts";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("temporary GHIN runtime probe is Preview-only and POST-only", () => {
  const route = source(routePath);

  assert.match(route, /process\.env\.VERCEL_ENV\s*!==\s*["']preview["'][\s\S]*?PREVIEW_ONLY[\s\S]*?404/);
  assert.match(route, /process\.env\.VERCEL_GIT_COMMIT_REF\s*!==\s*QA_BRANCH/);
  assert.match(route, /QA_BRANCH\s*=\s*["']integration\/backyard-current["']/);
  assert.match(route, /export\s+async\s+function\s+POST\s*\(/);
  assert.doesNotMatch(route, /export\s+(?:async\s+)?function\s+(?:GET|PUT|PATCH|DELETE)\s*\(/);
  assert.match(route, /dynamic\s*=\s*["']force-dynamic["']/);
  assert.match(route, /runtime\s*=\s*["']nodejs["']/);
});

test("temporary GHIN runtime probe uses a timing-safe server-only bearer", () => {
  const route = source(routePath);
  const envExample = source(".env.example");

  assert.match(route, /headers\.get\(["']authorization["']\)/i);
  assert.match(route, /\^Bearer \(\[\^\\s,\]\+\)\$/);
  assert.match(route, /timingSafeEqual\(paddedCandidate,\s*paddedExpected\)/);
  assert.match(route, /expectedBytes\.length\s*>\s*0/);
  assert.match(route, /process\.env\.GHIN_QA_PROBE_SECRET/);
  assert.match(envExample, /^GHIN_QA_PROBE_SECRET=$/m);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_GHIN_QA_PROBE_SECRET/);
  assert.match(route, /isCrossSiteRequest\(request\)/);
});

test("temporary GHIN runtime probe has an exact bounded command contract and global budget", () => {
  const route = source(routePath);
  const bodyReader = source("lib/backyard-ai/server/http-security.ts");

  assert.match(route, /MAX_BODY_BYTES\s*=\s*1_024/);
  assert.match(route, /readJsonBodyWithLimit\(request,\s*MAX_BODY_BYTES\)/);
  assert.match(route, /hasOnlyKeys\(input,\s*\["operation"\]\)/);
  assert.match(route, /value\s*===\s*"auth_matrix"\s*\|\|\s*value\s*===\s*"golfer_read_only"\s*\|\|\s*value\s*===\s*"full_read_only"/);
  assert.match(route, /limit:\s*3,\s*windowMs:\s*10\s*\*\s*60_000/);
  assert.match(route, /\.consume\(GLOBAL_LIMITER_KEY\)/);
  assert.match(route, /GLOBAL_LIMITER_KEY\s*=\s*"ghin-runtime-probe:global"/);
  assert.match(bodyReader, /totalBytes\s*>\s*maxBytes/);
});

test("temporary GHIN runtime probe emits private responses and only coarse secret shape", () => {
  const route = source(routePath);
  const headers = source("lib/backyard-ai/server/http-security.ts");

  assert.match(route, /BACKYARD_AI_PRIVATE_HEADERS/);
  assert.match(headers, /["']cache-control["']\s*:\s*["']private,\s*no-store["']/i);
  assert.match(headers, /["']x-content-type-options["']\s*:\s*["']nosniff["']/i);
  assert.match(route, /present:[\s\S]*?nonEmptyAfterTrim:[\s\S]*?leadingWhitespace:[\s\S]*?trailingWhitespace:/);
  assert.match(route, /wrappedInMatchingQuotes[\s\S]*?containsControlCharacter[\s\S]*?containsLiteralEscapeSequence[\s\S]*?startsWithBom[\s\S]*?lengthBand:/);
  assert.match(route, /return\s+"1-7"[\s\S]*?return\s+"8-15"[\s\S]*?return\s+"16-31"[\s\S]*?return\s+"32-63"[\s\S]*?return\s+"64\+"/);
  assert.doesNotMatch(route, /characterLength|utf8ByteLength/);
});

test("temporary GHIN runtime probe uses fixed read-only targets and never exposes raw provider artifacts", () => {
  const route = source(routePath);

  assert.match(route, /GHIN_NUMBER\s*=\s*"11103349"/);
  assert.match(route, /COURSE_QUERY\s*=\s*"LA VISTA COUNTRY CLUB"/);
  assert.match(route, /client\.authenticate\(true\)/);
  assert.match(route, /client\.lookupGolfer\(GHIN_NUMBER\)/);
  assert.match(route, /client\.getScores\(GHIN_NUMBER,\s*20\)/);
  assert.match(route, /client\.searchCourses\(COURSE_QUERY,\s*20,\s*COURSE_COUNTRY,\s*COURSE_STATE\)/);
  assert.match(route, /client\.getCourse\(selected\.id\)/);
  assert.match(route, /client\.getTee\(tee\.id\)/);
  assert.doesNotMatch(route, /getTrace\(|clearTrace\(|tokenFingerprint|providerMessage|rawResponse|responseTopLevelKeys/);
  assert.doesNotMatch(route, /console\.(?:log|info|warn|error|debug)/);
  assert.doesNotMatch(route, /\.postScore\s*\(|\.(?:create|update|delete|submit)Score\s*\(/i);
  assert.doesNotMatch(route, /fetch\s*\(/);
});

test("auth matrix covers both allowlisted hosts and both safe login selectors", () => {
  const route = source(routePath);

  assert.match(route, /host:\s*"api2\.ghin\.com",\s*baseUrl:\s*"https:\/\/api2\.ghin\.com\/api\/v1"/);
  assert.match(route, /host:\s*"api\.ghin\.com",\s*baseUrl:\s*"https:\/\/api\.ghin\.com\/api\/v1"/);
  assert.match(route, /loginKind:\s*"configured_login"[\s\S]*?login:\s*credentials\.login/);
  assert.match(route, /loginKind:\s*"ghin_number"[\s\S]*?login:\s*GHIN_NUMBER/);
  assert.match(route, /new\s+GhinReadOnlyClient\([\s\S]*?credentials:\s*\{\s*login:\s*attempt\.login,\s*password:\s*credentials\.password\s*\}/);
  assert.match(route, /tokenReceived:\s*result\.authenticated/);
  assert.match(route, /tokenReceived:\s*false/);
  assert.match(route, /httpStatus:\s*result\.httpStatus/);
  assert.match(route, /httpStatus:\s*sanitized\.httpStatus/);
  assert.match(route, /timestamp/);
  assert.match(route, /message:\s*"Autenticación GHIN completada\."/);
  assert.match(route, /message:\s*sanitized\.message/);
});

test("authorized read modes return only explicitly selected normalized GHIN data", () => {
  const route = source(routePath);

  assert.match(route, /golfer:\s*\{[\s\S]*?ghinNumber:\s*result\.data\.ghinNumber[\s\S]*?name:\s*result\.data\.name[\s\S]*?club:\s*result\.data\.clubName[\s\S]*?association:\s*result\.data\.associationName[\s\S]*?handicapIndex:\s*result\.data\.handicapIndex[\s\S]*?status:\s*result\.data\.status[\s\S]*?fetchedAt:\s*result\.fetchedAt/);
  assert.match(route, /fetchedAt:\s*result\.fetchedAt/);
  assert.match(route, /scoreCount:\s*result\.data\.length/);
  assert.match(route, /scores:\s*result\.data\.slice\(0,\s*20\)\.map\(normalizedScoreView\)/);
  assert.match(route, /teeCount:\s*normalizedTees\.length/);
  assert.match(route, /course:\s*normalizedCourseView\(details\.data,\s*normalizedTees\)/);
  assert.match(route, /client\.searchCourses\(COURSE_QUERY,\s*20,\s*COURSE_COUNTRY,\s*COURSE_STATE\)/);
  assert.match(route, /COURSE_COUNTRY\s*=\s*"Mexico"/);
  assert.match(route, /COURSE_STATE\s*=\s*"Puebla"/);
  assert.doesNotMatch(route, /data:\s*result\.data[,}]/);
  assert.doesNotMatch(route, /data:\s*details\.data[,}]/);
});

test("golfer-only probe does not depend on course enablement", () => {
  const route = source(routePath);

  assert.match(route, /operation\s*===\s*"golfer_read_only"[\s\S]*?!runtimeState\.capabilities\.golferLookup/);
  assert.match(route, /operation\s*===\s*"full_read_only"\s*&&\s*!runtimeState\.capabilities\.courseLookup/);
  const golferBranch = route.slice(route.indexOf('if (operation === "golfer_read_only")'));
  assert.ok(golferBranch.indexOf("golfer,") < golferBranch.indexOf("runCourseLookup"));
  assert.ok(golferBranch.indexOf("scores,") < golferBranch.indexOf("runCourseLookup"));
});

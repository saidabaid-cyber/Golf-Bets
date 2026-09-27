import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runSpicyGhin020ReadOnlyPoc } from "../lib/ghin/spicygolf-020-poc.server";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("reproduces @spicygolf/ghin 0.20.0 Firebase login and read-only calls exactly", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    switch (calls.length) {
      case 1:
        return jsonResponse({ authToken: { token: "firebase-token-sentinel", expiresIn: "604800s" } });
      case 2:
        return jsonResponse({ golfer_user: { golfer_user_token: "golfer-token-sentinel" } });
      case 3:
        return jsonResponse({
          golfers: [{
            ghin: 11103349,
            first_name: "Sample",
            last_name: "Golfer",
            club_name: "Sample Club",
            is_home_club: true,
            hi_display: "8.1",
            status: "Active",
            rev_date: "2026-09-27",
          }],
        });
      case 4:
        return jsonResponse({
          total_count: 2,
          scores: [
            { id: 1, played_at: "2026-09-20", adjusted_gross_score: 80, differential: 8.2 },
            { id: 2, played_at: "2026-09-10", adjusted_gross_score: 81, differential: 8.4 },
          ],
        });
      default:
        throw new Error("unexpected request");
    }
  };

  const result = await runSpicyGhin020ReadOnlyPoc({
    login: "authorized@example.invalid",
    password: "not-a-real-password",
    fetchImpl,
  });

  assert.equal(calls.length, 4);
  assert.equal(
    calls[0]?.url,
    "https://firebaseinstallations.googleapis.com/v1/projects/ghin-mobile-app/installations",
  );
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    appId: "1:884417644529:web:47fb315bc6c70242f72650",
    authVersion: "FIS_v2",
    fid: "fg6JfS0U01YmrelthLX9Iz",
    sdkVersion: "w:0.5.7",
  });
  assert.equal(calls[1]?.url, "https://api2.ghin.com/api/v1/golfer_login.json");
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    token: "firebase-token-sentinel",
    user: {
      email_or_ghin: "authorized@example.invalid",
      password: "not-a-real-password",
    },
  });
  assert.equal(
    calls[2]?.url,
    "https://api2.ghin.com/api/v1/golfers/search.json?page=1&per_page=100&sorting_criteria=last_name_first_name&order=asc&golfer_id=11103349",
  );
  assert.equal(calls[2]?.init?.method, undefined);
  assert.equal(calls[3]?.url, "https://api2.ghin.com/api/v1/scores.json?golfer_id=11103349");
  assert.equal(calls[3]?.init?.method, undefined);
  assert.equal(result.firebaseSession.status, "PASS");
  assert.equal(result.golferLogin.status, "PASS");
  assert.equal(result.golferLookup.status, "PASS");
  assert.equal(result.scoresReadOnly.status, "PASS");
  assert.equal(result.scoresReadOnly.count, 2);
  assert.equal(result.safety.scorePostingCalls, 0);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /not-a-real-password|firebase-token-sentinel|golfer-token-sentinel/);
});

test("stops after Firebase failure and exposes no secret material", async () => {
  let calls = 0;
  const result = await runSpicyGhin020ReadOnlyPoc({
    login: "authorized@example.invalid",
    password: "not-a-real-password",
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ error: "rejected" }, 400);
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.firebaseSession, {
    status: "FAIL",
    httpStatus: 400,
    authTokenReceived: false,
  });
  assert.equal(result.golferLogin.status, "NOT_TESTED");
  assert.equal(result.golferLookup.status, "NOT_TESTED");
  assert.equal(result.scoresReadOnly.status, "NOT_TESTED");
  assert.doesNotMatch(JSON.stringify(result), /authorized@example\.invalid|not-a-real-password|rejected/);
});

test("the isolated POC has no environment access, logging, or score posting", () => {
  const poc = readFileSync("lib/ghin/spicygolf-020-poc.server.ts", "utf8");

  assert.match(poc, /firebaseinstallations\.googleapis\.com\/v1\/projects\/ghin-mobile-app\/installations/);
  assert.match(poc, /api2\.ghin\.com\/api\/v1/);
  assert.doesNotMatch(poc, /process\.env|NEXT_PUBLIC_/);
  assert.doesNotMatch(poc, /console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(poc, /scores(?:\/|\.json)[\s\S]{0,300}method:\s*["']POST["']/i);
  assert.doesNotMatch(poc, /(?:post|create|update|delete|submit)Score/i);
});

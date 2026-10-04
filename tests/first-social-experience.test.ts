import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as firstExperienceDomain from "../lib/round-first-experience";
import { FIRST_EXPERIENCE_METADATA_KEY, firstExperienceState, firstExperiencePrompt, resolveFirstExperience, scheduleFirstExperienceNudge, firstRoundGroupCopy } from "../lib/round-first-experience";

test("friend nudge waits five seconds and leaving Home cancels it", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let opened = 0;
  const cancel = scheduleFirstExperienceNudge("friends", () => true, () => opened++);
  context.mock.timers.tick(4999); assert.equal(opened, 0);
  cancel(); context.mock.timers.tick(1); assert.equal(opened, 0);
  scheduleFirstExperienceNudge("friends", () => true, () => opened++);
  context.mock.timers.tick(5000); assert.equal(opened, 1);
});
test("a hidden Home or another modal prevents the delayed nudge", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let eligible = true, opened = false;
  scheduleFirstExperienceNudge("friends", () => eligible, () => { opened = true; });
  eligible = false; context.mock.timers.tick(5000); assert.equal(opened, false);
  const hook = readFileSync("app/components/first-social-experience.tsx", "utf8");
  assert.match(hook, /document.visibilityState === "visible"/);
  assert.match(hook, /\[role="dialog"\]\[aria-modal="true"\]/);
});
test("friends, group and round fallback resolve separately and never repeat after a skip", () => {
  let state = firstExperienceState(null);
  const home = { home: true, setup: false, hasGroup: false };
  assert.equal(firstExperiencePrompt(state, home), "friends");
  state = resolveFirstExperience(state, "friendDiscovery", "skipped", "2026-10-03T00:00:00.000Z");
  assert.equal(firstExperiencePrompt(state, home), "group");
  state = resolveFirstExperience(state, "firstGroup", "skipped", "2026-10-03T00:01:00.000Z");
  assert.equal(firstExperiencePrompt(state, home), null);
  assert.equal(firstExperiencePrompt(state, { home: false, setup: true, hasGroup: false }), "roundGroup");
  state = resolveFirstExperience(state, "firstRoundGroup", "skipped", "2026-10-03T00:02:00.000Z");
  assert.equal(firstExperiencePrompt(firstExperienceState(JSON.parse(JSON.stringify(state))), { home: false, setup: true, hasGroup: false }), null);
  assert.throws(() => resolveFirstExperience(state, "firstRoundGroup", "pending", "now"));
});
test("existing friends/groups are not nudged; score-only never mentions betting", () => {
  const state = firstExperienceState({ version: 1, friendDiscovery: "already_has_friends", firstGroup: "already_has_group", firstRoundGroup: "not_needed" });
  assert.equal(firstExperiencePrompt(state, { home: true, setup: false, hasGroup: true }), null);
  assert.equal(firstExperiencePrompt(state, { home: false, setup: true, hasGroup: true }), null);
  assert.doesNotMatch(firstRoundGroupCopy(true), /apuestas/);
  assert.match(firstRoundGroupCopy(false), /apuestas habituales/);
});
test("stale retries cannot reopen prompts and creation preserves sibling decisions", () => {
  const skipped = resolveFirstExperience(firstExperienceState(null), "firstGroup", "skipped", "2026-10-03T00:00:00Z");
  assert.deepEqual(resolveFirstExperience(skipped, "firstGroup", "opened", "later"), skipped);
  const created = resolveFirstExperience(skipped, "firstGroup", "created", "2026-10-03T00:01:00Z");
  assert.equal(created.firstGroup, "created"); assert.equal(created.friendDiscovery, "pending");
});

function routeHarness({ complete = true, friends = false, groups = false, rounds = false, failWrite = false } = {}) {
  const metadata: Record<string, unknown> = { untouched: { keep: true } };
  const ownId = "own-verified-id";
  let writes = 0;
  const tableData: Record<string, unknown> = { profiles: { onboarding_completed_at: complete ? "2026-10-03" : null }, friendships: friends ? [{ id: "friend" }] : [], frequent_groups_cloud: [], groups_v2: groups ? [{ default_template: { name: "Group", players: [{ name: "Player" }] } }] : [], rounds_cloud: rounds ? [{ snapshot: { lifecycleState: "completed" } }] : [] };
  const client = { from(table: string) {
    const query = { select() { return query; }, eq(column: string, id: string) { assert.equal(id, ownId); return query; }, or(filter: string) { assert.match(filter, /own-verified-id/); return query; }, limit() { return query; }, maybeSingle() { return query; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: tableData[table], error: null }).then(resolve); } };
    return query;
  }, auth: { getUser: async () => ({ data: { user: { id: ownId, user_metadata: metadata } }, error: null }) } };
  const exports: Record<string, unknown> = {};
  const source = ts.transpileModule(readFileSync("app/api/social/first-experience/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(source, { exports, Response, Request, URL, AbortSignal, Date, process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://bymeopxkxapfizeeqeyb.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test" } },
    fetch: async (_url: URL, init: RequestInit) => { writes++; assert.equal(init.method, "PUT"); const body = JSON.parse(init.body as string); assert.deepEqual(Object.keys(body.data), [FIRST_EXPERIENCE_METADATA_KEY]); if (!failWrite) Object.assign(metadata, body.data); return new Response(null, { status: failWrite ? 503 : 200 }); },
    require: (id: string) => {
      if (id.endsWith("/server-auth")) return { authenticatedRequest: async (request: Request) => request.headers.get("authorization") === "Bearer test-token" ? { ok: true, client, token: "test-token", userId: ownId, userMetadata: metadata } : { ok: false, status: 401, error: "Auth" } };
      if (id.endsWith("/social-http.server")) return { socialBody: (request: Request) => request.json() };
      if (id.endsWith("/http-security")) return { isCrossSiteRequest: (request: Request) => request.headers.get("sec-fetch-site") === "cross-site" };
      if (id.endsWith("/preview-database")) return { isolatedPreviewDatabaseEnabled: () => true };
      if (id.endsWith("/onboarding-checkpoint")) return { onboardingCheckpoint: () => null, ONBOARDING_CHECKPOINT_KEY: "checkpoint" };
      if (id.endsWith("/round-first-experience")) return firstExperienceDomain;
      throw new Error(`Unexpected boundary ${id}`);
    } });
  return { api: exports as { GET: (request: Request) => Promise<Response>; PUT: (request: Request) => Promise<Response> }, metadata, writes: () => writes };
}
const request = (body?: unknown, token = "test-token") => new Request("https://dev.thebackyard.com.mx/api/social/first-experience", { method: body ? "PUT" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
test("account state persists, reads back in a fresh session, and preserves unrelated metadata", async () => {
  const h = routeHarness();
  assert.equal((await (await h.api.GET(request())).json()).state.friendDiscovery, "pending");
  assert.equal((await h.api.PUT(request({ field: "friendDiscovery", value: "opened" }))).status, 200);
  assert.equal((await h.api.PUT(request({ field: "firstGroup", value: "skipped" }))).status, 200);
  const fresh = await (await h.api.GET(request())).json();
  assert.equal(fresh.state.friendDiscovery, "opened"); assert.equal(fresh.state.firstGroup, "skipped");
  assert.deepEqual(h.metadata.untouched, { keep: true });
});
test("account UX rejects foreign selectors, reset attempts, incomplete onboarding and unconfirmed groups", async () => {
  const h = routeHarness();
  for (const body of [{ field: "firstGroup", value: "opened", userId: "foreign" }, { field: "friendDiscovery", value: "pending" }]) assert.equal((await h.api.PUT(request(body))).status, 400);
  assert.equal((await h.api.PUT(request({ field: "firstGroup", value: "created" }))).status, 409);
  assert.equal((await h.api.GET(request(undefined, "wrong"))).status, 401);
  assert.equal((await routeHarness({ complete: false }).api.PUT(request({ field: "friendDiscovery", value: "opened" }))).status, 409);
  assert.equal(h.writes(), 0);
  assert.equal((await routeHarness({ failWrite: true }).api.PUT(request({ field: "friendDiscovery", value: "skipped" }))).status, 503);
});
test("existing friends/groups and completed rounds are resolved server-side", async () => {
  const h = routeHarness({ friends: true, groups: true, rounds: true });
  const state = (await (await h.api.GET(request())).json()).state;
  assert.equal(state.friendDiscovery, "already_has_friends"); assert.equal(state.firstGroup, "already_has_group"); assert.equal(state.firstRoundGroup, "not_needed");
  assert.equal(h.writes(), 1);
});
test("first-experience wiring preserves the round and reuses existing friends, QR and GroupBuilder", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const close = page.split("async function closeFirstExperienceGroupEditor()")[1].split("\n  }")[0];
  assert.doesNotMatch(close, /resetRound|applyNewRoundIntent|setPlayers|setCourse|setBets|setScores/);
  assert.match(close, /setTab\(context.tab\)/);
  assert.match(page, /if \(await firstSocialExperience.resolve\("friendDiscovery", "opened"\)\) openCareerFriends\(\)/);
  assert.match(page, /<GroupBuilder/);
  const social = readFileSync("app/components/social-feed.tsx", "utf8");
  assert.match(social, /onOpenFriends/);
  const friends = readFileSync("app/components/social-connections-panel.tsx", "utf8");
  assert.match(friends, /<PersonalQr/); assert.match(friends, /<SocialQrScanner/);
});
test("nearby discovery returns only public club identities, with the existing card privacy gate", () => {
  const source = readFileSync("app/api/social/connections/route.ts", "utf8");
  const nearby = source.split('searchParams.get("discovery")')[1].split('const target =')[0];
  assert.match(nearby, /eq\("privacy","PUBLIC"\)/); assert.match(nearby, /neq\("user_id",ctx.userId\)/);
  assert.match(nearby, /profile\(ctx,row.user_id\)/);
  assert.doesNotMatch(nearby, /email|latitude|longitude|coordinates|distance|address|\.from\("profiles"\)/);
  assert.match(nearby, /area_label:"Mismo club"/);
});

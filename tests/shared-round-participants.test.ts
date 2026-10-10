import assert from "node:assert/strict";
import test from "node:test";
import { linkedRoundPlayers, participantCard } from "../lib/shared-round-participants";
import { attributableHistory, personalRoundPerspective } from "../lib/participant-history";
import { createEmptyGroupGameTemplate, instantiateGroupGameTemplate, validateGroupRoundSelection } from "../lib/group-game-template";
import { firstExperiencePrompt, firstExperienceState } from "../lib/round-first-experience";
import type { FrequentGroup, RoundSnapshot } from "../lib/types";
import { patchGroupTemplateCore } from "../lib/group-template-editor";
import { parseFrequentGroups, serializeFrequentGroups } from "../lib/frequent-templates";
import { roundMaterialFingerprint } from "../lib/round-achievements";
import { writeVersionedRow } from "../lib/cloud-write";
import { CloudDb } from "./helpers/cloud-db";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import { finalizeOwnerRound } from "../lib/owner-round-finalize";
import { cancellationMaterial } from "../lib/owner-round-cancel";
import { preserveRoundStatisticsOrigin } from "../lib/statistics-reset";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
test("withheld notification privileges preserve card access without bypassing preferences", async () => {
  const snapshot = { ...round(), lifecycleState: "live" }, updates: string[] = [];
  const chain = (result: unknown) => {
    const value: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit"]) value[method] = () => value;
    value.then = (resolve: (result: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return value;
  };
  const client = { from: (table: string) => {
    if (table === "rounds_cloud") return chain({ data: [{ id: "cloud-one", version: 1, snapshot }], error: null });
    if (table === "live_round_operations_v2") return chain({ data: [], error: null });
    assert.equal(table, "round_participants_v2");
    const value = chain({ data: [{ id: "pa", user_id: A }, { id: "pb", user_id: B }], error: null });
    value.update = (patch: { player_key: string }) => { updates.push(patch.player_key); return chain({ error: null }); };
    return value;
  } };
  // No audit write needed for this empty live card.
  snapshot.scores = {};
  const admin = { from: (table: string) => { assert.equal(table, "notification_preferences_v2"); return chain({ data: null, error: { code: "42501" } }); } };
  const output = ts.transpileModule(readFileSync("lib/shared-round-participants.server.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  runInNewContext(output, { exports, require: (name: string) => name === "server-only" ? {} : name === "node:crypto" ? {} : name === "./supabase/server" ? { getSupabaseAdmin: () => admin } : name === "./shared-round-participants" ? { linkedRoundPlayers } : {}, Map, Set });
  assert.deepEqual(JSON.parse(JSON.stringify(await exports.syncSharedRoundParticipants(client, A, [snapshot.id]))), { notifications: "BLOCKED_EXTERNAL_NOTIFICATION_PERMISSIONS" });
  assert.deepEqual(updates, ["a", "b"]);
});
test("clearing a committed score records the authenticated author and is retry-safe", async () => {
  const snapshot = round(); snapshot.scores = {};
  let previousScore: number | null = 5;
  const captured: Array<{ actor_id: string; player_key: string; payload: { score: number | null }; resulting_version: number }> = [];
  const client = { from: (table: string) => {
    assert.equal(table, "live_round_operations_v2");
    const value: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) value[method] = () => value;
    value.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [{ player_key: "b", hole: 1, payload: { score: previousScore } }], error: null }).then(resolve);
    value.upsert = async (rows: typeof captured) => { captured.push(...rows); previousScore = rows[0].payload.score; return { error: null }; };
    return value;
  } };
  const output = ts.transpileModule(readFileSync("lib/shared-round-participants.server.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  runInNewContext(output, { exports, require: (name: string) => name === "node:crypto" ? { createHash } : {}, Map, Set });
  await exports.auditOwnerScores(client, A, { id: "cloud-one", version: 2, snapshot });
  await exports.auditOwnerScores(client, A, { id: "cloud-one", version: 2, snapshot });
  assert.equal(captured.length, 1); assert.equal(captured[0].actor_id, A); assert.equal(captured[0].player_key, "b");
  assert.equal(captured[0].payload.score, null); assert.equal(captured[0].resulting_version, 2);
});
function round(): RoundSnapshot {
  return { id: "local-one", date: "2026-10-04", courseName: "QA catalog course", teeName: "QA catalog tee", lifecycleState: "completed", completedAt: "2026-10-04T12:00:00Z",
    ownerId: "a", ownerName: "A", players: [{ id: "a", name: "A", handicap: 5, accountUserId: A }, { id: "b", name: "B", handicap: 15, accountUserId: B }, { id: "guest", name: "Juan Guest", handicap: 14 }],
    order: [1, 2, 3], scores: { 1: { a: 4, b: 5, guest: 6 }, 2: { a: 3, b: 4, guest: 5 }, 3: { a: 5, b: 6, guest: 4 } }, playerBalances: { a: 100, b: -100, guest: 0 },
    betResult: 100, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 0, netResult: 100, categoryResults: {}, scorekeeping: { version: 1, mode: "owner" } };
}
function group(): FrequentGroup {
  const result: FrequentGroup = { id: "large-recurring-group", name: "Miércoles", privacy: "private", uses: 0, updatedAt: "2026-10-04T12:00:00Z", players: Array.from({ length: 12 }, (_, index) => ({ memberId: `m${index}`, name: `Jugador ${index}`, handicap: index + 5,
    ...(index < 2 ? { accountUserId: index === 0 ? A : B } : {}) })) };
  result.gameTemplate = patchGroupTemplateCore(createEmptyGroupGameTemplate(result), "foursome", { enabled: true, mode: "fixed", fixedValue: 200, segmentSize: 6 });
  return result;
}

test("first canonical completion retains its instant even when an earlier client cached the live card as history", () => {
  const completed = round();
  const live = { ...completed, lifecycleState: "live" as const, completedAt: undefined };
  assert.equal(preserveRoundStatisticsOrigin(completed, live).completedAt, completed.completedAt);
  assert.equal(preserveRoundStatisticsOrigin(completed, { ...live, lifecycleState: "completed" }).completedAt, completed.completedAt);
  const legacy = { ...completed, scorekeeping: undefined, completedAt: undefined };
  assert.equal(preserveRoundStatisticsOrigin(completed, legacy).completedAt, undefined, "old date-only historical records keep their original semantics");
});

test("historical participant UI gates personal achievement badges and refreshes canonical proof after self-confirmation", () => {
  const detail = readFileSync("app/components/historical-round-detail.tsx", "utf8");
  assert.match(detail, /attributableHistory\(\[round\], accountUserId\)\.length > 0 && <RoundAchievementSummary/);
  assert.match(detail, /<RoundParticipationCard[^\n]*onConfirmed=\{onParticipantConfirmed\}/);
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /<HistoricalRoundDetail[^\n]*onParticipantConfirmed=\{refreshConfirmedSharedHistory\}/);
  const refresh = page.slice(page.indexOf("async function refreshConfirmedSharedHistory()"), page.indexOf("function openHistoricalRound("));
  assert.match(refresh, /withCloudAuthRetry\(downloadCloudData/);
  assert.match(refresh, /liveIdentity\.current\.userId !== actor\.userId/);
  assert.match(refresh, /canonical\.history\.filter\(round => round\.cloudReadOnly\)/);
  assert.doesNotMatch(refresh, /cloudParticipant\s*:/, "UI never invents confirmation proof");
});
test("12-member recurring roster serializes while today's outing remains at most five", () => {
  const saved = parseFrequentGroups(serializeFrequentGroups([group()]))[0];
  assert.equal(saved.players.length, 12);
  assert.equal(validateGroupRoundSelection(saved, saved.players.slice(0, 6).map(member => member.memberId!)).ok, false);
  const today = instantiateGroupGameTemplate(saved, () => crypto.randomUUID(), ["m0", "m1", "m2", "m3"]);
  assert.equal(today.players.length, 4); assert.equal(saved.players.length, 12);
  assert.equal(today.players.filter(player => player.accountUserId).length, 2);
  assert.equal(today.players.filter(player => !player.accountUserId).length, 2);
  assert.equal(today.origin.groupId, saved.id);
});
test("a non-playing organizer keeps the canonical card without acquiring personal stats", () => {
  const snapshot = round(); snapshot.scorekeeping = { version: 1, mode: "owner", organizerAccountUserId: C };
  assert.equal(attributableHistory([snapshot], C).length, 0);
  assert.equal(personalRoundPerspective(snapshot), null);
  snapshot.scorekeeping.organizerAccountUserId = A;
  assert.equal(attributableHistory([snapshot], A).length, 1);
  assert.equal(personalRoundPerspective(snapshot), snapshot);
  snapshot.ownerId = "b"; snapshot.betResult = -100;
  const source = JSON.stringify(snapshot), own = attributableHistory([snapshot], A)[0];
  assert.equal(own.ownerId, "a"); assert.equal(own.betResult, 100);
  assert.equal(JSON.stringify(snapshot), source);
});
test("runtime stake changes and later template edits do not mutate each other's snapshots", () => {
  const saved = group(), before = JSON.stringify(saved);
  const today = instantiateGroupGameTemplate(saved, () => crypto.randomUUID(), ["m0", "m1", "m2", "m3"]);
  today.bets.foursome.fixedValue = 300; assert.equal(JSON.stringify(saved), before);
  saved.gameTemplate!.betConfig.foursome.fixedValue = 250;
  assert.equal(today.bets.foursome.fixedValue, 300); assert.equal(saved.gameTemplate!.betConfig.foursome.fixedValue, 250);
});
test("same account under different names cannot obtain two shared identities", () => {
  const snapshot = round(); snapshot.players!.push({ id: "other-label", name: "Different", handicap: 5, accountUserId: B });
  assert.throws(() => linkedRoundPlayers(snapshot), /DUPLICATE_ROUND_ACCOUNT/);
});
test("same player key cannot identify two people", () => {
  const snapshot = round(); snapshot.players!.push({ id: "b", name: "Different", handicap: 5 });
  assert.throws(() => linkedRoundPlayers(snapshot), /DUPLICATE_ROUND_PLAYER/);
});
test("guest names never turn into account links", () => {
  assert.deepEqual(linkedRoundPlayers(round()).map(player => player.accountUserId), [A, B]);
  const card = participantCard("cloud-one", A, 1, "hash", round(), B, new Set());
  assert.equal(card.players[2].status, "GUEST"); assert.equal(card.players[2].accountUserId, null);
});
test("private participant card projects the right scores and only the viewer's balance", () => {
  const snapshot = round();
  const card = participantCard("cloud-one", A, 1, "hash", snapshot, B, new Set());
  assert.equal(card.myPlayerKey, "b"); assert.equal(card.myBalance, -100);
  assert.equal(card.players.find(player => player.playerKey === "b")?.score, 15);
  assert.deepEqual(card.players[1].scorecard.map(hole => hole.score), [5, 4, 6]);
  assert.equal("expenses" in card, false); assert.equal("playerBalances" in card, false);
});
test("outsider cannot read or claim a canonical private card", () => {
  assert.throws(() => participantCard("cloud-one", A, 1, "hash", round(), C, new Set()), /PARTICIPANT_NOT_LINKED/);
});
test("unconfirmed account is reviewable but excluded from personal attribution", () => {
  const snapshot = round(); const card = participantCard("cloud-one", A, 1, "hash", snapshot, B, new Set());
  assert.equal(card.canConfirm, true); assert.equal(card.players[1].status, "PENDING_CONFIRMATION");
  const shared = { ...snapshot, id: "shared:cloud-one", cloudReadOnly: true as const, cloudRoundId: "cloud-one", cloudSourceLocalId: snapshot.id };
  assert.deepEqual(attributableHistory([shared], B), []); assert.equal(personalRoundPerspective(shared), null);
});
test("self-confirmed proof attributes the canonical player's score and balance once", () => {
  const source = round(); const shared = { ...source, id: "shared:cloud-one", cloudReadOnly: true as const, cloudRoundId: "cloud-one", cloudSourceLocalId: source.id, cloudParticipant: { accountUserId: B, playerId: "b" } };
  assert.equal(attributableHistory([shared], B).length, 1); assert.equal(personalRoundPerspective(shared)?.betResult, -100);
  assert.equal(personalRoundPerspective(shared)?.ownerId, "b");
  assert.equal(participantCard("cloud-one", A, 2, "hash", source, B, new Set([B])).canConfirm, false);
});
test("live scorekeeper card never claims confirmation or GHIN posting", () => {
  const snapshot = round(); snapshot.lifecycleState = "live"; delete snapshot.completedAt;
  const card = participantCard("cloud-one", A, 1, "", snapshot, B, new Set());
  assert.equal(card.completed, false); assert.equal(card.canConfirm, false); assert.equal(card.myBalance, null);
  assert.deepEqual(card.ghin, { canPostOwnScore: false, canPostScoreForAnotherUser: false });
});
test("an incomplete scorecard never invents a final total", () => {
  const snapshot = round(); delete snapshot.scores![2].b;
  assert.equal(participantCard("cloud-one", A, 1, "hash", snapshot, B, new Set()).players[1].score, null);
});
test("first round group nudge waits until Friends experience has resolved", () => {
  const state = firstExperienceState({});
  assert.equal(firstExperiencePrompt(state, { home: false, setup: true, hasGroup: false }), null);
  assert.equal(firstExperiencePrompt({ ...state, friendDiscovery: "skipped" }, { home: false, setup: true, hasGroup: false }), "roundGroup");
  assert.equal(firstExperiencePrompt({ ...state, friendDiscovery: "opened" }, { home: false, setup: true, hasGroup: true }), null);
});
test("same round changes its material hash when a participant's score changes", async () => {
  const source = round(); source.roundHoles = 18;
  source.order = Array.from({ length: 18 }, (_, index) => index + 1);
  source.courseSnapshot = { id: "qa-course", name: "QA", teeName: "QA", holes: source.order.map(number => ({ number, par: 4, strokeIndex: number })) };
  source.scores = Object.fromEntries(source.order.map(hole => [hole, { a: 4, b: 5, guest: 6 }]));
  const before = await roundMaterialFingerprint(source, A); assert.ok(before);
  source.scores![1].b = 7;
  assert.notEqual(await roundMaterialFingerprint(source, A), before);
});
test("owner cloud CAS rejects a concurrent revision rather than acknowledging lost updates", async () => {
  const db = new CloudDb(); db.rows("rounds_cloud").push({ owner_id: A, local_id: "one", updated_at: "2026-10-04T10:00:00Z" });
  db.before = (table, operation) => { if (table === "rounds_cloud" && operation === "update") db.rows("rounds_cloud")[0].updated_at = "2026-10-04T12:00:00Z"; };
  await assert.rejects(writeVersionedRow(db.client, "rounds_cloud", { owner_id: A, local_id: "one" }, { owner_id: A, local_id: "one", updated_at: "2026-10-04T11:00:00Z" }));
});
test("finalized shared card cannot be stranded behind the last queued live timestamp", async () => {
  const db = new CloudDb(), completed = round();
  db.rows("rounds_cloud").push({ owner_id: A, local_id: "one", updated_at: "2026-10-04T12:00:01Z", snapshot: { ...completed, lifecycleState: "live" } });
  assert.equal(await writeVersionedRow(db.client, "rounds_cloud", { owner_id: A, local_id: "one" }, { owner_id: A, local_id: "one", updated_at: "2026-10-04T12:00:00Z", snapshot: completed }), true);
  assert.equal((db.rows("rounds_cloud")[0].snapshot as RoundSnapshot).lifecycleState, "completed");
});

function ownerRoute(db: CloudDb, userId = A) {
  const exported: Record<string, (request: Request) => Promise<Response>> = {};
  const client = { ...db.client, auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) } };
  const code = ts.transpileModule(readFileSync("app/api/cloud/rounds/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports: exported, URL, Date, require: (name: string) => {
    if (name === "next/server") return { NextResponse: Response };
    if (name.endsWith("/supabase/server")) return { getSupabaseForUser: () => client };
    if (name.endsWith("/auth-errors")) return { authUserFailure: () => null };
    if (name.endsWith("/social-publication.server")) return { scheduleSocialPublication: () => {} };
    if (name.endsWith("/social-publication-policy")) return { hasCompletedRoundPublicationCandidate: () => false };
    if (name.endsWith("/cloud-sync-service")) return {};
    if (name.endsWith("/pending-round-recovery")) return {};
    if (name.endsWith("/shared-round-participants.server")) return { syncSharedRoundParticipants: async () => {} };
    if (name.endsWith("/shared-round-participants")) return { linkedRoundPlayers };
    if (name.endsWith("/owner-round-cancel")) return { cancellationMaterial };
    throw new Error(name);
  } });
  return exported;
}
function put(round: RoundSnapshot, expectedVersion: number) { return new Request("https://qa.invalid/api/cloud/rounds", { method: "PUT", headers: { authorization: "Bearer synthetic", "content-type": "application/json" }, body: JSON.stringify({ round, expectedVersion }) }); }
test("live route rejects stale revision without changing any score", async () => {
  const db = new CloudDb(), snapshot = round(); snapshot.lifecycleState = "live"; delete snapshot.completedAt;
  db.rows("rounds_cloud").push({ id: "canonical", owner_id: A, local_id: snapshot.id, version: 2, snapshot });
  const edit = structuredClone(snapshot); edit.scores![1].b = 8;
  const response = await ownerRoute(db).PUT(put(edit, 1)); assert.equal(response.status, 409);
  assert.equal((db.rows("rounds_cloud")[0].snapshot as RoundSnapshot).scores![1].b, 5);
});
test("participant cannot use owner transport to edit their own or anyone else's score", async () => {
  const db = new CloudDb(), snapshot = round(); snapshot.lifecycleState = "live";
  db.rows("rounds_cloud").push({ id: "canonical", owner_id: A, local_id: snapshot.id, version: 1, snapshot });
  assert.equal((await ownerRoute(db, B).PUT(put(snapshot, 1))).status, 404);
  assert.equal(db.calls.some(call => call.op === "update"), false);
});
test("owner transport captures all selected player keys in the same canonical row", async () => {
  const db = new CloudDb(), snapshot = round(); snapshot.lifecycleState = "live"; delete snapshot.completedAt;
  db.rows("rounds_cloud").push({ id: "canonical", owner_id: A, local_id: snapshot.id, version: 1, snapshot: structuredClone(snapshot) });
  snapshot.scores![1] = { a: 3, b: 6, guest: 7 };
  assert.equal((await ownerRoute(db).PUT(put(snapshot, 1))).status, 200);
  assert.equal(db.rows("rounds_cloud").length, 1); assert.deepEqual((db.rows("rounds_cloud")[0].snapshot as RoundSnapshot).scores![1], { a: 3, b: 6, guest: 7 });
});
test("owner live transport cannot reopen or overwrite a completed historical round", async () => {
  const db = new CloudDb(), snapshot = round();
  db.rows("rounds_cloud").push({ id: "canonical", owner_id: A, local_id: snapshot.id, version: 1, snapshot });
  const edit = structuredClone(snapshot); edit.lifecycleState = "live";
  assert.equal((await ownerRoute(db).PUT(put(edit, 1))).status, 409);
  assert.equal((db.rows("rounds_cloud")[0].snapshot as RoundSnapshot).lifecycleState, "completed");
});

test("owner closes the same canonical live row once with its revision, without touching other historical rows", async () => {
  const db = new CloudDb(), completed = round(), live = { ...completed, lifecycleState: "live" as const, completedAt: undefined };
  db.rows("rounds_cloud").push({ id: "canonical", owner_id: A, local_id: live.id, version: 3, snapshot: live },
    { id: "old-card", owner_id: A, local_id: "old-card", version: 1, snapshot: { ...completed, id: "old-card" } });
  const old = structuredClone(db.rows("rounds_cloud")[1]);
  assert.equal((await ownerRoute(db).PUT(put(completed, 2))).status, 409);
  assert.equal((await ownerRoute(db).PUT(put(completed, 3))).status, 200);
  assert.equal(db.rows("rounds_cloud").length, 2);
  assert.equal((db.rows("rounds_cloud")[0].snapshot as RoundSnapshot).lifecycleState, "completed");
  assert.deepEqual(db.rows("rounds_cloud")[1], old);
  assert.equal((await ownerRoute(db).PUT(put(completed, 3))).status, 409, "a completed canonical card cannot be written again");
});

test("finalize client never adopts a freshly fetched revision to overwrite an unseen owner edit", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const key = `backyard-owner-round-revision:${A}:${round().id}`; storage.setItem(key, "2");
  const calls: RequestInit[] = [];
  const request: typeof fetch = async (_input, init) => {
    calls.push(init || {});
    return Response.json({ data: { id: "canonical", version: 3, snapshot: { ...round(), lifecycleState: "live" } } });
  };
  await assert.rejects(finalizeOwnerRound(round(), A, "synthetic", storage, request), /revisión de nube cambió/);
  assert.equal(calls.length, 1); assert.equal(calls[0].method, undefined);
  storage.setItem(key, "3"); calls.length = 0;
  const success: typeof fetch = async (input, init) => {
    calls.push(init || {});
    if (String(input).includes("?")) return request(input, init);
    const body = JSON.parse(String(init?.body)); assert.equal(body.expectedVersion, 3);
    assert.equal(body.round.lifecycleState, "completed");
    return Response.json({ roundId: "canonical", version: 4, delivery: { notifications: "BLOCKED_EXTERNAL_NOTIFICATION_PERMISSIONS" } });
  };
  assert.equal((await finalizeOwnerRound(round(), A, "synthetic", storage, success)).roundId, "canonical");
  assert.equal(storage.getItem(key), "4");
  assert.equal(calls.filter(call => call.method === "PUT").length, 1);
});

test("completed card finalize retry verifies material and never rewrites the canonical historical row", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => key.endsWith(":ack") ? values.get(key) || null : "4",
    setItem: (key: string, value: string) => { assert.ok(key.endsWith(":ack"), "checking a closed card must not adopt a fresh owner revision"); values.set(key, value); } };
  let calls = 0;
  const snapshot = round();
  snapshot.roundHoles = 18;
  snapshot.order = Array.from({ length: 18 }, (_, index) => index + 1);
  snapshot.courseSnapshot = { id: "qa-course", name: snapshot.courseName, teeName: snapshot.teeName,
    holes: snapshot.order.map(number => ({ number, par: 4, strokeIndex: number })) };
  snapshot.scores = Object.fromEntries(snapshot.order.map(number => [number, { a: 4, b: 5, guest: 6 }]));
  const request: typeof fetch = async (_input, init) => {
    calls += 1; assert.equal(init?.method, undefined);
    return Response.json({ data: { id: "canonical", version: 4, snapshot } });
  };
  assert.equal((await finalizeOwnerRound(snapshot, A, "synthetic", storage, request)).alreadyCompleted, true);
  assert.equal(calls, 1);
  assert.equal((await finalizeOwnerRound(snapshot, A, "synthetic", storage, request)).alreadyCompleted, true);
  assert.equal(calls, 1, "an unchanged closed-card remount uses its material ACK");
  const modified = structuredClone(snapshot); modified.scores![1].a = 8;
  await assert.rejects(finalizeOwnerRound(modified, A, "synthetic", storage, request), /ya está cerrada/);
});

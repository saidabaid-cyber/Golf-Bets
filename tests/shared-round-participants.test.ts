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

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
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
    if (name.endsWith("/shared-round-participants.server")) return { syncSharedRoundParticipants: async () => {} };
    if (name.endsWith("/shared-round-participants")) return { linkedRoundPlayers };
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

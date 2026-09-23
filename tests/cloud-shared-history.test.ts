import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { CloudDb } from "./helpers/cloud-db";
import { readCloudBundle, readCloudRoundHistory, writeCloudBundle } from "../lib/cloud-sync-service";
import { findAmbiguousCloudConflicts, mergeLocalAndCloud, type CloudDataBundle } from "../lib/cloud-sync";
import { buildGolfInsights } from "../lib/golf-insights";
import { buildBalanceLedger } from "../lib/balance-ledger";
import { canEditSnapshot, restoreRoundSnapshot } from "../lib/round-editing";
import { initialBets } from "../lib/new-round-bets";
import { calculateBackyardIndex } from "../lib/backyard-index";
import { attributableHistory } from "../lib/participant-history";
import { roundsEligibleForStatistics } from "../lib/statistics-reset";
import type { RoundSnapshot } from "../lib/types";

const A = "user-a", B = "user-b", SHARED_DB_ID = "11111111-1111-4111-8111-111111111111";
const time = "2026-09-16T12:00:00.000Z";
function card(owner: "a" | "b", id = "same-local-id"): RoundSnapshot {
  const players = [{ id: "a", name: "A", accountUserId: A, handicap: 0 }, { id: "b", name: "B", accountUserId: B, handicap: 0 }];
  const holes = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 }));
  return { id, date: "2026-09-16", lifecycleState: "completed", completedAt: time, updatedAt: time,
    ownerId: owner, ownerName: owner.toUpperCase(), courseName: "QA synthetic", teeName: "QA",
    roundHoles: 18, startHole: 1, players, scores: Object.fromEntries(holes.map(hole => [hole.number, { a: 4, b: 5 }])),
    order: holes.map(hole => hole.number), courseSnapshot: { id: "qa-course", name: "QA synthetic", teeName: "QA", holes },
    betConfig: initialBets(["a", "b"]), playerBalances: { a: 100, b: -100 },
    betResult: owner === "a" ? 100 : -100, netResult: owner === "a" ? 100 : -100,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 0, categoryResults: {} };
}
function fixtures() {
  const db = new CloudDb();
  db.rows("rounds_cloud").push(
    { id: SHARED_DB_ID, owner_id: null, local_id: "same-local-id", local_round_id: "same-local-id", snapshot: card("a"), updated_at: time },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", owner_id: B, local_id: "same-local-id", local_round_id: "same-local-id", snapshot: card("b"), updated_at: time },
    { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", owner_id: "private-third-user", local_id: "unrelated", snapshot: card("a", "unrelated"), updated_at: time },
  );
  db.rows("round_participants_v2").push({ round_id: SHARED_DB_ID, user_id: B });
  return db;
}

test("participant history preserves owner-null shared card and avoids same-local-ID collision without rewriting canonical snapshot", async () => {
  const db = fixtures(), before = structuredClone(db.rows("rounds_cloud"));
  const history = await readCloudRoundHistory(db.client, B);
  assert.equal(history.length, 2);
  const shared = history.find(round => round.cloudReadOnly)!;
  assert.equal(shared.id, `shared:${SHARED_DB_ID}`);
  assert.equal(shared.cloudSourceLocalId, "same-local-id");
  assert.equal(shared.cloudRoundId, SHARED_DB_ID);
  assert.equal(shared.ownerId, "a");
  assert.deepEqual(shared.playerBalances, { a: 100, b: -100 });
  assert.deepEqual(shared.scores?.[1], { a: 4, b: 5 });
  assert.equal(history.find(round => !round.cloudReadOnly)?.ownerId, "b");
  assert.deepEqual(db.rows("rounds_cloud"), before);
  assert.deepEqual(await readCloudRoundHistory(db.client, "not-a-participant"), []);
});

test("two full sync/reload cycles do not copy shared history into B ownership, projections or import ledger", async () => {
  const db = fixtures(), canonical = structuredClone(db.rows("rounds_cloud")[0]);
  for (let cycle = 0; cycle < 2; cycle++) {
    const downloaded = await readCloudBundle(db.client, B, true);
    const reloaded = JSON.parse(JSON.stringify(downloaded)) as CloudDataBundle;
    await writeCloudBundle(db.client, B, { data: reloaded, fingerprint: `cycle-${cycle}` }, { extendedSchema: true });
    const next = await readCloudBundle(db.client, B, true);
    assert.equal(next.history.length, 2);
    assert.equal(next.history.filter(round => round.cloudReadOnly).length, 1);
    assert.equal(db.rows("rounds_cloud").filter(row => row.owner_id === B).length, 1);
    assert.deepEqual(db.rows("rounds_cloud").find(row => row.id === SHARED_DB_ID), canonical);
    assert.equal(db.rows("round_players_cloud").some(row => row.round_id === SHARED_DB_ID), false);
    assert.deepEqual(db.rows("account_data_migrations").find(row => row.local_fingerprint === `cycle-${cycle}`)?.imported_round_ids, ["same-local-id"]);
  }
});

test("canonical shared anonymization wins over newer cached PII without conflict or local copy resurrection", async () => {
  const db = fixtures(), local = JSON.parse(JSON.stringify(await readCloudBundle(db.client, B))) as CloudDataBundle;
  const cached = local.history.find(round => round.cloudReadOnly)!;
  cached.ownerName = "STALE NAME";
  cached.updatedAt = "2099-01-01T00:00:00.000Z";
  cached.players![0].name = "STALE NAME";
  const source = db.rows("rounds_cloud")[0].snapshot as RoundSnapshot;
  source.ownerName = "Jugador eliminado";
  source.players![0].name = "Jugador eliminado";
  source.players![0].accountUserId = undefined;
  const remote = await readCloudBundle(db.client, B);
  assert.deepEqual(findAmbiguousCloudConflicts(local, remote), []);
  const merged = mergeLocalAndCloud(local, remote);
  assert.equal(merged.history.find(round => round.cloudReadOnly)?.ownerName, "Jugador eliminado");
  assert.equal(JSON.stringify(merged).includes("STALE NAME"), false);
  await writeCloudBundle(db.client, B, { data: local, fingerprint: "stale-cache" });
  assert.equal((db.rows("rounds_cloud")[0].snapshot as RoundSnapshot).ownerName, "Jugador eliminado");
});

test("revoked participant access removes cached shared card instead of importing it on next sync", async () => {
  const db = fixtures(), old = await readCloudBundle(db.client, B);
  db.tables.round_participants_v2 = [];
  const current = await readCloudBundle(db.client, B);
  const merged = mergeLocalAndCloud(old, current);
  assert.equal(merged.history.length, 1);
  assert.equal(merged.history.some(round => round.cloudReadOnly), false);
  await writeCloudBundle(db.client, B, { data: old, fingerprint: "revoked-cache" });
  assert.equal(db.rows("rounds_cloud").filter(row => row.owner_id === B).length, 1);
});

test("A72 shared view never becomes B personal score; B90 own card and complete historical ledger remain intact", async () => {
  const db = fixtures(), history = await readCloudRoundHistory(db.client, B);
  assert.equal(buildGolfInsights([card("a")]).averageScore, 72);
  assert.equal(buildGolfInsights([card("b")]).averageScore, 90);
  assert.equal(buildGolfInsights(history).averageScore, 90);
  assert.equal(buildGolfInsights(history).scoredRounds, 1);
  assert.equal(buildGolfInsights(history.filter(round => round.cloudReadOnly)).scoredRounds, 0);
  assert.equal(calculateBackyardIndex(history.filter(round => round.cloudReadOnly), B).records.length, 0);
  const ledger = buildBalanceLedger(history.filter(round => round.cloudReadOnly));
  assert.equal(ledger.rounds.length, 1);
  assert.deepEqual(ledger.rounds[0].balances.map(item => item.amount), [100, -100]);
  const personalLedger = buildBalanceLedger(history.filter(round => !round.cloudReadOnly && !round.id.startsWith("shared:")));
  assert.deepEqual(personalLedger, buildBalanceLedger([card("b")]));
  assert.equal(canEditSnapshot(card("b")), true);
  const shared = history.find(round => round.cloudReadOnly)!;
  assert.equal(canEditSnapshot(shared), false);
  assert.equal(restoreRoundSnapshot(shared), null);
  assert.equal(canEditSnapshot({ ...shared, cloudReadOnly: undefined }), false, "reserved namespace cannot be made editable by dropping marker");
});

test("shared history UI disables photo/delete and only confirmed views enter personal balances", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /if \(!file \|\| round\.cloudReadOnly \|\| round\.id\.startsWith\("shared:"\)\) return;/);
  assert.match(page, /target\.cloudReadOnly \|\| target\.id\.startsWith\("shared:"\)/);
  assert.match(page, /!sharedReadOnly && <label className="uploadButton"/);
  assert.match(page, /!sharedReadOnly && <button[^\n]*setHistoricalRoundToDelete\(r\)/);
  const balance = readFileSync("app/components/balance-ledger-panel.tsx", "utf8");
  assert.match(balance, /buildBalanceLedger\(attributableHistory\(history, currentUserId\)\)/);
});

test("B confirmation attributes B90 not A72, deduplicates DB identity, preserves immutable source and reset", async () => {
  const db = fixtures();
  db.tables.round_participants_v2 = []; // The social confirmation must be sufficient.
  db.rows("social_round_account_links_v3").push({round_id: SHARED_DB_ID, user_id: B, player_key: "b", verified_by: "SELF_CONFIRMED"});
  const sourceBefore = structuredClone(db.rows("rounds_cloud")[0]);
  const history = await readCloudRoundHistory(db.client, B);
  const shared = history.find(r => r.cloudReadOnly)!;
  assert.equal(shared.cloudParticipant?.playerId, "b");
  const insights = buildGolfInsights([shared, structuredClone(shared)]);
  assert.equal(insights.scoredRounds, 1);
  assert.equal(insights.averageScore, 90);
  assert.equal(insights.betBalance, -100);
  assert.equal(insights.expenseRounds, 0, "organizer expenses are not B's expenses");
  assert.equal(buildGolfInsights(roundsEligibleForStatistics([shared], "2026-09-17T00:00:00Z")).rounds, 0);
  const ledger = buildBalanceLedger(attributableHistory([shared, shared], B));
  assert.equal(ledger.rounds.length, 1);
  assert.equal(ledger.entries.find(e => e.accountUserId === B)?.balance, -100);
  assert.equal(attributableHistory([shared], A).length, 0);
  assert.deepEqual(db.rows("rounds_cloud")[0], sourceBefore);
  assert.equal(canEditSnapshot(shared), false);
  db.tables.social_round_account_links_v3 = [];
  assert.equal((await readCloudRoundHistory(db.client, B)).some(r => r.cloudReadOnly), false);
});

test("stored forged proof, mismatched player and ambiguous account identity cannot authorize analytics", async () => {
  const db = fixtures();
  (db.rows("rounds_cloud")[0].snapshot as RoundSnapshot).cloudParticipant = {accountUserId: B, playerId: "b"};
  assert.equal(buildGolfInsights((await readCloudRoundHistory(db.client, B)).filter(r => r.cloudReadOnly)).rounds, 0);
  db.rows("social_round_account_links_v3").push({round_id: SHARED_DB_ID, user_id: B, player_key: "a", verified_by: "SELF_CONFIRMED"});
  assert.equal(buildGolfInsights((await readCloudRoundHistory(db.client, B)).filter(r => r.cloudReadOnly)).rounds, 0);
});

test("participant rows paginate and owned participation does not duplicate canonical history", async () => {
  const db = new CloudDb();
  for (let index = 0; index < 501; index++) {
    const id = `db-${index}`;
    db.rows("round_participants_v2").push({ round_id: id, user_id: B });
    db.rows("rounds_cloud").push({ id, owner_id: index === 0 ? B : null, local_id: `round-${index}`, local_round_id: `round-${index}`, snapshot: card("a", `round-${index}`) });
  }
  const history = await readCloudRoundHistory(db.client, B);
  assert.equal(history.length, 501);
  assert.equal(history.filter(round => round.cloudReadOnly).length, 500);
  assert.equal(new Set(history.map(round => round.id)).size, 501);
});

test("published rounds route uses participant-aware reader and refuses shared re-import (synthetic handler test)", async () => {
  const db = fixtures();
  const client = { ...db.client, auth: { getUser: async () => ({ data: { user: { id: B } }, error: null }) } };
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  const compiled = ts.transpileModule(readFileSync("app/api/cloud/rounds/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === "next/server") return { NextResponse: Response };
    if (name.endsWith("/supabase/server")) return { getSupabaseForUser: () => client };
    if (name.endsWith("/auth-errors")) return { authUserFailure: () => null };
    if (name.endsWith("/social-publication.server")) return { scheduleSocialPublication: () => {} };
    if (name.endsWith("/social-publication-policy")) return { hasCompletedRoundPublicationCandidate: () => false };
    if (name.endsWith("/cloud-sync-service")) return { readCloudRoundHistory };
    throw new Error(name);
  } });
  const response = await exports.GET(new Request("https://qa.invalid/api/cloud/rounds", { headers: { authorization: "Bearer fixture" } }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  const rounds = (await response.json()).rounds as RoundSnapshot[];
  assert.equal(rounds.some(round => round.cloudRoundId === SHARED_DB_ID), true);
  const before = db.rows("rounds_cloud").length;
  const post = await exports.POST(new Request("https://qa.invalid/api/cloud/rounds", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" },
    body: JSON.stringify({ round: rounds.find(round => round.cloudReadOnly) }) }));
  assert.equal(post.status, 403);
  assert.equal(db.rows("rounds_cloud").length, before);
});

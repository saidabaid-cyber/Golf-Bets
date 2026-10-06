import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPendingOwnerRounds, PENDING_ROUND_PAGE_SIZE } from "../lib/pending-round-recovery";
import { unfinishedRoundDraft } from "../lib/unfinished-round";
import { readFileSync } from "node:fs";
import type { RoundSnapshot } from "../lib/types";
import { initialBets } from "../lib/new-round-bets";

const OWNER = "qa-owner";
function card(id = "interrupted"): RoundSnapshot {
  return { id, ownerId: "main", ownerName: "QA", date: "2026-10-05", lifecycleState: "live",
    scorekeeping: { version: 1, mode: "owner", organizerAccountUserId: OWNER },
    startedAt: "2026-10-05T18:00:00Z", courseName: "Catalog fixture", teeName: "Actual",
    roundHoles: 18, startHole: 1, players: [{ id: "main", accountUserId: OWNER, name: "QA", handicap: 0 }, { id: "companion", name: "QA companion", handicap: 0 }],
    betConfig: initialBets(["main", "companion"]), order: Array.from({ length: 18 }, (_, i) => i + 1), scores: { 1: { main: 4, companion: 5 }, 2: { main: 3, companion: 4 } },
    courseSnapshot: { id: "catalog-fixture", name: "Catalog fixture", teeName: "Actual", holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })) },
    betResult: 0, expenseTotal: 0, netResult: 0, categoryResults: {}, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 } };
}
function client(rows: unknown[], error: unknown = null) {
  const calls: unknown[][] = [];
  const query = {
    select(...args: unknown[]) { calls.push(["select", ...args]); return query; },
    eq(...args: unknown[]) { calls.push(["eq", ...args]); return query; },
    not(...args: unknown[]) { calls.push(["not", ...args]); return query; },
    order(...args: unknown[]) { calls.push(["order", ...args]); return query; },
    range(...args: unknown[]) { calls.push(["range", ...args]); return Promise.resolve({ data: rows, error }); },
  };
  return { calls, db: { from(table: string) { calls.push(["from", table]); return query; } } as unknown as SupabaseClient };
}
test("pending recovery is owner-scoped, bounded and ordered; it never writes or changes saved history", async () => {
  const snapshot = card(), { db, calls } = client([{ id: "canonical-id", version: 4, snapshot }]);
  const before = structuredClone(snapshot);
  const result = await readPendingOwnerRounds(db, OWNER);
  assert.ok(calls.some(c => JSON.stringify(c) === JSON.stringify(["eq", "owner_id", OWNER])));
  assert.ok(calls.some(c => JSON.stringify(c) === JSON.stringify(["eq", "snapshot->>lifecycleState", "live"])));
  assert.deepEqual(calls.at(-1), ["range", 0, 19]);
  assert.equal(result.rows[0].version, 4);
  assert.equal(result.rows[0].snapshot.resumeHoleIndex, 2);
  assert.deepEqual(snapshot, before);
  const draft = unfinishedRoundDraft(result.rows[0].snapshot)!;
  assert.equal(draft.roundId, snapshot.id);
  assert.equal(draft.currentIndex, 2);
  assert.deepEqual(draft.scores, snapshot.scores);
  assert.equal(result.nextOffset, null);
});
test("recovery excludes completed, read-only, non-owner and unversioned cards", async () => {
  const rows = [card(), { ...card("closed"), lifecycleState: "completed" }, { ...card("shared"), cloudReadOnly: true },
    { ...card("other"), scorekeeping: { version: 1, mode: "owner", organizerAccountUserId: "other" } },
    { ...card("legacy"), scorekeeping: undefined }].map(snapshot => ({ id: snapshot.id, version: 1, snapshot }));
  assert.deepEqual((await readPendingOwnerRounds(client(rows).db, OWNER)).rows.map(r => r.snapshot.id), ["interrupted"]);
});
test("pending pages are bounded and an incomplete companion score determines resume hole", async () => {
  const snapshot = card(); snapshot.scores![2] = { main: 3 };
  const { db, calls } = client(Array.from({ length: PENDING_ROUND_PAGE_SIZE }, (_, i) => ({ id: `${i}`, version: 2, snapshot })));
  const result = await readPendingOwnerRounds(db, OWNER, 20);
  assert.deepEqual(calls.at(-1), ["range", 20, 39]);
  assert.equal(result.nextOffset, 40);
  assert.equal(result.rows[0].snapshot.resumeHoleIndex, 1);
});
test("invalid pages and query errors fail before yielding recoverable cards", async () => {
  const { db, calls } = client([]);
  for (const offset of [-1, 0.5, 10001, NaN]) await assert.rejects(readPendingOwnerRounds(db, OWNER, offset));
  assert.equal(calls.length, 0);
  await assert.rejects(readPendingOwnerRounds(client([], new Error("unavailable")).db, OWNER), /unavailable/);
});
test("recovery UI fetches only on explicit action, aborts abandoned reads and keeps the preservation/CAS workflow", () => {
  const ui = readFileSync("app/components/pending-round-recovery.tsx", "utf8");
  const route = readFileSync("app/api/cloud/rounds/route.ts", "utf8");
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(ui, /onClick=\{\(\) => void load\(\)\}/);
  assert.match(ui, /flight\.current\?\.abort\(\)/);
  assert.doesNotMatch(ui, /setInterval|setTimeout/);
  assert.ok(route.indexOf("const authenticated = await account(request)") < route.indexOf('params.get("pending")'));
  assert.match(route, /readPendingOwnerRounds\(authenticated.supabase, authenticated.userId/);
  assert.match(page, /requestNewRoundIntent\(\{ kind: "resume", snapshot: row.snapshot \}\)/);
  assert.match(page, /backyard-owner-round-revision:\$\{identity.userId\}:\$\{row.snapshot.id\}/);
});

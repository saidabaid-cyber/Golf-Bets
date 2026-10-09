import assert from "node:assert/strict";
import test from "node:test";
import { cancelOwnerRound, OwnerRoundCancellationConflict } from "../lib/owner-round-cancel";
import { ownerRoundExclusive } from "../lib/owner-round-sync";
import { preserveUnfinishedRound } from "../lib/unfinished-round";
import type { RoundSnapshot } from "../lib/types";

const userId = "qa-owner";
function card(): RoundSnapshot {
  return preserveUnfinishedRound({ id: "qa-active", lifecycleState: "live", startedAt: "2026-10-04T12:00:00Z",
    date: "2026-10-04", courseName: "La Vista", teeName: "Blancas", ownerName: "QA Uno", ownerId: "p1",
    scorekeeping: { version: 1, mode: "owner", organizerAccountUserId: userId },
    players: [{ id: "p1", name: "QA Uno", handicap: 4.8 }, { id: "p2", name: "QA Dos", handicap: 8.2 }],
    scores: { 1: { p1: 4, p2: 5 }, 2: { p1: 3, p2: 4 } },
    betResult: 0, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 0, netResult: 0, categoryResults: {},
  }, 2, "cancelled");
}
function revision(value?: number) {
  const values = new Map<string, string>();
  const key = `backyard-owner-round-revision:${userId}:qa-active`;
  if (value) values.set(key, String(value));
  return { getItem: (name: string) => values.get(name) || null, setItem: (name: string, next: string) => { values.set(name, next); } };
}
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }

test("cancel uses the acknowledged revision and preserves one canonical partial card", async () => {
  const round = card(), storage = revision(7), calls: RequestInit[] = [];
  const request: typeof fetch = async (_url, init) => {
    calls.push(init || {});
    if (calls.length === 1) return response({ data: { id: "cloud-qa", version: 7, snapshot: { lifecycleState: "live" } } });
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.expectedVersion, 7); assert.deepEqual(payload.round.scores, round.scores);
    assert.equal(payload.round.lifecycleState, "cancelled"); assert.equal(payload.round.completedAt, undefined);
    assert.equal(payload.round.id, "qa-active"); assert.equal(payload.round.players.length, 2);
    return response({ roundId: "cloud-qa", version: 8 });
  };
  assert.equal((await cancelOwnerRound(round, userId, "qa-token", storage, request)).roundId, "cloud-qa");
  assert.equal(calls[1].method, "PUT"); assert.equal(storage.getItem(`backyard-owner-round-revision:${userId}:qa-active`), "8");
});

test("fresh GET cannot authorize a stale or unknown device to cancel", async () => {
  for (const known of [undefined, 4]) {
    let calls = 0;
    const request: typeof fetch = async () => { calls++; return response({ data: { id: "cloud-qa", version: 5, snapshot: { lifecycleState: "live" } } }); };
    await assert.rejects(cancelOwnerRound(card(), userId, "qa-token", revision(known), request), /revisión de nube cambió/);
    assert.equal(calls, 1);
  }
});

test("server conflict is explicit and completed history can never be cancelled", async () => {
  let calls = 0;
  const request: typeof fetch = async () => ++calls === 1
    ? response({ data: { id: "cloud-qa", version: 7, snapshot: { lifecycleState: "live" } } })
    : response({ code: "STALE_REVISION", error: "Otro dispositivo cambió la tarjeta." }, 409);
  await assert.rejects(cancelOwnerRound(card(), userId, "qa-token", revision(7), request), /Otro dispositivo/);
  let completedCalls = 0;
  await assert.rejects(cancelOwnerRound(card(), userId, "qa-token", revision(7), async () => {
    completedCalls++; return response({ data: { id: "completed-history", version: 7, snapshot: { lifecycleState: "completed" } } });
  }), /histórico no se modificó/);
  assert.equal(completedCalls, 1);
});

test("retry after an uncertain acknowledgement checks scores and retries only draft cleanup", async () => {
  const round = card();
  const reordered = JSON.parse(JSON.stringify(round));
  reordered.scores = { 2: { p2: 4, p1: 3 }, 1: { p2: 5, p1: 4 } };
  reordered.pausedAt = "2026-10-04T14:00:00Z";
  let calls = 0;
  const request: typeof fetch = async () => { calls++; return response({ data: { id: "cloud-qa", version: 8, snapshot: reordered } }); };
  assert.equal((await cancelOwnerRound(round, userId, "qa-token", revision(7), request)).alreadyCancelled, true);
  assert.equal(calls, 2);
  reordered.scores[1].p1 = 6;
  await assert.rejects(cancelOwnerRound(round, userId, "qa-token", revision(7), request), /otra tarjeta/);
});

test('newer revision with exactly equal capture inputs can be cancelled without removing CAS',async()=>{
  const round=card(),remote={...round,lifecycleState:'live' as const,pausedAt:'other',resumeHoleIndex:0,betResult:99};
  for(const known of [undefined,2]){
    let calls=0;const storage=revision(known);
    const request:typeof fetch=async(_url,init)=>{
      if(++calls===1)return response({data:{id:'cloud-qa',version:8,snapshot:remote}});
      assert.equal(JSON.parse(String(init?.body)).expectedVersion,8);
      return response({roundId:'cloud-qa',version:9});
    };
    await cancelOwnerRound(round,userId,'qa-token',storage,request);
    assert.equal(calls,2);assert.equal(storage.getItem(`backyard-owner-round-revision:${userId}:qa-active`),'9');
  }
});
test('changed canonical score is supplied for explicit review with no write or revision adoption',async()=>{
  const storage=revision(2),remote={...card(),lifecycleState:'live' as const,scores:{1:{p1:9,p2:5}}};let calls=0;
  await assert.rejects(cancelOwnerRound(card(),userId,'qa-token',storage,async()=>{calls++;return response({data:{id:'cloud',version:8,snapshot:remote}});}),error=>{
    assert.ok(error instanceof OwnerRoundCancellationConflict);assert.equal(error.version,8);assert.equal(error.snapshot.scores![1].p1,9);return true;
  });
  assert.equal(calls,1);assert.equal(storage.getItem(`backyard-owner-round-revision:${userId}:qa-active`),'2');
});
test('cancel waits for this device owner write before reading canonical revision',async()=>{
  const key=`backyard-owner-round-revision:${userId}:qa-active`;
  let release=()=>{},reads=0;
  const writing=ownerRoundExclusive(key,()=>new Promise<void>(resolve=>{release=resolve;}));
  await Promise.resolve();
  const cancelling=cancelOwnerRound(card(),userId,'qa-token',revision(7),async(_url,init)=>{
    reads++;return init?.method==='PUT'?response({version:8}):response({data:{id:'cloud',version:7,snapshot:{...card(),lifecycleState:'live'}}});
  });
  await Promise.resolve();assert.equal(reads,0);release();await writing;await cancelling;assert.equal(reads,2);
});

test("unsynced organizer card is created once through the existing API, never deleted", async () => {
  const methods: string[] = [];
  const result = await cancelOwnerRound(card(), userId, "qa-token", revision(), async (_url, init) => {
    methods.push(init?.method || "GET");
    return methods.length === 1 ? response({ data: null }) : response({ roundId: "new-canonical", version: 1 }, 201);
  });
  assert.deepEqual(methods, ["GET", "POST"]); assert.equal(result.roundId, "new-canonical");
});

test("participant/read-only/other organizer cannot invoke cancellation", async () => {
  const original = card(); let calls = 0;
  for (const round of [{ ...original, cloudReadOnly: true }, { ...original, id: "shared:foreign" },
    { ...original, scorekeeping: { ...original.scorekeeping!, organizerAccountUserId: "another-account" } }]) {
    await assert.rejects(cancelOwnerRound(round as RoundSnapshot, userId, "qa-token", revision(), async () => { calls++; return response({}); }), /esta cuenta/);
  }
  assert.equal(calls, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { ownerRoundTransportPayload, syncOwnerRound } from "../lib/owner-round-sync";
import type { RoundSnapshot } from "../lib/types";

const base = () => ({ id: "paused-qa", lifecycleState: "live", startedAt: "2026-10-06T12:00:00Z",
  scorekeeping: { version: 1, mode: "owner", organizerAccountUserId: "qa-owner" },
  scores: { 1: { qa: 5 } }, pausedAt: "2026-10-06T12:10:00Z", resumeHoleIndex: 1,
  updatedAt: "2026-10-06T12:10:00Z" } as unknown as RoundSnapshot);
function fixture(remote = base(), putStatus = 200) {
  const values = new Map([["backyard-owner-round-revision:qa-owner:paused-qa", "1"]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const calls: Array<{ url: string; method?: string; body?: any }> = [];
  const request: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (init?.method) return Response.json(putStatus === 200 ? { version: 4 } : { error: "CAS conflict" }, { status: putStatus });
    return Response.json({ data: { id: "canonical-id", version: 3, ...(String(input).includes("metadata=1") ? {} : { snapshot: remote }) } });
  };
  return { storage, calls, request };
}
test("manual paused recovery accepts only an identical canonical base and sends new scores with CAS", async () => {
  const s = fixture(); const edited = { ...base(), scores: { 1: { qa: 5 }, 2: { qa: 3 } } };
  await syncOwnerRound(ownerRoundTransportPayload(edited), "qa-owner", "qa-token", s.storage, () => true, s.request, true, base());
  assert.equal(s.calls.length, 3); assert.equal(s.calls[2].body.expectedVersion, 3);
  assert.deepEqual(s.calls[2].body.round.scores, edited.scores);
  await syncOwnerRound(ownerRoundTransportPayload(edited), "qa-owner", "qa-token", s.storage, () => true, s.request, false, base());
  assert.equal(s.calls.length, 3, "ACK prevents remount requests");
});
test("changed scores, cancelled state and changed configuration remain conflicts even on manual retry", async () => {
  for (const remote of [{ ...base(), scores: { 1: { qa: 6 } } }, { ...base(), lifecycleState: "cancelled" }, { ...base(), teeName: "Other" }]) {
    const s = fixture(remote as RoundSnapshot);
    await assert.rejects(syncOwnerRound(ownerRoundTransportPayload(base()), "qa-owner", "qa-token", s.storage, () => true, s.request, true, base()), /cambió/);
    assert.equal(s.calls.filter(c => c.method).length, 0);
    assert.equal(s.storage.getItem("backyard-owner-round-revision:qa-owner:paused-qa"), "1");
  }
});
test("automatic retry cannot adopt a fresh revision and the server CAS still rejects a later race", async () => {
  const automatic = fixture();
  await assert.rejects(syncOwnerRound(ownerRoundTransportPayload(base()), "qa-automatic", "qa-token", automatic.storage, () => true, automatic.request, false, base()), /versión/);
  assert.equal(automatic.calls.length, 1);
  const race = fixture(base(), 409);
  await assert.rejects(syncOwnerRound(ownerRoundTransportPayload(base()), "qa-owner", "qa-token", race.storage, () => true, race.request, true, base()), /CAS conflict/);
  assert.equal(race.calls[2].body.expectedVersion, 3);
});
test("a superseded account/effect never adopts the read revision or writes", async () => {
  const s = fixture(); let current = true;
  const request: typeof fetch = async (input, init) => { const r = await s.request(input, init); if (!String(input).includes("metadata=1")) current = false; return r; };
  assert.equal(await syncOwnerRound(ownerRoundTransportPayload(base()), "qa-owner", "qa-token", s.storage, () => current, request, true, base()), null);
  assert.equal(s.calls.filter(c => c.method).length, 0);
  assert.equal(s.storage.getItem("backyard-owner-round-revision:qa-owner:paused-qa"), "1");
});

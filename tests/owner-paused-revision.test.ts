import test from "node:test";
import assert from "node:assert/strict";
import { ownerRoundTransportPayload, ownerLiveTransportAllowed, syncOwnerRound } from "../lib/owner-round-sync";
import { readFileSync } from "node:fs";
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

test("live-to-completed-to-correction retains history transport and never reopens a closed card", () => {
  const original = base();
  assert.equal(ownerLiveTransportAllowed(original.id, []), true);
  assert.equal(ownerLiveTransportAllowed(original.id, [original]), true);
  const completed = { ...original, lifecycleState: "completed", completedAt: "2026-10-06T13:00:00Z" } as RoundSnapshot;
  assert.equal(ownerLiveTransportAllowed(original.id, [completed]), false);
  const correction = { ...completed, scores: { 1: { qa: 6 } } };
  assert.equal(ownerLiveTransportAllowed(correction.id, [completed]), false);
  assert.equal(ownerLiveTransportAllowed("another-active", [completed]), true);
  assert.equal(ownerLiveTransportAllowed(original.id, [{ ...completed, lifecycleState: undefined }]), false);
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /ownerLiveTransportAllowed\(roundId, history\) &&[\s\S]*?<OwnerRoundSync/);
});

test("a clean session verifies identical canonical material before adopting its revision, without PUT or retry", async () => {
  const clean = { ...base(), id: "clean-match" }; const s = fixture(clean);
  const key = "backyard-owner-round-revision:qa-owner:clean-match";
  s.storage.setItem(key, "");
  const result = await syncOwnerRound(ownerRoundTransportPayload(clean), "qa-owner", "qa-token", s.storage, () => true, s.request);
  assert.equal(result.unchanged, true);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls.filter(call => call.method).length, 0);
  assert.equal(s.storage.getItem(key), "3");
  await syncOwnerRound(ownerRoundTransportPayload(clean), "qa-owner", "qa-token", s.storage, () => true, s.request);
  assert.equal(s.calls.length, 2, "durable ACK skips unchanged remount");
  await syncOwnerRound(ownerRoundTransportPayload({ ...clean, scores: { 1: { qa: 5 }, 2: { qa: 4 } } }), "qa-owner", "qa-token", s.storage, () => true, s.request);
  assert.equal(s.calls.at(-1)?.body.expectedVersion, 3, "next edit still uses CAS");
});

test("clean recovery never acknowledges changed material, another owner, terminal card or a revision race", async () => {
  let i = 0;
  for (const patch of [
    { scores: { 1: { qa: 6 } } }, { teeName: "Changed tee" }, { lifecycleState: "cancelled" },
    { scorekeeping: { version: 1, mode: "owner", organizerAccountUserId: "another" } },
  ]) {
    const clean = { ...base(), id: `clean-changed-${i++}` }; const s = fixture({ ...clean, ...patch } as RoundSnapshot);
    const key = `backyard-owner-round-revision:qa-owner:${clean.id}`;
    s.storage.setItem(key, "");
    await assert.rejects(syncOwnerRound(ownerRoundTransportPayload(clean), "qa-owner", "qa-token", s.storage, () => true, s.request), /cambió/);
    assert.equal(s.calls.filter(call => call.method).length, 0);
    assert.equal(s.storage.getItem(key), "");
  }
  const clean = { ...base(), id: "clean-race" }; const s = fixture(clean);
  s.storage.setItem("backyard-owner-round-revision:qa-owner:clean-race", "");
  const request: typeof fetch = async (input, init) => {
    const response = await s.request(input, init);
    return String(input).includes("metadata=1") ? response : Response.json({ data: { id: "canonical-id", version: 4, snapshot: clean } });
  };
  await assert.rejects(syncOwnerRound(ownerRoundTransportPayload(clean), "qa-owner", "qa-token", s.storage, () => true, request), /cambió/);
  assert.equal(s.calls.filter(call => call.method).length, 0);
});

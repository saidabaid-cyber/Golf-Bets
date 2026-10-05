import test from "node:test";
import assert from "node:assert/strict";
import { socialUI, settleUI } from "./helpers/social-ui";
import { ownerRoundSyncFingerprint, ownerRoundTransportPayload } from "../lib/owner-round-sync";
import type { RoundSnapshot } from "../lib/types";

function setup() {
  const timers = new Map<number, () => void>(); let sequence = 0, calls = 0;
  const storage = { getItem: () => null, setItem() {} };
  const h = socialUI("app/components/owner-round-sync.tsx", {
    "owner-round-sync": { ownerRoundSyncFingerprint, ownerRoundTransportPayload,
      syncOwnerRound: async () => { calls++; return { version: 1 }; } },
    "account-workspace": { ownsLocalWorkspace: () => true },
  }, { navigator: { onLine: true }, localStorage: storage, fetch: async () => { throw new Error("unexpected real request"); },
    setTimeout: (fn: () => void) => { timers.set(++sequence, fn); return sequence; },
    clearTimeout: (id: number) => timers.delete(id) });
  const snapshot = { id: "ui-active", startedAt: "2026-10-05T12:00:00Z", scores: { 1: { p: 4 } }, personalSlidingAdjustments: [] } as unknown as RoundSnapshot;
  return { h, snapshot, calls: () => calls, render: (round = snapshot) => h.render("OwnerRoundSync", { snapshot: round, accessToken: "qa-token", userId: "qa" }),
    flush() { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); }, timers };
}
test("real owner component debounces several rapid scores into one capture", async () => {
  const s = setup(); s.render();
  s.render({ ...s.snapshot, scores: { 1: { p: 5 } } });
  s.render({ ...s.snapshot, scores: { 1: { p: 6 } } });
  assert.equal(s.timers.size, 1); assert.equal(s.calls(), 0);
  s.flush(); await settleUI(); assert.equal(s.calls(), 1); s.h.unmount();
});
test("server-derived renders and unrelated navigation do not restart an owner write", async () => {
  const s = setup(); s.render(); s.flush(); await settleUI();
  for (let i = 0; i < 4; i++) s.render({ ...s.snapshot, updatedAt: String(i), completedAt: String(i) });
  assert.equal(s.timers.size, 0); assert.equal(s.calls(), 1); s.h.unmount();
});
test("unmount discards delayed jobs but leaves the durable draft untouched", async () => {
  const s = setup(); s.render(); s.h.unmount(); s.flush(); await settleUI();
  assert.equal(s.calls(), 0); assert.equal(s.snapshot.scores?.[1].p, 4);
});
test("owner online recovery schedules one capture and not a recurring timer", async () => {
  const s = setup(); s.render(); s.flush(); await settleUI();
  s.h.emit("online"); s.render(); assert.equal(s.timers.size, 1);
  s.flush(); await settleUI(); s.render(); s.flush(); await settleUI(); assert.equal(s.calls(), 2); s.h.unmount();
});

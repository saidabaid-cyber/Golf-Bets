import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const page = readFileSync("app/page.tsx", "utf8");

test("profile completion uses the shared modal outside the profile identity grid", () => {
  const component = readFileSync("app/components/profile-completion-ring.tsx", "utf8");
  const css = readFileSync("app/components/profile-completion-ring.module.css", "utf8");
  assert.match(component, /createPortal\(<ModalShell open/);
  assert.match(component, /document\.body/);
  assert.match(component, /closeDisabled=\{busy\}/);
  assert.match(css, /input\[type=checkbox\],\.dialog input\[type=radio\]\{width:20px/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) 92px/);
  assert.match(css, /white-space:normal;overflow-wrap:anywhere/);
});

test("capture offers exit and the same guarded new-round flow without requiring completion", () => {
  const capture = page.slice(page.indexOf('{tab === "round" && <>'), page.indexOf("<RoundCaptureV2"));
  assert.match(capture, /Salir y continuar después/);
  assert.match(capture, /flushLocalState\.current\?\.\(\); setTab\("welcome"\)/);
  assert.match(capture, /onClick=\{requestNewRound\}>Nueva ronda/);
  assert.doesNotMatch(capture, /resetRound|deleteActiveRound|saveRound/);
});

function replacementHarness(backupSucceeds: boolean) {
  const calls: string[] = [];
  const replacingRound = { current: false };
  const intent = { kind: "blank" };
  const fn = page.slice(page.indexOf("  async function confirmNewRound()"), page.indexOf("  async function deleteActiveRound()"));
  const confirm = runInNewContext(`${fn}; confirmNewRound`, {
    replacingRound, pendingNewRoundIntent: intent, localStorage: {},
    flushLocalState: { current: () => true },
    setNewRoundBackupError: (error: string) => { if (error) calls.push("error"); },
    setRoundLifecycleBusy: () => {},
    parkActiveRound: async () => { calls.push("backup"); if (!backupSucceeds) throw new Error('backup failed'); },
    applyNewRoundIntent: (value: unknown) => { assert.equal(value, intent); calls.push("replace"); },
  }) as () => Promise<void>;
  return { calls, confirm, replacingRound };
}

test("confirmed replacement saves before replacing and double tap replaces only once", async () => {
  const h = replacementHarness(true);
  assert.deepEqual(h.calls, []);
  await Promise.all([h.confirm(), h.confirm()]);
  assert.deepEqual(h.calls, ["backup", "replace"]);
});

test("failed backup never replaces a round and permits safe retry", async () => {
  const h = replacementHarness(false);
  await h.confirm();
  assert.deepEqual(h.calls, ["backup", "error"]);
  assert.equal(h.replacingRound.current, false);
  await h.confirm();
  assert.deepEqual(h.calls, ["backup", "error", "backup", "error"]);
});

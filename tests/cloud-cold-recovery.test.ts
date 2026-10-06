import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { CloudHydrationBoundary } from "../lib/cloud-hydration";
import { stableValue, cloudDraftApplyPlan, restoreLocalRoundUi } from "../lib/cloud-sync";
import { recoveredRoundResumeIndex } from "../lib/active-round-navigation";
import { STORAGE_KEYS } from "../lib/round-utils";

test("the actual cloud apply callback recovers H2 on a cold workspace and preserves navigation on same-round updates", () => {
  const source = ts.createSourceFile("page.tsx", readFileSync("app/page.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let action: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "applyCloudBundle" && node.initializer && ts.isCallExpression(node.initializer)) action = node.initializer.arguments[0];
    if (!action) ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(action);
  const js = ts.transpileModule(`exports.action = ${action.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const draft = { roundId: "canonical-active", players: [{ id: "a" }, { id: "b" }], scores: { 1: { a: 5, b: 6 } } };
  const bundle = { activeDraft: draft, history: [], courses: [], rivals: [], frequentPlayers: [], frequentGroups: [], tombstones: [], preferences: { highContrast: true, defaultHandicap: 5 } };
  for (const prior of [null, { ...draft, scores: {} }]) {
    let preserve: boolean | undefined; let index = 0;
    const values = new Map<string, string>(); const exported: any = {};
    const revision = { current: 0 };
    runInNewContext(js, {
      exports: exported, cloudHydrationBoundary: { current: new CloudHydrationBoundary() }, mergeLocalAndCloud: (_local: unknown, remote: unknown) => remote,
      stableValue, cloudDraftApplyPlan, restoreLocalRoundUi, localPersistRevision: revision,
      flushLocalState: { current: () => true }, preserveDraftConflict() {}, setFeedback() {},
      applyDraft: (value: typeof draft, options: { preserveLocalUi: boolean }) => { preserve = options.preserveLocalUi; if (!preserve) index = recoveredRoundResumeIndex(value, ["a", "b"], [1, 2, 3]); },
      mergeDefaultCourses: (courses: unknown) => courses, normalizeHistorySnapshot: (round: unknown) => round,
      applyCloudPreferences() {}, localStorage: { setItem: (key: string, value: string) => values.set(key, value) },
      STORAGE_KEYS, CLOUD_TOMBSTONES_KEY: "tombstones", persistCloudMetadata() {}, serializeFrequentGroups: JSON.stringify,
      currentIndexRef: { current: 0 }, hadLocalPreferences: { current: false }, offlineDeviceId: { current: "fixture-device" },
      collectLocalCloudData: () => ({ ...bundle }), cloudSyncPayloadFingerprint: () => "ack",
    });
    assert.equal(exported.action(bundle, { ...bundle, activeDraft: prior }), "ack");
    assert.equal(preserve, prior !== null);
    assert.equal(index, prior ? 0 : 1, "existing device may review H1; a cold device must recover H2");
    assert.equal(revision.current, 1, "old autosave is fenced before cloud apply");
    assert.deepEqual(JSON.parse(values.get(STORAGE_KEYS.draft)!).scores, draft.scores);
  }
});

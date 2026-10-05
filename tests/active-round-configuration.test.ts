import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { normalizeRoundDraft } from "../lib/round-utils";
import { wizardEngineFixture } from "./fixtures/round-wizard-engine";

const page = readFileSync("app/page.tsx", "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) { if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(ast) === name) found = node; if (!found) ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found); return found;
}
function execute(name: string, dependencies: Record<string, any>) {
  const node = declaration(name);
  const expression = ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) ? node.initializer.arguments[0].getText(ast) : node.getText(ast);
  const source = ts.isFunctionDeclaration(node) ? `${expression}; exports.action = ${name};` : `exports.action = ${expression};`;
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exported: any = {};
  runInNewContext(js, { exports: exported, ...dependencies });
  return exported.action;
}

test("active edit passes its real snapshot through existing hydration, preserving the current hole", () => {
  const snapshot = { roundId: "existing", course: { name: "La Vista" }, scores: { 1: { said: 4 } } };
  let actual: any, options: any, step = 0, editing = false, tab = "";
  const edit = execute("editActiveRound", { commitFocusedNumericCapture() {}, flushLocalState: { current: () => true }, roundDraftPayload: () => snapshot, applyDraft: (value: any, opts: any) => { actual = value; options = opts; }, setRoundSetupInitialStep: (value: number) => { step = value; }, setEditingRound: (value: boolean) => { editing = value; }, setTab: (value: string) => { tab = value; } });
  edit(); assert.equal(actual, snapshot); assert.equal(options.preserveLocalUi, true); assert.equal(step, 1); assert.equal(editing, true); assert.equal(tab, "setup");
});

test("real draft hydration restores selected course, layout, tee, roster, bets, scores and group origin", () => {
  const input = wizardEngineFixture(10, "course");
  const draft = { version: 11, roundId: "active-config", roundDate: "2026-10-04", startedAt: "2026-10-04T12:00:00Z", courseSelected: true, course: input.course, players: input.players, ownerId: "said", startHole: 10, roundHoles: 18, handicapBasis: "course", bets: input.bets, segments: input.segments, personalBets: input.personalBets, supplementalBets: input.supplementalBets, manualBets: input.manualBets, scores: { 10: input.scores[10], 11: input.scores[11] }, currentIndex: 2, ballFriendSetup: input.ballFriendSetup, templateOrigin: { groupId: "g", groupNameSnapshot: "Miércoles", basedOnUpdatedAt: "initial", roundPlayerIdByMemberId: { member: "said" } } };
  const captured: Record<string, any> = {};
  const globals: Record<string, any> = { identity: { userId: "qa-owner" }, undoStack: { current: [] }, holeSummarySession: { current: null }, emptyExpenses: {}, laVista: input.course, Date, Object, Array };
  const required = createRequire(resolve(__dirname, "../app/page.js"));
  const arrow = declaration("applyDraft").getText(ast);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    const names = statement.importClause.namedBindings.elements.filter(binding => arrow.includes(binding.name.text));
    if (!names.length || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const imported = required(statement.moduleSpecifier.text);
    for (const binding of names) globals[binding.name.text] = imported[binding.propertyName?.text || binding.name.text];
  }
  for (const name of new Set(arrow.match(/\bset[A-Z]\w+/g))) globals[name] = (value: any) => { captured[name] = value; };
  const normalized = normalizeRoundDraft(draft)!;
  execute("applyDraft", globals)(draft, { preserveLocalUi: true });
  const plain = (value: any) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(captured.setCourse), input.course); assert.equal(captured.setCourseSelected, true); assert.equal(captured.setCourseSetupStage, "details");
  assert.deepEqual(plain(captured.setPlayers), input.players); assert.equal(captured.setOwnerId, "said"); assert.equal(captured.setStartHole, 10); assert.equal(captured.setRoundHoles, 18); assert.equal(captured.setRoundHandicapBasis, "course");
  assert.deepEqual(plain(captured.setScores), draft.scores); assert.deepEqual(plain(captured.setBallFriendSetup), input.ballFriendSetup); assert.deepEqual(plain(captured.setRoundTemplateOrigin), draft.templateOrigin);
  for (const [setter, expected] of [["setPersonalBets", normalized.personalBets], ["setSupplementalBets", normalized.supplementalBets], ["setManualBets", normalized.manualBets]] as const) for (const [index, entry] of expected.entries()) for (const key of Object.keys(entry)) assert.deepEqual(plain(captured[setter][index][key]), plain(entry[key]));
  assert.equal(captured.setBets.foursome.fixedValue, input.bets.foursome.fixedValue); assert.equal(captured.setCurrentIndex, undefined);
});

test("cancellation parks the snapshot as cancelled before resetting, and never hard-deletes history", async () => {
  const events: string[] = [], busy = { current: false };
  const cancel = execute("deleteActiveRound", { replacingRound: busy, setRoundLifecycleBusy() {}, parkActiveRound: async (state: string) => { events.push(state); }, resetRound: () => events.push("reset"), setTab: () => events.push("navigate"), setNewRoundBackupError: () => events.push("error") });
  await cancel(); assert.deepEqual(events, ["cancelled", "reset", "navigate"]); assert.equal(busy.current, false);
  const failed: string[] = [];
  const reject = execute("deleteActiveRound", { replacingRound: busy, setRoundLifecycleBusy() {}, parkActiveRound: async () => { throw new Error("storage unavailable"); }, resetRound: () => failed.push("reset"), setTab: () => failed.push("navigate"), setNewRoundBackupError: () => failed.push("error") });
  await reject(); assert.deepEqual(failed, ["error"]);
  assert.match(page, /¿Cancelar esta ronda\?/); assert.doesNotMatch(declaration("deleteActiveRound").getText(ast), /deleteRound|deleteHistory|removeItem|DELETE/);
});

test("online cancel closes canonical cloud before clearing the active draft; failure keeps it active", async () => {
  const events: string[] = [];
  const dependencies = {
    localStorage: {}, identity: { userId: "qa-owner", mode: "authenticated", accessToken: "qa-token" },
    ownsLocalWorkspace: () => true, flushLocalState: { current: () => true },
    currentSnapshot: () => ({ id: "qa-active", startedAt: "2026-10-04T12:00:00Z" }),
    readStoredJson: () => ({ roundId: "qa-active", courseSelected: true, scores: { 1: { qa: 4 } } }),
    STORAGE_KEYS: { draft: "draft" }, roundId: "qa-active", scores: {}, history: [], currentIndex: 1,
    applyPendingScoreEdits: (value: unknown) => value, preserveUnfinishedRound: (value: unknown) => value,
    cloudLinked: true, navigator: { onLine: true }, cancelOwnerRound: async () => { events.push("cloud-cancel"); },
    saveRoundHistoryLocalFirst: async () => { events.push("local-save"); return { history: [] }; },
    offlineDeviceId: { current: "qa-device" }, hadLocalPreferences: { current: false },
    setHistory() {}, normalizeHistorySnapshot: (value: unknown) => value, clearActiveRoundStorage: () => { events.push("clear-active"); },
    trackLocalCloudEdits() {}, highContrast: false, notificationsEnabled: false, requestCloudSync: { current() {} },
  };
  await execute("parkActiveRound", dependencies)("cancelled");
  assert.deepEqual(events, ["cloud-cancel", "local-save", "clear-active"]);
  events.length = 0;
  await assert.rejects(execute("parkActiveRound", { ...dependencies, flushLocalState: { current: () => true }, cancelOwnerRound: async () => { throw new Error("stale cloud revision"); } })("cancelled"), /stale cloud/);
  assert.deepEqual(events, []);
});

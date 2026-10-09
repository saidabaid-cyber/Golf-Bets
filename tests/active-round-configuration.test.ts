import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { normalizeRoundDraft } from "../lib/round-utils";
import { CloudHydrationBoundary } from "../lib/cloud-hydration";
import { wizardEngineFixture } from "./fixtures/round-wizard-engine";
import { applyRoundCourseHandicaps } from "../features/handicap/round-player-handicap";
import { withPlayerCourseCards } from "../lib/player-course-card";
import { assignTeeToEveryPlayer } from "../lib/player-tee-assignments";
import type { Course, Player } from "../lib/types";

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

test("paused detail resumes the same snapshot through active-round preservation, without completed editing", () => {
  for (const lifecycleState of ["live"]) {
    const snapshot = { id: "paused", lifecycleState, resumeCurrentIndex: 1, scores: { 1: { qa: 5 } } };
    let intent: any;
    execute("editHistoricalRound", { canEditSnapshot: () => true, roundId: "other", roundClosed: false,
      requestNewRoundIntent: (value: any) => { intent = value; },
      restoreRoundSnapshot: () => { throw new Error("must not reset a paused round as completed editing"); } })(snapshot);
    assert.equal(intent.kind, "resume"); assert.equal(intent.snapshot, snapshot);
    assert.equal(intent.snapshot.resumeCurrentIndex, 1); assert.equal(intent.snapshot.scores[1].qa, 5);
  }
});

test("cancelled detail cannot create a resume intent or overwrite the active draft", () => {
  const snapshot = { id: "cancelled-qa", lifecycleState: "cancelled", scores: { 1: { qa: 5 } } };
  const before = JSON.stringify(snapshot);
  let feedback = "";
  const forbidden = () => { throw new Error("cancelled evidence must stay read-only"); };
  execute("editHistoricalRound", { setFeedback: (value: string) => { feedback = value; },
    canEditSnapshot: forbidden, continueActiveRound: forbidden, requestNewRoundIntent: forbidden,
    restoreRoundSnapshot: forbidden })(snapshot);
  assert.match(feedback, /cancelada.*scores.*no puede reactivarse/);
  assert.equal(JSON.stringify(snapshot), before);
});

test("current paused detail continues directly and shared read-only snapshots cannot resume", () => {
  let continued = 0;
  const action = execute("editHistoricalRound", { canEditSnapshot: (round: any) => !round.cloudReadOnly,
    roundId: "current", roundClosed: false, continueActiveRound: () => { continued++; },
    requestNewRoundIntent: () => { throw new Error("must not replace current active round"); } });
  action({ id: "current", lifecycleState: "live" }); assert.equal(continued, 1);
  action({ id: "shared", lifecycleState: "live", cloudReadOnly: true }); assert.equal(continued, 1);
});

test("reusing a saved guest preserves its stable ID and blocks only that same individual", () => {
  let added: any[] = [], feedback = "";
  const deps = { players: [], MAX_ROUND_PLAYERS: 5, ROUND_PLAYER_LIMIT_MESSAGE: "limit", makeId: () => "fresh-runtime",
    identity: { userId: "owner", mode: "authenticated" }, accountPrimaryPlayerId: (id: string) => `account:${id}`,
    setFeedback: (message: string) => { feedback = message; }, setPlayers: (updater: any) => { added = updater([]); },
    setOwnerId() {}, roundPresentation: { playMode: "score_only" } };
  execute("appendPlayer", deps)("Guest QA", 12, undefined, "frequent-stable");
  assert.equal(added[0].id, "frequent-stable");
  added = [];
  execute("appendPlayer", { ...deps, players: [{ id: "frequent-stable", name: "Renamed", handicap: 12 }] })("Guest QA", 12, undefined, "frequent-stable");
  assert.equal(added.length, 0); assert.match(feedback, /ya está/);
  execute("appendPlayer", { ...deps, players: [{ id: "other-person", name: "Guest QA", handicap: 12 }] })("Guest QA", 12, undefined, "frequent-stable");
  assert.equal(added[0].id, "frequent-stable");
});

test("an explicit tee edit recalculates HCP and player cards while keeping IDs and scores", () => {
  const players = [{ id: "account:qa", name: "QA", handicap: 5, handicapIndex: 5.5 }];
  const assignments = [{ playerId: "account:qa", teeId: "new-tee" }];
  const scores = { 1: { "account:qa": 4 } };
  const calculated: any[] = []; let selected: any, appliedPlayers: any, appliedAssignments: any;
  const apply = execute("applyRoundTeeAssignments", { players, course: { id: "old-tee" },
    withPlayerCourseCards: (value: any, tees: any) => ({ ...value, playerHoleCards: tees }),
    applyRoundCourseHandicaps: (current: any, tees: any, selectedCourse: any, _time: string, locked: boolean) => {
      calculated.push({ current, tees, selectedCourse, locked }); return current.map((p: any) => ({ ...p, handicap: 7 }));
    }, setCourse: (value: any) => { selected = value; }, setPlayerTeeAssignments: (value: any) => { appliedAssignments = value; },
    setPlayers: (updater: any) => { appliedPlayers = updater(players); } });
  apply(assignments, { id: "new-tee" });
  assert.equal(calculated[0].locked, false, "only the explicit edit bypasses automatic freeze");
  assert.equal(appliedPlayers[0].id, players[0].id); assert.equal(appliedPlayers[0].handicap, 7);
  assert.equal(selected.id, "new-tee"); assert.equal(appliedAssignments, assignments);
  assert.deepEqual(scores, { 1: { "account:qa": 4 } });
});

test("real tee-selection handler re-freezes new inputs during edit and automatic updates remain locked", () => {
  const previous: Course = { id: "tee-before", name: "QA", teeName: "Blancas", catalogCourseId: "qa-course", rating: 70.8, slope: 125,
    holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })) };
  const next = { ...previous, id: "tee-after", teeName: "Doradas", rating: 68.4, slope: 121 };
  const source: Player = { id: "account:qa", name: "QA", handicap: 5.5, handicapIndex: 5.5, handicapSource: "profile_index" };
  let players = applyRoundCourseHandicaps([source], assignTeeToEveryPlayer([source], previous, "2026-10-05T12:00:00Z"), previous, "2026-10-05T12:00:00Z");
  const before = players[0].courseHandicapSnapshot;
  let selectedCourse: Course = previous, assignments: any[] = [];
  const applyAssignments = execute("applyRoundTeeAssignments", { course: previous, withPlayerCourseCards, applyRoundCourseHandicaps,
    setCourse: (value: Course) => { selectedCourse = value; }, setPlayerTeeAssignments: (value: any[]) => { assignments = value; },
    setPlayers: (update: (current: Player[]) => Player[]) => { players = update(players); } });
  execute("selectRoundTee", { teeOptions: [next], beginRoundCourseSelection: () => ({ ok: true }), completeRoundTeeSelection: () => ({ ok: true, course: next }),
    roundTeeSelectionId: () => next.id, course: previous, players, startHole: 1, roundHoles: 18, bets: { foursome: { segmentSize: 6 } },
    setCourse: (value: Course) => { selectedCourse = value; }, setPlayerTeeAssignments: (value: any[]) => { assignments = value; },
    applyRoundTeeAssignments: applyAssignments, assignTeeToEveryPlayer, confirmRoundChange: (_message: string, apply: () => void) => apply(),
    setStartHole() {}, setRoundHoles() {}, setSegments() {}, playOrderForHoles: () => Array.from({ length: 18 }, (_, i) => i + 1), segmentDefinitions: () => [],
    setCourseSelected() {}, setPendingCourseIdentity() {}, setCourseSelectionError() {}, setCourseSetupStage() {} })(next);
  assert.equal(players[0].handicap, 2);
  assert.equal(players[0].courseHandicapSnapshot?.teeId, "tee-after");
  assert.equal(assignments[0].teeId, "tee-after");
  assert.notDeepEqual(players[0].courseHandicapSnapshot, before);
  assert.strictEqual(applyRoundCourseHandicaps(players, assignTeeToEveryPlayer(players, previous, "2026-10-06T12:00:00Z"), selectedCourse, "2026-10-06T12:00:00Z", true), players);
});

test("active edit passes its real snapshot through existing hydration, preserving the current hole", () => {
  const snapshot = { roundId: "existing", course: { name: "La Vista" }, scores: { 1: { said: 4 } } };
  let actual: any, options: any, step = 0, editing = false, tab = "";
  const edit = execute("editActiveRound", { cloudHydrationBoundary: { current: new CloudHydrationBoundary() }, commitFocusedNumericCapture() {}, flushLocalState: { current: () => true }, roundDraftPayload: () => snapshot, applyDraft: (value: any, opts: any) => { actual = value; options = opts; }, setRoundSetupInitialStep: (value: number) => { step = value; }, setEditingRound: (value: boolean) => { editing = value; }, setTab: (value: string) => { tab = value; } });
  edit(); assert.equal(actual, snapshot); assert.equal(options.preserveLocalUi, true); assert.equal(step, 1); assert.equal(editing, true); assert.equal(tab, "setup");
});

test("real draft hydration restores selected course, layout, tee, roster, bets, scores and group origin", () => {
  const input = wizardEngineFixture(10, "course");
  const draft = { version: 11, roundId: "active-config", roundDate: "2026-10-04", startedAt: "2026-10-04T12:00:00Z", courseSelected: true, course: input.course, players: input.players, ownerId: "said", startHole: 10, roundHoles: 18, handicapBasis: "course", bets: input.bets, segments: input.segments, personalBets: input.personalBets, supplementalBets: input.supplementalBets, manualBets: input.manualBets, scores: { 10: input.scores[10], 11: input.scores[11] }, currentIndex: 2, ballFriendSetup: input.ballFriendSetup, templateOrigin: { groupId: "g", groupNameSnapshot: "Miércoles", basedOnUpdatedAt: "initial", roundPlayerIdByMemberId: { member: "said" } } };
  const captured: Record<string, any> = {};
  const globals: Record<string, any> = { cloudHydrationBoundary: { current: new CloudHydrationBoundary() }, identity: { userId: "qa-owner" }, undoStack: { current: [] }, holeSummarySession: { current: null }, emptyExpenses: {}, laVista: input.course, Date, Object, Array };
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

test("cancellation parks the snapshot before clearing state, without creating another draft", async () => {
  const events: string[] = [], busy = { current: false };
  const cancel = execute("deleteActiveRound", { roundStartedAt:'2026-10-09T12:00:00Z',scores:{},scoreEdits:{},replacingRound: busy, setRoundLifecycleBusy() {}, parkActiveRound: async (state: string) => { events.push(state); }, applyDraft: (draft: unknown) => { assert.equal(draft,null);events.push("clear"); }, setRoundClosed() {}, setDraftAvailable() {}, setShowDeleteRoundConfirm() {}, setFeedback() {}, setTab: () => events.push("navigate"), setNewRoundBackupError: () => events.push("error") });
  await cancel(); assert.deepEqual(events, ["cancelled", "clear", "navigate"]); assert.equal(busy.current, false);
  const failed: string[] = [];
  const reject = execute("deleteActiveRound", { OwnerRoundCancellationConflict:class extends Error{},roundStartedAt:'2026-10-09T12:00:00Z',scores:{},scoreEdits:{},replacingRound: busy, setRoundLifecycleBusy() {}, parkActiveRound: async () => { throw new Error("storage unavailable"); }, resetRound: () => failed.push("reset"), setTab: () => failed.push("navigate"), setNewRoundBackupError: () => failed.push("error") });
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
    localPersistRevision: { current: 0 }, trackLocalCloudCheckpoint() {}, highContrast: false, notificationsEnabled: false, requestCloudSync: { current() {} },
  };
  await execute("parkActiveRound", dependencies)("cancelled");
  assert.deepEqual(events, ["cloud-cancel", "local-save", "clear-active"]);
  events.length = 0;
  await assert.rejects(execute("parkActiveRound", { ...dependencies, flushLocalState: { current: () => true }, cancelOwnerRound: async () => { throw new Error("stale cloud revision"); } })("cancelled"), /stale cloud/);
  assert.deepEqual(events, []);
});

test('reviewing a newer cancellation card first preserves local inputs and requires another confirmation',()=>{
  const local={roundId:'qa-review',scores:{1:{self:4}}},remote={id:'qa-review',scores:{1:{self:5}}};
  const events:string[]=[],ack:Record<string,string>={};
  const deps={cancelReview:{conflict:{snapshot:remote,version:9},pending:false},roundLifecycleBusy:false,
    identity:{userId:'qa'},localStorage:{setItem:(k:string,v:string)=>{ack[k]=v;}},ownsLocalWorkspace:()=>true,
    roundId:'qa-review',flushLocalState:{current:()=>true},STORAGE_KEYS:{draft:'main-draft'},readStoredJson:()=>local,
    preserveDraftConflict:(_s:unknown,value:unknown)=>{assert.equal(value,local);events.push('preserve');return true;},
    unfinishedRoundDraft:()=>({roundId:remote.id,scores:remote.scores}),localPersistRevision:{current:0},
    applyDraft:(value:any)=>{assert.equal(value.scores[1].self,5);events.push('load');},setCancelReview:()=>events.push('dismiss'),
    setNewRoundBackupError:(message:string)=>assert.match(message,/confirma nuevamente/),
    cancelOwnerRound:()=>assert.fail('review cannot cancel automatically')};
  execute('reviewCurrentCancellation',deps)();
  assert.deepEqual(events,['preserve','load','dismiss']);assert.equal(ack['backyard-owner-round-revision:qa:qa-review'],'9');
  events.length=0;execute('reviewCurrentCancellation',{...deps,preserveDraftConflict:()=>false,setNewRoundBackupError:()=>events.push('preserve-failed')})();
  assert.deepEqual(events,['preserve-failed']);
});

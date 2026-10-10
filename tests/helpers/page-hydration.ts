import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { CloudHydrationBoundary } from "../../lib/cloud-hydration";
import { RoundDraftTabBoundary } from "../../lib/round-draft-tab-boundary";
import { CLOUD_LOCAL_META_KEY } from "../../lib/cloud-sync";
import { DEFAULT_COURSES } from "../../lib/golf-course-directory";

export function pageHydrationHarness(text = readFileSync("app/page.tsx", "utf8")) {
  const page = ts.createSourceFile("page.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fixture = JSON.parse(readFileSync("tests/fixtures/hydration-live.json", "utf8"));
  const scope: Record<string, any> = { exports: {}, structuredClone, Date, JSON, setTimeout: () => 1, clearTimeout() {},
    window: { setTimeout: () => 1, clearTimeout() {} }, localPersistRevision: { current: 0 }, flushLocalState: { current: null },
    offlineDeviceId: { current: "fixture-device" }, hadLocalPreferences: { current: true }, identity: { userId: "qa-owner", mode: "authenticated", displayName: "QA Owner", defaultHandicap: null },
    hydrated: true, hydratedWorkspaceOwner: "qa-owner", cloudLinked: true, highContrast: true, notificationsEnabled: false, roundClosed: false, editingRound: false, history: [], savedPersonalRivals: [],
    frequentPlayers: [], frequentGroups: [], courses: [fixture.course], pendingCourseIdentity: null, holeSummarySession: { current: null },
    undoStack: { current: [] }, currentIndexRef: { current: 0 }, favoriteCourseIds: [], recentCourseIds: [], roundHandicapBasis: "relative", roundTemplateOrigin: null,
    cloudHydrationBoundary: { current: new CloudHydrationBoundary() }, localDraftTabBoundary: { current: new RoundDraftTabBoundary() }, CLOUD_LOCAL_META_KEY, defaultCourses: DEFAULT_COURSES, laVista: fixture.course,
  };
  for (const node of page.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
    const path = (node.moduleSpecifier as ts.StringLiteral).text;
    if (!path.startsWith("../lib/") && path !== "../features/handicap/round-player-handicap" && path !== "./draft-restoration") continue;
    const relative = path.startsWith("../") ? "../../" + path.slice(3) : "../../app/" + path.slice(2);
    const loaded = createRequire(__filename)(relative);
    for (const element of node.importClause.namedBindings.elements) if (!element.isTypeOnly) scope[element.name.text] = loaded[(element.propertyName || element.name).text];
  }
  const values = new Map<string, string>();
  scope.localStorage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) };
  scope.window.localStorage = scope.localStorage;
  // Only platform/account boundaries are replaced. Apply/normalizers/storage
  // serialization/read/metadata/merge/gate are the actual production code.
  scope.ownsLocalWorkspace = () => true; scope.accountDeletionMarkerKey = () => "deleted";
  scope.persistOfflineBundle = async () => {}; scope.requestCloudSync = { current() {} };
  scope.preserveDraftConflict = () => {}; scope.applyCloudPreferences = (p: any) => { scope.identity.defaultHandicap = p.defaultHandicap; };
  const nodes: Record<string, ts.Node> = {};
  function visit(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name && ["roundDraftPayload", "playersForRoundStart", "persistCommittedHoleBeforeAdvance", "currentSnapshot"].includes(n.name.text)) nodes[n.name.text] = n;
    if (ts.isVariableDeclaration(n) && ["applyDraft", "applyCloudBundle", "setupPlayers"].includes(n.name.getText(page))) nodes[n.name.getText(page)] = (n.initializer as ts.CallExpression).arguments[0];
    if (ts.isVariableDeclaration(n) && ["openActiveRound", "resumeActiveRound", "continueActiveRound"].includes(n.name.getText(page))) nodes[n.name.getText(page)] = n.initializer!;
    if (ts.isVariableDeclaration(n) && n.name.getText(page) === "activeRoundSummary") nodes.activeRoundSummary = (n.initializer as ts.CallExpression).arguments[0];
    if (ts.isCallExpression(n) && n.arguments[0]?.getText(page).includes("trackLocalCloudEdits") && n.expression.getText(page) === "useLayoutEffect") nodes.persistEffect = n.arguments[0];
    if (ts.isCallExpression(n) && n.arguments[0]?.getText(page).includes("syncAccountPrimaryFrequentPlayer") && n.expression.getText(page) === "useEffect") nodes.profileEffect = n.arguments[0];
    if (ts.isCallExpression(n) && n.arguments[0]?.getText(page).includes("applyRoundCourseHandicaps") && n.expression.getText(page) === "useEffect") nodes.handicapEffect = n.arguments[0];
    if (ts.isCallExpression(n) && n.arguments[0]?.getText(page).includes("reconcilePlayerTeeAssignments") && n.expression.getText(page) === "useEffect") nodes.teeEffect = n.arguments[0];
    ts.forEachChild(n, visit);
  }
  visit(page);
  for (const node of Object.values(nodes)) for (const match of node.getText(page).matchAll(/\bset([A-Z]\w+)\(/g)) {
    const key = match[1][0].toLowerCase() + match[1].slice(1);
    scope["set" + match[1]] = (value: any) => { scope[key] = typeof value === "function" ? value(scope[key]) : value; };
  }
  for (const name of ["normalizeExpenses", "normalizeHistorySnapshot", "mergeDefaultCourses"]) {
    const node = page.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
    runInNewContext(ts.transpileModule(node.getText(page), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
  }
  scope.emptyExpenses = scope.normalizeExpenses(undefined);
  for (const [name, node] of Object.entries(nodes)) {
    runInNewContext(ts.transpileModule(`exports.${name} = ${node.getText(page)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
    scope[name] = scope.exports[name];
  }
  const persist = () => { scope.exports.persistEffect(); const ok = scope.flushLocalState.current(); if (!ok || scope.saveStatus === "error") throw new Error("Actual page persistence failed in harness"); };
  return { scope, storage: scope.localStorage, fixture, persist, apply: scope.exports.applyCloudBundle as (remote: any, local: any) => string };
}

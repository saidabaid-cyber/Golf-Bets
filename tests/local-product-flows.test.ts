import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildLegalAcceptances,
  hasCurrentLegalConsent,
  isValidEmail,
  mergeBackyardProfile,
  migrationDecisionStorageKey,
  normalizeOtp,
  type BackyardProfile,
} from "../lib/account-state";
import {
  generateRandomGroups,
  groupsShareText,
  swapGroupPlayers,
  validateGroups,
  type GroupPlayer,
} from "../lib/group-generator";
import { parseFrequentGroups, serializeFrequentGroups } from "../lib/frequent-templates";
import { buildHoleSummary, persistRoundHistory, privateLeaderboard } from "../lib/round-utils";
import { OFFICIAL_RULES_VIDEOS_URL, searchGolfRules } from "../lib/rules-catalog";
import { OFFICIAL_RULES_DOCUMENTS } from "../lib/rules-documents";
import type { Course, Player, RoundSnapshot } from "../lib/types";

test("Flujo A invitado conserva consentimiento, ronda, resultados e histórico local", () => {
  const storage = new Map<string, string>();
  storage.set("backyard-account-mode-v1", "guest");
  const accepted = buildLegalAcceptances("guest", "2026-09-01T12:00:00.000Z");
  assert.equal(hasCurrentLegalConsent(accepted, "guest"), true);

  const players: Player[] = [
    { id: "said", name: "Said", handicap: 7 },
    { id: "jorge", name: "Jorge", handicap: 12 },
  ];
  const course: Course = {
    id: "local", name: "Prueba local", teeName: "General",
    holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
  };
  const order = Array.from({ length: 9 }, (_, index) => index + 1);
  const scores = Object.fromEntries(order.map((hole) => [hole, { said: 4, jorge: 4 }]));
  const board = privateLeaderboard(course, players, scores, order);
  assert.equal(board.every((row) => row.finished && row.gross === 36), true);
  assert.deepEqual(buildHoleSummary(1, players, scores), ["Hoyo 1 guardado", "Said 4", "Jorge 4"]);

  const round: RoundSnapshot = {
    id: "round-flow-a", date: "2026-09-01", courseName: course.name, teeName: course.teeName,
    ownerName: "Said", roundHoles: 9, startHole: 1, betResult: 0,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0, netResult: 0, categoryResults: {}, players, scores, courseSnapshot: course, order,
  };
  persistRoundHistory({ setItem: (key, value) => storage.set(key, value) }, [round]);
  assert.equal(JSON.parse(storage.get("golfbets-history") || "[]")[0].id, "round-flow-a");
});

test("Flujo B arma, resortea, edita, comparte, guarda y reutiliza 10 jugadores en 5+5", () => {
  const names = ["Said", "Jorge", "Carlos", "Cuau", "Armando", "Jesús", "Raúl", "Pedro", "Luis", "Mario"];
  const source: GroupPlayer[] = names.map((name, index) => ({ id: `p${index + 1}`, name, handicap: index + 1 }));
  const first = generateRandomGroups(source, 5, 1);
  const second = generateRandomGroups(source, 5, 2);
  assert.deepEqual(first.map((group) => group.length), [5, 5]);
  assert.equal(validateGroups(first, source), true);
  assert.notDeepEqual(first, second);
  const edited = swapGroupPlayers(first, first[0][0].id, first[1][0].id);
  assert.equal(validateGroups(edited, source), true);
  assert.match(groupsShareText(edited), /THE BACKYARD[\s\S]*Grupo 1[\s\S]*Grupo 2/);

  const serialized = serializeFrequentGroups(edited.map((group, index) => ({
    id: `g${index + 1}`, name: `Miércoles ${index + 1}`, players: group.map(({ name, handicap }) => ({ name, handicap })), uses: 0, updatedAt: "2026-09-01T12:00:00.000Z",
  })));
  const saved = parseFrequentGroups(serialized);
  assert.deepEqual(saved.map((group) => group.players.length), [5, 5]);
  assert.equal(saved[0].players.every((player) => typeof player.name === "string"), true);
});

test("Flujo C simula correo, OTP, consentimiento, edición de perfil y sesión local", () => {
  assert.equal(isValidEmail("said@example.com"), true);
  assert.equal(normalizeOtp("00 12-3456"), "00123456");
  const accepted = buildLegalAcceptances("account-1", "2026-09-01T12:00:00.000Z");
  assert.equal(hasCurrentLegalConsent(accepted, "account-1"), true);
  const profile: BackyardProfile = { userId: "account-1", displayName: "Said", email: "said@example.com", avatarUrl: "", defaultHandicap: null };
  const edited = mergeBackyardProfile(profile, { displayName: "  Said G.  ", avatarUrl: "", defaultHandicap: 7 });
  assert.equal(edited.displayName, "Said G.");
  assert.equal(edited.defaultHandicap, 7);
  assert.match(migrationDecisionStorageKey(edited.userId), /account-1$/);
  const providerSource = readFileSync("app/components/account-provider.tsx", "utf8");
  const authFlowSource = readFileSync("lib/auth-flow.ts", "utf8");
  assert.match(providerSource, /restoreAuthSession/);
  assert.match(providerSource, /closeAuthSession/);
  assert.match(authFlowSource, /auth\.getSession/);
  assert.match(authFlowSource, /auth\.signOut/);
  assert.doesNotMatch(providerSource, /localStorage\.clear/);
});

test("Flujo D conserva búsqueda, IA, documentos oficiales, regreso y videos", () => {
  assert.ok(searchGolfRules("bola movida").length > 0);
  assert.equal(OFFICIAL_RULES_DOCUMENTS.length, 3);
  assert.equal(OFFICIAL_RULES_DOCUMENTS.every((document) => document.officialUrl.startsWith("https://")), true);
  assert.match(OFFICIAL_RULES_VIDEOS_URL, /PLnU5qUEfww3dYQwcnZ5qoGAlwzGRtghdA/);
  const rulesSource = readFileSync("app/components/rules-panel.tsx", "utf8");
  const legalLayout = readFileSync("app/legal/layout.tsx", "utf8");
  assert.match(rulesSource, /Preguntar a IA/);
  assert.match(rulesSource, /target="_blank"/);
  assert.match(legalLayout, /← Volver/);
});

test("contratos responsive cubren iPhone pequeño, iPhone grande y safe area", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.accessCard/);
  assert.match(css, /\.consentCard/);
  assert.match(css, /\.generatedGroupGrid/);
  assert.match(css, /\.holeSummaryBackdrop/);
});

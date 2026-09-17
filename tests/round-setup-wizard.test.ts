import assert from "node:assert/strict";
import test from "node:test";
import { betDisplayLabel, supplementalBetDisplayLabel } from "../lib/bet-catalog";
import { initialBets } from "../lib/new-round-bets";
import { buildWizardBetCatalog, issuesBlockingWizardStep, readWizardStep, wizardEditorId, wizardIssueStep } from "../lib/round-setup-wizard";
import { createSupplementalBet } from "../lib/supplemental-bets";
import type { ManualBet, PersonalBet, Player, SupplementalBet } from "../lib/types";

const players: Player[] = [
  { id: "a", name: "Said", handicap: 7 },
  { id: "b", name: "Bruno", handicap: 14 },
  { id: "c", name: "Francisco Javier Martínez", handicap: 9 },
  { id: "d", name: "Alejandro Rodríguez Hernández", handicap: 10 },
];
const personalBet: PersonalBet = {
  id: "personal-one", enabled: true, rivalMode: "group", rivalPlayerId: "b", rivalName: "Nombre anterior",
  externalScores: {}, baseValue: 500, advantageReceiver: "rival", advantageStrokes: 7, back9Multiplier: 1,
  pressureMultiplier: 3, pressureNine: "holes_1_9", nassauVersion: 2,
  components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
};
function input() {
  return { bets: initialBets(players.map((player) => player.id)), players: structuredClone(players), ownerId: "a", personalBets: [] as PersonalBet[], manualBets: [] as ManualBet[], supplementalBets: [] as SupplementalBet[] };
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freeze);
  Object.freeze(value);
}

test("wizard accepts only the five valid saved UI steps", () => {
  for (const step of [1, 2, 3, 4, 5] as const) {
    assert.equal(readWizardStep(step), step);
    assert.equal(readWizardStep(String(step)), step);
  }
  for (const value of [undefined, null, 0, 6, 2.5, {}, [], "", "3abc", "3.5", true]) assert.equal(readWizardStep(value), 1);
});

test("preflight destinations resolve DOM wrapper and classify every editor", () => {
  const steps = {
    "round-course": 1, "round-course-ai-focus": 1, "round-players": 2, "round-hcp-error-a": 2,
    "setup-rabbits": 3, "setup-skins": 3, "setup-foursome": 3, "setup-polla-h1-9": 3,
    "setup-polla-h10-18": 3, "setup-polla-18-hoyos": 3, "setup-vegas": 3, "setup-team_pressures": 3,
    "setup-personal-nassau": 4, "setup-manuals": 4, "setup-individual_nassau": 4,
    "setup-dollar_stroke": 4, "setup-individual_pressures": 4,
  };
  for (const [id, step] of Object.entries(steps)) {
    assert.equal(wizardEditorId(`result-section-${id}`), id);
    assert.equal(wizardIssueStep({ targetId: id }), step);
    assert.equal(wizardIssueStep({ targetId: `result-section-${id}` }), step);
  }
});

test("step gates include only current and prior issues; review includes all without mutating them", () => {
  const issues = ["round-course", "round-players", "setup-skins", "setup-manuals"].map((targetId) => ({ targetId }));
  freeze(issues);
  for (const step of [1, 2, 3, 4] as const) assert.deepEqual(issuesBlockingWizardStep(issues, step), issues.slice(0, step));
  assert.deepEqual(issuesBlockingWizardStep(issues, 5), issues);
  assert.deepEqual(issuesBlockingWizardStep([], 5), []);
});

test("no-bet rounds retain every available category without activating any", () => {
  const catalog = buildWizardBetCatalog(input());
  assert.equal(catalog.group.length, 18);
  assert.equal(catalog.personal.length, 4);
  assert.equal([...catalog.group, ...catalog.personal].some((entry) => entry.enabled), false);
  assert.equal(catalog.group.find((entry) => entry.id === "setup-foursome")?.label, betDisplayLabel("foursome"));
  assert.equal(catalog.personal.find((entry) => entry.id === "setup-dollar_stroke")?.label, supplementalBetDisplayLabel("dollar_stroke"));
  assert.equal(catalog.personal.some((entry) => entry.id === "setup-individual_nassau"), false);
});

test("all existing modalities remain in exactly their group or personal editor", () => {
  const draft = input();
  draft.supplementalBets = (["individual_nassau", "dollar_stroke", "individual_pressures", "team_pressures", "chicago", "vegas", "minimum_putts"] as const)
    .map((type) => createSupplementalBet(type, players, `id-${type}`));
  draft.personalBets = [structuredClone(personalBet)];
  draft.manualBets = [{ id: "manual-1", name: "Comida", amounts: { a: 200, b: -200 } }];
  for (const config of [draft.bets.rabbits, draft.bets.skins, draft.bets.units, draft.bets.foursome, draft.bets.ballFriend,
    draft.bets.monkey!, draft.bets.polla.first9, draft.bets.polla.second9, draft.bets.polla.total18, draft.bets.miniPolla,
    draft.bets.vipers, draft.bets.camels, draft.bets.fish, draft.bets.loba]) config.enabled = true;
  const catalog = buildWizardBetCatalog(draft);
  assert.deepEqual(catalog.group.map((entry) => entry.id), [
    "setup-rabbits", "setup-skins", "setup-units", "setup-foursome", "setup-ball-friend", "setup-monkey",
    "setup-polla-h1-9", "setup-polla-h10-18", "setup-polla-18-hoyos", "setup-mini-polla", "setup-vipers", "setup-camels", "setup-fish", "setup-loba",
    "setup-team_pressures", "setup-chicago", "setup-vegas", "setup-minimum_putts",
  ]);
  assert.deepEqual(catalog.personal.map((entry) => entry.id), ["setup-manuals", "setup-personal-nassau", "setup-individual_nassau", "setup-dollar_stroke", "setup-individual_pressures"]);
  assert.equal([...catalog.group, ...catalog.personal].every((entry) => entry.enabled), true);
  assert.equal(new Set([...catalog.group, ...catalog.personal].map((entry) => entry.id)).size, 23);
});

test("review uses actual names, configured prices, Match mode and animal rules", () => {
  const draft = input();
  draft.bets.foursome = { ...draft.bets.foursome, enabled: true, mode: "match", fixedValue: 500, hcpPct: 80, pressureMultiplier: 5 };
  draft.bets.vipers = { ...draft.bets.vipers, enabled: true, value: 125, determinationMode: "most_events", mostEventsTieRule: "latest_tied_event" };
  draft.personalBets = [structuredClone(personalBet), { ...structuredClone(personalBet), id: "external", rivalMode: "external", rivalName: "Pedro externo", baseValue: 800 }];
  draft.manualBets = [{ id: "manual", name: "Agua", amounts: { a: 75, b: -75 } }];
  const catalog = buildWizardBetCatalog(draft);
  const foursome = catalog.group.find((entry) => entry.id === "setup-foursome")!;
  assert.match(foursome.summary, /Match · Primera \/ Segunda \/ Total/);
  assert.match(foursome.summary, /\$500/);
  assert.match(foursome.summary, /HCP 80%/);
  assert.match(foursome.summary, /Presión 5x/);
  assert.match(foursome.summary, /Francisco Javier Martínez/);
  assert.match(catalog.group.find((entry) => entry.id === "setup-vipers")!.summary, /\$125 · El que más hizo · Último de los empatados/);
  const nassau = catalog.personal.find((entry) => entry.id === "setup-personal-nassau")!.summary;
  assert.match(nassau, /Said vs Bruno · \$500 · Presión 3x/);
  assert.match(nassau, /Said vs Pedro externo · \$800/);
  assert.doesNotMatch(nassau, /Nombre anterior/);
  assert.match(catalog.personal.find((entry) => entry.id === "setup-manuals")!.summary, /Agua: Said \$75 \/ Bruno \$-75/);
});

test("disabled instances do not contaminate active summaries and legacy enabled defaults survive", () => {
  const draft = input();
  draft.personalBets = [{ ...structuredClone(personalBet), enabled: false, baseValue: 999 }, { ...structuredClone(personalBet), id: "legacy", enabled: undefined }];
  draft.supplementalBets = [createSupplementalBet("dollar_stroke", players, "one"), { ...createSupplementalBet("dollar_stroke", players, "two"), enabled: false }];
  const catalog = buildWizardBetCatalog(draft);
  const personal = catalog.personal.find((entry) => entry.id === "setup-personal-nassau")!;
  assert.equal(personal.enabled, true);
  assert.doesNotMatch(personal.summary, /999/);
  assert.equal(catalog.personal.filter((entry) => entry.id === "setup-dollar_stroke").length, 1);
  assert.equal(catalog.personal.find((entry) => entry.id === "setup-dollar_stroke")!.summary.includes(";"), false);
});

test("catalog is pure on frozen state including score-bearing personal bets and repeated step navigation", () => {
  const draft = input();
  draft.personalBets = [{ ...structuredClone(personalBet), externalScores: { 10: 4 } }];
  draft.manualBets = [{ id: "manual", name: "Manual", amounts: { a: 500, b: -500 } }];
  draft.supplementalBets = [createSupplementalBet("team_pressures", players, "teams")];
  const before = structuredClone(draft);
  freeze(draft);
  const first = buildWizardBetCatalog(draft);
  for (const step of [1, 2, 3, 4, 5, 3, 1, 4, 5] as const) {
    readWizardStep(step);
    assert.deepEqual(buildWizardBetCatalog(draft), first);
  }
  assert.deepEqual(draft, before);
  assert.equal(draft.personalBets[0].externalScores[10], 4);
  assert.equal(draft.personalBets[0].pressureNine, "holes_1_9");
});

test("removed players and invalid amounts remain visibly pending, never silently repaired", () => {
  const draft = input();
  draft.personalBets = [{ ...structuredClone(personalBet), rivalPlayerId: "removed" }];
  draft.bets.skins = { ...draft.bets.skins, enabled: true, value: Number.NaN, participantIds: ["a", "removed"] };
  const catalog = buildWizardBetCatalog(draft);
  assert.match(catalog.group.find((entry) => entry.id === "setup-skins")!.summary, /Precio pendiente/);
  assert.match(catalog.group.find((entry) => entry.id === "setup-skins")!.summary, /Jugador pendiente/);
  assert.match(catalog.personal.find((entry) => entry.id === "setup-personal-nassau")!.summary, /Said vs Jugador pendiente/);
  assert.deepEqual(draft.bets.skins.participantIds, ["a", "removed"]);
  assert.ok(Number.isNaN(draft.bets.skins.value));
});

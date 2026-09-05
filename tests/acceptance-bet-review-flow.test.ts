import assert from "node:assert/strict";
import test from "node:test";

import { setRememberedCategoryEnabled, setSupplementalCategoryEnabled } from "../lib/bet-activation";
import { initialBets } from "../lib/new-round-bets";
import { buildPersonalOpponentHistory, buildPersonalOpponentResults, groupCurrentPersonalResults } from "../lib/personal-opponents";
import { persistPendingRoundReview } from "../lib/round-review";
import { saveRoundHistoryLocalFirst } from "../lib/round-history-save";
import { normalizeRoundDraft, readStoredJson, STORAGE_KEYS } from "../lib/round-utils";
import { calculateSupplementalBets, createSupplementalBet, normalizeSupplementalBets, supplementalBetValue } from "../lib/supplemental-bets";
import type { Course, ManualBet, PersonalBet, Player, RoundSnapshot, SupplementalBet } from "../lib/types";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const players: Player[] = [
  { id: "owner-a", name: "Jugador A", handicap: 0 },
  { id: "opponent-b", name: "Jugador B", handicap: 0 },
  { id: "player-c", name: "Jugador C", handicap: 0 },
  { id: "player-d", name: "Jugador D", handicap: 0 },
];
const order = Array.from({ length: 18 }, (_, index) => index + 1);
const course: Course = {
  id: "acceptance-course",
  name: "Campo QA aislado",
  teeName: "QA",
  holes: order.map((number) => ({ number, par: 4, strokeIndex: number })),
};
const scores = Object.fromEntries(order.map((hole, index) => [hole, {
  "owner-a": index < 2 ? 3 : 4,
  "opponent-b": index < 13 ? 5 : 6,
  "player-c": 4,
  "player-d": 4,
}]));

function amountAtCreation(bet: SupplementalBet) {
  return supplementalBetValue(bet);
}

function completedSnapshot(updatedAt = "2026-09-05T14:00:00.000Z"): RoundSnapshot {
  return {
    id: "round-review-qa",
    date: "2026-09-05",
    ownerId: "owner-a",
    ownerName: "Jugador A",
    courseName: course.name,
    teeName: course.teeName,
    roundHoles: 18,
    startHole: 1,
    players,
    courseSnapshot: course,
    order,
    scores,
    putts: {},
    betConfig: initialBets(players.map((player) => player.id)),
    supplementalBets: [],
    personalBets: [],
    manualBets: [],
    betResult: 250,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0,
    netResult: 250,
    categoryResults: { Personales: 250 },
    personalOpponentResults: [
      { betId: "nassau-1", mode: "nassau_individual", modeLabel: "Nassau individual", opponentId: "opponent-b", opponentName: "Jugador B", amount: 200 },
      { betId: "dollar-1", mode: "dollar_stroke", modeLabel: "Dollar a Stroke", opponentId: "opponent-b", opponentName: "Jugador B", amount: -50 },
      { betId: "pressure-1", mode: "individual_pressures", modeLabel: "Presiones individuales", opponentId: "opponent-b", opponentName: "Jugador B", amount: 100 },
    ],
    photoId: "qa-photo",
    completedAt: "2026-09-05T13:59:00.000Z",
    updatedAt,
  };
}

test("todas las modalidades nuevas conservan ID, monto y subconjunto activo al apagar, serializar y reactivar", () => {
  const types: SupplementalBet["type"][] = ["individual_nassau", "dollar_stroke", "individual_pressures", "team_pressures", "chicago", "vegas", "minimum_putts"];
  for (const type of types) {
    const first = createSupplementalBet(type, players, `${type}-1`);
    const second = { ...createSupplementalBet(type, players, `${type}-2`), enabled: false } as SupplementalBet;
    const originalValue = amountAtCreation(first);
    const disabled = setSupplementalCategoryEnabled([first, second], type, false);
    assert.deepEqual(disabled.map((bet) => bet.enabled), [false, false], `${type} no se apagó completo`);
    const reloaded = normalizeSupplementalBets(JSON.parse(JSON.stringify(disabled)));
    const restored = setSupplementalCategoryEnabled(reloaded, type, true);
    assert.deepEqual(restored.map((bet) => bet.enabled), [true, false], `${type} no restauró el subconjunto exacto`);
    assert.deepEqual(restored.map((bet) => bet.id), [`${type}-1`, `${type}-2`]);
    assert.equal(amountAtCreation(restored[0]), originalValue);
  }
});

test("Nassau y Manual conservan configuración e instancias sin activarse por abrir o migrar", () => {
  const personal: PersonalBet[] = [{
    id: "nassau-canonical", enabled: true, rivalMode: "group", rivalPlayerId: "opponent-b", rivalName: "Jugador B",
    externalScores: {}, baseValue: 100, advantageReceiver: "rival", advantageStrokes: 5, back9Multiplier: 1,
    components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
  }];
  const manual: ManualBet[] = [{ id: "manual-1", enabled: true, name: "Apuesta QA", amounts: { "owner-a": 50, "opponent-b": -50 } }];
  const personalOff = setRememberedCategoryEnabled(personal, false);
  const manualOff = setRememberedCategoryEnabled(manual, false);
  const personalBack = setRememberedCategoryEnabled<PersonalBet>(JSON.parse(JSON.stringify(personalOff)), true);
  const manualBack = setRememberedCategoryEnabled<ManualBet>(JSON.parse(JSON.stringify(manualOff)), true);
  assert.equal(personalBack[0].baseValue, 100);
  assert.equal(personalBack[0].advantageStrokes, 5);
  assert.deepEqual(manualBack[0].amounts, { "owner-a": 50, "opponent-b": -50 });
  assert.equal(personalBack.length, 1);
  assert.equal(manualBack.length, 1);
  const noInstances = setRememberedCategoryEnabled<PersonalBet>([], true);
  assert.deepEqual(noInstances, [], "abrir un editor vacío no fabrica una apuesta");
});

test("Skins y todas las apuestas generales sobreviven configuración → inicio → hoyo → reload sin cambiar precios", () => {
  const configured = initialBets(players.map((player) => player.id));
  for (const key of ["rabbits", "skins", "units", "foursome", "ballFriend", "miniPolla", "vipers", "camels", "fish", "loba"] as const) configured[key].enabled = true;
  configured.monkey!.enabled = true;
  configured.polla.first9.enabled = true;
  configured.polla.second9.enabled = false;
  configured.polla.total18.enabled = true;
  configured.skins.value = 50;
  configured.units.value = 100;
  const draft = normalizeRoundDraft(JSON.parse(JSON.stringify({
    version: 6, roundId: "activation-round", players, course, bets: configured, segments: [], personalBets: [], supplementalBets: [], manualBets: [],
    scores: { 1: Object.fromEntries(players.map((player) => [player.id, 4])) }, scoreEdits: {}, putts: {}, unitEvents: [], counterBetEvents: [], counterBetKeepers: {}, lobaHoles: {}, ballFriendSetup: {}, expenses: {},
  })));
  assert.ok(draft?.bets);
  const restored = draft!.bets as unknown as ReturnType<typeof initialBets>;
  assert.equal(restored.skins.enabled, true);
  assert.equal(restored.skins.value, 50);
  assert.equal(restored.units.value, 100);
  assert.equal(restored.polla.second9.enabled, false);
  for (const key of ["rabbits", "skins", "units", "foursome", "ballFriend", "miniPolla", "vipers", "camels", "fish", "loba"] as const) assert.equal(restored[key].enabled, true, key);
});

test("Dollar a Stroke respeta 70 vs 95, cinco golpes pactados para B y liquida exactamente $200", () => {
  const bet = {
    ...createSupplementalBet("dollar_stroke", players, "dollar-reference"),
    playerAId: "owner-a",
    playerBId: "opponent-b",
    advantageReceiverId: "opponent-b",
    advantageStrokes: 5,
    valuePerStroke: 10,
  } as SupplementalBet;
  const result = calculateSupplementalBets([bet], players, course, scores, {}, order).results[0];
  assert.equal(order.reduce((total, hole) => total + (scores[hole]["owner-a"] || 0), 0), 70);
  assert.equal(order.reduce((total, hole) => total + (scores[hole]["opponent-b"] || 0), 0), 95);
  assert.match(result.lines.join(" "), /Jugador A 70 · Jugador B 90/);
  assert.equal(result.balances["owner-a"], 200);
  assert.equal(result.balances["opponent-b"], -200);
  const [detail] = buildPersonalOpponentResults({ ownerId: "owner-a", players, course, scores, putts: {}, order, canonicalResults: [], personalBets: [], supplementalBets: [bet] });
  assert.equal(detail.status, "final");
  assert.equal(detail.components?.[0].amount, 200);
  assert.match(detail.detailLines?.join(" ") || "", /Scores considerados \(18 hoyos\): Jugador A 70 · Jugador B 95/);
  assert.match(detail.detailLines?.join(" ") || "", /Resultado ajustado: Jugador A 70 · Jugador B 90/);
});

test("Personales agrupa +200−50+100 = +250 por identidad estable y una edición sustituye sin duplicar", () => {
  const first = completedSnapshot();
  const grouped = groupCurrentPersonalResults(first.personalOpponentResults || []);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].name, "Jugador B");
  assert.equal(grouped[0].wonMoney, 300);
  assert.equal(grouped[0].lostMoney, 50);
  assert.equal(grouped[0].total, 250);
  const corrected = completedSnapshot("2026-09-05T15:00:00.000Z");
  corrected.personalOpponentResults = corrected.personalOpponentResults!.map((entry) => entry.betId === "dollar-1" ? { ...entry, amount: -100 } : entry);
  const history = buildPersonalOpponentHistory([first, corrected]);
  assert.equal(history.length, 1);
  assert.equal(history[0].rounds.length, 1);
  assert.equal(history[0].total, 200);
});

test("Terminar conserva 72 scores como pendiente; solo Guardar archiva y el retry usa un único ID", async () => {
  const storage = new MemoryStorage();
  const draft = {
    version: 6, roundId: "round-review-qa", reviewPending: false, players, course, bets: initialBets(players.map((player) => player.id)),
    segments: [], personalBets: [], supplementalBets: [], manualBets: [], scores, scoreEdits: {}, putts: {}, unitEvents: [], counterBetEvents: [], counterBetKeepers: {}, lobaHoles: {}, ballFriendSetup: {}, expenses: {},
  };
  persistPendingRoundReview(storage as unknown as Storage, draft);
  assert.equal(storage.getItem(STORAGE_KEYS.history), null, "Terminar no debe archivar");
  const recovered = normalizeRoundDraft(JSON.parse(storage.getItem(STORAGE_KEYS.draft)!));
  assert.equal(recovered?.reviewPending, true);
  const recoveredScores = recovered?.scores as Record<number, Record<string, number>>;
  assert.equal(Object.values(recoveredScores || {}).flatMap((row) => Object.values(row)).length, 72);
  const persistOffline = async () => "review-fingerprint";
  const options = { storage: storage as unknown as Storage, ownerId: "owner-a", snapshot: completedSnapshot(), deviceId: "device-qa", defaultHandicap: null, hasLocalPreferenceState: false, queueForCloud: true, persistOffline };
  await saveRoundHistoryLocalFirst(options);
  await saveRoundHistoryLocalFirst(options);
  const history = readStoredJson<RoundSnapshot[]>(storage as unknown as Storage, STORAGE_KEYS.history, []);
  assert.equal(history.length, 1);
  assert.equal(history[0].id, "round-review-qa");
  assert.equal(Object.values(history[0].scores || {}).flatMap((row) => Object.values(row)).length, 72);
  assert.equal(history[0].photoId, "qa-photo");
  assert.equal(buildPersonalOpponentHistory(history)[0].total, 250);
  assert.ok(storage.getItem(STORAGE_KEYS.draft), "la capa de página solo limpia después de esta confirmación durable");
});

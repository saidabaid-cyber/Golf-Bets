import assert from "node:assert/strict";
import test from "node:test";
import { deriveRoundAchievements, roundAchievementLabels, roundMaterialFingerprint, roundMaterialPayload } from "../lib/round-achievements";
import type { RoundSnapshot } from "../lib/types";

const OWNER = "qa-account-owner";
const OTHER = "qa-account-other";
const HOLES = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 }));
const ORDER = HOLES.map(hole => hole.number);

function scores(value = 4) {
  return Object.fromEntries(ORDER.map(hole => [hole, { principal: value, rival: value }]));
}
function putts(value = 2) {
  return Object.fromEntries(ORDER.map(hole => [hole, { principal: value }]));
}
function round(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    id: "round-current", lifecycleState: "completed", date: "2026-09-15", roundHoles: 18,
    courseName: "Synthetic QA", teeName: "Blancas", ownerName: "Nombre compartido", ownerId: "principal",
    betResult: 100, expenseTotal: 0, netResult: 100,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, categoryResults: { foursome: 100 },
    players: [{ id: "principal", name: "Nombre compartido", handicap: 9, accountUserId: OWNER },
      { id: "rival", name: "Nombre compartido", handicap: 10, accountUserId: OTHER }],
    courseSnapshot: { id: "course-qa", name: "Synthetic QA", teeName: "Blancas", holes: HOLES },
    order: ORDER, scores: scores(),
    ...overrides,
  };
}
const codes = (snapshot: RoundSnapshot, prior: RoundSnapshot[] = [], user = OWNER) =>
  deriveRoundAchievements(snapshot, prior, user)?.achievements.map(item => item.code) || [];

test("18H comparables estrictos: estado, orden, par, score completo e identidad Auth; nombres jamás son ownership", () => {
  const current = round();
  assert.equal(deriveRoundAchievements(current, [], OWNER)?.grossScore, 72);
  assert.equal(deriveRoundAchievements(current, [], "missing-account"), null);
  assert.equal(deriveRoundAchievements(round({ lifecycleState: "live" }), [], OWNER), null);
  assert.equal(deriveRoundAchievements(round({ roundHoles: 9, order: ORDER.slice(0, 9) }), [], OWNER), null);
  assert.equal(deriveRoundAchievements(round({ order: Array(18).fill(1) }), [], OWNER), null);
  assert.equal(deriveRoundAchievements(round({ scores: { ...scores(), 18: { principal: null } } }), [], OWNER), null);
  assert.equal(deriveRoundAchievements(round({ courseSnapshot: { ...current.courseSnapshot!, holes: HOLES.slice(0, 17) } }), [], OWNER), null);
  assert.equal(deriveRoundAchievements(round({ courseSnapshot: { ...current.courseSnapshot!, holes: HOLES.map(hole => hole.number === 18 ? { ...hole, par: 9 } : hole) } }), [], OWNER), null);
  assert.equal(deriveRoundAchievements(round({ players: current.players!.map(player => ({ ...player, accountUserId: undefined })) }), [], OWNER), null);
  assert.equal(deriveRoundAchievements(round({ players: [{ ...current.players![0] }, { ...current.players![0], id: "duplicate" }] }), [], OWNER), null);
  assert.equal(deriveRoundAchievements(round({ players: [{ ...current.players![0] }, { ...current.players![1], id: "principal" }] }), [], OWNER), null);
});

test("PB sólo si existe ronda anterior 18H comparable del mismo accountUserId y par", () => {
  const old = round({ id: "old", date: "2026-09-14", scores: scores(5) });
  assert.equal(codes(round(), []).includes("PERSONAL_BEST_18H"), false);
  assert.equal(codes(round(), [old]).includes("PERSONAL_BEST_18H"), true);
  assert.equal(deriveRoundAchievements(round(), [old], OWNER)?.previousComparableBest, 90);
  assert.equal(codes(round({ scores: scores(5) }), [old]).includes("PERSONAL_BEST_18H"), false);
  const bad = [
    round({ ...old, lifecycleState: "live" }),
    round({ ...old, roundHoles: 9, order: ORDER.slice(0, 9) }),
    round({ ...old, date: "2026-09-16" }),
    round({ ...old, id: "round-current" }),
    round({ ...old, players: old.players!.map(player => ({ ...player, accountUserId: player.id === "principal" ? OTHER : undefined })) }),
    round({ ...old, courseSnapshot: { ...old.courseSnapshot!, holes: HOLES.map(hole => ({ ...hole, par: 5 })) } }),
  ];
  for (const prior of bad) assert.equal(codes(round(), [prior]).includes("PERSONAL_BEST_18H"), false);
});

test("PB mismo día exige cronología demostrable; futuro, empate e instante incierto no son baseline", () => {
  const current = round({ startedAt: "2026-09-15T14:00:00.000Z", completedAt: "2026-09-15T18:00:00.000Z" });
  const earlier = round({ id: "morning", scores: scores(5), startedAt: "2026-09-15T08:00:00.000Z", completedAt: "2026-09-15T12:00:00.000Z" });
  const later = round({ id: "evening", scores: scores(5), startedAt: "2026-09-15T19:00:00.000Z", completedAt: "2026-09-15T22:00:00.000Z" });
  const overlapping = round({ id: "overlap", scores: scores(5), startedAt: "2026-09-15T10:00:00.000Z", completedAt: "2026-09-15T15:00:00.000Z" });
  const uncertain = round({ id: "unknown", scores: scores(5) });
  assert.equal(codes(current, [earlier]).includes("PERSONAL_BEST_18H"), true);
  for (const prior of [later, overlapping, uncertain]) assert.equal(codes(current, [prior]).includes("PERSONAL_BEST_18H"), false);
  assert.equal(codes(current, [round({ ...earlier, completedAt: current.startedAt })]).includes("PERSONAL_BEST_18H"), false);
});

test("birdies/águilas y score limpio usan sólo score y par reales; un resumen por ronda", () => {
  const card = scores(); card[1].principal = 3; card[2].principal = 2;
  const summary = deriveRoundAchievements(round({ scores: card }), [], OWNER)!;
  assert.equal(summary.birdies, 1);
  assert.equal(summary.eaglesOrBetter, 1);
  assert.equal(summary.achievements.find(item => item.code === "BIRDIES")?.count, 1);
  assert.equal(summary.achievements.find(item => item.code === "EAGLES_OR_BETTER")?.count, 1);
  assert.equal(summary.scoreToPar, -3);
  assert.ok(codes(round({ scores: card })).includes("BOGEY_FREE"));
  assert.ok(codes(round({ scores: card })).includes("NO_DOUBLE_BOGEYS"));
  const bogey = scores(); bogey[1].principal = 5;
  assert.equal(codes(round({ scores: bogey })).includes("BOGEY_FREE"), false);
  assert.equal(codes(round({ scores: bogey })).includes("NO_DOUBLE_BOGEYS"), true);
  const double = scores(); double[1].principal = 6;
  assert.equal(codes(round({ scores: double })).includes("NO_DOUBLE_BOGEYS"), false);
});

test("sin tres putts exige los 18 datos completos y válidos", () => {
  assert.equal(codes(round()).includes("NO_THREE_PUTTS"), false);
  assert.equal(codes(round({ putts: putts(2) })).includes("NO_THREE_PUTTS"), true);
  for (const value of [null, 3, 6, -1]) {
    const captured = putts(); captured[18].principal = value as number;
    assert.equal(codes(round({ putts: captured })).includes("NO_THREE_PUTTS"), false);
  }
  const incomplete = putts(); delete incomplete[18];
  assert.equal(codes(round({ putts: incomplete })).includes("NO_THREE_PUTTS"), false);
});

test("GIR sólo explícito o score+putts suficientes; captura explícita prevalece", () => {
  assert.equal(deriveRoundAchievements(round(), [], OWNER)?.gir, null);
  const derived = deriveRoundAchievements(round({ putts: putts(2) }), [], OWNER)!;
  assert.deepEqual(derived.gir, { hit: 18, attempts: 18, source: "score_putts" });
  assert.equal(derived.achievements.find(item => item.code === "GIR_9_PLUS")?.count, 18);
  const explicit = Object.fromEntries(ORDER.map(hole => [hole, { principal: { greenInRegulation: hole <= 9 } }]));
  const explicitSummary = deriveRoundAchievements(round({ advancedStats: explicit }), [], OWNER)!;
  assert.deepEqual(explicitSummary.gir, { hit: 9, attempts: 18, source: "explicit" });
  const mixed = { ...explicit }; delete mixed[18];
  assert.equal(deriveRoundAchievements(round({ advancedStats: mixed }), [], OWNER)?.gir, null);
  assert.equal(deriveRoundAchievements(round({ advancedStats: mixed, putts: putts(2) }), [], OWNER)?.gir?.source, "mixed");
  const allFalse = Object.fromEntries(ORDER.map(hole => [hole, { principal: { greenInRegulation: false } }]));
  assert.equal(deriveRoundAchievements(round({ advancedStats: allFalse, putts: putts(2) }), [], OWNER)?.gir?.hit, 0);
  assert.equal(codes(round({ advancedStats: allFalse, putts: putts(2) })).includes("GIR_9_PLUS"), false);
});

test("mejor GIR personal sólo con 18 capturas y baseline anterior; etiquetas determinísticas", () => {
  const lowGir = Object.fromEntries(ORDER.map(hole => [hole, { principal: { greenInRegulation: hole <= 8 } }]));
  const highGir = Object.fromEntries(ORDER.map(hole => [hole, { principal: { greenInRegulation: hole <= 9 } }]));
  const prior = round({ id: "prior", date: "2026-09-14", advancedStats: lowGir });
  const current = round({ advancedStats: highGir });
  const summary = deriveRoundAchievements(current, [prior], OWNER)!;
  assert.equal(summary.previousComparableGirBest, 8);
  assert.equal(summary.gir?.hit, 9);
  assert.ok(summary.achievements.some(item => item.code === "PERSONAL_BEST_GIR_18H"));
  assert.ok(roundAchievementLabels(summary).includes("Mejor GIR personal · 18 hoyos"));
  assert.ok(roundAchievementLabels(summary).includes("9 GIR de 18 hoyos"));
  assert.equal(codes(current).includes("PERSONAL_BEST_GIR_18H"), false);
  assert.equal(codes(current, [round({ ...prior, advancedStats: highGir })]).includes("PERSONAL_BEST_GIR_18H"), false);
  const incompletePrior = { ...lowGir }; delete incompletePrior[18];
  assert.equal(codes(current, [round({ ...prior, advancedStats: incompletePrior })]).includes("PERSONAL_BEST_GIR_18H"), false);
  assert.equal(codes(round(), [prior]).includes("PERSONAL_BEST_GIR_18H"), false);
});

test("material SHA-256 permanece estable ante likes/caption/avatar/notes/timestamps y cambia con deporte/resultados", async () => {
  const source = round({ putts: putts(), updatedAt: "2026-09-15T20:00:00Z" });
  const first = await roundMaterialFingerprint(source, OWNER);
  assert.match(first || "", /^[a-f0-9]{64}$/);
  const cosmetics = { ...source, updatedAt: "2026-09-16T20:00:00Z", completedAt: "2026-09-16T20:00:00Z",
    caption: "Nueva leyenda", likes: 500, comments: ["¡bien!"], avatar: "https://x.invalid/avatar.png",
    advancedStats: { 1: { principal: { notes: "Texto privado" } } },
  } as RoundSnapshot & Record<string, unknown>;
  assert.equal(await roundMaterialFingerprint(cosmetics, OWNER), first);
  const variants = [
    round({ scores: { ...scores(), 1: { principal: 5, rival: 4 } } }),
    round({ courseSnapshot: { ...source.courseSnapshot!, holes: HOLES.map(hole => hole.number === 1 ? { ...hole, par: 5 } : hole) } }),
    round({ advancedStats: { 1: { principal: { penaltyStrokes: 1 } } } }),
    round({ advancedStats: { 1: { principal: { penaltyAreaCount: 1, outOfBoundsCount: 1 } } } }),
    round({ betResult: 101 }),
    round({ categoryResults: { foursome: 101 } }),
  ];
  for (const variant of variants) assert.notEqual(await roundMaterialFingerprint(variant, OWNER), first);
  const financial = round({ ...source, personalResults: [{ rivalKey: "rival", rivalName: "Nombre A", totalMoney: 25,
    componentMoney: { first: 25 } }] });
  const financialRevision = await roundMaterialFingerprint(financial, OWNER);
  assert.notEqual(financialRevision, first);
  assert.equal(await roundMaterialFingerprint({ ...financial, personalResults: [{ ...financial.personalResults![0], rivalName: "Nombre B" }] }, OWNER), financialRevision);
  assert.notEqual(await roundMaterialFingerprint({ ...financial, personalResults: [{ ...financial.personalResults![0], totalMoney: 26 }] }, OWNER), financialRevision);
  assert.equal(await roundMaterialFingerprint(source, "missing-account"), null);
  assert.equal(roundMaterialPayload(round({ lifecycleState: "live" }), OWNER), null);
  const reorder = { ...source, scores: Object.fromEntries([...Object.entries(source.scores!)].reverse()) };
  assert.equal(await roundMaterialFingerprint(reorder, OWNER), first);
});

test("material de 9 hoyos admite revisión pero nunca inventa logro 18H", async () => {
  const nine = round({ roundHoles: 9, order: ORDER.slice(0, 9) });
  assert.match(await roundMaterialFingerprint(nine, OWNER) || "", /^[a-f0-9]{64}$/);
  assert.equal(deriveRoundAchievements(nine, [], OWNER), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PremiumScorecard, GolfScoreSymbol } from "../app/components/premium-scorecard";
import { QuickHoleEditor } from "../app/components/quick-hole-editor";
import { canQuickEditPlayer, golfResult, prepareQuickHole, quickDraftErrors, scorecardCells, summarizeScorecard, toParText, type QuickEditAccess } from "../lib/premium-scorecard";
import { scorecardViewFromSearch, scorecardViewHref } from "../lib/scorecard-view";
import { persistRoundDraftCheckpoint } from "../lib/round-review";
import { STORAGE_KEYS } from "../lib/round-utils";
import type { Course, Player, AdvancedStatsByHole } from "../lib/types";
import { qaAccess, qaAdvanced, qaCourse, qaOrder, qaPlayer, qaPutts, qaScores } from './fixtures/scorecard-ux';

// These deliberately synthetic values exist only in the test suite.
const player: Player = { id: "owner", name: "Test owner", handicap: 7, accountUserId: "test-account" };
const other: Player = { id: "other", name: "Test opponent", handicap: 10, accountUserId: "other-account" };
const course: Course = { id: "test-course", name: "Test course", teeName: "Test tee", holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: index === 2 ? 3 : 4, strokeIndex: index + 1, yards: 300 + index })) };
const order = course.holes.map(hole => hole.number);
const access: QuickEditAccess = { currentDraft: true, roundId: "test-round", readOnly: false, closed: false, ownerId: player.id, accountUserId: player.accountUserId, organizerAccountUserId: player.accountUserId, lifecycle: "live" };
const scores = Object.fromEntries(order.map(number => [number, { owner: number === 1 ? 2 : number === 2 ? 3 : number === 4 ? 5 : number === 5 ? 6 : course.holes[number - 1].par, other: 5 }]));
const advancedStats: AdvancedStatsByHole = { 1: { owner: { fairwayHit: true, greenInRegulation: false, penaltyStrokes: 0, teeClub: "Test club" } }, 2: { owner: { fairwayHit: false } }, 3: { owner: { fairwayHit: true, teeDirection: "left" } } };
const cells = () => scorecardCells({ course, order, scores, advancedStats, putts: { 1: { owner: 0 }, 2: { owner: 2 } }, playerId: player.id });

test("gross symbols distinguish eagle, birdie, par, bogey and double without relying on color", () => {
  for (const [score, result] of [[2, "eagle"], [3, "birdie"], [4, "par"], [5, "bogey"], [6, "double"], [9, "double"], [1, "eagle"]] as const) {
    assert.equal(golfResult(score, 4), result);
    const markup = renderToStaticMarkup(createElement(GolfScoreSymbol, { score, result }));
    assert.match(markup, new RegExp(`data-result="${result}"`));
    assert.match(markup, /aria-label="\d+ golpes,/);
  }
  for (const bad of [null, undefined, 0, -1, NaN, Infinity, "4", 4.5]) assert.equal(golfResult(bad, 4), "pending");
  assert.equal(golfResult(4, 0), "pending");
  assert.equal(toParText(0), "E"); assert.equal(toParText(null), "—"); assert.equal(toParText(-1), "−1");
});

test("front, back and total are actual gross; missing stats stay missing and captured zero stays zero", () => {
  const all = cells(), front = summarizeScorecard(all.slice(0, 9)), back = summarizeScorecard(all.slice(9)), total = summarizeScorecard(all);
  assert.equal(front.gross, 35); assert.equal(back.gross, 36); assert.equal(total.gross, 71);
  assert.equal(total.par, 71); assert.equal(total.toPar, 0);
  assert.deepEqual(total.putts, { value: 2, captured: 2, possible: 18 });
  assert.deepEqual(total.fir, { value: 1, captured: 2, possible: 17 });
  assert.deepEqual(total.gir, { value: 0, captured: 1, possible: 18 });
  assert.deepEqual(total.penalties, { value: 0, captured: 1, possible: 18 });
  assert.equal(all[2].fir, null); assert.equal(all[2].gir, null); assert.equal(all[0].putts, 0); assert.equal(all[2].putts, null);
  assert.equal(summarizeScorecard(all.slice(9)).putts.value, null);
});

test("partial/9-hole/start-back/individual frozen tees never invent a score or full-round differential", () => {
  const partial = scorecardCells({ course, order: [10, 11, 12], playerId: player.id, scores: { 10: { owner: 5 } } });
  assert.equal(partial[1].score, null);
  assert.deepEqual({ gross: summarizeScorecard(partial).gross, par: summarizeScorecard(partial).par, delta: summarizeScorecard(partial).toPar, captured: summarizeScorecard(partial).scored }, { gross: 5, par: 12, delta: 1, captured: 1 });
  const individual = { ...course, playerHoleCards: { owner: [{ ...course.holes[0], par: 5 }] } };
  const frozen = scorecardCells({ course: individual, playerId: player.id, order: [1, 2, 1, 99], scores: { 1: { owner: 4 } } });
  assert.equal(frozen.length, 1); assert.equal(frozen[0].result, "birdie");
  assert.equal(summarizeScorecard(scorecardCells({ course, order: order.slice(0, 9), playerId: player.id, scores: {} })).gross, null);
});

test("ownership, shared, GHIN, cancelled and closed rounds fail closed; historical edits use the existing correction flow", () => {
  assert.equal(canQuickEditPlayer(access, player), true);
  assert.equal(canQuickEditPlayer(access, other), false);
  for (const patch of [{ currentDraft: false }, { readOnly: true }, { closed: true }, { lifecycle: "cancelled" as const }, { roundId: "shared:test" }, { roundId: "ghin:test" }, { accountUserId: "wrong" }, { organizerAccountUserId: "wrong" }]) {
    assert.equal(canQuickEditPlayer({ ...access, ...patch }, player), false);
    assert.throws(() => prepareQuickHole({ access: { ...access, ...patch }, player, hole: course.holes[0], scores, edits: {}, putts: {}, advancedStats, draft: { score: 4, putts: null, advanced: {} } }), /solo lectura/);
  }
});

test("confirmed quick capture composes existing capture logic without mutating opponents, pending edits or input", () => {
  const input = { access, player, hole: course.holes[0], scores, edits: { 1: { owner: 7, other: 6 }, 2: { other: 8 } }, putts: { 1: { owner: 2, other: 3 } }, advancedStats, draft: { score: 3, putts: 0, advanced: { fairwayHit: false, teeDirection: "right" as const, greenInRegulation: true, penaltyStrokes: 0 } } };
  const before = JSON.stringify(input), next = prepareQuickHole(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(next.scores[1], { owner: 3, other: 5 }); assert.deepEqual(next.edits, { 1: { other: 6 }, 2: { other: 8 } });
  assert.deepEqual(next.putts[1], { owner: 0, other: 3 }); assert.equal(next.advancedStats[1].owner?.teeClub, undefined);
  assert.deepEqual(next.advancedStats[2], advancedStats[2]);
  const cleared = prepareQuickHole({ ...input, draft: { ...input.draft, putts: null } });
  assert.equal(Object.hasOwn(cleared.putts[1], "owner"), false);
  const par3 = prepareQuickHole({ ...input, hole: course.holes[2] });
  assert.equal(par3.advancedStats[3].owner?.fairwayHit, undefined); assert.equal(par3.advancedStats[3].owner?.teeDirection, "right");
});

test("invalid quick capture cannot reach persistence, and durable checkpoint detects storage failure", () => {
  for (const draft of [{ score: null, putts: null, advanced: {} }, { score: 4, putts: 5, advanced: {} }, { score: 0, putts: 0, advanced: {} }, { score: 4, putts: 1, advanced: { penaltyStrokes: -1 } }]) {
    assert.ok(quickDraftErrors(draft).length);
    assert.throws(() => prepareQuickHole({ access, player, hole: course.holes[0], scores, edits: {}, putts: {}, advancedStats, draft }));
  }
  const saved = new Map<string, string>();
  const storage = { setItem: (key: string, value: string) => { saved.set(key, value); }, getItem: (key: string) => saved.get(key) ?? null };
  const prepared = prepareQuickHole({ access, player, hole: course.holes[0], scores, edits: {}, putts: {}, advancedStats, draft: { score: 4, putts: 0, advanced: {} } });
  const evidence = { roundId: "test-round", ghin: { externalId: "test-ghin" }, atestVersion: 3, history: ["immutable-test-evidence"], currentIndex: 4 };
  persistRoundDraftCheckpoint(storage, { ...evidence, ...prepared });
  const reloaded = JSON.parse(saved.get(STORAGE_KEYS.draft)!);
  assert.equal(reloaded.scores[1].owner, 4); assert.equal(reloaded.putts[1].owner, 0);
  assert.deepEqual(reloaded.ghin, evidence.ghin); assert.deepEqual(reloaded.history, evidence.history); assert.equal(reloaded.currentIndex, 4);
  assert.throws(() => persistRoundDraftCheckpoint({ setItem() {}, getItem: () => null }, prepared), /comprobar/);
  assert.throws(() => persistRoundDraftCheckpoint({ setItem() { throw new Error("quota"); }, getItem: () => null }, prepared), /quota/);
});

test("round → card → hole → card → round keeps parent navigation and rejects invalid objects", () => {
  const round = "/?screen=historyDetail&career=rondas&filter=year";
  const card = scorecardViewHref(round.split("?")[1], "test-round", { kind: "card" });
  const hole = scorecardViewHref(card.split("?")[1], "test-round", { kind: "hole", hole: 7, playerId: player.id });
  assert.deepEqual(scorecardViewFromSearch(hole.split("?")[1], "test-round", order, [player.id]), { kind: "hole", hole: 7, playerId: player.id });
  assert.equal(scorecardViewHref(hole.split("?")[1], "test-round", { kind: "card" }), card);
  assert.equal(scorecardViewHref(card.split("?")[1], "test-round", { kind: "round" }), round);
  assert.deepEqual(scorecardViewFromSearch(hole.split("?")[1], "another-round", order, [player.id]), { kind: "round" });
  assert.deepEqual(scorecardViewFromSearch("?card=test-round&cardHole=99&cardPlayer=owner", "test-round", order, [player.id]), { kind: "card" });
  assert.deepEqual(scorecardViewFromSearch("?card=test-round&cardHole=1&cardPlayer=intruder", "test-round", order, [player.id]), { kind: "card" });
});

test("scorecard and manual hole detail expose real data, readable labels and read-only actions", () => {
  const props = { roundId: "test-round", course, players: [player, other], order, scores, advancedStats, putts: { 1: { owner: 0 } }, ownerId: player.id, accountUserId: player.accountUserId, onBack() {}, onHole() {} };
  const card = renderToStaticMarkup(createElement(PremiumScorecard, { ...props, view: { kind: "card" } }));
  for (const label of ["Tarjeta de golf", "Ida", "1–9", "Vuelta", "10–18", "Ida / OUT", "Vuelta / IN", "TOTAL", "Solo lectura", "Eagle o mejor", "Doble bogey o más"]) assert.ok(card.includes(label), label);
  assert.match(card, /aria-expanded="false"/);
  assert.doesNotMatch(card, /Stroke index|Distancia · yd/);
  const focused = renderToStaticMarkup(createElement(PremiumScorecard, { ...props, initialPlayerId: player.id, view: { kind: "card" } }));
  assert.match(focused, /Stroke index/); assert.match(focused, /Distancia · yd/);
  assert.equal((focused.match(/data-scorecard-player=/g) ?? []).length, 2, 'expanded statistics keep both players');
  assert.match(card, /scope="row"/); assert.match(card, /Ver detalle del hoyo 1/); assert.doesNotMatch(card, /Editar score|undefined|NaN|Strokes Gained|GHIN verificado/);
  const hole = renderToStaticMarkup(createElement(PremiumScorecard, { ...props, view: { kind: "hole", hole: 1, playerId: player.id } }));
  assert.match(hole, /Sin golpes registrados/); assert.match(hole, /premiumHolePrimary/); assert.match(hole, /Volver a tarjeta/);
  assert.doesNotMatch(hole, /Capturar este hoyo|Golpe 1/);
  const editable = renderToStaticMarkup(createElement(PremiumScorecard, { ...props, access, onSaveHole() {}, view: { kind: "card" } }));
  assert.match(editable, /Editar score del hoyo 1/);
  const otherHole = renderToStaticMarkup(createElement(PremiumScorecard, { ...props, onRequestEdit() {}, view: { kind: "hole", hole: 1, playerId: other.id } }));
  assert.doesNotMatch(otherHole, /Corregir ronda con el flujo autorizado|Capturar este hoyo|Editar score/);
});

test('controlled fixture renders captured zero, missing and not applicable separately; FIR never substitutes direction', () => {
  const props = { roundId: qaAccess.roundId, course: qaCourse, players: [qaPlayer], order: qaOrder, scores: qaScores, advancedStats: qaAdvanced, putts: qaPutts, ownerId: qaPlayer.id, onBack() {}, onHole() {} };
  const markup = renderToStaticMarkup(createElement(PremiumScorecard, { ...props, view: { kind: 'card' } }));
  for (const label of ['FIR', 'Salida', 'GIR', 'Penalidades', 'No aplicable', 'Sin capturar', 'Nombre completo del campo']) assert.ok(markup.includes(label), label);
  assert.match(markup, /aria-label="No aplicable"[^>]*>N\/A/);
  assert.match(markup, /aria-label="Sin capturar"[^>]*>—/);
  const fixture = scorecardCells({ ...props, playerId: qaPlayer.id });
  assert.equal(fixture[0].putts, 0); assert.equal(fixture[0].stat.penaltyStrokes, 0);
  assert.equal(fixture[2].fir, null); assert.equal(fixture[5].putts, null); assert.equal(fixture[5].gir, null);
  const hole = renderToStaticMarkup(createElement(PremiumScorecard, { ...props, view: { kind: 'hole', hole: 1, playerId: qaPlayer.id } }));
  assert.match(hole, /<dt>Putts<\/dt><dd>0<\/dd>/);
  assert.match(hole, /<dt>Penalidades<\/dt><dd>0<\/dd>/);
  assert.ok(hole.indexOf('premiumHolePrimary') < hole.indexOf('premiumHoleAdvanced'));
  assert.equal((hole.match(/aria-label="Volver a tarjeta"/g) ?? []).length, 1);
  assert.doesNotMatch(hole, /<h2>Sin golpes/);
});

test('QA navigation stays on its isolated pathname and confirmed edit affects only the in-memory fixture', () => {
  const href = scorecardViewHref('', qaAccess.roundId, { kind: 'card' }, '/qa/scorecard');
  assert.equal(href, '/qa/scorecard?card=qa-memory-round');
  const before = JSON.stringify({ qaScores, qaAdvanced, qaPutts });
  const next = prepareQuickHole({ access: qaAccess, player: qaPlayer, hole: qaCourse.holes[3], scores: qaScores, edits: {}, putts: qaPutts, advancedStats: qaAdvanced, draft: { score: 4, putts: 1, advanced: { fairwayHit: true, teeDirection: 'center', greenInRegulation: true, penaltyStrokes: 0 } } });
  assert.equal(next.scores[4][qaPlayer.id], 4); assert.equal(next.putts[4][qaPlayer.id], 1);
  assert.equal(next.advancedStats[4][qaPlayer.id]?.greenInRegulation, true);
  assert.equal(JSON.stringify({ qaScores, qaAdvanced, qaPutts }), before);
});

test("quick editor renders saved values without invoking any write; no value is invented for missing putts", () => {
  let writes = 0;
  const markup = renderToStaticMarkup(createElement(QuickHoleEditor, { cell: cells()[0], playerName: player.name, onCancel() {}, onSave() { writes++; } }));
  assert.equal(writes, 0); assert.match(markup, /role="dialog"/); assert.match(markup, /aria-modal="true"/);
  for (const label of ["Cancelar", "Guardar", "Captura avanzada", "Aumentar Score", "Disminuir Putts", "Fairway", "Izquierda", "Derecha"]) assert.ok(markup.includes(label), label);
  assert.match(markup, /aria-label="Putts"[^>]*value="0"/);
  const missing = renderToStaticMarkup(createElement(QuickHoleEditor, { cell: cells()[2], playerName: player.name, onCancel() {}, onSave() { writes++; } }));
  assert.match(missing, /Putts sin capturar/); assert.match(missing, /FIR no aplica · par 3/); assert.equal(writes, 0);
});

test('advanced capture persists supported fields through the same checkpoint and preserves unedited evidence', () => {
  const draft = { score: 5, putts: 2, advanced: { teeDirection: 'far_right' as const, fairwayHit: false, greenInRegulation: false, bunkerCount: 1, penaltyStrokes: 2, penaltyAreaCount: 1, outOfBounds: true, outOfBoundsCount: 1, teeClub: '5 Wood', teeDistance: 241.5, firstPuttDistanceFeet: 15, notes: 'Private test note' } };
  const next = prepareQuickHole({ access, player, hole: course.holes[0], scores, edits: {}, putts: {}, advancedStats, draft });
  assert.deepEqual(next.advancedStats[1][player.id], draft.advanced);
  assert.equal(next.putts[1][player.id], 2);
  assert.equal(next.scores[1][other.id], scores[1].other);
  const preserved = { history: ['original'], source: 'GHIN', atest: ['original'], shots: ['original'], bets: { enabled: false } };
  let serialized: string | null = null;
  persistRoundDraftCheckpoint({ setItem(_key, value) { serialized = value; }, getItem() { return serialized; } }, { ...preserved, ...next });
  const saved = JSON.parse(serialized!);
  for (const key of Object.keys(preserved) as Array<keyof typeof preserved>) assert.deepEqual(saved[key], preserved[key]);
  assert.deepEqual(saved.advancedStats[1][player.id], draft.advanced);
});

test('hole table follows the reference row order, supplies OUT totals in the grid and omits unavailable optional facts', () => {
  const markup = renderToStaticMarkup(createElement(PremiumScorecard, { roundId: 'test-round', course, players: [player], ownerId: player.id, order, scores, putts: { 1: { owner: 0 } }, advancedStats, view: { kind: 'card' }, onBack() {}, onHole() {} }));
  const labels = ['Distancia · yd', 'Stroke index', 'Par</th>', 'Score gross', 'Putts</th>', 'FIR / Salida', 'Bastón</th>', 'GIR</th>', 'Penalidades</th>'];
  let last = -1;
  for (const label of labels) { const position = markup.indexOf(label); assert.ok(position > last, label); last = position; }
  assert.match(markup, /class="scorecardAggregate">OUT/);
  assert.match(markup, /class="scorecardAggregate"><strong>35<\/strong><small>E<\/small>/);
  const empty = renderToStaticMarkup(createElement(PremiumScorecard, { roundId: 'test-round', course, players: [player], order, scores, view: { kind: 'card' }, onBack() {}, onHole() {} }));
  assert.doesNotMatch(empty, /FIR \/ Salida|Penalidades<\/th>|Bastón<\/th>|GIR<\/th>/);
  assert.match(empty, /aria-label="Sin capturar"/);
  assert.doesNotMatch(empty, /Score net/);
});

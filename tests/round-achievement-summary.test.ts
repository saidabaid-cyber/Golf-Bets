import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoundAchievementSummary } from "../app/components/round-achievement-summary";
import type { RoundSnapshot } from "../lib/types";

const OWNER = "qa-owner-account";
const holes = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 }));
const order = holes.map(hole => hole.number);
function round(id: string, date: string, score = 4): RoundSnapshot {
  return {
    id, lifecycleState: "completed", date, roundHoles: 18, courseName: "Campo QA", teeName: "Blancas",
    ownerName: "Nombre QA", ownerId: "player", players: [{ id: "player", name: "Nombre QA", handicap: 0, accountUserId: OWNER }],
    courseSnapshot: { id: "qa-course", name: "Campo QA", teeName: "Blancas", holes }, order,
    scores: Object.fromEntries(order.map(hole => [hole, { player: score }])),
    betResult: 0, expenseTotal: 0, netResult: 0, categoryResults: {},
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
  };
}
function markup(snapshot: RoundSnapshot, priorRounds: RoundSnapshot[] = [], accountUserId = OWNER) {
  return renderToStaticMarkup(createElement(RoundAchievementSummary, { round: snapshot, priorRounds, accountUserId }));
}

test("render real Histórico acredita un resumen local con PB, birdie, águila, putts y GIR completos", () => {
  const prior = round("old", "2026-09-14", 5);
  prior.advancedStats = Object.fromEntries(order.map(hole => [hole, { player: { greenInRegulation: false } }]));
  const current = round("new", "2026-09-15");
  current.scores![1].player = 3; current.scores![2].player = 2;
  current.putts = Object.fromEntries(order.map(hole => [hole, { player: 2 }]));
  const html = markup(current, [prior]);
  for (const phrase of ["Logros deportivos", "Mejor score personal", "Mejor GIR personal", "1 birdie", "1 águila", "Sin 3 putts", "18 GIR de 18 hoyos"]) {
    assert.match(html, new RegExp(phrase));
  }
  assert.match(html, /Un resumen verificable de esta ronda/);
  assert.match(html, /no es un attest/);
  assert.equal((html.match(/<section/g) || []).length, 1, "un solo resumen por ronda");
});

test("render 9H explica no elegibilidad sin generar badges; la ronda no se elimina", () => {
  const nine = round("nine", "2026-09-15"); nine.roundHoles = 9; nine.order = order.slice(0, 9);
  const html = markup(nine);
  assert.match(html, /Ronda de 9 hoyos: no elegible/);
  assert.match(html, /Su tarjeta y resultado permanecen en Histórico/);
  assert.doesNotMatch(html, /Logros verificados|Mejor score personal|Sin 3 putts/);
});

test("render no acredita logros a otro accountUserId ni inventa putts/GIR sin captura", () => {
  const current = round("current", "2026-09-15");
  assert.equal(markup(current, [], "different-account"), "");
  const html = markup(current);
  assert.match(html, /Sin captura completa/);
  assert.match(html, /Evidencia insuficiente/);
  assert.doesNotMatch(html, /Sin 3 putts|9 GIR de 18 hoyos/);
});

test("detalle histórico conserva CloudSocialActivity y añade resumen local sin exigir token", () => {
  const source = readFileSync(join(process.cwd(), "app/components/historical-round-detail.tsx"), "utf8");
  assert.match(source, /<RoundAchievementSummary round=\{round\} priorRounds=\{priorRounds\} accountUserId=\{accountUserId\}/);
  assert.match(source, /accountUserId && accessToken && <RoundSharingPanel/);
  const sharing = readFileSync("app/components/round-sharing-panel.tsx", "utf8");
  assert.match(sharing, /Compartir con jugadores/);
  assert.match(sharing, /<CloudSocialActivity/);
  assert.match(sharing, /<SocialSharingPreferences/);
});

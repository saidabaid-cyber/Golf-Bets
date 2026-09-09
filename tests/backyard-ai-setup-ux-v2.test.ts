import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { groupNassauReviewItems } from "../lib/backyard-ai/round-review/group-nassau";
import { initialBets } from "../lib/new-round-bets";

const setup = readFileSync("app/components/backyard-ai/ai-round-setup.tsx", "utf8");
const review = readFileSync("app/components/backyard-ai/ai-round-review.tsx", "utf8");
const groupNassauReview = readFileSync("lib/backyard-ai/round-review/group-nassau.ts", "utf8");

test("CAMBIAR ALGO lleva al composer, lo enfoca y anuncia el modo de edición", () => {
  assert.match(setup, /composerRef\.current\?\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(setup, /textareaRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(setup, /¿Qué quieres cambiar\?/);
  assert.match(setup, /setEditing\(true\)/);
  assert.match(setup, /const usesHandicapForm = !editing && handicapTargets\.length > 0/);
  assert.match(setup, /busy \? "Entendiendo…" : editing \? "Aplicar cambio" : question \? "Confirmar respuesta"/);
});

test("los HCP faltantes se capturan juntos y Confirmar respuesta da feedback visible", () => {
  assert.match(setup, /question\?\.code === "missing_player_handicaps"/);
  assert.match(setup, /question\.playerTargets/);
  assert.match(setup, /className=\{styles\.handicapGrid\}/);
  assert.match(setup, /HCP de \$\{target\.label\}/);
  assert.match(setup, /handicapAnswerReady/);
  assert.match(setup, /question \? "Confirmar respuesta" : "Preparar mi ronda"/);
});

test("TU RONDA usa estados honestos y checklist, nunca porcentaje de completitud", () => {
  assert.match(review, /"LISTO"/);
  assert.match(review, /"CASI LISTO"/);
  assert.match(review, /"FALTA INFORMACIÓN"/);
  assert.match(review, /FALTA COMPLETAR/);
  assert.match(review, /draft\.courseIdentity\?\.name/);
  assert.doesNotMatch(review, /% interpretado/);
  assert.doesNotMatch(review, /Math\.round\(confidence/);
});

test("cada fila pendiente abre su propia pregunta y Cambiar algo no contesta otra por accidente", () => {
  assert.match(review, /onResolveQuestion\(item\.question\)/);
  assert.match(setup, /function resolveQuestion\(selected: RoundSetupQuestion\)/);
  assert.match(setup, /questions: \[question, \.\.\.questions\]/);
  assert.match(setup, /const focusedQuestion = editing \? undefined : plan\?\.questions\[0\]/);
});

test("Nassau conserva el término pedido mientras el engine usa componentes Polla", () => {
  assert.match(review, /groupNassauTerm === "nassau"/);
  assert.match(review, /groupNassauReviewItems\(draft\.bets\.polla\)/);
  assert.match(groupNassauReview, /label: "Frente"/);
  assert.match(groupNassauReview, /label: "Vuelta"/);
  assert.match(groupNassauReview, /label: "Total"/);
});

test("la revisión sólo colapsa Nassau cuando monto, roster, HCP y redondeo coinciden", () => {
  const bets = initialBets(["said", "pedro", "juan", "carlos"]);
  bets.polla.first9 = { ...bets.polla.first9, enabled: true, value: 500, hcpPct: 100, decimals: "round", participantIds: ["said", "pedro", "juan", "carlos"] };
  bets.polla.second9 = { ...bets.polla.second9, enabled: true, value: 500, hcpPct: 100, decimals: "round", participantIds: ["said", "pedro", "juan", "carlos"] };
  bets.polla.total18 = { ...bets.polla.total18, enabled: true, value: 500, hcpPct: 100, decimals: "round", participantIds: ["said", "pedro", "juan", "carlos"] };

  const collapsed = groupNassauReviewItems(bets.polla);
  assert.deepEqual(collapsed.map((item) => [item.id, item.label, item.componentLabels]), [
    ["nassau", "Nassau", ["Frente", "Vuelta", "Total"]],
  ]);

  bets.polla.second9 = { ...bets.polla.second9, participantIds: ["said", "pedro", "juan"] };
  bets.polla.total18 = { ...bets.polla.total18, value: 700, hcpPct: 80, decimals: "partial" };
  const divergent = groupNassauReviewItems(bets.polla);
  assert.deepEqual(divergent.map((item) => item.id), ["nassau-first9", "nassau-second9", "nassau-total18"]);
  assert.deepEqual(divergent.map((item) => item.label), ["Nassau · Frente", "Nassau · Vuelta", "Nassau · Total"]);
  assert.deepEqual(divergent.map((item) => [item.config.value, item.config.participantIds, item.config.hcpPct, item.config.decimals]), [
    [500, ["said", "pedro", "juan", "carlos"], 100, "round"],
    [500, ["said", "pedro", "juan"], 100, "round"],
    [700, ["said", "pedro", "juan", "carlos"], 80, "partial"],
  ]);
});

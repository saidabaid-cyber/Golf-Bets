import assert from "node:assert/strict";
import test from "node:test";

import type { BackyardProfile } from "../lib/account-state";
import { roundSetupAnswerCommand } from "../lib/backyard-ai/runtime/answer-command";
import { planRoundSetup } from "../lib/backyard-ai/runtime/round-setup";
import { createRoundSetupDraft } from "../lib/backyard-ai/schemas/round-setup";
import type { Course, Player } from "../lib/types";

const players: Player[] = [
  { id: "said", name: "Said", handicap: 8, accountUserId: "user-said" },
  { id: "pedro", name: "Pedro", handicap: 10 },
  { id: "juan", name: "Juan", handicap: 12 },
  { id: "carlos", name: "Carlos", handicap: 14 },
];
const course: Course = {
  id: "la-vista",
  name: "La Vista",
  teeName: "Azules",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};
const profile: BackyardProfile = { userId: "user-said", displayName: "Said", email: "", avatarUrl: "", defaultHandicap: 8, homeClub: "La Vista", preferredTee: "Azules" };
let sequence = 0;
const context = (activeDraft = createRoundSetupDraft({ date: "2026-09-07", course, players, ownerId: "said" })) => ({
  profile,
  frequentPlayers: players.slice(1).map((player) => ({ id: player.id, name: player.name, handicap: player.handicap, uses: 1, updatedAt: "2026-09-07" })),
  frequentGroups: [],
  history: [],
  courses: [course],
  today: "2026-09-07",
  activeDraft,
  idFactory: () => `answer-${++sequence}`,
});

test("la aclaración de pareja reconstruye Dollar a Stroke sin copiar el texto de la pregunta", () => {
  const first = planRoundSetup("Dollar a Stroke de 20.", context());
  const question = first.questions.find((candidate) => candidate.field === "supplementalBets.dollar_stroke.players");
  const command = roundSetupAnswerCommand(question, "Said y Pedro", first, "Dollar a Stroke de 20.");
  const resolved = planRoundSetup(command, context());
  const bet = resolved.draft.supplementalBets.find((candidate) => candidate.type === "dollar_stroke");

  assert.equal(command, "Dollar a Stroke Said contra Pedro de 20. Dollar a Stroke de 20.");
  assert.ok(bet && bet.type === "dollar_stroke");
  assert.equal(bet.valuePerStroke, 20);
  assert.equal(resolved.canConfirm, true);
});

test("la aclaración de equipos conserva modalidad y monto para Vegas", () => {
  const first = planRoundSetup("Vegas de 10.", context());
  const question = first.questions.find((candidate) => candidate.field === "supplementalBets.vegas.teams");
  const command = roundSetupAnswerCommand(question, "Said/Juan contra Pedro/Carlos", first, "Vegas de 10.");
  const resolved = planRoundSetup(command, context());
  const bet = resolved.draft.supplementalBets.find((candidate) => candidate.type === "vegas");

  assert.equal(command, "Vegas Said/Juan contra Pedro/Carlos de 10. Vegas de 10.");
  assert.ok(bet && bet.type === "vegas");
  assert.deepEqual(new Set(bet.teamA), new Set(["said", "juan"]));
  assert.equal(resolved.canConfirm, true);
});

test("las aclaraciones de Presses y Polla producen un comando ejecutable y acotado", () => {
  const presses = planRoundSetup("Jugamos Presses.", context());
  const pressuresCommand = roundSetupAnswerCommand(presses.questions[0], "individuales de 100", presses, "Jugamos Presses.");
  assert.equal(pressuresCommand, "Presiones individuales de 100. Jugamos Presses.");
  assert.equal(planRoundSetup(pressuresCommand, context()).draft.supplementalBets.some((bet) => bet.type === "individual_pressures"), true);

  const polla = planRoundSetup("Polla de 300.", context());
  const pollaCommand = roundSetupAnswerCommand(polla.questions.find((question) => question.field === "bets.polla.variant"), "primera vuelta", polla, "Polla de 300.");
  const resolved = planRoundSetup(pollaCommand, context());
  assert.equal(pollaCommand, "Polla primera vuelta de 300. Polla de 300.");
  assert.equal(resolved.draft.bets.polla.first9.value, 300);
  assert.equal(resolved.draft.bets.polla.second9.enabled, false);
});

test("aclarar Presses conserva monto, exclusión y carry del turno original", () => {
  const first = planRoundSetup("Presses de 200 menos Carlos sin carry.", context());
  const question = first.questions.find((candidate) => candidate.field === "bets.pressures");
  assert.ok(question);
  const command = roundSetupAnswerCommand(question, "individuales", first, "Presses de 200 menos Carlos sin carry.");
  const resolved = planRoundSetup(command, context(first.draft));
  const bet = resolved.draft.supplementalBets.find((candidate) => candidate.type === "individual_pressures");
  assert.ok(bet && bet.type === "individual_pressures");
  assert.equal(bet.value, 200);
  assert.equal(bet.carryEnabled, false);
  assert.equal(bet.participantIds.includes("carlos"), false);
});

test("una respuesta desconocida no reinyecta el prompt ni activa modalidades mencionadas por la pregunta", () => {
  const plan = planRoundSetup("Agrega Oyes.", context());
  const question = plan.questions.find((candidate) => candidate.field === "bets.oyes");
  const command = roundSetupAnswerCommand(question, "Me refería a Skins de 50", plan, "Agrega Oyes.");

  assert.equal(command, "Me refería a Skins de 50");
  assert.equal(command.includes(question?.prompt ?? "__missing__"), false);
  assert.equal(planRoundSetup(command, context()).draft.bets.skins.value, 50);
});

test("dos montos faltantes permanecen en cola hasta que ambos fueron contestados", () => {
  const first = planRoundSetup("Skins y Conejos.", context());
  assert.equal(first.questions.length, 2);
  assert.equal(first.draft.bets.skins.enabled, false);
  assert.equal(first.draft.bets.rabbits.enabled, false);

  const firstQuestion = first.questions[0];
  const firstAnswer = firstQuestion.field === "bets.skins.value" ? "110" : "120";
  const commandOne = roundSetupAnswerCommand(firstQuestion, firstAnswer, first, "Skins y Conejos.");
  const second = planRoundSetup(commandOne, context(first.draft));
  assert.equal(second.questions.length, 1);
  assert.notEqual(second.questions[0].field, firstQuestion.field);

  const secondAnswer = second.questions[0].field === "bets.skins.value" ? "110" : "120";
  const commandTwo = roundSetupAnswerCommand(second.questions[0], secondAnswer, second, commandOne);
  const resolved = planRoundSetup(commandTwo, context(second.draft));
  assert.equal(resolved.questions.length, 0);
  assert.equal(resolved.draft.bets.skins.value, 110);
  assert.equal(resolved.draft.bets.rabbits.value, 120);
  assert.equal(resolved.canConfirm, true);
});

test("aclarar Dollar no descarta la pregunta pendiente de equipos Vegas", () => {
  const first = planRoundSetup("Dollar a Stroke de 20 y Vegas de 10.", context());
  const dollarQuestion = first.questions.find((question) => question.field === "supplementalBets.dollar_stroke.players");
  assert.ok(dollarQuestion);
  const commandOne = roundSetupAnswerCommand(dollarQuestion, "Said contra Pedro", first, "Dollar a Stroke de 20 y Vegas de 10.");
  const second = planRoundSetup(commandOne, context(first.draft));
  const vegasQuestion = second.questions.find((question) => question.field === "supplementalBets.vegas.teams");
  assert.ok(vegasQuestion);
  assert.equal(second.draft.supplementalBets.some((bet) => bet.type === "dollar_stroke"), true);

  const commandTwo = roundSetupAnswerCommand(vegasQuestion, "Said/Juan contra Pedro/Carlos", second, commandOne);
  const resolved = planRoundSetup(commandTwo, context(second.draft));
  assert.equal(resolved.questions.length, 0);
  assert.equal(resolved.draft.supplementalBets.some((bet) => bet.type === "dollar_stroke"), true);
  assert.equal(resolved.draft.supplementalBets.some((bet) => bet.type === "vegas"), true);
  assert.equal(resolved.canConfirm, true);
});

test("la respuesta de monto conserva el subconjunto explícito de participantes", () => {
  const first = planRoundSetup("Chicago Said y Juan.", context());
  const question = first.questions.find((candidate) => candidate.field === "supplementalBets.chicago.value");
  assert.ok(question);
  const command = roundSetupAnswerCommand(question, "25", first, "Chicago Said y Juan.");
  const resolved = planRoundSetup(command, context(first.draft));
  const chicago = resolved.draft.supplementalBets.find((bet) => bet.type === "chicago");
  assert.ok(chicago && chicago.type === "chicago");
  assert.deepEqual(new Set(chicago.participantIds), new Set(["said", "juan"]));
  assert.equal(chicago.valuePerPoint, 25);
});

test("la aclaración de instancia repetida reconstruye una modalidad ejecutable", () => {
  const draft = createRoundSetupDraft({ date: "2026-09-07", course, players, ownerId: "said" });
  const first = { id: "d1", type: "dollar_stroke" as const, enabled: true, playerAId: "said", playerBId: "pedro", valuePerStroke: 10, advantageStrokes: 0 };
  const second = { ...first, id: "d2", playerAId: "juan", playerBId: "carlos", valuePerStroke: 20 };
  draft.supplementalBets = [first, second];
  const ambiguous = planRoundSetup("Dollar a Stroke de 40.", context(draft));
  const question = ambiguous.questions.find((candidate) => candidate.field === "supplementalBets.dollar_stroke.instance");
  assert.ok(question);
  const command = roundSetupAnswerCommand(question, "Juan y Carlos", ambiguous, "Dollar a Stroke de 40.");
  const resolved = planRoundSetup(command, context(ambiguous.draft));
  assert.equal(resolved.questions.some((candidate) => candidate.field.endsWith(".instance")), false);
  const changed = resolved.draft.supplementalBets.find((bet) => bet.id === "d2");
  const unchanged = resolved.draft.supplementalBets.find((bet) => bet.id === "d1");
  assert.ok(changed?.type === "dollar_stroke" && unchanged?.type === "dollar_stroke");
  assert.equal(changed.valuePerStroke, 40);
  assert.equal(unchanged.valuePerStroke, 10);
});

test("una aclaración conserva HCP, redondeo, rotación y penalty ya especificados", () => {
  const first = planRoundSetup(
    "Vegas Said/Juan contra Pedro/Carlos con rotación por bloques de 6 hoyos, HCP 80%, .6 sube y con penalty birdie vs bogey.",
    context(),
  );
  const question = first.questions.find((candidate) => candidate.field === "supplementalBets.vegas.value");
  assert.ok(question);
  const command = roundSetupAnswerCommand(question, "10", first, "Vegas Said/Juan contra Pedro/Carlos con rotación por bloques de 6 hoyos, HCP 80%, .6 sube y con penalty birdie vs bogey.");
  const resolved = planRoundSetup(command, context(first.draft));
  const vegas = resolved.draft.supplementalBets.find((bet) => bet.type === "vegas");
  assert.ok(vegas && vegas.type === "vegas");
  assert.equal(vegas.valuePerUnit, 10);
  assert.equal(vegas.rotation, "blocks");
  assert.equal(vegas.blockSize, 6);
  assert.equal(vegas.hcpPct, 80);
  assert.equal(vegas.decimals, "six_up");
  assert.equal(vegas.birdiePenalty, true);
  assert.equal(resolved.canConfirm, true);
});

test("aclarar jugadores de Dollar conserva la ventaja explícita", () => {
  const first = planRoundSetup("Dollar a Stroke de 20 con 3 golpes de ventaja para Pedro.", context());
  const question = first.questions.find((candidate) => candidate.field === "supplementalBets.dollar_stroke.players");
  assert.ok(question);
  const command = roundSetupAnswerCommand(question, "Said y Pedro", first, "Dollar a Stroke de 20 con 3 golpes de ventaja para Pedro.");
  const resolved = planRoundSetup(command, context(first.draft));
  const dollar = resolved.draft.supplementalBets.find((bet) => bet.type === "dollar_stroke");
  assert.ok(dollar && dollar.type === "dollar_stroke");
  assert.equal(dollar.valuePerStroke, 20);
  assert.equal(dollar.advantageStrokes, 3);
  assert.equal(dollar.advantageReceiverId, "pedro");
  assert.equal(resolved.canConfirm, true);
});

test("aclarar monto de Polla conserva porcentaje y redondeo", () => {
  const first = planRoundSetup("Polla primera vuelta con HCP 75% y decimales cuentan.", context());
  const question = first.questions.find((candidate) => candidate.field === "bets.polla.first9.value");
  assert.ok(question);
  const command = roundSetupAnswerCommand(question, "250", first, "Polla primera vuelta con HCP 75% y decimales cuentan.");
  const resolved = planRoundSetup(command, context(first.draft));
  assert.equal(resolved.draft.bets.polla.first9.value, 250);
  assert.equal(resolved.draft.bets.polla.first9.hcpPct, 75);
  assert.equal(resolved.draft.bets.polla.first9.decimals, "partial");
  assert.equal(resolved.canConfirm, true);
});

test("la aclaración de Nassau individual incompleto conserva monto y nunca crea Nassau grupal", () => {
  const first = planRoundSetup("Nassau individual de 500.", context());
  const question = first.questions.find((candidate) => candidate.field === "supplementalBets.individual_nassau.players");
  assert.ok(question);

  const command = roundSetupAnswerCommand(question, "Said y Pedro", first, "Nassau individual de 500.");
  const resolved = planRoundSetup(command, context(first.draft));

  assert.equal(command, "Nassau individual Said contra Pedro de 500. Nassau individual de 500.");
  assert.equal(resolved.draft.personalBets.length, 1);
  assert.equal(resolved.draft.personalBets[0].rivalPlayerId, "pedro");
  assert.equal(resolved.draft.personalBets[0].baseValue, 500);
  assert.equal(resolved.draft.bets.polla.first9.enabled, false);
  assert.equal(resolved.canConfirm, true);
});

test("la aclaración de cuál Nassau personal cambiar modifica sólo la pareja elegida", () => {
  const first = planRoundSetup("Nassau Said contra Pedro de 500.", context());
  const second = planRoundSetup("Nassau Said contra Juan de 400.", context(first.draft));
  const ambiguous = planRoundSetup("Mejor Nassau de 300.", context(second.draft));
  const question = ambiguous.questions.find((candidate) => candidate.field === "supplementalBets.individual_nassau.instance");
  assert.ok(question);

  const command = roundSetupAnswerCommand(question, "Said y Pedro", ambiguous, "Mejor Nassau de 300.");
  const resolved = planRoundSetup(command, context(ambiguous.draft));
  const pedro = resolved.draft.personalBets.find((bet) => bet.rivalPlayerId === "pedro");
  const juan = resolved.draft.personalBets.find((bet) => bet.rivalPlayerId === "juan");

  assert.equal(pedro?.baseValue, 300);
  assert.equal(juan?.baseValue, 400);
  assert.equal(resolved.draft.bets.polla.first9.enabled, false);
  assert.equal(resolved.canConfirm, true);
});

test("la aclaración de presión de Peces conserva el monto y aplica el multiplicador real", () => {
  const first = planRoundSetup("Peces de 100 con presión.", context());
  const question = first.questions.find((candidate) => candidate.field === "bets.fish.secondNineMultiplier");
  assert.ok(question);

  const command = roundSetupAnswerCommand(question, "3", first, "Peces de 100 con presión.");
  const resolved = planRoundSetup(command, context(first.draft));

  assert.equal(resolved.draft.bets.fish.value, 100);
  assert.equal(resolved.draft.bets.fish.secondNinePressed, true);
  assert.equal(resolved.draft.bets.fish.secondNineMultiplier, 3);
  assert.equal(resolved.canConfirm, true);
});

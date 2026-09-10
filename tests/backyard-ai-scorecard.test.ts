import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeScorecardExtraction,
  normalizeScorecardPhotoExtractions,
} from "../lib/backyard-ai/scorecard/extractor";
import { validateScorecardExtraction } from "../lib/backyard-ai/scorecard/validator";
import type {
  ActiveScorecardRound,
  ScorecardExtraction,
  ScorecardTotalKind,
} from "../lib/backyard-ai/schemas/scorecard";

type RawCell = { playerName: string; hole: number; value: number | null; confidence: number; source?: string };
type RawTotal = { playerName: string; kind: "OUT" | "IN" | "TOTAL"; value: number; confidence: number; source?: string };
type RawPayload = {
  version: 1;
  course?: { value: string; confidence: number; source?: string };
  players?: Array<{ playerName: string; confidence: number; source?: string }>;
  cells: RawCell[];
  pars?: Array<{ hole: number; value: number | null; confidence: number; source?: string }>;
  totals?: RawTotal[];
};

const names = ["Said", "Pedro", "Juan", "Carlos"];
const playerIds = ["said", "pedro", "juan", "carlos"];
const holes = Array.from({ length: 18 }, (_, index) => index + 1);
const scoreFor = (playerIndex: number, hole: number) => 3 + ((playerIndex + hole) % 3);

const round: ActiveScorecardRound = {
  roundId: "round-ai-card",
  players: names.map((name, index) => ({ id: playerIds[index], name })),
  course: {
    id: "la-vista",
    name: "La Vista Country Club",
    aliases: ["La Vista"],
    holes: holes.map((number) => ({ number, par: number % 3 === 0 ? 3 : number % 2 === 0 ? 5 : 4 })),
  },
  startHole: 1,
  roundHoles: 18,
};

function totalFor(playerName: string, selectedHoles: readonly number[]) {
  const playerIndex = names.indexOf(playerName);
  return selectedHoles.reduce((sum, hole) => sum + scoreFor(playerIndex, hole), 0);
}

function payload(selectedHoles: readonly number[] = holes): RawPayload {
  const cells = names.flatMap((playerName, playerIndex) => selectedHoles.map((hole) => ({
    playerName,
    hole,
    value: scoreFor(playerIndex, hole),
    confidence: 0.98,
  })));
  const hasOut = selectedHoles.filter((hole) => hole <= 9).length === 9;
  const hasIn = selectedHoles.filter((hole) => hole >= 10).length === 9;
  const totals: RawTotal[] = names.flatMap((playerName) => [
    ...(hasOut ? [{ playerName, kind: "OUT" as const, value: totalFor(playerName, holes.slice(0, 9)), confidence: 0.97 }] : []),
    ...(hasIn ? [{ playerName, kind: "IN" as const, value: totalFor(playerName, holes.slice(9)), confidence: 0.97 }] : []),
    ...(selectedHoles.length === 18 ? [{ playerName, kind: "TOTAL" as const, value: totalFor(playerName, holes), confidence: 0.97 }] : []),
    ...(selectedHoles.length === 9 ? [{ playerName, kind: "TOTAL" as const, value: totalFor(playerName, selectedHoles), confidence: 0.97 }] : []),
  ]);
  return {
    version: 1,
    course: { value: "La Vista", confidence: 0.98 },
    players: names.map((playerName) => ({ playerName, confidence: 0.98 })),
    cells,
    totals,
  };
}

function extraction(raw: RawPayload = payload(), photoId = "photo-1"): ScorecardExtraction {
  const result = normalizeScorecardExtraction(raw, photoId);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.extraction;
}

function issueCodes(value: ReturnType<typeof validateScorecardExtraction>) {
  return value.issues.map((item) => item.code);
}

test("normaliza y fusiona extracción multi-foto conservando source por celda; payload inválido falla cerrado", () => {
  const first = payload(holes.slice(0, 9));
  const second = payload(holes.slice(9));
  const merged = normalizeScorecardPhotoExtractions([
    { photoId: "front-nine", payload: first },
    { photoId: "back-nine", payload: second },
  ]);
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.deepEqual(merged.extraction.sourceIds, ["front-nine", "back-nine"]);
  assert.equal(merged.extraction.cells.length, 72);
  assert.equal(merged.extraction.cells.filter((cell) => cell.source.photoId === "front-nine").length, 36);
  assert.equal(merged.extraction.cells.filter((cell) => cell.source.photoId === "back-nine").length, 36);

  const malformed = structuredClone(first);
  (malformed.cells[0] as unknown as { confidence: unknown }).confidence = "0.98";
  const rejected = normalizeScorecardPhotoExtractions([{ photoId: "bad", payload: malformed }]);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.issues[0].path, /cells\[0\]\.confidence/);
});

test("tarjeta completa de 18 hoyos acepta 72 scores y no expone campos correctos", () => {
  const result = validateScorecardExtraction(extraction(), round);
  assert.equal(result.ready, true);
  assert.equal(result.acceptedCells.length, 72);
  assert.deepEqual(result.issues, []);
  assert.equal(result.acceptedScores[14].juan, scoreFor(2, 14));
  assert.ok(result.acceptedCells.every((cell) => cell.acceptedFrom === "extraction"));
});

test("filas estructurales PAR/HCP duplicadas por visión no se tratan como jugadores ni dudas", () => {
  const raw = payload();
  raw.players!.push({ playerName: "PAR", confidence: 0.99 });
  raw.cells.push(...holes.map((hole) => ({
    playerName: "PAR",
    hole,
    value: round.course.holes.find((candidate) => candidate.number === hole)!.par,
    confidence: 0.99,
  })));
  raw.totals!.push({ playerName: "PAR", kind: "TOTAL", value: 72, confidence: 0.99 });

  const result = validateScorecardExtraction(extraction(raw), round);
  assert.equal(result.ready, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.acceptedCells.length, 72);
  assert.equal(result.evidence.detectedCellCount, 72);
  assert.equal(result.evidence.numericCellCount, 72);
});

test("un nombre o campo exacto con baja confianza visual todavía exige confirmación", () => {
  const raw = payload();
  raw.players = raw.players!.map((player) => player.playerName === "Juan" ? { ...player, confidence: 0.36 } : player);
  raw.course = { value: "La Vista", confidence: 0.4 };
  const card = extraction(raw);
  const result = validateScorecardExtraction(card, round);

  assert.ok(result.issues.some((current) => current.code === "player_match_low_confidence" && current.extractedPlayerName === "Juan"));
  assert.ok(result.issues.some((current) => current.code === "course_low_confidence"));
  assert.equal(result.ready, false);

  const confirmed = validateScorecardExtraction(card, round, {
    playerMappings: [{ extractedName: "Juan", playerId: "juan" }],
    acceptCourseMismatch: true,
  });
  assert.equal(confirmed.ready, true);
});

test("si sólo 2 de 72 celdas son dudosas devuelve exactamente esas dos y los overrides las resuelven", () => {
  const raw = payload();
  raw.cells.find((cell) => cell.playerName === "Juan" && cell.hole === 14)!.confidence = 0.61;
  raw.cells.find((cell) => cell.playerName === "Pedro" && cell.hole === 7)!.confidence = 0.72;
  const card = extraction(raw);
  const first = validateScorecardExtraction(card, round);
  assert.equal(first.ready, false);
  assert.equal(first.acceptedCells.length, 70);
  assert.deepEqual(first.issues.map((item) => [item.playerId, item.hole, item.code]), [
    ["pedro", 7, "low_confidence_score"],
    ["juan", 14, "low_confidence_score"],
  ]);

  const confirmed = validateScorecardExtraction(card, round, { cells: [
    { playerId: "pedro", hole: 7, value: scoreFor(1, 7) },
    { playerId: "juan", hole: 14, value: scoreFor(2, 14) },
  ] });
  assert.equal(confirmed.ready, true);
  assert.deepEqual(confirmed.issues, []);
  assert.equal(confirmed.acceptedCells.filter((cell) => cell.acceptedFrom === "user_override").length, 2);
});

test("extracción parcial 63/72 devuelve únicamente las 9 celdas dudosas", () => {
  const raw = payload();
  const doubtful = raw.cells.slice(0, 9);
  doubtful.forEach((cell) => { cell.confidence = 0.61; });
  const result = validateScorecardExtraction(extraction(raw), round);

  assert.equal(result.ready, false);
  assert.equal(result.acceptedCells.length, 63);
  assert.equal(result.issues.length, 9);
  assert.ok(result.issues.every((current) => current.code === "low_confidence_score" && current.resolution === "cell_value"));
  assert.deepEqual(result.issues.map((current) => [current.playerId, current.hole]), doubtful.map((cell) => [cell.playerName.toLocaleLowerCase("es-MX"), cell.hole]));
});

test("tarjeta parcialmente ilegible pide únicamente la celda ilegible", () => {
  const raw = payload();
  const unreadable = raw.cells.find((cell) => cell.playerName === "Carlos" && cell.hole === 3)!;
  unreadable.value = null;
  unreadable.confidence = 0.22;
  const result = validateScorecardExtraction(extraction(raw), round);
  assert.equal(result.ready, false);
  assert.equal(result.acceptedCells.length, 71);
  assert.deepEqual(issueCodes(result), ["unreadable_score"]);
  assert.deepEqual([result.issues[0].playerId, result.issues[0].hole], ["carlos", 3]);
});

test("detecta TOTAL inconsistente y permite confirmar que el agregado escrito era incorrecto", () => {
  const raw = payload();
  const total = raw.totals!.find((item) => item.playerName === "Juan" && item.kind === "TOTAL")!;
  total.value += 1;
  const card = extraction(raw);
  const result = validateScorecardExtraction(card, round);
  assert.deepEqual(issueCodes(result), ["total_mismatch"]);
  assert.equal(result.issues[0].candidateValue, total.value);
  assert.equal(result.issues[0].expectedValue, total.value - 1);

  const confirmed = validateScorecardExtraction(card, round, {
    acceptTotalMismatches: [{ playerId: "juan", kind: "total" }],
  });
  assert.equal(confirmed.ready, true);
});

test("jugador no reconocido genera una sola pregunta de mapping y el override recupera toda su fila", () => {
  const raw = payload();
  raw.players = raw.players!.map((player) => player.playerName === "Carlos" ? { ...player, playerName: "Invitado X" } : player);
  raw.cells = raw.cells.map((cell) => cell.playerName === "Carlos" ? { ...cell, playerName: "Invitado X" } : cell);
  raw.totals = raw.totals!.map((total) => total.playerName === "Carlos" ? { ...total, playerName: "Invitado X" } : total);
  const card = extraction(raw);
  const result = validateScorecardExtraction(card, round);
  assert.deepEqual(issueCodes(result), ["unknown_player"]);
  assert.equal(result.issues[0].resolution, "player_mapping");
  assert.equal(result.acceptedCells.length, 54);

  const mapped = validateScorecardExtraction(card, round, {
    playerMappings: [{ extractedName: "Invitado X", playerId: "carlos" }],
  });
  assert.equal(mapped.ready, true);
  assert.equal(mapped.acceptedCells.length, 72);
});

test("matching de campo bloquea una tarjeta ajena y una confirmación explícita la desbloquea", () => {
  const raw = payload();
  raw.course = { value: "Club Campestre Puebla", confidence: 0.99 };
  const card = extraction(raw);
  const mismatch = validateScorecardExtraction(card, round);
  assert.deepEqual(issueCodes(mismatch), ["course_mismatch"]);
  assert.equal(validateScorecardExtraction(card, round, { acceptCourseMismatch: true }).ready, true);
});

test("fotos que muestran campos distintos conservan ambas evidencias y bloquean la mezcla silenciosa", () => {
  const first = payload(holes.slice(0, 9));
  first.course = { value: "La Vista", confidence: 0.99 };
  const second = payload(holes.slice(9));
  second.course = { value: "Club Campestre Puebla", confidence: 0.99 };
  const merged = normalizeScorecardPhotoExtractions([
    { photoId: "front", payload: first },
    { photoId: "back", payload: second },
  ]);
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.deepEqual(merged.extraction.courses?.map((candidate) => candidate.value), ["La Vista", "Club Campestre Puebla"]);
  const result = validateScorecardExtraction(merged.extraction, round);
  assert.ok(result.issues.some((candidate) => candidate.code === "conflicting_course_observations"));
  assert.equal(result.ready, false);
});

test("scores digitales completos no convierten una foto sin celdas visibles en lectura AI exitosa", () => {
  const raw = payload([]);
  raw.players = [];
  raw.totals = [];
  const digitalRound: ActiveScorecardRound = {
    ...round,
    digitalScores: Object.fromEntries(holes.map((hole) => [hole, Object.fromEntries(playerIds.map((id) => [id, 4]))])),
  };
  const result = validateScorecardExtraction(extraction(raw), digitalRound);

  assert.ok(result.issues.some((candidate) => candidate.code === "no_scorecard_evidence"));
  assert.equal(result.evidence.detectedCellCount, 0);
  assert.equal(result.ready, false);
});

test("ronda de 9 hoyos con salida por el 10 sólo valida H10–H18 e IN/TOTAL", () => {
  const nineRound: ActiveScorecardRound = { ...round, roundId: "round-nine", startHole: 10, roundHoles: 9 };
  const card = extraction(payload(holes.slice(9)));
  const result = validateScorecardExtraction(card, nineRound);
  assert.equal(result.ready, true);
  assert.deepEqual(result.expectedHoles, holes.slice(9));
  assert.equal(result.acceptedCells.length, 36);
  assert.deepEqual(result.issues, []);
});

test("OUT e IN escritos incorrectamente se reportan por separado", () => {
  const raw = payload();
  for (const kind of ["OUT", "IN"] as const) raw.totals!.find((item) => item.playerName === "Said" && item.kind === kind)!.value += 2;
  const result = validateScorecardExtraction(extraction(raw), round);
  assert.deepEqual(result.issues.map((item) => [item.code, item.totalKind]), [
    ["total_mismatch", "out"],
    ["total_mismatch", "in"],
  ]);
});

test("score fuera de rango se bloquea aunque la lectura tenga confianza alta", () => {
  const raw = payload();
  raw.cells.find((cell) => cell.playerName === "Pedro" && cell.hole === 11)!.value = 25;
  const result = validateScorecardExtraction(extraction(raw), round);
  assert.deepEqual(issueCodes(result), ["score_out_of_range"]);
  assert.equal(result.issues[0].candidateValue, 25);
});

test("score distinto al digital no elige ganador: exige override de celda", () => {
  const raw = payload();
  const digitalScores = Object.fromEntries(holes.map((hole) => [hole, Object.fromEntries(names.map((_, playerIndex) => [
    playerIds[playerIndex],
    scoreFor(playerIndex, hole),
  ]))]));
  digitalScores[14].juan += 1;
  const card = extraction(raw);
  const result = validateScorecardExtraction(card, { ...round, digitalScores });
  assert.deepEqual(issueCodes(result), ["digital_score_mismatch"]);
  assert.equal(result.acceptedCells.length, 71);
  assert.equal(result.acceptedScores[14]?.juan, undefined);

  const corrected = validateScorecardExtraction(card, { ...round, digitalScores }, {
    cells: [{ playerId: "juan", hole: 14, value: scoreFor(2, 14) }],
  });
  assert.equal(corrected.ready, true);
  assert.equal(corrected.acceptedScores[14].juan, scoreFor(2, 14));
});

test("una discrepancia con score digital nunca se oculta por baja confianza OCR", () => {
  const raw = payload();
  const observed = raw.cells.find((cell) => cell.playerName === "Juan" && cell.hole === 14)!;
  assert.equal(typeof observed.value, "number");
  const digitalScores = { 14: { juan: Number(observed.value) + 1 } };
  observed.confidence = 0.61;
  const result = validateScorecardExtraction(extraction(raw), { ...round, digitalScores });
  const mismatch = result.issues.find((issue) => issue.code === "digital_score_mismatch" && issue.playerId === "juan" && issue.hole === 14);
  assert.ok(mismatch);
  assert.equal(mismatch.confidence, 0.61);
  assert.equal(result.ready, false);
});

test("Par impreso diferente al campo activo se detecta sin alterar scores", () => {
  const raw = payload();
  raw.pars = round.course.holes.map((hole) => ({ hole: hole.number, value: hole.par, confidence: 0.98 }));
  raw.pars.find((par) => par.hole === 6)!.value = 5;
  const result = validateScorecardExtraction(extraction(raw), round);
  assert.deepEqual(issueCodes(result), ["par_mismatch"]);
  assert.equal(result.acceptedCells.length, 72);
  const confirmed = validateScorecardExtraction(extraction(raw), round, { acceptParMismatches: [6] });
  assert.equal(confirmed.ready, true);
  assert.equal(confirmed.acceptedCells.length, 72);
});

test("dos fotos con valores incompatibles conservan evidencia y piden una sola corrección", () => {
  const complete = payload();
  const conflicting: RawPayload = {
    version: 1,
    cells: [{ playerName: "Said", hole: 1, value: scoreFor(0, 1) + 1, confidence: 0.97 }],
  };
  const normalized = normalizeScorecardPhotoExtractions([
    { photoId: "full", payload: complete },
    { photoId: "detail", payload: conflicting },
  ]);
  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  const result = validateScorecardExtraction(normalized.extraction, round);
  assert.deepEqual(issueCodes(result), ["conflicting_score_observations"]);
  assert.equal(result.issues[0].hole, 1);
  assert.equal(result.issues[0].source?.photoId, "full");
});

test("los tipos de total normalizados son siempre minúsculas canónicas", () => {
  const kinds = new Set(extraction().totals.map((total) => total.kind));
  assert.deepEqual([...kinds], ["out", "in", "total"] satisfies ScorecardTotalKind[]);
});

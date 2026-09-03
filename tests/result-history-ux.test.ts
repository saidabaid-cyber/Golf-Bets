import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { MedalPollaDetail } from "../lib/engine";
import type { RoundSnapshot } from "../lib/types";
import { filterHistory, historyYears } from "../lib/history-filters";
import { countPdfTextMatches, normalizePdfSearch } from "../lib/pdf-viewer-utils";
import { priorRabbitStatus, priorSkinsStatus } from "../lib/prior-hole-status";
import { pollaDetailBalance } from "../lib/result-breakdown";

const history = [
  { id: "a", date: "2026-09-03" },
  { id: "b", date: "2026-08-20" },
  { id: "c", date: "2025-09-01" },
] as unknown as RoundSnapshot[];

test("Histórico filtra mes/año sin modificar datos ni perder años disponibles", () => {
  const before = structuredClone(history);
  assert.deepEqual(historyYears(history), ["2026", "2025"]);
  assert.deepEqual(filterHistory(history, "2026", "09").map((round) => round.id), ["a"]);
  assert.deepEqual(filterHistory(history, "", "09").map((round) => round.id), ["a", "c"]);
  assert.deepEqual(history, before);
});

test("estado previo usa exclusivamente eventos guardados y expresa carry", () => {
  assert.deepEqual(priorRabbitStatus([{ hole: 2, type: "hold", playerId: "juan" }], 1, 100, () => "Juan"), ["Juan trae el Conejo", "En juego $100"]);
  assert.deepEqual(priorRabbitStatus([], 2, 100, () => "—"), ["Conejo libre", "Acumula $200"]);
  assert.deepEqual(priorSkinsStatus(4, 50), ["Skin actual: $200", "Carry de 3 hoyos"]);
});

test("cada Polla se liquida por separado por jugador", () => {
  const detail: MedalPollaDetail = { key: "first9", label: "Polla H1–9", holes: [1,2,3,4,5,6,7,8,9], value: 100, complete: true, totals: { a: 34, b: 35, c: 36 }, winnerIds: ["a"], grossPrizePerWinner: 300 };
  assert.equal(pollaDetailBalance(detail, "a"), 200);
  assert.equal(pollaDetailBalance(detail, "b"), -100);
  assert.equal(pollaDetailBalance(detail, "outside"), 0);
  assert.equal(pollaDetailBalance({ ...detail, complete: false, winnerIds: [], grossPrizePerWinner: 0 }, "b"), 0);
});

test("búsqueda PDF ignora acentos, mayúsculas y espacios y cuenta frases", () => {
  assert.equal(normalizePdfSearch("  ÁREA   de Penalidad "), "area de penalidad");
  assert.equal(countPdfTextMatches("Área de penalidad; AREA DE PENALIDAD", "area de penalidad"), 2);
});

test("UI dinámica oculta apuestas apagadas, separa Pollas y cierra la ronda activa", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /bets\.rabbits\.enabled && <div><span>Conejos<\/span>/);
  assert.match(page, /polla\.details\.filter\(\(detail\) => Object\.hasOwn\(detail\.totals, p\.id\)\)\.map/);
  assert.match(page, /clearActiveRoundStorage\(window\.localStorage\);[\s\S]{0,120}setRoundClosed\(true\)/);
  assert.match(page, /draftAvailable && !roundClosed/);
  assert.match(page, /priorOrder = useMemo\(\(\) => order\.slice\(0, currentIndex\)/);
});

test("visor PDF es continuo, busca texto y no usa paginación como navegación principal", () => {
  const viewer = readFileSync("app/components/internal-pdf-viewer.tsx", "utf8");
  assert.match(viewer, /Array\.from\(\{ length: pdf\.numPages \}/);
  assert.match(viewer, /getTextContent\(\)/);
  assert.match(viewer, /Buscar en documento/);
  assert.match(viewer, /IntersectionObserver/);
  assert.doesNotMatch(viewer, /Página anterior|Página siguiente/);
});

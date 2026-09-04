import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResultAccordion } from "../app/components/result-accordion";
import { calculateUnits } from "../lib/engine";
import { summarizeNetUnitQuantities } from "../lib/result-breakdown";
import type { BetConfig, Player, UnitEvent } from "../lib/types";

test("Resumen de Unidades usa eventos reales: +4 −1 da +3 y conserva suma monetaria cero", () => {
  const players: Player[] = [
    { id: "said", name: "Said", handicap: 0 },
    { id: "rival", name: "Rival", handicap: 0 },
    { id: "sin-eventos", name: "Sin eventos", handicap: 0 },
  ];
  const events: UnitEvent[] = [
    { id: "u1", hole: 1, playerId: "said", amount: 4, label: "Positivas" },
    { id: "u2", hole: 1, playerId: "said", amount: -1, label: "Negativa" },
    { id: "u3", hole: 1, playerId: "rival", amount: 1, label: "Positiva" },
    { id: "u4", hole: 1, playerId: "rival", amount: -2, label: "Negativas" },
  ];
  const config = { enabled: true, participantIds: players.map(player => player.id), value: 100, copaValue: 100 } as BetConfig["units"];
  const units = calculateUnits(players, events, config);
  const summary = summarizeNetUnitQuantities(units.net, players.map(player => player.id));

  assert.deepEqual(summary.quantities, { said: 3, rival: -1, "sin-eventos": 0 });
  assert.equal(summary.total, 2);
  assert.equal(Object.values(units.balances).reduce((sum, amount) => sum + amount, 0), 0);
});

test("acordeón de Resultados expone estado accesible y contenido asociado", () => {
  const open = renderToStaticMarkup(createElement(ResultAccordion, {
    id: "general",
    title: "Resumen General",
    defaultOpen: true,
  }, createElement("p", null, "Contenido general")));
  const closed = renderToStaticMarkup(createElement(ResultAccordion, {
    id: "manuals",
    title: "Manuales",
  }, createElement("p", null, "Contenido manual")));

  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /aria-controls="results-general"/);
  assert.doesNotMatch(open, /hidden=""/);
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /id="results-manuals"[^>]*hidden=""/);
});

test("las secciones de detalle de Resultados inician cerradas sin perder su contenido", () => {
  for (const [id, title] of [["rabbits", "🐇 Conejos"], ["skins", "⛳ Skins"], ["units", "📏 Unidades"], ["foursome", "Foursome"], ["ball-friend", "⚪🤝 Bola Amiga"], ["polla", "Polla"], ["mini-polla", "Mini Polla"], ["personals", "Resultados de Apuestas Personales"], ["manuals", "Manuales"]]) {
    const markup = renderToStaticMarkup(createElement(ResultAccordion, {
      id,
      title,
    }, createElement("p", null, `Detalle ${title}`)));
    assert.match(markup, /aria-expanded="false"/);
    assert.match(markup, /hidden=""/);
    assert.match(markup, new RegExp(`Detalle ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});

test("ResultAccordion admite control externo sin perder el modo no controlado", () => {
  const forcedClosed = renderToStaticMarkup(createElement(ResultAccordion, {
    id: "controlled-closed",
    title: "Controlado cerrado",
    defaultOpen: true,
    open: false,
    onOpenChange: () => undefined,
  }, createElement("p", null, "Detalle conservado")));
  const forcedOpen = renderToStaticMarkup(createElement(ResultAccordion, {
    id: "controlled-open",
    title: "Controlado abierto",
    open: true,
    onOpenChange: () => undefined,
  }, createElement("p", null, "Detalle visible")));

  assert.match(forcedClosed, /aria-expanded="false"/);
  assert.match(forcedClosed, /hidden=""/);
  assert.match(forcedOpen, /aria-expanded="true"/);
  assert.doesNotMatch(forcedOpen, /hidden=""/);
});

test("Editar ronda concentra Personales/Manuales y Resultados conserva navegación y lectura", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const setup = page.slice(page.indexOf('{tab === "setup"'), page.indexOf('{tab === "personals"'));
  const personals = page.slice(page.indexOf('{tab === "personals"'), page.indexOf('{tab === "round"'));
  const results = page.slice(page.indexOf('{tab === "results" && <>'), page.indexOf('{tab === "history" && <>'));

  assert.ok(setup.indexOf('id="setup-personals"') < setup.indexOf('id="setup-manuals"'));
  assert.match(setup, /renderPersonalBetsEditor\(\)/);
  assert.match(setup, /renderManualBetsEditor\(true\)/);
  assert.match(personals, /<PersonalHistoryPanel/);
  assert.doesNotMatch(personals, /renderPersonalBetsEditor|\+ Personal/);
  assert.match(results, /className="resultJumpNav"/);
  assert.match(results, /openResultSection\(item\.id\)/);
  assert.match(results, /renderManualBetResults\(\)/);
  assert.doesNotMatch(results, /renderManualBetsEditor/);
  assert.doesNotMatch(results, /\.click\(\)/);
});

test("Resultados mantiene controles táctiles de 44px y filas compactas en portrait y landscape", () => {
  const css = readFileSync("app/functional-ux.css", "utf8");
  assert.match(css, /\.resultJumpNav button\{min-height:44px/);
  assert.match(css, /\.compactResults \.resultAccordion\{margin-bottom:5px\}/);
  assert.match(css, /\.compactResults \.resultAccordionHeading>button\{min-height:44px/);
  assert.match(css, /\.compactResults \.generalResultsTable th,\.compactResults \.generalResultsTable td\{height:46px/);
  assert.match(css, /@media\(orientation:landscape\) and \(max-height:600px\)/);
});

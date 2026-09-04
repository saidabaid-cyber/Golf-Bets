import assert from "node:assert/strict";
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScorecardHoleContext, ScorecardHoleNetPreview } from "../app/components/scorecard-hole-preview";
import { scorecardHoleContext, scorecardHolePreview } from "../lib/scorecard-hole-preview";

test("la captura muestra golpes de tarjeta y neto previsto sin cambiar reglas de apuestas", () => {
  assert.deepEqual(scorecardHolePreview({ handicap: 10 }, { strokeIndex: 5 }, 4), {
    allowance: 1,
    net: 3,
    adjustmentLabel: "Recibe 1 golpe",
    netLabel: "Neto al guardar 3",
  });
  assert.deepEqual(scorecardHolePreview({ handicap: 36 }, { strokeIndex: 18 }, 7), {
    allowance: 2,
    net: 5,
    adjustmentLabel: "Recibe 2 golpes",
    netLabel: "Neto al guardar 5",
  });
  assert.deepEqual(scorecardHolePreview({ handicap: -1 }, { strokeIndex: 18 }, 4), {
    allowance: -1,
    net: 5,
    adjustmentLabel: "Da 1 golpe",
    netLabel: "Neto al guardar 5",
  });
  assert.equal(scorecardHolePreview({ handicap: 0 }, { strokeIndex: 1 }, 4).adjustmentLabel, "Sin golpes");
});

test("HCP o score faltante permanece pendiente y nunca inventa un neto", () => {
  assert.deepEqual(scorecardHolePreview({ handicap: null }, { strokeIndex: 1 }, 4), {
    allowance: null,
    net: null,
    adjustmentLabel: "Completa HCP",
    netLabel: "Neto pendiente",
  });
  assert.equal(scorecardHolePreview({ handicap: 8 }, { strokeIndex: 1 }, null).net, null);
  assert.equal(scorecardHolePreview({ handicap: 8 }, { strokeIndex: 1 }, Number.NaN).net, null);
  assert.equal(scorecardHolePreview({ handicap: 8 }, { strokeIndex: 1 }, 3.5).net, null);

  const markup = renderToStaticMarkup(createElement(ScorecardHoleNetPreview, {
    player: { handicap: null },
    hole: { strokeIndex: 1 },
    gross: 4,
  }));
  assert.match(markup, /Completa HCP/);
  assert.match(markup, /Neto pendiente/);
  assert.doesNotMatch(markup, /Neto al guardar/);
});

test("el encabezado usa solo yardage y tee realmente disponibles", () => {
  assert.deepEqual(scorecardHoleContext({ par: 4, strokeIndex: 3, yards: 421.4 }, " Azules "), ["Par 4", "SI 3", "421 yd", "Tee Azules"]);
  assert.deepEqual(scorecardHoleContext({ par: 3, strokeIndex: 17 }, ""), ["Par 3", "SI 17"]);
  const markup = renderToStaticMarkup(createElement(ScorecardHoleContext, {
    hole: { par: 4, strokeIndex: 3, yards: 421 },
    teeName: "Azules",
  }));
  assert.match(markup, /Par 4 · SI 3 · 421 yd · Tee Azules/);
});

test("la tarjeta activa integra contexto, neto previo y una aclaración separada de apuestas", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const start = page.indexOf('{tab === "round"');
  const end = page.indexOf('{tab === "standings"', start);
  const round = page.slice(start, end);
  assert.match(round, /<ScorecardHoleContext hole=\{hole\} teeName=\{course\.teeName\}/);
  assert.match(round, /<ScorecardHoleNetPreview player=\{p\} hole=\{hole\} gross=\{scoreFor\(p\.id\)\}/);
  assert.match(round, /El neto de tarjeta usa el HCP de ronda al 100%/);
  assert.match(readFileSync("app/functional-ux.css", "utf8"), /\.scorecardNetPreview/);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  BET_PRESENTATION,
  betDisplayLabel,
  historicalBetDisplayLabel,
  SUPPLEMENTAL_BET_PRESENTATION,
  supplementalBetDisplayLabel,
} from "../lib/bet-catalog";
import { SUPPLEMENTAL_BET_LABELS } from "../lib/supplemental-bets";

test("configuración y resultados comparten nombre e icono por modalidad", () => {
  for (const [kind, presentation] of Object.entries(BET_PRESENTATION)) {
    assert.equal(betDisplayLabel(kind as keyof typeof BET_PRESENTATION), `${presentation.icon} ${presentation.title}`);
  }
  for (const [type, presentation] of Object.entries(SUPPLEMENTAL_BET_PRESENTATION)) {
    const key = type as keyof typeof SUPPLEMENTAL_BET_PRESENTATION;
    assert.equal(SUPPLEMENTAL_BET_LABELS[key], presentation.title);
    assert.equal(supplementalBetDisplayLabel(key), `${presentation.icon} ${presentation.title}`);
  }
});

test("un título ya decorado no duplica el emoji", () => {
  assert.equal(betDisplayLabel("skins", "⛳ Skins especiales"), "⛳ Skins especiales");
  assert.equal(supplementalBetDisplayLabel("vegas", "🎲 Vegas 2"), "🎲 Vegas 2");
});

test("Histórico reconoce claves antiguas y modalidades actuales con el catálogo compartido", () => {
  const legacyLabels: Record<string, string> = {
    Conejos: "🐇 Conejos",
    Skins: "⛳ Skins",
    Unidades: "📏 Unidades / Copas",
    Monkey: "🐒 Monkey",
    Foursome: "🤝 Foursome",
    "Bola Amiga": "⚪🤝 Bola Amiga",
    "Polla 1ª vuelta": "🥈 Polla H1–9",
    "Polla 2ª vuelta": "🥈 Polla H10–18",
    "Polla Nassau": "🏆 Polla 18 hoyos",
    "Mini Polla": "⚡ Mini Polla",
    Víboras: "🐍 Víboras",
    Camellos: "🐫 Camellos",
    Peces: "🐟 Peces",
    Loba: "🐺 Loba",
    Manuales: "✍️ Apuestas Manuales",
    Personales: "↔ Personales",
  };

  for (const [stored, expected] of Object.entries(legacyLabels)) {
    assert.equal(historicalBetDisplayLabel(stored), expected);
  }
  for (const presentation of Object.values(SUPPLEMENTAL_BET_PRESENTATION)) {
    assert.equal(historicalBetDisplayLabel(presentation.title), `${presentation.icon} ${presentation.title}`);
  }
  assert.equal(historicalBetDisplayLabel("Vegas 2"), "🎲 Vegas 2");
  assert.equal(historicalBetDisplayLabel("🐍 Víboras"), "🐍 Víboras");
  assert.equal(historicalBetDisplayLabel("Categoría heredada"), "Categoría heredada");
});

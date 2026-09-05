import assert from "node:assert/strict";
import test from "node:test";

import {
  BET_PRESENTATION,
  betDisplayLabel,
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

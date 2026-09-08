import assert from "node:assert/strict";
import test from "node:test";

import { buildDeterministicRoundRecap } from "../lib/backyard-ai/recap/round-recap";

test("AI recap only narrates deterministic balances, counters and settlements", () => {
  const recap = buildDeterministicRoundRecap({
    players: [{ id: "said", name: "Said" }, { id: "pedro", name: "Pedro" }],
    balances: { said: 1_400, pedro: -1_400 },
    skinsWon: { pedro: 4 },
    transfers: [{ fromPlayerId: "pedro", toPlayerId: "said", amount: 1_400 }],
  });
  assert.equal(recap.headline, "Said terminó como mayor ganador con +$1,400.");
  assert.deepEqual(recap.highlights, ["Pedro ganó 4 skins.", "La liquidación mínima requiere 1 pago."]);
  assert.equal(recap.provenance, "deterministic_round_results");
});

test("AI recap does not invent a winner or highlights without verified data", () => {
  const recap = buildDeterministicRoundRecap({
    players: [{ id: "a", name: "Ana" }, { id: "b", name: "Beto" }],
    balances: { a: 0, b: 0 },
  });
  assert.equal(recap.headline, "La ronda terminó sin un ganador económico neto.");
  assert.deepEqual(recap.highlights, []);
});

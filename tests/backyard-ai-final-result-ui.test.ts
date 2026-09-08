import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the final AI result is presentational and keeps settlement legally scoped", () => {
  const source = readFileSync("app/components/backyard-ai/round-final-result.tsx", "utf8");

  assert.match(source, /RONDA TERMINADA/);
  assert.match(source, /Resultado por jugador/);
  assert.match(source, /CÓMO LIQUIDAR/);
  assert.match(source, /No recibe, custodia ni procesa fondos/);
  assert.match(source, /no actúa como sportsbook ni casa de apuestas/);
  assert.match(source, /data-provenance=\{recap\.provenance\}/);
  assert.doesNotMatch(source, /from "\.\.\/\.\.\/\.\.\/lib\/engine"/);
  assert.doesNotMatch(source, /settleBalances|mergeBalances|calculate[A-Z]/);
});

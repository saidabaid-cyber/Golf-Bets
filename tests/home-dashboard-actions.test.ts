import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/components/home-dashboard.tsx", "utf8");

test("Home summary cards are native buttons connected to their real destinations", () => {
  for (const callback of ["onOpenHistory", "onOpenStats", "onOpenBalances", "onOpenGroups"]) {
    assert.match(source, new RegExp(`<button type="button" className="stat" onClick=\\{${callback}\\}`));
  }
});

test("Home keeps unavailable wager money unknown and separates capture progress from the edited hole", () => {
  assert.match(source, /insights\.betBalance === undefined \? "—" : signedMoney\(insights\.betBalance\)/);
  assert.match(source, /\$\{playedHoles\} de \$\{round\.totalHoles\} hoyos capturados/);
  assert.match(source, /Editando hoyo \$\{currentHole\}/);
  assert.doesNotMatch(source, /Hoyo \$\{round\.currentHole\} de \$\{round\.totalHoles\}/);
});

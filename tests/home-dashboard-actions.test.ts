import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/components/home-dashboard.tsx", "utf8");

test("Home keeps one calm primary action and connects navigation to real destinations", () => {
  assert.match(source, /data-home-version="calm-v1"/);
  assert.match(source, /onClick=\{activeRound \? onContinueRound : onAiRound\}/);
  assert.match(source, /onClick=\{onNewRound\}>Prefiero configurar a mano/);
  for (const callback of ["onOpenHistory", "onOpenStats", "onOpenBalances", "onOpenGroups", "onOpenCourses"]) {
    assert.match(source, new RegExp(`(?:action|onClick):?=?.*${callback}|onClick=\\{${callback}\\}`));
  }
});

test("Home never manufactures empty metrics and separates played holes from the edited hole", () => {
  assert.match(source, /validPlayed \? `\$\{played\} de \$\{round\.totalHoles\} hoyos capturados`/);
  assert.match(source, /validCurrent \? `Hoyo \$\{current\}`/);
  assert.match(source, /typeof insights\.betBalance === "number" && Number\.isFinite\(insights\.betBalance\)/);
  assert.match(source, /insights\.scoredRounds > 0/);
  assert.doesNotMatch(source, /Todav[ií]a no hay actividad|sin resultado verificable|HCP manual/);
});

test("Home prioritizes setup, live and review rounds, including a round with zero captured holes", () => {
  assert.match(source, /round\.status === "review"/);
  assert.match(source, /round\.status === "setup"/);
  assert.match(source, /played >= 0/);
  assert.match(source, /activeRound \? onContinueRound : onAiRound/);
  assert.match(source, /activity\.slice\(0, 2\)/);
  assert.match(source, /onOpenRound\(latestRound\.id\)/);
});

test("Home uses the delivered local fairway artwork through Next Image", () => {
  assert.match(source, /import Image from "next\/image"/);
  assert.match(source, /src="\/brand\/backyard-fairway-scene\.svg"/);
  assert.match(source, /alt="" aria-hidden="true" fill/);
});

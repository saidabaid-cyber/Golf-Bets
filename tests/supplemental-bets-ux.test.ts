import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/page.tsx", "utf8");
const editor = readFileSync("app/components/supplemental-bets-editor.tsx", "utf8");
const styles = readFileSync("app/components/supplemental-bets.module.css", "utf8");

test("round setup keeps current Personals first, the seven new games in order, and Manuals last", () => {
  const currentPersonals = page.indexOf('title="Apuestas personales actuales"');
  const supplemental = page.indexOf("<SupplementalBetsEditor");
  const manuals = page.indexOf('id="setup-manuals"');
  assert.ok(currentPersonals >= 0 && supplemental > currentPersonals && manuals > supplemental);
  assert.match(editor, /const ORDER:[^=]+\= \["individual_nassau", "dollar_stroke", "individual_pressures", "team_pressures", "chicago", "vegas", "minimum_putts"\]/);
});

test("every existing and new bet type has compact contextual help in a closable modal", () => {
  for (const kind of [
    "personal", "individual_nassau", "dollar_stroke", "individual_pressures", "team_pressures", "chicago", "vegas", "minimum_putts", "manual",
    "rabbits", "skins", "units", "foursome", "ball_friend", "monkey", "polla", "mini_polla", "vipers", "camels", "fish", "loba",
  ]) assert.match(editor, new RegExp(`\\b${kind}: \\{`));
  assert.match(editor, /role="dialog" aria-modal="true"/);
  assert.match(editor, /Qué es/);
  assert.match(editor, /Cómo funciona/);
  assert.match(editor, /Reglas importantes/);
  assert.match(editor, /Ejemplo simple/);
  assert.match(editor, /aria-label="Cerrar ayuda"/);
});

test("Personal and Manual switches retain their editors and move inactive records after active ones", () => {
  assert.match(page, /sort\(\(first, second\) => Number\(second\.enabled !== false\) - Number\(first\.enabled !== false\)\)/);
  assert.match(page, /updatePersonalBet\(bet\.id, \{ enabled: bet\.enabled === false \}\)/);
  assert.match(page, /updateManualBet\(bet\.id, \{ enabled: bet\.enabled === false \}\)/);
  assert.match(page, /bet\.enabled === false \? "betItemDisabled"/);
  assert.match(styles, /\.disabled\{order:2;/);
  const signedInput = readFileSync("app/components/signed-money-input.tsx", "utf8");
  assert.doesNotMatch(signedInput, /Gana \+|Pierde −|signedMoneyDirection/);
  assert.match(signedInput, /value=\{value\}/);
});

test("Minimum Putts capture stays inside the existing score card and persists in draft/history", () => {
  const scoreCard = page.indexOf('<section className="card scoreCard">');
  const putts = page.indexOf('className="puttsCapture"');
  const previousBets = page.indexOf('aria-label="Estado antes de este hoyo"');
  assert.ok(scoreCard >= 0 && putts > scoreCard && previousBets > putts);
  assert.match(page, /supplementalBets, manualBets, scores, scoreEdits, putts,/);
  assert.match(page, /supplementalBets: structuredClone\(supplementalBets\), putts: structuredClone\(putts\)/);
  assert.match(page, /setSupplementalBets\(normalizeSupplementalBets\(restored\.supplementalBets\)\); setPutts\(restored\.putts \|\| \{\}\)/);
});

test("new games feed live standings, general results, settlement and individual result accordions", () => {
  assert.match(page, /liveSupplemental\.balances/);
  assert.match(page, /supplemental\.balances/);
  assert.match(page, /generalResultCategories[\s\S]*supplemental\.results\.map/);
  assert.match(page, /id=\{`supplemental-\$\{result\.betId\}`\}/);
  assert.match(page, /<SupplementalBetResults results=\{\[result\]\}/);
});

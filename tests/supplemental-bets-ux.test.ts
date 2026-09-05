import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/page.tsx", "utf8");
const editor = readFileSync("app/components/supplemental-bets-editor.tsx", "utf8");
const styles = readFileSync("app/components/supplemental-bets.module.css", "utf8");
const sideBets = readFileSync("app/components/side-bet-panels.tsx", "utf8");

test("round setup keeps general additions first, Manuals before the final Personales group", () => {
  const currentPersonals = page.indexOf('id="setup-personals"');
  const supplemental = page.indexOf("<SupplementalBetsEditor");
  const manuals = page.indexOf('id="setup-manuals"');
  assert.ok(supplemental >= 0 && manuals > supplemental && currentPersonals > manuals);
  assert.match(editor, /const ORDER:[^=]+\= \["team_pressures", "chicago", "vegas", "minimum_putts"\]/);
  assert.match(page, /types=\{\["dollar_stroke", "individual_pressures"\]\}/);
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
  assert.match(editor, /headerAction=\{<span className=\{styles\.headerActions\}><BetHelpButton kind=\{type\} \/><Switch/);
  const itemHeader = editor.slice(editor.indexOf("function ItemShell"), editor.indexOf("const COMPONENT_LABELS"));
  assert.match(itemHeader, /<Switch on=\{bet\.enabled\}/);
  assert.match(itemHeader, /<fieldset disabled=\{locked\} className=\{`\$\{styles\.fields\} bettingEditorFieldset`\}/);
});

test("la configuración usa las descripciones compactas solicitadas y alinea ayuda con switch", () => {
  for (const description of [
    "Gana hoyos · captura y conserva el conejo",
    "Mejor score único gana · empates acumulan",
    "Puntos positivos y negativos · todos contra todos",
    "Parejas · puntos por Low/High según configuración",
    "Los 2 jugadores de la derecha vs los 2 de la izquierda",
  ]) assert.match(page, new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const description of [
    "3 putts · el último jugador que la tenga paga",
    "Bunker · se acumulan por jugador",
    "Agua · se acumulan por jugador",
    "El Lobo elige pareja o juega solo",
  ]) assert.match(sideBets, new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const description of [
    "Jugador vs jugador · ida, vuelta y total",
    "Diferencia de golpes netos · pago por golpe",
    "Duelo hoyo por hoyo · al perder se abre nueva presión",
    "Low Ball / High Ball por equipos · con presiones",
    "Puntos contra cuota según handicap",
    "Scores de pareja concatenados · diferencia por unidad",
    "Menos putts de la ronda gana el ante",
  ]) assert.ok(editor.includes(description));
  assert.match(styles, /\.itemActions\{display:flex;align-items:center/);
});

test("Personal and Manual switches retain their editors and move inactive records after active ones", () => {
  assert.match(page, /sort\(\(first, second\) => Number\(second\.enabled !== false\) - Number\(first\.enabled !== false\)\)/);
  assert.match(page, /runAfterBettingConsent\(\(\) => \{ updatePersonalBet\(bet\.id, \{ enabled: true, enabledBeforeCategoryOff: undefined \}\); setExpandedPersonalId\(bet\.id\); \}\)/);
  assert.match(page, /runAfterBettingConsent\(\(\) => updateManualBet\(bet\.id, \{ enabled: true, enabledBeforeCategoryOff: undefined \}\)\)/);
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
  assert.match(page, /const supplementalGeneralResults = useMemo\(\(\) => supplemental\.results\.filter\(\(result\) => !isPersonalSupplementalType\(result\.type\)\)/);
  assert.match(page, /generalResultCategories[\s\S]*supplementalGeneralResults\.map/);
  assert.match(page, /id=\{`supplemental-\$\{result\.betId\}`\}/);
  assert.match(page, /supplementalGeneralResults\.map\(\(result\) => <ResultAccordion[\s\S]*<SupplementalBetResults results=\{\[result\]\}/);
});

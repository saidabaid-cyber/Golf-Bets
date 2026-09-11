import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BET_HELP, type BetHelpKind } from "../lib/bet-help";
import { BET_DEFINITION_BY_ID } from "../lib/bets/registry";
import { finalizeNumericCapture } from "../lib/numeric-input";

const page = readFileSync("app/page.tsx", "utf8");
const roundCapture = readFileSync("app/components/round-capture-v2.tsx", "utf8");
const roundCaptureLogic = readFileSync("lib/round-capture.ts", "utf8");
const captureRequirements = readFileSync("lib/bets/capture-requirements.ts", "utf8");
const editor = readFileSync("app/components/supplemental-bets-editor.tsx", "utf8");
const captureControls = readFileSync("app/components/bet-fields/capture-controls.tsx", "utf8");
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
  const kinds: BetHelpKind[] = [
    "personal_group", "personal", "individual_nassau", "dollar_stroke", "individual_pressures", "team_pressures", "chicago", "vegas", "minimum_putts", "manual",
    "rabbits", "skins", "units", "foursome", "ball_friend", "monkey", "polla", "mini_polla", "vipers", "camels", "fish", "loba",
  ];
  assert.deepEqual(Object.keys(BET_HELP).sort(), [...kinds].sort());
  for (const kind of kinds) {
    const help = BET_HELP[kind];
    assert.match(help.title, /^\P{Letter}+/u);
    for (const section of [help.what, help.how, help.rules, help.example]) {
      assert.ok(typeof section === "string" ? section.trim().length > 0 : section.length > 0);
    }
  }
  assert.match(editor, /role="dialog" aria-modal="true"/);
  assert.match(editor, /QUÉ ES/);
  assert.match(editor, /CÓMO FUNCIONA/);
  assert.match(editor, /REGLAS IMPORTANTES/);
  assert.match(editor, /EJEMPLO SIMPLE/);
  assert.match(editor, /aria-label="Cerrar ayuda"/);
  assert.match(editor, /headerAction=\{<span className=\{styles\.headerActions\}><BetHelpButton kind=\{type\} \/><Switch/);
  const itemHeader = editor.slice(editor.indexOf("function ItemShell"), editor.indexOf("const COMPONENT_LABELS"));
  assert.match(itemHeader, /<Switch on=\{bet\.enabled\}/);
  assert.match(itemHeader, /<fieldset disabled=\{locked\} className=\{`\$\{styles\.fields\} bettingEditorFieldset`\}/);
});

test("la configuración usa las descripciones compactas solicitadas y alinea ayuda con switch", () => {
  for (const description of [
    "Gana hoyos · captura y conserva el conejo",
    "Mejor score neto único gana el skin",
    "Puntos positivos y negativos · todos contra todos",
    "Parejas · puntos por Low/High según configuración",
    "Los 2 jugadores de la derecha vs los 2 de la izquierda",
  ]) assert.match(page, new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const description of [
    "3 putts · el último jugador que la tenga paga",
    "Bunker · el último jugador paga la bolsa",
    "Agua · el último jugador paga la bolsa",
    "El Lobo elige pareja o juega solo",
  ]) assert.match(sideBets, new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const type of ["individual_nassau", "dollar_stroke", "individual_pressures", "team_pressures", "chicago", "vegas", "minimum_putts"] as const) {
    const definition = BET_DEFINITION_BY_ID.get(type);
    assert.ok(definition?.description.trim(), `${type} necesita descripción canónica`);
  }
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

test("importes ordinarios tienen mínimo cero y Manuales conserva captura firmada", () => {
  const moneyInput = page.slice(page.indexOf("function MoneyInput"), page.indexOf("function GolfBetsApp"));
  const moneyField = editor.slice(editor.indexOf("function MoneyField"), editor.indexOf("function NumberField"));
  const signedInput = readFileSync("app/components/signed-money-input.tsx", "utf8");
  assert.match(moneyInput, /<NumericCaptureInput[^>]+min=\{0\}/);
  assert.match(moneyField, /<NumericCaptureInput[^>]+min=\{0\}/);
  assert.doesNotMatch(signedInput, /min=\{0\}/);
  assert.match(page, /manualGrid[\s\S]{0,500}<SignedMoneyInput/);
  assert.deepEqual(finalizeNumericCapture("-50", 0), { raw: "0", value: 0 });
  assert.deepEqual(finalizeNumericCapture("-50"), { raw: "-50", value: -50 });
});

test("Minimum Putts capture stays inside the existing score card and persists in draft/history", () => {
  const scoreCard = page.indexOf("<RoundCaptureV2");
  const previousBets = page.indexOf('aria-label="Estado antes de este hoyo"');
  assert.ok(scoreCard >= 0 && previousBets > scoreCard);
  assert.match(roundCapture, /<CompactStepper large label=\{`Putts \$\{activePlayer\.name\} hoyo \$\{hole\.number\}`\}/);
  assert.match(roundCapture, /roundCaptureFieldsForPlayer\(\{ mode: "quick", playerId/);
  assert.match(captureControls, /function CompactStepper[\s\S]*aria-label=\{`Restar \$\{label\}`\}/);
  assert.match(roundCaptureLogic, /captureRequirementsForPlayer/);
  assert.match(captureRequirements, /bet\.type === "minimum_putts"/);
  assert.match(captureRequirements, /bet\.participantIds\.includes\(input\.playerId\)/);
  assert.match(page, /supplementalBets, manualBets, scores, scoreEdits, putts,/);
  assert.match(page, /supplementalBets: structuredClone\(supplementalBets\), putts: structuredClone\(putts\)/);
  assert.match(page, /setSupplementalBets\(normalizeSupplementalBets\(restored\.supplementalBets, restoredRoundHoles\)\); setPutts\(restored\.putts \|\| \{\}\)/);
  assert.match(page, /setSupplementalBets\(\(current\) => supplementalBetsForRoundHoles\(current, next\)\)/);
  assert.match(page, /<SupplementalBetsEditor[^>]+roundHoles=\{roundHoles\}/);
  assert.match(editor, /createSupplementalBet\(type, players, id, roundHoles\)/);
  assert.match(editor, /Ronda configurada: \{roundHoles\} hoyos\./);
});

test("new games feed live standings, general results, settlement and individual result accordions", () => {
  assert.match(page, /liveSupplemental\.balances/);
  assert.match(page, /supplemental\.balances/);
  assert.match(page, /const supplementalGeneralResults = useMemo\(\(\) => supplemental\.results\.filter\(\(result\) => !isPersonalSupplementalType\(result\.type\)\)/);
  assert.match(page, /generalResultCategories[\s\S]*supplementalGeneralResults\.map/);
  assert.match(page, /id=\{`supplemental-\$\{result\.betId\}`\}/);
  assert.match(page, /supplementalGeneralResults\.map\(\(result\) => <ResultAccordion[\s\S]*<SupplementalBetResults results=\{\[result\]\}/);
});

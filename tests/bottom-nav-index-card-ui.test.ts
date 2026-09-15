import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nav = readFileSync("app/components/app-bottom-nav.tsx", "utf8");
const navStyles = readFileSync("app/components/app-bottom-nav.module.css", "utf8");
const card = readFileSync("app/components/backyard-index-card.tsx", "utf8");
const cardStyles = readFileSync("app/components/backyard-index-card.module.css", "utf8");

test("round-resume navigation keeps its conditional route and uses an accessible two-line label", () => {
  assert.match(nav, /label === "Social" && onResumeRound && <button/);
  assert.match(nav, /onClick=\{onResumeRound\} aria-label="Continuar la ronda activa"/);
  assert.match(nav, /<span className=\{`betaNavLabel \$\{styles\.resumeLabel\}`\}><span>CONTINUAR<\/span><span>RONDA<\/span><\/span>/);
  assert.doesNotMatch(nav, /betaNavLabel">JUGAR<\/span>/);
  assert.match(navStyles, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(navStyles, /\.resume \{[^}]*min-height: 52px/);
  assert.match(navStyles, /\.resume svg \{ width: 24px; height: 24px;/);
  assert.match(navStyles, /\.resume \.resumeLabel \{ display: grid;/);
});

test("Backyard Index card shows actual eligible-record and differential counts without estimating missing rounds", () => {
  assert.match(card, /summary\?\.value === null \? "—"/);
  assert.match(card, /Se necesitan 3 rondas elegibles para empezar\./);
  assert.match(card, /summary\?\.recentRoundCount \?\? 0\} \/ 20/);
  assert.match(card, /summary\?\.usedCount \?\? 0/);
  assert.match(card, /mejores diferenciales/);
  assert.match(card, /calculateBackyardIndex\(history, userId\)/);
});

test("Index opt-in explains local PCC and does not treat older enabled preference as a declaration", () => {
  assert.match(card, /Al activar el Índice, declaro PCC 0 para las rondas sin PCC publicado, sólo para esta estimación local, no oficial\./);
  assert.match(card, /Si no hay PCC publicado, usaré PCC 0 declarado para esta estimación local, no oficial\./);
  assert.match(card, /localPccZeroDeclared === false && onDeclareLocalPccZero/);
  assert.match(card, /USAR PCC 0 LOCAL/);
  assert.match(card, /disabled=\{saving\}/);
  assert.match(card, /role="alert"/);
});

test("one shared set of user-facing Index reasons includes an unactivated round and verified tee wording", () => {
  const labels = readFileSync("lib/backyard-index-labels.ts", "utf8");
  assert.match(labels, /INDEX_NOT_ENABLED: "El Índice Backyard no estaba activado al cerrar esta ronda\."/);
  assert.match(labels, /MISSING_OFFICIAL_TEE_RATING: "Falta Rating\/Slope verificado del tee\."/);
  assert.match(card, /BACKYARD_INDEX_REASON_LABELS\[reason\]/);
  assert.match(card, /Desactivar Índice/);
});

test("Index help is an accessible, mobile-tappable dialog with the approved explanation", () => {
  assert.match(card, /aria-label="Cómo funciona el Índice Backyard" aria-haspopup="dialog"/);
  assert.match(card, /<ModalShell open=\{helpOpen\}/);
  assert.match(card, /Backyard Index utiliza tus diferenciales de score\. Conforme registras más rondas, utiliza una selección de tus mejores diferenciales\. Con 20 rondas utiliza los mejores 8\./);
  assert.match(cardStyles, /\.helpButton \{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(cardStyles, /\.helpDialog \{[^}]*max-height: min\(80vh, 620px\);/);
});

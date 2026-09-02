import assert from "node:assert/strict";
import test from "node:test";

import { expenseTotal } from "../lib/engine";
import { initialNumericCapture, numericCaptureOr, parseNumericCapture } from "../lib/numeric-input";

test("un cero inicial de captura se presenta vacío", () => {
  assert.equal(initialNumericCapture(0), "");
});
test("un HCP sin capturar se presenta vacío y un HCP explícito cero puede mostrarse", () => {
  assert.equal(initialNumericCapture(null, false), "");
  assert.equal(initialNumericCapture(0, false), "0");
});

test("un input vacío permite escribir un número directamente", () => {
  assert.equal(parseNumericCapture("125"), 125);
});

test("borrar un número deja el valor de captura vacío", () => {
  assert.equal(parseNumericCapture(""), null);
  assert.equal(initialNumericCapture(null), "");
});

test("el vacío no se convierte visualmente otra vez en cero", () => {
  assert.equal(initialNumericCapture(parseNumericCapture("")), "");
});

test("el motor puede interpretar el vacío como cero al confirmar", () => {
  assert.equal(numericCaptureOr(""), 0);
});

test("una apuesta manual acepta una pérdida de -500", () => {
  assert.equal(parseNumericCapture("-500"), -500);
});

test("un cero calculado real sigue siendo cero en resultados", () => {
  assert.equal(expenseTotal({ caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }), 0);
});

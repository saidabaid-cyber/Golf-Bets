import assert from "node:assert/strict";
import test from "node:test";

import { expenseTotal } from "../lib/engine";
import { applyNumericDirection, finalizeNumericCapture, initialNumericCapture, normalizeNumericCaptureText, numericCaptureOr, parseNumericCapture } from "../lib/numeric-input";

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
  assert.equal(applyNumericDirection(500, "loss"), -500);
  assert.equal(applyNumericDirection(-500, "gain"), 500);
});

test("la escritura 1 → 10 → 100 permanece temporal hasta confirmar 100", () => {
  assert.deepEqual(["1", "10", "100"].map(normalizeNumericCaptureText), ["1", "10", "100"]);
  assert.deepEqual(finalizeNumericCapture("100"), { raw: "100", value: 100 });
  assert.deepEqual(finalizeNumericCapture("80", 0, 100), { raw: "80", value: 80 });
});

test("captura numérica acepta signo y coma decimal pero nunca guarda letras", () => {
  assert.equal(normalizeNumericCaptureText(" - 12,7 abc"), "-12,7");
  assert.equal(parseNumericCapture("-12,7"), -12.7);
  assert.equal(parseNumericCapture("USD cien"), null);
  assert.deepEqual(finalizeNumericCapture("125", 0, 100), { raw: "100", value: 100 });
});

test("un cero calculado real sigue siendo cero en resultados", () => {
  assert.equal(expenseTotal({ caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }), 0);
});

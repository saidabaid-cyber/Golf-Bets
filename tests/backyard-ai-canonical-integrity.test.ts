import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateCanonicalRoundCommand } from "../lib/backyard-ai/runtime/canonical-command-guard";

test("acepta una normalización que conserva todas las acciones explícitas", () => {
  const result = validateCanonicalRoundCommand(
    "Jugamos Said, Pedro, Juan y Carlos. Skins de $100 y Nassau de $500.",
    "Hoy jugamos Said, Pedro, Juan y Carlos. Skins a 100; Nassau por 500.",
  );

  assert.equal(result.ok, true);
  assert.equal(result.command, "Hoy jugamos Said, Pedro, Juan y Carlos. Skins a 100; Nassau por 500.");
});

test("rechaza cambiar, agregar u omitir cifras incluso en modalidades desconocidas", () => {
  for (const [original, proposed] of [
    ["Skins de 100 y Nassau de 500.", "Skins de 200 y Nassau de 500."],
    ["Skins de 100.", "Skins de 100 a 18 hoyos."],
    ["Calcuta de 1,000.", "Calcuta de 2,000."],
  ]) {
    const result = validateCanonicalRoundCommand(original, proposed);
    assert.equal(result.ok, false, `${original} -> ${proposed}`);
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "explicit_numbers_changed"));
  }
});

test("acepta equivalencias de formato numérico sin permitir alterar el valor", () => {
  assert.equal(
    validateCanonicalRoundCommand("Skins de $1,000.", "Skins por 1000.").ok,
    true,
  );
  assert.equal(
    validateCanonicalRoundCommand("Pedro HCP 9,5.", "Pedro handicap 9.5.").ok,
    true,
  );
});

test("rechaza quitar, agregar o cambiar una exclusión o negación", () => {
  for (const proposed of [
    "Todos juegan Skins.",
    "Todos juegan Skins menos Juan.",
    "Quita Skins.",
  ]) {
    const result = validateCanonicalRoundCommand("Todos juegan Skins menos Carlos.", proposed);
    assert.equal(result.ok, false, proposed);
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "explicit_actions_changed"));
  }

  assert.equal(
    validateCanonicalRoundCommand("Pedro hoy no juega Nassau.", "Nassau menos Pedro.").ok,
    true,
    "una reformulación semánticamente equivalente sí es válida",
  );
});

test("rechaza renombrar, omitir o reordenar el roster explícito", () => {
  for (const proposed of [
    "Jugamos Said, Pedro y Julio. Skins de 100.",
    "Jugamos Said y Pedro. Skins de 100.",
    "Jugamos Pedro, Said y Juan. Skins de 100.",
  ]) {
    const result = validateCanonicalRoundCommand("Jugamos Said, Pedro y Juan. Skins de 100.", proposed);
    assert.equal(result.ok, false, proposed);
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "explicit_actions_changed"));
  }
});

test("conserva la partición de equipos aunque cambie el orden dentro de cada pareja", () => {
  const original = "Bola Amiga Said/Juan contra Pedro/Carlos de 200.";
  assert.equal(
    validateCanonicalRoundCommand(original, "Bola Amiga Juan/Said vs Carlos/Pedro por 200.").ok,
    true,
  );

  const mixed = validateCanonicalRoundCommand(
    original,
    "Bola Amiga Said/Pedro contra Juan/Carlos de 200.",
  );
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.ok(mixed.issues.some((issue) => issue.code === "explicit_actions_changed"));
});

test("rechaza agregar otra modalidad aunque reutilice la misma cifra", () => {
  const result = validateCanonicalRoundCommand("Skins de 100.", "Skins de 100 y Conejos de 100.");
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "explicit_actions_changed"));
});

test("protege también flags y reglas avanzadas aunque las cifras permanezcan iguales", () => {
  const penalty = validateCanonicalRoundCommand(
    "Vegas Said/Juan contra Pedro/Carlos de 10 cada hoyo con penalty birdie vs bogey.",
    "Vegas Said/Juan contra Pedro/Carlos de 10 cada hoyo sin penalty birdie vs bogey.",
  );
  assert.equal(penalty.ok, false);
  assert.ok(!penalty.ok && penalty.issues.some((issue) => issue.code === "explicit_actions_changed"));

  const matchPlay = validateCanonicalRoundCommand(
    "Presiones individuales de 150 con HCP al 80%, .5 baja y con Match Play.",
    "Presiones individuales de 150 con HCP al 80%, .5 baja y sin Match Play.",
  );
  assert.equal(matchPlay.ok, false);
  assert.ok(!matchPlay.ok && matchPlay.issues.some((issue) => issue.code === "explicit_actions_changed"));
});

test("preserva referencias de memoria y sus nombres", () => {
  assert.equal(
    validateCanonicalRoundCommand("Los mismos del domingo.", "Los mismos jugadores del domingo.").ok,
    true,
  );
  const changed = validateCanonicalRoundCommand(
    "Juguemos como la última vez en La Vista.",
    "Juguemos como la última vez en El Campanario.",
  );
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.ok(changed.issues.some((issue) => issue.code === "memory_reference_changed"));
});

test("conserva términos fuera de catálogo para que el validador local pregunte", () => {
  const changed = validateCanonicalRoundCommand("Agrega Calcuta de 100.", "Agrega Skins de 100.");
  assert.equal(changed.ok, false);
  if (!changed.ok) {
    assert.ok(changed.issues.some((issue) => issue.code === "unknown_catalog_term_changed"));
    assert.equal(changed.command, "Agrega Calcuta de 100.");
  }
});

test("falla cerrado ante una respuesta vacía", () => {
  const result = validateCanonicalRoundCommand("Skins de 100.", "   ");
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.issues.map((issue) => issue.code), ["empty_canonical_command"]);
});

test("AiRoundSetup valida antes de usar el comando del proveedor y avisa al hacer fallback", () => {
  const component = readFileSync("app/components/backyard-ai/ai-round-setup.tsx", "utf8");
  const validation = component.indexOf("validateCanonicalRoundCommand(command, response.canonicalCommand)");
  const assignment = component.indexOf("canonicalCommand = integrity.command");

  assert.ok(validation >= 0 && assignment > validation);
  assert.match(component, /canonicalCommand = command;[\s\S]*respuesta del proveedor cambió datos explícitos/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NAVIGABLE_GOLF_RULES } from "../lib/rules-navigation";
test("common situations point to sections of the existing official rule navigation", () => {
  const sections = new Set(NAVIGABLE_GOLF_RULES.flatMap(rule => rule.sections.map(section => section.number)));
  for (const reference of ["12.2", "18.2", "16.1", "17.1", "14.3"]) assert.ok(sections.has(reference), reference);
});
test("Reglas shows search before secondary disclosures and contains only golf rules", () => {
  const rules = readFileSync("app/components/rules-panel.tsx", "utf8");
  const home = rules.slice(rules.lastIndexOf('return <div className="rulesHome"'));
  assert.ok(home.indexOf('id="rules-search"') < home.indexOf('id="preguntar-ia"'));
  assert.match(home, /Buscar una regla, situación o palabra clave…/);
  assert.match(home, /Temas principales/);
  assert.match(home, /Situaciones comunes/);
  assert.match(home, /openRuleReference\(situation.reference\)/);
  assert.doesNotMatch(home, /Mi Bolsa|GHIN|Fitting|Amigos|Soporte|onOpenEquipment/);
});

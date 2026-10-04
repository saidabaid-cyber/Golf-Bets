import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NAVIGABLE_GOLF_RULES } from "../lib/rules-navigation";
import { RULES_COMMON_SITUATIONS } from "../lib/rules-catalog";
test("common situations point to sections of the existing official rule navigation", () => {
  const sections = new Set(NAVIGABLE_GOLF_RULES.flatMap(rule => rule.sections.map(section => section.number)));
  for (const situation of RULES_COMMON_SITUATIONS) for (const reference of situation.references) assert.ok(sections.has(reference), reference);
});
test("Reglas shows search before secondary disclosures and contains only golf rules", () => {
  const rules = readFileSync("app/components/rules-panel.tsx", "utf8");
  const home = rules.slice(rules.lastIndexOf('return <div className={`rulesHome'));
  assert.ok(home.indexOf('id="rules-search"') < home.indexOf('id="preguntar-ia"'));
  assert.match(home, /Buscar una regla, situación o palabra clave…/);
  assert.match(home, /Temas principales/);
  assert.match(home, /Situaciones comunes/);
  assert.match(home, /setHomeView\(\{ kind: "situation", situation \}\)/);
  assert.match(rules, /onClick=\{\(\) => openRuleReference\(reference\)\}/);
  assert.doesNotMatch(home, /Mi Bolsa|GHIN|Fitting|Amigos|Soporte|onOpenEquipment/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isLaVistaCourse } from "../lib/local-rules";
import { findNavigableRule, NAVIGABLE_GOLF_RULES, searchNavigableRules } from "../lib/rules-navigation";
import { browseRulesSource, rulesCorpusCoverage, searchRulesCorpus } from "../lib/rules-search";
import { normalizeRulesSearch } from "../lib/rules-search-normalization";
import { speechRecognitionConstructor, type SpeechRecognitionLike } from "../lib/speech-dictation";

const panel = readFileSync("app/components/rules-panel.tsx", "utf8");

test("el reglamento navegable contiene las 25 reglas oficiales", () => {
  assert.equal(NAVIGABLE_GOLF_RULES.length, 25);
  assert.deepEqual(NAVIGABLE_GOLF_RULES.map((rule) => Number(rule.number)), Array.from({ length: 25 }, (_, index) => index + 1));
});

test("la primera regla aparece con número y título", () => {
  assert.equal(NAVIGABLE_GOLF_RULES[0].number, "1");
  assert.match(NAVIGABLE_GOLF_RULES[0].title, /Juego.*Conducta/i);
});

test("la última regla aparece con sus modificaciones de accesibilidad", () => {
  assert.equal(NAVIGABLE_GOLF_RULES.at(-1)?.number, "25");
  assert.match(NAVIGABLE_GOLF_RULES.at(-1)?.title || "", /Discapacidades/i);
});

test("cada regla tiene acordeón accesible y subreglas", () => {
  assert.ok(NAVIGABLE_GOLF_RULES.every((rule) => rule.sections.length > 0));
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.match(panel, /aria-controls=\{`contenido-regla-/);
});

test("una subregla se localiza y abre en una vista dedicada", () => {
  const location = findNavigableRule("Regla 7.3");
  assert.equal(location?.chapter.number, "7");
  assert.equal(location?.section?.number, "7.3");
  assert.match(panel, /setDetail\(\{ chapter: entry, section: child \}\)/);
  assert.match(panel, /Regresar a Regla/);
});

test("la búsqueda por palabra encuentra la regla correcta", () => {
  assert.ok(searchNavigableRules("bola provisional").some(({ rule }) => rule.number === "18"));
  assert.ok(searchRulesCorpus("bola provisional").some((result) => result.rule.startsWith("18")));
});

test("la búsqueda por número encuentra regla y subregla", () => {
  assert.equal(searchNavigableRules("regla 17")[0].rule.number, "17");
  assert.equal(findNavigableRule("17.1a(2)")?.section?.number, "17.1");
});

test("la búsqueda ignora acentos, mayúsculas y espacios repetidos", () => {
  assert.equal(normalizeRulesSearch("  ÁREA   DE Penalidad "), "area de penalidad");
  const accented = searchNavigableRules("área de penalidad").map(({ rule }) => rule.number);
  const plain = searchNavigableRules("area de penalidad").map(({ rule }) => rule.number);
  assert.deepEqual(accented, plain);
});

test("los sinónimos comunes conducen a reglas pertinentes", () => {
  assert.ok(searchNavigableRules("cart path").some(({ rule }) => rule.number === "16"));
  assert.ok(searchNavigableRules("hazard").some(({ rule }) => rule.number === "17"));
  assert.ok(searchNavigableRules("OB").some(({ rule }) => rule.number === "18"));
  assert.ok(searchNavigableRules("drop").some(({ rule }) => rule.number === "14"));
});

test("las 13 páginas de Aclaraciones 2026 están disponibles", () => {
  const clarifications = browseRulesSource("clarifications-july-2026", 20);
  assert.equal(clarifications.length, 13);
  assert.ok(clarifications.every((result) => result.documentType === "clarification"));
  assert.match(panel, /Aclaraciones vigentes 2026/);
});

test("Procedimientos del Comité está separado de las Reglas", () => {
  const committee = browseRulesSource("committee-procedures-part-2", 18);
  assert.equal(committee.length, 18);
  assert.ok(committee.every((result) => result.documentType === "committee"));
  assert.match(panel, /Guía separada para quienes administran el campo/);
});

test("un resultado de búsqueda abre su regla o fuente correcta", () => {
  assert.match(panel, /openRuleReference\(entry\.rule, entry\.sourceId, entry\.page\)/);
  assert.match(panel, /findNavigableRule\(reference\)/);
  assert.match(panel, /setSelectedDocument\(document\)/);
});

test("el micrófono detecta SpeechRecognition y WebKit", () => {
  class Recognition implements SpeechRecognitionLike {
    lang = ""; continuous = false; interimResults = false;
    onstart = null; onresult = null; onerror = null; onend = null;
    start() {} stop() {}
  }
  assert.equal(speechRecognitionConstructor({ SpeechRecognition: Recognition }), Recognition);
  assert.equal(speechRecognitionConstructor({ webkitSpeechRecognition: Recognition }), Recognition);
  assert.match(panel, /Dictar búsqueda/);
});

test("el micrófono sin soporte muestra fallback y conserva búsqueda escrita", () => {
  assert.equal(speechRecognitionConstructor({}), null);
  assert.match(panel, /Dictado no disponible en este dispositivo/);
  assert.match(panel, /onChange=\{\(event\) => setQuery\(event\.target\.value\)\}/);
});

test("La Vista y La Vista Temporal muestran Reglas Locales", () => {
  assert.equal(isLaVistaCourse("La Vista"), true);
  assert.equal(isLaVistaCourse("La Vista Temporal"), true);
  assert.match(panel, /localRulesApply && <section className="card" id="reglas-locales"/);
});

test("otros campos no reciben Reglas Locales de La Vista", () => {
  assert.equal(isLaVistaCourse("Club Campestre"), false);
  assert.equal(isLaVistaCourse("La Vista Norte"), false);
});

test("Código de Caballeros permanece separado y no oficial", () => {
  assert.match(panel, /Código de Caballeros/);
  assert.match(panel, /Etiqueta y cultura de juego/);
  assert.match(panel, /NO OFICIAL/);
});

test("los tres PDFs conservan apertura accesible y regreso seguro", () => {
  assert.equal((panel.match(/Abrir documento/g) || []).length >= 1, true);
  assert.match(panel, /OFFICIAL_RULES_DOCUMENTS\.map/);
  assert.match(readFileSync("app/components/internal-pdf-viewer.tsx", "utf8"), /← Regresar a Reglas/);
  assert.match(readFileSync("app/components/internal-pdf-viewer.tsx", "utf8"), /<canvas ref=\{canvas\}/);
});

test("la búsqueda manual cubre tres fuentes sin llamar OpenAI automáticamente", () => {
  const coverage = rulesCorpusCoverage();
  assert.equal(coverage.sources, 3);
  assert.ok(coverage.pages >= 592);
  const searchEffect = panel.slice(panel.indexOf("const trimmed = query.trim()"), panel.indexOf("function toggleDictation"));
  assert.match(searchEffect, /\/api\/rules\/search/);
  assert.doesNotMatch(searchEffect, /\/api\/rules\/ask/);
  assert.match(panel, /method: "POST"/);
});

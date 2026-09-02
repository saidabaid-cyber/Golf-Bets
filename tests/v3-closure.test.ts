import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { BOTTOM_NAV_TARGETS, contrastToggleLabel } from "../lib/app-navigation";
import { GENTLEMEN_CODE, GENTLEMEN_CODE_DISCLAIMER, GENTLEMEN_CODE_FINAL_QUOTE } from "../lib/gentlemen-code";
import { activeLocalRules, isLaVistaCourse, LA_VISTA_LOCAL_RULES, withDefaultLaVistaRules } from "../lib/local-rules";
import { clearActiveRoundStorage, STORAGE_KEYS } from "../lib/round-utils";
import { OFFICIAL_RULES_VIDEOS_EMBED_URL, OFFICIAL_RULES_VIDEOS_URL } from "../lib/rules-catalog";
import { OFFICIAL_RULES_DOCUMENTS } from "../lib/rules-documents";
import type { Course } from "../lib/types";

test("bottom navigation maps Inicio to the real Home and every tab to its section", () => {
  assert.deepEqual(BOTTOM_NAV_TARGETS, {
    Inicio: "welcome",
    Tarjeta: "round",
    Personales: "personals",
    Resultados: "results",
    Histórico: "history",
    Reglas: "rules",
  });
});

test("deleting the active round removes only the draft key", () => {
  const removed: string[] = [];
  clearActiveRoundStorage({ removeItem: (key) => { removed.push(key); } });
  assert.deepEqual(removed, [STORAGE_KEYS.draft]);
  assert.notEqual(STORAGE_KEYS.draft, STORAGE_KEYS.history);
  assert.notEqual(STORAGE_KEYS.draft, STORAGE_KEYS.courses);
  assert.notEqual(STORAGE_KEYS.draft, STORAGE_KEYS.frequentPlayers);
  assert.notEqual(STORAGE_KEYS.draft, STORAGE_KEYS.frequentGroups);
  assert.notEqual(STORAGE_KEYS.draft, STORAGE_KEYS.rivals);
  assert.notEqual(STORAGE_KEYS.draft, STORAGE_KEYS.contrast);
});

test("high contrast control has an unambiguous label in both states", () => {
  assert.equal(contrastToggleLabel(false), "☀ Alto contraste");
  assert.equal(contrastToggleLabel(true), "✓ Alto contraste");
  assert.equal(contrastToggleLabel(false).includes("Campo"), false);
});

test("rules videos use the approved external playlist and safe embed", () => {
  assert.equal(OFFICIAL_RULES_VIDEOS_URL, "https://youtube.com/playlist?list=PLnU5qUEfww3dYQwcnZ5qoGAlwzGRtghdA&si=QuhRbedq6dIFrouW");
  assert.equal(OFFICIAL_RULES_VIDEOS_EMBED_URL, "https://www.youtube-nocookie.com/embed/videoseries?list=PLnU5qUEfww3dYQwcnZ5qoGAlwzGRtghdA");
});

test("La Vista rules include the documented per-hole cases and stay snapshot-safe", () => {
  assert.equal(isLaVistaCourse("La Vista Temporal"), true);
  assert.equal(isLaVistaCourse("Otro campo"), false);
  assert.match(LA_VISTA_LOCAL_RULES.find((rule) => rule.hole === 14)?.text || "", /golpe de castigo/i);
  assert.match(LA_VISTA_LOCAL_RULES.find((rule) => rule.hole === 6)?.text || "", /área de penalidad frontal/i);
  const sprinklerRule = LA_VISTA_LOCAL_RULES.find((rule) => rule.id === "green-sprinklers")?.text || "";
  assert.match(sprinklerRule, /3 yardas del green/i);
  assert.match(sprinklerRule, /máxima de un bastón del aspersor/i);

  const base: Course = {
    id: "la-vista-test", name: "La Vista", teeName: "General",
    holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
  };
  const configured = withDefaultLaVistaRules(base);
  const snapshot = structuredClone(configured);
  configured.localRules![0].enabled = false;
  assert.equal(snapshot.localRules![0].enabled, true);
  assert.equal(activeLocalRules(configured.localRules).length, LA_VISTA_LOCAL_RULES.length - 1);
});

test("La Vista local rules are restored from the code-controlled source", () => {
  const empty = withDefaultLaVistaRules({
    id: "vista-empty",
    name: "La Vista",
    teeName: "General",
    builtIn: false,
    holes: [],
    localRules: [],
  });
  assert.deepEqual(empty.localRules, LA_VISTA_LOCAL_RULES);
});

test("La Vista local rules apply only to La Vista and La Vista Temporal", () => {
  assert.equal(isLaVistaCourse("La Vista"), true);
  assert.equal(isLaVistaCourse("La Vista Temporal"), true);
  for (const course of ["Campestre de Puebla", "El Cristo", "Cola de Lagarto", "Campo personalizado", "La Vista Norte"]) {
    assert.equal(isLaVistaCourse(course), false, course);
  }
});

test("the three indexed official documents are visible through safe local ids", () => {
  assert.equal(OFFICIAL_RULES_DOCUMENTS.length, 3);
  assert.deepEqual(OFFICIAL_RULES_DOCUMENTS.map((document) => document.sourceFileName), [
    "2023 Guia Oficial Golf pt1.pdf",
    "2023 Guia Oficial Golf pt2.pdf",
    "Additional Clarifications of the 2023 Rules of Golf - 1 July 2026 - 2.pdf",
  ]);
  assert.ok(OFFICIAL_RULES_DOCUMENTS.every((document) => document.usedByAi && document.localUrl.startsWith("/api/rules/documents/") && !document.localUrl.includes(".pdf")));
  assert.ok(OFFICIAL_RULES_DOCUMENTS.every((document) => document.officialUrl.startsWith("https://") && document.officialUrl.toLowerCase().endsWith(".pdf")));
  assert.equal(OFFICIAL_RULES_DOCUMENTS[0].officialUrl, "https://www.usga.org/content/dam/usga/pdf/2023/rules/2023%20Guia%20Oficial%20Golf%20pt1.pdf");
  assert.equal(OFFICIAL_RULES_DOCUMENTS[1].officialUrl, "https://www.usga.org/content/dam/usga/pdf/2023/rules/2023%20Guia%20Oficial%20Golf%20pt2.pdf");
  assert.match(OFFICIAL_RULES_DOCUMENTS[2].officialUrl, /assets\.randa\.org\/.*1%20July%202026_RA\.pdf$/);
});

test("document buttons use official production sources and never show a localhost-only dead end", () => {
  const panel = readFileSync("app/components/rules-panel.tsx", "utf8");
  const route = readFileSync("app/api/rules/documents/[id]/route.ts", "utf8");
  assert.match(panel, /setSelectedDocument\(document\)/);
  assert.match(panel, /<iframe src=\{selectedDocument\.localUrl\}/);
  assert.match(panel, />Abrir documento<\/button>/);
  assert.match(route, /fetch\(document\.officialUrl/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /X-Frame-Options.*SAMEORIGIN/);
  assert.doesNotMatch(`${panel}\n${route}`, /únicamente en localhost/i);
});

test("document navigation leaves The Backyard available for a safe return", () => {
  const panel = readFileSync("app/components/rules-panel.tsx", "utf8");
  assert.match(panel, /← Volver a Reglas/);
  assert.match(panel, /href=\{selectedDocument\.officialUrl\} target="_blank" rel="noreferrer">Abrir en navegador/);
  assert.match(panel, /Si Safari no muestra el PDF dentro de la app/);
});

test("the setup date uses a centered responsive wrapper for mobile and desktop", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(page, /className="hero setupHero"/);
  assert.match(page, /className="heroDate"/);
  assert.match(css, /\.heroDate\{[^}]*justify-content:center/);
  assert.match(css, /\.setupHero \.dateInput\{[^}]*margin:0 auto[^}]*text-align:center/);
  assert.match(css, /@media\(max-width:430px\)[\s\S]*\.setupHero \.heroDate\{[^}]*align-self:center/);
});

test("capture inputs use the empty-safe numeric control without zero placeholders", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const polla = readFileSync("app/components/polla-live-panel.tsx", "utf8");
  const input = readFileSync("app/components/numeric-capture-input.tsx", "utf8");
  assert.match(page, /NumberField label="Golpes que recibe"/);
  assert.match(page, /NumericCaptureInput inputMode="decimal" step=\{50\}/);
  assert.match(polla, /NumericCaptureInput placeholder="HCP"/);
  assert.match(input, /setRawValue\(event\.target\.value\)/);
  assert.doesNotMatch(`${page}\n${polla}`, /placeholder="0"/);
});

test("private rule-source folders remain ignored by Git", () => {
  const gitignore = readFileSync(".gitignore", "utf8");
  assert.match(gitignore, /^rules-source\/$/m);
  assert.match(gitignore, /^rules-sources\/$/m);
  assert.match(gitignore, /^brand-source\/$/m);
});

test("Código de Caballeros is complete and explicitly cannot create sports penalties", () => {
  assert.equal(GENTLEMEN_CODE.length, 7);
  assert.match(GENTLEMEN_CODE_FINAL_QUOTE, /mantiene su nivel cuando pierde/i);
  assert.match(GENTLEMEN_CODE_DISCLAIMER, /No crea penalidades deportivas/i);
});

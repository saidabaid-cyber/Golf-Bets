import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { rulesContextForRound } from "../lib/app-navigation";
import { legalConfig, LEGAL_DOCUMENT_VERSIONS, missingLegalFields } from "../lib/legal-config";
import { isLaVistaCourse, LA_VISTA_LOCAL_RULES, withDefaultLaVistaRules } from "../lib/local-rules";
import { rulesCorpusCoverage, searchRulesCorpus } from "../lib/rules-search";
import { speechRecognitionConstructor, speechRecognitionErrorMessage, type SpeechRecognitionLike } from "../lib/speech-dictation";
import type { Course } from "../lib/types";

const read = (file: string) => readFileSync(file, "utf8");

function sourceFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const candidate = path.join(folder, name);
    if (statSync(candidate).isDirectory()) return sourceFiles(candidate);
    return /\.(?:ts|tsx|json|webmanifest)$/.test(name) ? [candidate] : [];
  });
}

test("Reglas Locales son de solo lectura y controladas por código", () => {
  const page = read("app/page.tsx");
  const panel = read("app/components/rules-panel.tsx");
  assert.match(page, /Ver Reglas Locales/);
  for (const forbidden of ["Editar Reglas Locales", "Agregar Regla Local", "Eliminar Regla Local"]) {
    assert.doesNotMatch(`${page}\n${panel}`, new RegExp(forbidden));
  }
  const stale: Course = { id: "vista", name: "La Vista", teeName: "General", holes: [], localRules: [] };
  assert.deepEqual(withDefaultLaVistaRules(stale).localRules, LA_VISTA_LOCAL_RULES);
});

test("Reglas Locales y contexto IA aplican solo a La Vista con ronda activa", () => {
  assert.equal(isLaVistaCourse("La Vista"), true);
  assert.equal(isLaVistaCourse("La Vista Temporal"), true);
  assert.equal(isLaVistaCourse("La Vista Norte"), false);
  assert.equal(rulesContextForRound(true, "La Vista"), "La Vista");
  assert.equal(rulesContextForRound(false, "La Vista"), "");
});

test("dictado detecta SpeechRecognition estándar, WebKit y ausencia de soporte", () => {
  class Recognition implements SpeechRecognitionLike {
    lang = "";
    continuous = false;
    interimResults = false;
    onstart = null;
    onresult = null;
    onerror = null;
    onend = null;
    start() {}
    stop() {}
  }
  assert.equal(speechRecognitionConstructor({ SpeechRecognition: Recognition }), Recognition);
  assert.equal(speechRecognitionConstructor({ webkitSpeechRecognition: Recognition }), Recognition);
  assert.equal(speechRecognitionConstructor({}), null);
});

test("dictado comunica permiso denegado y fallos de captura sin romper la app", () => {
  assert.match(speechRecognitionErrorMessage({ error: "not-allowed" }), /permiso/i);
  assert.match(speechRecognitionErrorMessage({ error: "audio-capture" }), /micrófono/i);
  assert.match(speechRecognitionErrorMessage({ error: "no-speech" }), /voz/i);
});

test("buscador cubre los tres documentos completos, acentos y números de Regla", () => {
  const coverage = rulesCorpusCoverage();
  assert.equal(coverage.sources, 3);
  assert.ok(coverage.pages >= 590);
  assert.ok(searchRulesCorpus("bola perdida").length > 0);
  assert.ok(searchRulesCorpus("area de penalidad").some((result) => /^17(?:\.|$)/.test(result.rule)));
  assert.ok(searchRulesCorpus("área de penalidad").some((result) => /^17(?:\.|$)/.test(result.rule)));
  assert.ok(searchRulesCorpus("regla 25").some((result) => /^25(?:\.|$)/.test(result.rule)));
  assert.ok(searchRulesCorpus("cart path").some((result) => /camino|cart path/i.test(result.explanation)));
});

test("Safari/iPhone conserva autosave y abre fotos sin perder la app instalada", () => {
  const page = read("app/page.tsx");
  const layout = read("app/layout.tsx");
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(page, /addEventListener\("pagehide", flush\)/);
  assert.match(page, /addEventListener\("visibilitychange", flushWhenHidden\)/);
  assert.match(page, /window\.open\("about:blank", "_blank"\)[\s\S]*readScorecardPhoto/);
});

test("identidad pública y metadata usan exclusivamente THE BACKYARD", () => {
  const visibleSource = [
    ...sourceFiles("app"),
    "public/manifest.webmanifest",
    "lib/round-export.ts",
  ].map(read).join("\n");
  assert.match(visibleSource, /THE BACKYARD/);
  assert.match(visibleSource, /Built for the games we play\./);
  assert.match(visibleSource, /Play\. Compete\. Bet\. Settle\./);
  assert.doesNotMatch(visibleSource, /Golf Bets/i);
});

test("logo oficial usa SVG vectorial primero, PNG transparente como fallback y header sin V3", () => {
  const brand = read("app/components/brand-lockup.tsx");
  const page = read("app/page.tsx");
  const svgPath = "public/brand/the-backyard-logo.svg";
  const pngPath = "public/brand/the-backyard-logo.png";
  assert.equal(existsSync(svgPath), true);
  assert.equal(existsSync(pngPath), true);
  const svg = read(svgPath);
  const png = readFileSync(pngPath);
  assert.match(svg, /<svg[^>]*viewBox=/);
  assert.ok((svg.match(/<path /g) || []).length >= 20);
  assert.doesNotMatch(svg, /<image\b/);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png[25], 6, "PNG must use RGBA color type");
  assert.match(brand, /<source srcSet="\/brand\/the-backyard-logo\.svg" type="image\/svg\+xml"/);
  assert.match(brand, /src="\/brand\/the-backyard-logo\.png"/);
  assert.match(brand, /current === "svg" \? "png" : "wordmark"/);
  assert.doesNotMatch(page, />V3<\/span>/);
  assert.match(page, /identity\.mode === "guest" \? <svg className="guestAvatar"/);
});

test("configuración legal real es única, completa y usa la versión solicitada", () => {
  assert.equal(LEGAL_DOCUMENT_VERSIONS.privacy, "2026-09-02-v2");
  assert.equal(legalConfig.responsibleName, "Said Abaid Taja");
  assert.match(legalConfig.responsibleAddress, /Calle 1 Retorno Osa Menor/);
  assert.match(legalConfig.responsibleAddress, /Periférico Ecológico/);
  assert.equal(legalConfig.privacyEmail, "privacidad@thebackyard.com.mx");
  assert.equal(legalConfig.supportEmail, "soporte@thebackyard.com.mx");
  assert.equal(legalConfig.contactEmail, "contacto@thebackyard.com.mx");
  assert.deepEqual(missingLegalFields(), []);
});

test("Aviso y Términos consumen legalConfig y mantienen los límites económicos", () => {
  const privacy = read("app/legal/privacy/page.tsx");
  const terms = read("app/legal/terms/page.tsx");
  assert.match(privacy, /legalConfig\.privacyVersion/);
  assert.match(privacy, /legalConfig\.responsibleAddress/);
  assert.match(privacy, /legalConfig\.privacyEmail/);
  assert.match(terms, /THE BACKYARD/);
  assert.match(terms, /No recibe,[^;]*ni procesa dinero/i);
  assert.match(terms, /legalConfig\.contactEmail/);
  assert.match(terms, /legalConfig\.privacyEmail/);
});

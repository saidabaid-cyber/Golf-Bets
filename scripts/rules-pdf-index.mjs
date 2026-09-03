import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_RULES_PDF_SOURCES = [
  {
    sourceId: "official-guide-part-1",
    filename: "2023 Guia Oficial Golf pt1.pdf",
    source: "Guía Oficial / Reglas de Golf — Parte 1",
  },
  {
    sourceId: "committee-procedures-part-2",
    filename: "2023 Guia Oficial Golf pt2.pdf",
    source: "Procedimientos del Comité / Parte 2",
  },
  {
    sourceId: "clarifications-july-2026",
    filename: "Additional Clarifications of the 2023 Rules of Golf - 1 July 2026 - 2.pdf",
    source: "Aclaraciones vigentes — Julio 2026",
  },
];

export function normalizeRulesPdfText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\uFFFD/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function hasUsefulRulesPdfText(value, minimumCharacters = 24) {
  return normalizeRulesPdfText(value).replace(/[^a-z0-9]/g, "").length >= minimumCharacters;
}

function ruleNumber(text) {
  const match = String(text).slice(0, 1800).match(/\b(?:Regla|Rule)\s+(\d{1,2}(?:\.\d+[a-z]?(?:\(\d+\))?)?)/i);
  return match?.[1] ?? "";
}

function extractedText(textContent) {
  return textContent.items
    .map((item) => (item && typeof item === "object" && "str" in item ? String(item.str) : ""))
    .join(" ");
}

async function renderPageForOcr(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, canvas, viewport, background: "white" }).promise;
  return canvas.toBuffer("image/png");
}

async function createLocalOcrWorker() {
  const languagePath = fs.mkdtempSync(path.join(os.tmpdir(), "backyard-rules-ocr-"));
  for (const language of ["spa", "eng"]) {
    const data = require(`@tesseract.js-data/${language}`);
    fs.copyFileSync(
      path.join(data.langPath, `${language}.traineddata.gz`),
      path.join(languagePath, `${language}.traineddata.gz`),
    );
  }
  const worker = await createWorker(["spa", "eng"], undefined, {
    langPath: languagePath,
    cachePath: languagePath,
    gzip: true,
  });
  return {
    async recognize(image) {
      const result = await worker.recognize(image);
      return { text: result.data.text ?? "", confidence: result.data.confidence ?? 0 };
    },
    async close() {
      await worker.terminate();
      fs.rmSync(languagePath, { recursive: true, force: true });
    },
  };
}

function coveragePercent(indexedPages, totalPages) {
  return totalPages ? Number(((indexedPages / totalPages) * 100).toFixed(2)) : 100;
}

export function rulesPdfCoverageMarkdown(report) {
  const rows = report.documents.map((document) =>
    `| ${document.source} | ${document.totalPages} | ${document.textPages} | ${document.ocrProcessedPages} | ${document.ocrPages} | ${document.indexedPages} | ${document.pagesWithoutText} | ${document.coveragePercent}% |`,
  );
  const unresolved = report.documents
    .filter((document) => document.pagesWithoutText > 0)
    .map((document) => `- ${document.source}: páginas ${document.pagesWithoutTextNumbers.join(", ")} no contienen texto visible ni después de OCR.`);
  return [
    "# Cobertura del índice PDF de Reglas",
    "",
    "El índice se genera fuera del iPhone. Primero usa la capa de texto; las páginas sin texto útil se renderizan y pasan por OCR Tesseract.js (`spa+eng`).",
    "",
    "| Documento | Páginas | Texto normal | OCR procesadas | OCR indexadas | Total indexadas | Sin texto final | Cobertura |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    `**Total:** ${report.totals.indexedPages}/${report.totals.totalPages} páginas indexadas (${report.totals.coveragePercent}%).`,
    "",
    ...(unresolved.length ? ["## Páginas sin texto final", "", ...unresolved, ""] : []),
    "Las páginas sin texto final permanecen auditadas en el reporte JSON; no se inventa contenido para páginas realmente vacías.",
    "",
  ].join("\n");
}

export async function buildRulesPdfIndex({
  sources = DEFAULT_RULES_PDF_SOURCES,
  sourceDirectory = path.join(ROOT, "rules-sources"),
  outputPath = path.join(ROOT, "lib", "rules-search-index.generated.json"),
  reportPath = path.join(ROOT, "lib", "rules-search-index.report.generated.json"),
  markdownReportPath = path.join(ROOT, "docs", "RULES_PDF_INDEX_REPORT.md"),
  minimumTextCharacters = 24,
  renderScale = 2,
  createOcr = createLocalOcrWorker,
  onProgress = (message) => console.log(message),
} = {}) {
  const entries = [];
  const documents = [];
  let ocr;

  try {
    for (const source of sources) {
      const pdfPath = source.path ?? path.join(sourceDirectory, source.filename);
      if (!fs.existsSync(pdfPath)) throw new Error(`No existe el PDF fuente: ${pdfPath}`);
      const loadingTask = getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), disableWorker: true, verbosity: 0 });
      const document = await loadingTask.promise;
      const stats = {
        sourceId: source.sourceId,
        source: source.source,
        filename: path.basename(pdfPath),
        totalPages: document.numPages,
        textPages: 0,
        ocrProcessedPages: 0,
        ocrPages: 0,
        indexedPages: 0,
        pagesWithoutText: 0,
        pagesWithoutTextNumbers: [],
        ocrPageNumbers: [],
        coveragePercent: 0,
      };

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const rawText = extractedText(await page.getTextContent());
        let finalText = rawText;
        let usedOcr = false;

        if (!hasUsefulRulesPdfText(rawText, minimumTextCharacters)) {
          ocr ??= await createOcr();
          stats.ocrProcessedPages += 1;
          const recognized = await ocr.recognize(await renderPageForOcr(page, renderScale));
          if (hasUsefulRulesPdfText(recognized.text, minimumTextCharacters)) {
            finalText = recognized.text;
            usedOcr = true;
          }
        }

        const searchable = normalizeRulesPdfText(finalText);
        if (searchable) {
          if (usedOcr) {
            stats.ocrPages += 1;
            stats.ocrPageNumbers.push(pageNumber);
          } else {
            stats.textPages += 1;
          }
          entries.push({
            id: `${source.sourceId}-p${pageNumber}`,
            sourceId: source.sourceId,
            source: source.source,
            page: pageNumber,
            rule: ruleNumber(finalText),
            searchText: searchable,
          });
          stats.indexedPages += 1;
        } else {
          stats.pagesWithoutText += 1;
          stats.pagesWithoutTextNumbers.push(pageNumber);
        }
        page.cleanup();
      }

      stats.coveragePercent = coveragePercent(stats.indexedPages, stats.totalPages);
      documents.push(stats);
      await loadingTask.destroy();
      onProgress(`${source.source}: ${stats.indexedPages}/${stats.totalPages} páginas indexadas; ${stats.ocrProcessedPages} procesadas por OCR.`);
    }
  } finally {
    await ocr?.close();
  }

  const totals = documents.reduce((total, document) => ({
    totalPages: total.totalPages + document.totalPages,
    textPages: total.textPages + document.textPages,
    ocrProcessedPages: total.ocrProcessedPages + document.ocrProcessedPages,
    ocrPages: total.ocrPages + document.ocrPages,
    indexedPages: total.indexedPages + document.indexedPages,
    pagesWithoutText: total.pagesWithoutText + document.pagesWithoutText,
    coveragePercent: 0,
  }), { totalPages: 0, textPages: 0, ocrProcessedPages: 0, ocrPages: 0, indexedPages: 0, pagesWithoutText: 0, coveragePercent: 0 });
  totals.coveragePercent = coveragePercent(totals.indexedPages, totals.totalPages);
  const report = { engine: "Tesseract.js 7.0.0 (spa+eng)", documents, totals };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(markdownReportPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(entries), "utf8");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(markdownReportPath, rulesPdfCoverageMarkdown(report), "utf8");
  return { entries, report };
}

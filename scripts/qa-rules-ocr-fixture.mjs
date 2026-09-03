import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";

import { buildRulesPdfIndex } from "./rules-pdf-index.mjs";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "backyard-ocr-fixture-"));
try {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  pdf.setFontSize(24);
  pdf.text("Regla 17 - area de penalidad", 50, 90);
  pdf.text("Esta pagina conserva una capa de texto normal.", 50, 130);

  const canvas = createCanvas(1400, 500);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "bold 72px Arial";
  context.fillText("BOLA PROVISIONAL", 60, 180);
  context.font = "48px Arial";
  context.fillText("Página capturada solamente como imagen OCR", 60, 300);
  pdf.addPage();
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 36, 180, 540, 193);

  const sourcePath = path.join(temporary, "mixed.pdf");
  fs.writeFileSync(sourcePath, Buffer.from(pdf.output("arraybuffer")));
  const { entries, report } = await buildRulesPdfIndex({
    sources: [{ sourceId: "ocr-fixture", source: "Fixture OCR", filename: "mixed.pdf", path: sourcePath }],
    outputPath: path.join(temporary, "index.json"),
    reportPath: path.join(temporary, "report.json"),
    markdownReportPath: path.join(temporary, "report.md"),
    onProgress: () => {},
  });
  const searched = entries.filter((entry) => entry.searchText.includes("bola provisional"));
  console.log(JSON.stringify({
    report: report.documents[0],
    indexedPages: entries.map((entry) => entry.page),
    ocrSearchPages: searched.map((entry) => entry.page),
    ocrExcerpt: searched[0]?.searchText ?? "",
  }));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

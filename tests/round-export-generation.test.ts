import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import type { jsPDF } from "jspdf";
import { downloadRoundCsv, downloadRoundImage, downloadRoundPdf, roundCardBlob, shareRound } from "../lib/round-export";
import type { RoundSnapshot } from "../lib/types";

test("exports generate real nonempty CSV/PNG/PDF with filenames and Web Share fallbacks (not physical download)", async (t) => {
  const round: RoundSnapshot = { id: "qa-export", date: "2026-09-17", courseName: "Campo QA", teeName: "Azules", ownerName: "Alfa QA", ownerId: "a", roundHoles: 18, startHole: 1, handicapBasis: "relative", players: [{ id: "a", name: "Alfa QA", handicap: 0 }], scores: { 1: { a: 4 } }, betResult: 75, expenseTotal: 15, netResult: 60, categoryResults: { skins: 75 }, expenses: { caddie: 15, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 } };
  const objects = new Map<string, Blob>();
  const downloads: { filename: string; blob: Blob }[] = [];
  const originals = new Map(["document", "navigator", "FileReader"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const setGlobal = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, value });
  t.mock.method(URL, "createObjectURL", (blob: Blob) => { const id = `blob:qa-${objects.size}`; objects.set(id, blob); return id; });
  t.mock.method(URL, "revokeObjectURL", () => undefined);
  setGlobal("document", { createElement: (tag: string) => {
    if (tag === "canvas") { const canvas = createCanvas(1080, 1350); return Object.assign(canvas, { toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array(canvas.toBuffer("image/png"))], { type: "image/png" })) }); }
    if (tag === "a") return { href: "", download: "", click() { downloads.push({ filename: this.download, blob: objects.get(this.href)! }); } };
    throw Error(`Unexpected element ${tag}`);
  } });
  setGlobal("FileReader", class { result = ""; onload?: () => void; readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(buffer => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`; this.onload?.(); }); } });
  // Intercept only the final OS save, not PDF generation or its image encoding.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfModule = require("jspdf") as { jsPDF: typeof jsPDF };
  const RealPdf = pdfModule.jsPDF;
  t.mock.method(pdfModule, "jsPDF", function (options: ConstructorParameters<typeof jsPDF>[0]) {
    const pdf = new RealPdf(options);
    pdf.save = ((filename: string) => { downloads.push({ filename, blob: new Blob([pdf.output("arraybuffer")], { type: "application/pdf" }) }); return pdf; }) as typeof pdf.save;
    return pdf;
  });
  try {
    downloadRoundCsv(round);
    assert.equal(downloads[0].filename, "the-backyard-2026-09-17.csv");
    assert.equal(downloads[0].blob.type, "text/csv;charset=utf-8");
    assert.match(await downloads[0].blob.text(), /Campo QA.*Alfa QA/);
    const image = await roundCardBlob(round);
    assert.equal(image.type, "image/png"); assert.ok(image.size > 1000);
    assert.equal(Buffer.from(await image.arrayBuffer()).subarray(1, 4).toString(), "PNG");
    await downloadRoundImage(round);
    assert.equal(downloads[1].filename, "the-backyard-2026-09-17.png");
    await downloadRoundPdf(round);
    assert.equal(downloads[2].filename, "the-backyard-2026-09-17.pdf");
    assert.equal(downloads[2].blob.type, "application/pdf"); assert.ok(downloads[2].blob.size > 1000);
    assert.equal(Buffer.from(await downloads[2].blob.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    let shareCalls = 0;
    setGlobal("navigator", { canShare: () => true, share: async ({ files }: { files: File[] }) => { shareCalls++; assert.equal(files[0].type, "image/png"); assert.equal(files[0].name, "the-backyard-2026-09-17.png"); } });
    assert.equal(await shareRound(round), "shared"); assert.equal(shareCalls, 1);
    let copied = "";
    setGlobal("navigator", { canShare: () => false, share: async () => { throw Error("unsupported files must not share"); }, clipboard: { writeText: async (text: string) => { copied = text; } } });
    assert.equal(await shareRound(round), "copied"); assert.match(copied, /Campo QA/);
    setGlobal("navigator", {});
    assert.equal(await shareRound(round), "downloaded"); assert.equal(downloads[3].filename, "the-backyard-2026-09-17.png");
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

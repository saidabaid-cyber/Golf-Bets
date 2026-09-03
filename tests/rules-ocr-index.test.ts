import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("índice PDF mezcla texto normal con OCR real y encuentra la página escaneada", () => {
  const result = spawnSync(process.execPath, ["scripts/qa-rules-ocr-fixture.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim()) as {
    report: { totalPages: number; textPages: number; ocrProcessedPages: number; ocrPages: number; indexedPages: number; pagesWithoutText: number; coveragePercent: number };
    indexedPages: number[];
    ocrSearchPages: number[];
    ocrExcerpt: string;
  };
  assert.deepEqual(payload.indexedPages, [1, 2]);
  assert.deepEqual(payload.ocrSearchPages, [2]);
  assert.match(payload.ocrExcerpt, /bola provisional/);
  assert.deepEqual(payload.report, {
    ...payload.report,
    totalPages: 2,
    textPages: 1,
    ocrProcessedPages: 1,
    ocrPages: 1,
    indexedPages: 2,
    pagesWithoutText: 0,
    coveragePercent: 100,
  });
});

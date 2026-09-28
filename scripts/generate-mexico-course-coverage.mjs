import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildMexicoCourseCoverageRows,
  mexicoCourseCoverageCsv,
  summarizeMexicoCourseCoverage,
} from "./lib/mexico-course-coverage.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const inputPath = argument("--input");
const outputPath = argument("--output") ?? "docs/course-data/MEXICO_COURSE_COVERAGE.csv";
const seedPath = argument("--seed") ?? "data/golf-course-catalog.seed.json";
const check = process.argv.includes("--check");
if (!inputPath) throw new Error("Usage: node scripts/generate-mexico-course-coverage.mjs --input <qa-read-only-export.json> [--output <csv>] [--seed <seed.json>] [--check]");

const input = JSON.parse(readFileSync(path.resolve(inputPath), "utf8"));
const seed = JSON.parse(readFileSync(path.resolve(seedPath), "utf8"));
const rows = buildMexicoCourseCoverageRows(input, seed);
const csv = mexicoCourseCoverageCsv(rows);
const output = path.resolve(outputPath);
if (check) assert.equal(readFileSync(output, "utf8").replaceAll("\r\n", "\n"), csv, "MEXICO_COURSE_COVERAGE_STALE");
else writeFileSync(output, csv);
console.log(JSON.stringify({ status: "PASS", mode: check ? "check" : "generate", output: outputPath, ...summarizeMexicoCourseCoverage(rows) }));

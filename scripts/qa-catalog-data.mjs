import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

// Compile with `node node_modules/typescript/bin/tsc -p tsconfig.test.json` first.
// Uses exactly the normalizers/deduplication consumed by the runtime provider.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { buildEquipmentAudit, buildCourseAudit } = require("../.test-dist/scripts/catalog-quality.js");
const { golfBallCatalog, golfClubCatalog, golfShaftCatalog } = require("../.test-dist/lib/golf-equipment-catalog.js");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some(value => value !== "--check")) throw Error("Usage: node scripts/qa-catalog-data.mjs [--check]");
const sourceFiles = ["lib/golf-equipment-catalog.ts", "lib/golf-equipment.ts", "lib/ball-fit-handicap.ts", "data/golf-ball-catalog.seed.json", "data/golf-club-catalog.seed.json", "data/golf-shaft-catalog.seed.json", "data/golf-equipment-catalog.expansion.seed.json", "data/forgiving-golf-equipment.snapshot.json", "data/backyard-equipment-master-2010-2026.snapshot.json", "data/backyard-shaft-master-2010-2026.snapshot.json"];
const provenance = sourceFiles.map(file => ({ file, sha256: createHash("sha256").update(readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n")).digest("hex") }));
const equipment = { ...buildEquipmentAudit({ clubs: golfClubCatalog, balls: golfBallCatalog, shafts: golfShaftCatalog }), sourceFiles: provenance };
const source = JSON.parse(readFileSync(path.join(root, "data/qa/course-audit-source.json"), "utf8"));
const courses = buildCourseAudit(source);
mkdirSync(path.join(root, "data/qa"), { recursive: true });
for (const [filename, data] of [["course-gaps.json", courses], ["equipment-gaps.json", equipment]]) {
  const file = path.join(root, "data/qa", filename);
  const content = JSON.stringify(data, null, 2) + "\n";
  if (check) {
    if (readFileSync(file, "utf8").replaceAll("\r\n", "\n") !== content) throw Error(`STALE_CATALOG_AUDIT:${filename}`);
  } else writeFileSync(file, content);
}
console.log(JSON.stringify({ status: "PASS", mode: check ? "check" : "generate", courses: courses.summary, equipment: equipment.summary, dbWrites: 0, catalogChanges: 0 }));

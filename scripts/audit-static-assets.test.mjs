import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const auditor = fileURLToPath(new URL("./audit-static-assets.mjs", import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "backyard-assets-"));
  for (const directory of ["app", "docs/evidence", "scripts", "public"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, "app/apple-icon.png"), "fixture");
  writeFileSync(join(root, "public/root-present.png"), "fixture");
  writeFileSync(join(root, "docs/evidence/present.png"), "fixture");
  writeFileSync(join(root, "docs/reference.md"), "![evidence](evidence/present.png)\n");
  writeFileSync(join(root, "README.md"), "![root evidence](/root-present.png)\n");
  writeFileSync(join(root, "scripts/generate.mjs"), "new URL('../app/apple-icon.png', import.meta.url);\n");
  return root;
}

function audit(root) {
  return spawnSync(process.execPath, [auditor, "--root", root, "--json"], { encoding: "utf8" });
}

test("asset audit resolves Markdown and script references relative to their source file", () => {
  const root = fixture();
  try {
    const result = audit(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.missingReferences.length, 0);
    assert.equal(report.localReferences, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("asset audit scans root Markdown and fails when its asset disappears", () => {
  const root = fixture();
  try {
    rmSync(join(root, "public/root-present.png"));
    const result = audit(root);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.missingReferences.map((entry) => entry.target), ["public/root-present.png"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("asset audit fails when a relative Markdown asset disappears", () => {
  const root = fixture();
  try {
    rmSync(join(root, "docs/evidence/present.png"));
    const result = audit(root);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.missingReferences.map((entry) => entry.target), ["docs/evidence/present.png"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

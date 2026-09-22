// Run from the integration candidate checkout. Artifacts are ignored and
// every result is bound to the clean, immutable candidate HEAD.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const stableSha = "8fe4379d4afa034bc1dd6b37fcd058046ed669c3";
const git = (cwd, ...args) => {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, `Git inspection failed in ${cwd}`);
  return run.stdout.trim();
};

const candidateRoot = process.cwd();
const stableRoot = path.resolve(process.env.STABLE_WORKTREE || "../Golf-Bets-22-sept");
const branch = git(candidateRoot, "branch", "--show-current");
assert.equal(branch, "phase2/integration-candidate-2026-09-22");
assert.equal(git(candidateRoot, "status", "--porcelain"), "", "Commit the candidate tree before running gates");
assert.equal(git(stableRoot, "rev-parse", "HEAD"), stableSha, "Frozen stable worktree changed");
assert.equal(git(stableRoot, "status", "--porcelain"), "", "Frozen stable worktree is not clean");

const sha = git(candidateRoot, "rev-parse", "HEAD");
const directory = path.resolve(".qa-artifacts", "integration", sha);
mkdirSync(directory, { recursive: true });
const gates = [];
const steps = [
  ["test-compile", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.test.json"]],
  ["tests", ["--test", ".test-dist/tests/*.test.js"]],
  ["games-matrix", ["scripts/qa-games-matrix.mjs"]],
  ["games-golden", ["scripts/qa-games-golden-compare.mjs", stableRoot]],
  ["catalog-freshness", ["scripts/qa-catalog-data.mjs", "--check"]],
  ["typescript", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["eslint", ["node_modules/eslint/bin/eslint.js", "."]],
  ["build", ["node_modules/next/dist/bin/next", "build", "--webpack"]],
  ["bundle", ["scripts/qa-integration-bundle.mjs", stableRoot]],
];

for (const [name, args] of steps) {
  const start = Date.now();
  const run = spawnSync(process.execPath, args, {
    cwd: candidateRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      CANDIDATE_SHA: sha,
      CI: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  writeFileSync(path.join(directory, `${name}.log`), output);
  const gate = {
    name,
    status: run.status === 0 ? "PASS" : "FAIL",
    exitCode: run.status,
    elapsedMs: Date.now() - start,
  };
  if (name === "tests") {
    gate.counts = Object.fromEntries(
      ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((key) => [
        key,
        Number(output.match(new RegExp(`(?:#|ℹ) ${key} (\\d+)`))?.[1] ?? Number.NaN),
      ]),
    );
    if (
      !gate.counts.tests ||
      gate.counts.fail ||
      gate.counts.cancelled ||
      gate.counts.skipped ||
      gate.counts.todo
    ) {
      gate.status = "FAIL";
    }
  }
  gates.push(gate);
  console.log(JSON.stringify(gate));
  if (gate.status === "FAIL") break;
}

const clean = git(candidateRoot, "status", "--porcelain") === "";
const unchanged = git(candidateRoot, "rev-parse", "HEAD") === sha;
const stableUnchanged = git(stableRoot, "rev-parse", "HEAD") === stableSha;
const report = {
  branch,
  sha,
  stableSha,
  gates,
  clean,
  unchanged,
  stableUnchanged,
  status:
    gates.length === steps.length &&
    gates.every((gate) => gate.status === "PASS") &&
    clean &&
    unchanged &&
    stableUnchanged
      ? "PASS"
      : "FAIL",
};
writeFileSync(path.join(directory, "quality-gates.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, sha, directory }));
if (report.status !== "PASS") process.exitCode = 1;

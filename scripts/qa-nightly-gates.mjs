// Run from the nightly checkout. Artifacts are ignored and always bound to HEAD.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const git = (...args) => {
  const run = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(run.status, 0, "Git inspection failed");
  return run.stdout.trim();
};
const branch = git("branch", "--show-current");
assert.equal(branch, "phase2/nightly-core-ai-games-2026-09-22");
assert.equal(git("status", "--porcelain"), "", "Commit the final nightly tree before running gates");
const sha = git("rev-parse", "HEAD");
const directory = path.resolve(".qa-artifacts", "nightly", sha);
mkdirSync(directory, { recursive: true });
const gates = [];
const steps = [
  ["test-compile", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.test.json"]],
  ["tests", ["--test", ".test-dist/tests/*.test.js"]],
  ["typescript", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["eslint", ["node_modules/eslint/bin/eslint.js", "."]],
  // Webpack is an official Next build mode; external shared dependency junctions
  // in the Windows worktree are not supported by Turbopack's filesystem sandbox.
  ["build", ["node_modules/next/dist/bin/next", "build", "--webpack"]],
];
for (const [name, args] of steps) {
  const start = Date.now();
  const run = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: "1", NEXT_TELEMETRY_DISABLED: "1" } });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  writeFileSync(path.join(directory, `${name}.log`), output);
  const gate = { name, status: run.status === 0 ? "PASS" : "FAIL", exitCode: run.status, elapsedMs: Date.now() - start };
  if (name === "tests") {
    gate.counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(output.match(new RegExp(`(?:#|ℹ) ${key} (\\d+)`))?.[1] ?? NaN)]));
    if (!gate.counts.tests || gate.counts.fail || gate.counts.cancelled || gate.counts.skipped || gate.counts.todo) gate.status = "FAIL";
  }
  gates.push(gate);
  console.log(JSON.stringify(gate));
  if (gate.status === "FAIL") break;
}
const clean = git("status", "--porcelain") === "";
const unchanged = git("rev-parse", "HEAD") === sha;
const report = { branch, sha, baseSha: "8fe4379d4afa034bc1dd6b37fcd058046ed669c3", gates, clean, unchanged, status: gates.length === steps.length && gates.every(g => g.status === "PASS") && clean && unchanged ? "PASS" : "FAIL" };
writeFileSync(path.join(directory, "quality-gates.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, sha, directory }));
if (report.status !== "PASS") process.exitCode = 1;

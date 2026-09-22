/** Compare candidate and frozen-stable Webpack builds without loading the app. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const stableRoot = process.argv[2] && path.resolve(process.argv[2]);
assert.ok(stableRoot, "Pass the frozen stable worktree path");
const candidateRoot = process.cwd();

function files(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...files(target));
    else result.push(target);
  }
  return result;
}

function manifest(root) {
  const buildRoot = path.join(root, ".next");
  const manifestPath = path.join(buildRoot, "server/app/page_client-reference-manifest.js");
  const source = readFileSync(manifestPath, "utf8");
  const marker = 'globalThis.__RSC_MANIFEST["/page"]=';
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing /page RSC manifest in ${root}`);
  const data = JSON.parse(source.slice(markerIndex + marker.length).replace(/;\s*$/, ""));
  const build = JSON.parse(readFileSync(path.join(buildRoot, "build-manifest.json"), "utf8"));
  const page = Object.entries(data.clientModules).find(([name]) => /[\\/]app[\\/]page\.tsx$/.test(name))?.[1];
  assert.ok(page, `Missing app/page client manifest in ${root}`);
  const layout = Object.values(data.clientModules).flatMap((entry) => entry.chunks || [])
    .filter((value) => typeof value === "string" && /static\/chunks\/app\/layout-.*\.js$/.test(value));
  const relative = [...new Set([
    ...(build.rootMainFiles || []),
    ...page.chunks.filter((value) => typeof value === "string" && value.endsWith(".js")),
    ...layout,
  ])];
  const initialBytes = relative.reduce((sum, filename) => sum + statSync(path.join(buildRoot, filename)).size, 0);
  const chunkFiles = files(path.join(buildRoot, "static/chunks")).filter((file) => file.endsWith(".js"));
  const staticFiles = files(path.join(buildRoot, "static"));
  return {
    initialFiles: relative.length,
    initialBytes,
    homeInitialJsBytes: initialBytes,
    playInitialJsBytes: initialBytes,
    routeReason: "Home and Play are stateful views of the single app/page route",
    clientChunkCount: chunkFiles.length,
    clientChunkBytes: chunkFiles.reduce((sum, file) => sum + statSync(file).size, 0),
    staticBuildBytes: staticFiles.reduce((sum, file) => sum + statSync(file).size, 0),
    chunkFiles,
  };
}

const stable = manifest(stableRoot);
const candidate = manifest(candidateRoot);
const tokens = [
  "course-gaps.json",
  "equipment-gaps.json",
  "course-audit-source.json",
  "f7fbfaa190bd05d38e47d15295aabdf5e9182831a849df36f2ed406dc699d9df",
  "4c61b5deaebd728d09bcb93b19195d566b93ab2d22c43b9b13342e03bc2a3559",
  "LOCATION_EVIDENCE_MISSING",
];
const leakedTokens = [];
for (const file of candidate.chunkFiles) {
  const source = readFileSync(file, "utf8");
  for (const token of tokens) if (source.includes(token)) leakedTokens.push({ file: path.basename(file), token });
}
const growth = (after, before) => ({ bytes: after - before, percent: before ? Number((((after - before) / before) * 100).toFixed(3)) : null });
const comparisons = {
  initialJs: growth(candidate.initialBytes, stable.initialBytes),
  clientChunks: growth(candidate.clientChunkBytes, stable.clientChunkBytes),
  staticBuild: growth(candidate.staticBuildBytes, stable.staticBuildBytes),
};
// A small guarded foundation is expected. Flag only material growth: both more
// than 5% and more than 128 KiB for initial JS, or 256 KiB for all client JS.
const materialInitialRegression = comparisons.initialJs.percent > 5 && comparisons.initialJs.bytes > 128 * 1024;
const materialClientRegression = comparisons.clientChunks.percent > 5 && comparisons.clientChunks.bytes > 256 * 1024;
const status = !leakedTokens.length && !materialInitialRegression && !materialClientRegression ? "PASS" : "FAIL";
console.log(JSON.stringify({
  schemaVersion: 1,
  stableSha: "8fe4379d4afa034bc1dd6b37fcd058046ed669c3",
  candidateSha: process.env.CANDIDATE_SHA || null,
  stable: { ...stable, chunkFiles: undefined },
  candidate: { ...candidate, chunkFiles: undefined },
  comparisons,
  dataQaClientBundleMatches: leakedTokens,
  thresholds: { initialJs: "fail only when >5% and >128 KiB", allClientJs: "fail only when >5% and >256 KiB" },
  status,
}, null, 2));
process.exitCode = status === "PASS" ? 0 : 1;

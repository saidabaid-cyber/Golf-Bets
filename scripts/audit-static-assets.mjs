import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootArgument = process.argv.indexOf("--root");
const repoRoot = rootArgument >= 0 && process.argv[rootArgument + 1]
  ? resolve(process.argv[rootArgument + 1])
  : fileURLToPath(new URL("..", import.meta.url));
const sourceRoots = [".github", "app", "data", "docs", "lib", "scripts", "public"];
const textExtensions = new Set([
  ".cjs", ".css", ".cts", ".example", ".html", ".js", ".jsx", ".json", ".md", ".mjs", ".mts", ".ts", ".tsx", ".txt", ".webmanifest", ".yaml", ".yml",
]);
const rootTextExcludes = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const assetExtensions = new Set([
  ".avif", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webmanifest", ".webp",
]);
const rootAssetPattern = /["'`]\/(?!\/)([^"'`?#\s]+\.(?:avif|gif|ico|jpe?g|png|svg|webmanifest|webp))(?:[?#][^"'`]*)?["'`]/gi;
const relativeAssetPattern = /["'`](\.\.?\/[^"'`?#\s]+\.(?:avif|gif|ico|jpe?g|png|svg|webmanifest|webp))(?:[?#][^"'`]*)?["'`]/gi;
const markdownAssetPattern = /!?\[[^\]]*\]\(\s*<?(?!https?:\/\/|data:|#|\/)([^)>?#\s]+\.(?:avif|gif|ico|jpe?g|png|svg|webmanifest|webp))(?:[?#][^)>\s]*)?>?(?:\s+["'][^"']*["'])?\s*\)/gi;
const markdownRootAssetPattern = /!?\[[^\]]*\]\(\s*<?\/(?!\/)([^)>?#\s]+\.(?:avif|gif|ico|jpe?g|png|svg|webmanifest|webp))(?:[?#][^)>\s]*)?>?(?:\s+["'][^"']*["'])?\s*\)/gi;
const unquotedCssAssetPattern = /url\(\s*\/(?!\/)([^)'"?#\s]+\.(?:avif|gif|ico|jpe?g|png|svg|webmanifest|webp))(?:[?#][^)\s]*)?\s*\)/gi;
const hardcodedVercelUrlPattern = /https?:\/\/[a-z0-9.-]*\.vercel\.app(?:[/:?#][^\s"'`)]*)?/gi;

const intentionalUnreferencedAssets = new Map([
  ["public/avatars/flag-sunset.svg", "legacy profile value accepted by persisted accounts"],
  ["public/avatars/golf-ball.svg", "legacy profile value accepted by persisted accounts"],
  ["public/avatars/golfer-green.svg", "legacy profile value accepted by persisted accounts"],
  ["public/brand/backyard-fairway-scene.svg", "preserved historical brand artwork; no active import"],
]);

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function slash(path) {
  return path.replaceAll("\\", "/");
}

const rootTextFiles = readdirSync(repoRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && !rootTextExcludes.has(entry.name) && textExtensions.has(extname(entry.name).toLowerCase()))
  .map((entry) => resolve(repoRoot, entry.name));

function resolveRootAsset(reference) {
  const publicCandidate = resolve(repoRoot, "public", reference);
  if (existsSync(publicCandidate)) return publicCandidate;
  if (reference === "apple-icon.png") return resolve(repoRoot, "app", reference);
  return publicCandidate;
}

const files = sourceRoots
  .flatMap((root) => walk(resolve(repoRoot, root)))
  .concat(rootTextFiles)
  .filter((path) => textExtensions.has(extname(path).toLowerCase()))
  .filter((path) => !/\.test\.(?:[cm]?js|tsx?)$/i.test(path));

const localReferences = [];
const missingReferences = [];
const hardcodedPreviewUrls = [];
const referencedAssets = new Set();
const referenceKeys = new Set();

function recordReference(source, reference, target) {
  const targetRelative = slash(relative(repoRoot, target));
  const key = `${source}\u0000${reference}\u0000${targetRelative}`;
  if (referenceKeys.has(key)) return;
  referenceKeys.add(key);
  const record = { source, reference, target: targetRelative };
  localReferences.push(record);
  referencedAssets.add(targetRelative);
  if (!existsSync(target)) missingReferences.push(record);
}

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const source = slash(relative(repoRoot, file));

  for (const match of content.matchAll(rootAssetPattern)) {
    const target = resolveRootAsset(match[1]);
    recordReference(source, `/${match[1]}`, target);
  }

  for (const match of content.matchAll(unquotedCssAssetPattern)) {
    const target = resolveRootAsset(match[1]);
    recordReference(source, `/${match[1]}`, target);
  }

  for (const match of content.matchAll(relativeAssetPattern)) {
    recordReference(source, match[1], resolve(file, "..", match[1]));
  }

  if (extname(file).toLowerCase() === ".md") {
    for (const match of content.matchAll(markdownRootAssetPattern)) {
      recordReference(source, `/${match[1]}`, resolveRootAsset(match[1]));
    }
    for (const match of content.matchAll(markdownAssetPattern)) {
      recordReference(source, match[1], resolve(file, "..", match[1]));
    }
  }

  if (!source.startsWith("public/")) {
    for (const match of content.matchAll(hardcodedVercelUrlPattern)) {
      hardcodedPreviewUrls.push({ source, url: match[0] });
    }
  }
}

const publicAssets = walk(resolve(repoRoot, "public"))
  .filter((path) => assetExtensions.has(extname(path).toLowerCase()))
  .map((path) => slash(relative(repoRoot, path)))
  .sort();
const unreferencedAssets = publicAssets.filter((path) => !referencedAssets.has(path));
const unexplainedUnreferencedAssets = unreferencedAssets.filter((path) => !intentionalUnreferencedAssets.has(path));

const result = {
  scannedFiles: files.length,
  publicAssets: publicAssets.length,
  localReferences: localReferences.length,
  missingReferences,
  hardcodedPreviewUrls,
  unreferencedAssets: unreferencedAssets.map((path) => ({
    path,
    explanation: intentionalUnreferencedAssets.get(path) ?? null,
  })),
  unexplainedUnreferencedAssets,
};

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(
    `Static asset audit: ${result.localReferences} references, ${result.publicAssets} public assets, `
      + `${result.missingReferences.length} missing, ${result.hardcodedPreviewUrls.length} active Vercel URLs, `
      + `${result.unexplainedUnreferencedAssets.length} unexplained unreferenced assets.\n`,
  );
  for (const record of result.missingReferences) {
    process.stderr.write(`MISSING ${record.source}: ${record.reference} -> ${record.target}\n`);
  }
  for (const record of result.hardcodedPreviewUrls) {
    process.stderr.write(`HARDCODED_PREVIEW ${record.source}: ${record.url}\n`);
  }
  for (const path of result.unexplainedUnreferencedAssets) {
    process.stderr.write(`UNEXPLAINED_UNREFERENCED ${path}\n`);
  }
}

if (missingReferences.length || hardcodedPreviewUrls.length || unexplainedUnreferencedAssets.length) {
  process.exitCode = 1;
}

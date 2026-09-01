import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const root = process.cwd();
const supportedExtensions = new Set([".pdf", ".md"]);
const requiredMarkdown = ["reglas-locales-la-vista.md", "codigo-caballeros-golf.md"];

function collectFiles(entry) {
  const resolved = path.resolve(entry);
  if (!fs.existsSync(resolved)) return [];
  const stats = fs.statSync(resolved);
  if (stats.isDirectory()) return fs.readdirSync(resolved, { withFileTypes: true }).flatMap((item) => collectFiles(path.join(resolved, item.name)));
  return supportedExtensions.has(path.extname(resolved).toLowerCase()) ? [resolved] : [];
}

function discoverInputs() {
  const requested = process.argv.slice(2);
  const sources = requested.length
    ? requested
    : ["rules-source", "rules-sources", ...requiredMarkdown].map((entry) => path.join(root, entry));
  return Array.from(new Set(sources.flatMap(collectFiles))).sort((a, b) => path.basename(a).localeCompare(path.basename(b), "es"));
}

function setLocalEnvValue(name, value) {
  const envPath = path.join(root, ".env.local");
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${name}=${value}`;
  const matcher = new RegExp(`^${name}=.*$`, "m");
  const next = matcher.test(current) ? current.replace(matcher, line) : `${current.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(envPath, next, "utf8");
}

async function resolveVectorStore(openai) {
  const configuredId = process.env.OPENAI_RULES_VECTOR_STORE_ID?.trim();
  if (configuredId) {
    try {
      const existing = await openai.vectorStores.retrieve(configuredId);
      if (existing.status !== "expired") return { vectorStore: existing, reused: true };
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
  }
  const vectorStore = await openai.vectorStores.create({
    name: "Golf Bets Rules",
    description: "Reglas de Golf, Guía Oficial, Procedimientos del Comité, aclaraciones vigentes, Reglas Locales de La Vista y Código de Caballeros.",
  });
  return { vectorStore, reused: false };
}

async function attachedFiles(openai, vectorStoreId) {
  const attached = new Map();
  for await (const item of openai.vectorStores.files.list(vectorStoreId, { limit: 100 })) {
    try {
      const file = await openai.files.retrieve(item.id);
      attached.set(file.filename, file);
    } catch {
      // A missing source file should not prevent the remaining documents from indexing.
    }
  }
  return attached;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Falta OPENAI_API_KEY en .env.local.");
  const files = discoverInputs();
  const missingMarkdown = requiredMarkdown.filter((name) => !files.some((file) => path.basename(file) === name));
  if (missingMarkdown.length) throw new Error(`Faltan documentos requeridos: ${missingMarkdown.join(", ")}`);
  if (!files.length) throw new Error("No se encontraron PDFs o Markdown para indexar.");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { vectorStore, reused } = await resolveVectorStore(openai);
  const existing = await attachedFiles(openai, vectorStore.id);
  const pending = files.filter((file) => {
    const remote = existing.get(path.basename(file));
    return !remote || remote.bytes !== fs.statSync(file).size;
  });

  const uploadedIds = [];
  for (const file of pending) {
    const uploaded = await openai.files.create({ file: fs.createReadStream(file), purpose: "user_data" });
    uploadedIds.push(uploaded.id);
  }

  if (uploadedIds.length) {
    const batch = await openai.vectorStores.fileBatches.createAndPoll(vectorStore.id, { file_ids: uploadedIds }, { pollIntervalMs: 2000 });
    if (batch.status !== "completed" || batch.file_counts.failed > 0) {
      throw new Error(`La indexación terminó con estado ${batch.status}; fallidos: ${batch.file_counts.failed}.`);
    }
  }

  const ready = await openai.vectorStores.retrieve(vectorStore.id);
  if (ready.status !== "completed" || ready.file_counts.failed > 0 || ready.file_counts.in_progress > 0) {
    throw new Error(`El Vector Store no quedó listo: ${ready.status}.`);
  }

  setLocalEnvValue("OPENAI_RULES_VECTOR_STORE_ID", vectorStore.id);
  setLocalEnvValue("OPENAI_RULES_MODEL", process.env.OPENAI_RULES_MODEL?.trim() || "gpt-5.4-mini");
  setLocalEnvValue("RULES_AI_ENABLED", "true");

  console.log(`OPENAI_RULES_VECTOR_STORE_ID=${vectorStore.id}`);
  console.log(`Vector Store ${reused ? "reutilizado" : "creado"}.`);
  console.log(`Documentos detectados: ${files.length}. Nuevos indexados: ${pending.length}. Ya presentes: ${files.length - pending.length}.`);
  files.forEach((file) => console.log(`- ${path.basename(file)}`));
}

main().catch((error) => {
  console.error(`No fue posible indexar las reglas: ${error instanceof Error ? error.message : "error desconocido"}`);
  process.exitCode = 1;
});

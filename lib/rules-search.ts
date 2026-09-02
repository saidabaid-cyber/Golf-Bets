import corpus from "./rules-search-index.generated.json";
import { golfRulesCatalog, type GolfRuleEntry } from "./rules-catalog";
import { officialRulesDocument } from "./rules-documents";

export type RulesSearchResult = {
  id: string;
  rule: string;
  title: string;
  explanation: string;
  source: string;
  sourceUrl: string;
  page?: number;
};

type CorpusEntry = {
  id: string;
  sourceId: string;
  source: string;
  page: number;
  rule: string;
  searchText: string;
};

const RULE_TITLES: Record<string, string> = {
  "1": "El juego, la conducta del jugador y las Reglas",
  "2": "El campo",
  "3": "La competición",
  "4": "El equipamiento del jugador",
  "5": "Jugando la vuelta",
  "6": "Jugando un hoyo",
  "7": "Búsqueda, identificación y bola levantada",
  "8": "El campo se juega como se encuentra",
  "9": "Bola jugada como reposa; bola levantada o movida",
  "10": "Preparar y ejecutar un golpe; consejo, ayuda y caddies",
  "11": "Bola en movimiento golpea una persona, animal u objeto",
  "12": "Bunkers",
  "13": "Greenes",
  "14": "Procedimientos para marcar, levantar, reponer y dropear",
  "15": "Impedimentos sueltos y obstrucciones movibles",
  "16": "Alivio de condiciones anormales, peligro y bola empotrada",
  "17": "Áreas de penalidad",
  "18": "Golpe y distancia; bola perdida, fuera de límites o provisional",
  "19": "Bola injugable",
  "20": "Resolver cuestiones de Reglas durante la vuelta",
  "21": "Otras modalidades individuales de juego",
  "22": "Foursomes",
  "23": "Four-Ball",
  "24": "Competiciones por equipos",
  "25": "Modificaciones para jugadores con discapacidades",
};

const ALIASES: Record<string, string[]> = {
  agua: ["area de penalidad", "estaca roja", "estaca amarilla"],
  "cart path": ["camino", "obstruccion inamovible"],
  drop: ["dropear", "dropeo", "area de alivio"],
  dropeo: ["dropear", "drop", "area de alivio"],
  green: ["putting green"],
  aspersor: ["obstruccion inamovible", "sprinkler"],
  provisional: ["bola provisional", "perdida", "fuera de limites"],
};

export function normalizeRulesSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").replace(/[^a-z0-9.()\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function expandedTerms(query: string) {
  const normalized = normalizeRulesSearch(query);
  const aliases = Object.entries(ALIASES).flatMap(([key, values]) => normalized.includes(key) ? values : []);
  return normalizeRulesSearch([normalized, ...aliases].join(" ")).split(/\s+/).filter((word) => word.length > 1 || /^\d+$/.test(word));
}

function curatedResult(entry: GolfRuleEntry): RulesSearchResult {
  return { id: `curated-${entry.id}`, rule: entry.rule, title: entry.title, explanation: entry.explanation, source: "Reglas de Golf", sourceUrl: entry.sourceUrl };
}

function contextualExcerpt(text: string, normalizedQuery: string, terms: string[]) {
  const needle = [normalizedQuery, ...terms]
    .filter((candidate) => candidate.length > 2)
    .find((candidate) => text.includes(candidate));
  const matchIndex = needle ? text.indexOf(needle) : 0;
  const start = Math.max(0, matchIndex - 90);
  const end = Math.min(text.length, matchIndex + (needle?.length || 0) + 190);
  const excerpt = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${excerpt}${end < text.length ? "…" : ""}`;
}

export function searchRulesCorpus(query: string, limit = 12): RulesSearchResult[] {
  const normalized = normalizeRulesSearch(query);
  if (!normalized) return golfRulesCatalog.slice(0, Math.min(limit, 4)).map(curatedResult);
  const terms = expandedTerms(query);
  const curated = golfRulesCatalog
    .map((entry) => {
      const haystack = normalizeRulesSearch([entry.rule, entry.title, entry.explanation, ...entry.keywords].join(" "));
      const score = (haystack.includes(normalized) ? 20 : 0) + terms.reduce((sum, term) => sum + (haystack.includes(term) ? 4 : 0), 0);
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => curatedResult(entry));

  const pages = (corpus as CorpusEntry[])
    .map((entry) => {
      const exactRule = Boolean(entry.rule) && (normalized === entry.rule || normalized.startsWith(`regla ${entry.rule}`));
      const phrase = entry.searchText.includes(normalized);
      const matched = terms.reduce((sum, term) => sum + (entry.searchText.includes(term) ? 1 : 0), 0);
      return { entry, score: (exactRule ? 40 : 0) + (phrase ? 12 : 0) + matched };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.page - b.entry.page);

  const seen = new Set(curated.map((entry) => `${entry.source}:${entry.rule}`));
  const results = [...curated];
  for (const { entry } of pages) {
    const document = officialRulesDocument(entry.sourceId);
    if (!document) continue;
    const mainRule = entry.rule.split(".")[0];
    const identity = `${entry.sourceId}:${entry.rule || entry.page}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    results.push({
      id: entry.id,
      rule: entry.rule || "Fuente oficial",
      title: entry.rule && RULE_TITLES[mainRule] ? RULE_TITLES[mainRule] : entry.source,
      explanation: contextualExcerpt(entry.searchText, normalized, terms),
      source: entry.source,
      sourceUrl: document.officialUrl,
      page: entry.page,
    });
    if (results.length >= limit) break;
  }
  return results.slice(0, limit);
}

export function rulesCorpusCoverage() {
  const entries = corpus as CorpusEntry[];
  return {
    pages: entries.length,
    sources: new Set(entries.map((entry) => entry.sourceId)).size,
  };
}

import corpus from "./rules-search-index.generated.json";
import { golfRulesCatalog, type GolfRuleEntry } from "./rules-catalog";
import { officialRulesDocument, type OfficialRulesDocument } from "./rules-documents";
import { expandedRulesSearchTerms, normalizeRulesSearch, rulesSearchContains } from "./rules-search-normalization";
import { searchNavigableRules } from "./rules-navigation";

export type RulesDocumentType = "rules" | "committee" | "clarification";

export type RulesSearchResult = {
  id: string;
  rule: string;
  title: string;
  explanation: string;
  source: string;
  sourceId: OfficialRulesDocument["id"];
  documentType: RulesDocumentType;
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

export type RulesDocumentPageMatch = {
  page: number;
  count: number;
  excerpt: string;
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

function documentType(sourceId: CorpusEntry["sourceId"]): RulesDocumentType {
  if (sourceId === "clarifications-july-2026") return "clarification";
  if (sourceId === "committee-procedures-part-2") return "committee";
  return "rules";
}

function curatedResult(entry: GolfRuleEntry): RulesSearchResult {
  return { id: `curated-${entry.id}`, rule: entry.rule, title: entry.title, explanation: entry.explanation, source: "Reglas de Golf", sourceId: "official-guide-part-1", documentType: "rules", sourceUrl: entry.sourceUrl };
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

export function searchRulesCorpus(query: string, limit = Infinity): RulesSearchResult[] {
  const normalized = normalizeRulesSearch(query);
  if (!normalized) return golfRulesCatalog.slice(0, Math.min(limit, 4)).map(curatedResult);
  const terms = expandedRulesSearchTerms(query);
  const curated = golfRulesCatalog
    .map((entry) => {
      const haystack = normalizeRulesSearch([entry.rule, entry.title, entry.explanation, ...entry.keywords].join(" "));
      const score = (rulesSearchContains(haystack, normalized) ? 20 : 0) + terms.reduce((sum, term) => sum + (rulesSearchContains(haystack, term) ? 4 : 0), 0);
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => curatedResult(entry));

  const pages = (corpus as CorpusEntry[])
    .map((entry) => {
      const exactRule = Boolean(entry.rule) && (normalized === entry.rule || normalized.startsWith(`regla ${entry.rule}`));
      const phrase = rulesSearchContains(entry.searchText, normalized);
      const matched = terms.reduce((sum, term) => sum + (rulesSearchContains(entry.searchText, term) ? 1 : 0), 0);
      return { entry, score: (exactRule ? 40 : 0) + (phrase ? 12 : 0) + matched };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.page - b.entry.page);

  const seen = new Set(curated.map((entry) => `${entry.source}:${entry.rule}`));
  const navigation: RulesSearchResult[] = searchNavigableRules(query).map(({rule, section}) => ({
    id: `navigation-${section?.number || rule.number}`, rule: section?.number || rule.number,
    title: section?.title || rule.title, explanation: section?.summary || rule.summary,
    source: "Reglas de Golf", sourceId: "official-guide-part-1", documentType: "rules", sourceUrl: rule.sourceUrl,
  }));
  const results = [...navigation, ...curated];
  for (const { entry } of pages) {
    const document = officialRulesDocument(entry.sourceId);
    if (!document) continue;
    const mainRule = entry.rule.split(".")[0];
    const identity = `${entry.sourceId}:${entry.page}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    results.push({
      id: entry.id,
      rule: entry.rule || "Fuente oficial",
      title: entry.rule && RULE_TITLES[mainRule] ? RULE_TITLES[mainRule] : entry.source,
      explanation: contextualExcerpt(entry.searchText, normalized, terms),
      source: entry.source,
      sourceId: entry.sourceId as OfficialRulesDocument["id"],
      documentType: documentType(entry.sourceId),
      sourceUrl: document.officialUrl,
      page: entry.page,
    });
    if (results.length >= limit) break;
  }
  return results.slice(0, limit);
}

function referencedRules(text: string) {
  const references = Array.from(text.matchAll(/(?:regla|rule)\s+(\d{1,2})(?:\.\d+)?/g), (match) => Number(match[1]))
    .filter((number) => number >= 1 && number <= 25);
  return Array.from(new Set(references)).slice(0, 6);
}

export function browseRulesSource(sourceId: OfficialRulesDocument["id"], limit = Infinity): RulesSearchResult[] {
  const document = officialRulesDocument(sourceId);
  if (!document) return [];
  return (corpus as CorpusEntry[])
    .filter((entry) => entry.sourceId === sourceId)
    .slice(0, Math.max(1, limit))
    .map((entry) => {
      const related = referencedRules(entry.searchText);
      const primaryRule = entry.rule || (related[0] ? String(related[0]) : "Fuente oficial");
      return {
        id: entry.id,
        rule: primaryRule,
        title: sourceId === "clarifications-july-2026" ? `Aclaraciones · página ${entry.page}` : `Procedimientos del Comité · página ${entry.page}`,
        explanation: related.length
          ? `Contenido oficial indexado con referencias a ${related.map((number) => `Regla ${number}`).join(", ")}. Usa el buscador para localizar un tema concreto o consulta la fuente completa.`
          : "Contenido oficial indexado. Usa el buscador para localizar un tema concreto o consulta la fuente completa.",
        source: entry.source,
        sourceId,
        documentType: documentType(sourceId),
        sourceUrl: document.officialUrl,
        page: entry.page,
      } satisfies RulesSearchResult;
    });
}

export function rulesCorpusCoverage() {
  const entries = corpus as CorpusEntry[];
  return {
    pages: entries.length,
    sources: new Set(entries.map((entry) => entry.sourceId)).size,
  };
}

function countOccurrences(text: string, query: string) {
  if (!query) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(query, offset)) !== -1) {
    count += 1;
    offset += Math.max(1, query.length);
  }
  return count;
}

/** Search the build-time page index used by the in-app PDF viewer. This avoids
 * repeatedly downloading or parsing a 13 MB PDF on iPhone and still works when
 * Safari exposes no text layer for a rendered/scanned page. */
export function searchRulesDocumentPages(sourceId: OfficialRulesDocument["id"], query: string, limit = 100): RulesDocumentPageMatch[] {
  const normalized = normalizeRulesSearch(query);
  if (!normalized || !officialRulesDocument(sourceId)) return [];
  const terms = expandedRulesSearchTerms(query).filter(term => term.length > 2);
  const baseTerms = normalized.split(/\s+/).filter(term => term.length > 2);
  const candidates = (corpus as CorpusEntry[])
    .filter(entry => entry.sourceId === sourceId)
    .map(entry => {
      const phraseCount = countOccurrences(entry.searchText, normalized);
      const baseCounts = baseTerms.map(term => countOccurrences(entry.searchText, term));
      const allBaseTerms = baseTerms.length > 1 && baseCounts.every(count => count > 0);
      const expandedCount = terms.reduce((sum, term) => sum + countOccurrences(entry.searchText, term), 0);
      const rank = phraseCount > 0 ? 3 : allBaseTerms ? 2 : expandedCount > 0 ? 1 : 0;
      const count = phraseCount || (allBaseTerms ? baseCounts.reduce((sum, value) => sum + value, 0) : expandedCount);
      return { entry, count, rank };
    });
  const bestRank = candidates.reduce((best, candidate) => Math.max(best, candidate.rank), 0);
  return candidates
    .filter(({ rank }) => rank === bestRank && rank > 0)
    .slice(0, Math.max(1, limit))
    .map(({ entry, count }) => ({
      page: entry.page,
      count,
      excerpt: contextualExcerpt(entry.searchText, normalized, terms),
    }));
}

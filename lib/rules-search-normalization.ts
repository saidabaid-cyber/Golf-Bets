export const RULES_SEARCH_ALIASES: Record<string, string[]> = {
  bola: ["ball"],
  "agua temporal": ["temporary water"],
  agua: ["area de penalidad", "penalty area"],
  lago: ["area de penalidad", "penalty area"],
  estanque: ["area de penalidad", "penalty area"],
  rio: ["area de penalidad", "penalty area"],
  "area de penalidad": ["penalty area"],
  "bola perdida": ["lost ball"],
  "bola movida": ["ball moved"],
  "bola equivocada": ["wrong ball"],
  "bola provisional": ["provisional ball"],
  "cart path": ["camino", "obstruccion inamovible"],
  camino: ["cart path", "obstruccion inamovible", "immovable obstruction"],
  hazard: ["area de penalidad"],
  ob: ["fuera de limites", "out of bounds", "estaca blanca"],
  "out of bounds": ["fuera de limites", "estaca blanca"],
  drop: ["dropear", "dropeo", "area de alivio"],
  dropeo: ["dropear", "drop", "area de alivio"],
  green: ["putting green"],
  aspersor: ["obstruccion inamovible", "sprinkler"],
  sprinkler: ["aspersor", "obstruccion inamovible"],
  provisional: ["bola provisional", "perdida", "fuera de limites"],
};

/** A query for7.3 must not accidentally match17.3 or7.30. */
export function rulesSearchContains(text: string, term: string) {
  if (/^\d{1,2}(?:\.\d+)?$/.test(term)) return new RegExp(`(?:^|[^\\d.])${term.replace(/\./g, "\\.")}(?!\\d)`).test(text);
  return text.includes(term);
}

export function normalizeRulesSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").replace(/[^a-z0-9.()\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function expandedRulesSearchTerms(query: string) {
  const normalized = normalizeRulesSearch(query);
  const temporaryWater = /(?:^|\s)agua temporal(?:$|\s)/.test(normalized);
  const aliases = Object.entries(RULES_SEARCH_ALIASES).flatMap(([key, values]) => {
    if (key === "agua" && temporaryWater) return [];
    const exactAlias = new RegExp(`(?:^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`);
    return exactAlias.test(normalized) ? values : [];
  });
  const stop = new Set([
    "de", "del", "la", "el", "los", "las", "en", "un", "una", "por", "para", "con", "que", "se", "regla",
    "si", "mi", "tu", "su", "al", "y", "o", "pasa", "paso", "va", "fue",
  ]);
  const ballOnly = normalized === "bola" || normalized === "ball";
  return [...new Set(normalizeRulesSearch([normalized, ...aliases].join(" ")).split(/\s+/).filter((word) => {
    if (!ballOnly && (word === "bola" || word === "ball")) return false;
    return !stop.has(word) && (word.length > 1 || /^\d+$/.test(word));
  }))];
}

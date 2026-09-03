export const RULES_SEARCH_ALIASES: Record<string, string[]> = {
  agua: ["area de penalidad", "estaca roja", "estaca amarilla"],
  "cart path": ["camino", "obstruccion inamovible"],
  camino: ["cart path", "obstruccion inamovible"],
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

export function normalizeRulesSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").replace(/[^a-z0-9.()\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function expandedRulesSearchTerms(query: string) {
  const normalized = normalizeRulesSearch(query);
  const aliases = Object.entries(RULES_SEARCH_ALIASES).flatMap(([key, values]) => {
    const exactAlias = new RegExp(`(?:^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`);
    return exactAlias.test(normalized) ? values : [];
  });
  return normalizeRulesSearch([normalized, ...aliases].join(" ")).split(/\s+/).filter((word) => word.length > 1 || /^\d+$/.test(word));
}

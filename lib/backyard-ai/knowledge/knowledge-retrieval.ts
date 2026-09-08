import type { KnowledgeItem, KnowledgeProvenance, KnowledgeSource } from "./knowledge-types";
import { auditKnowledgeItem, knowledgeProvenance, sourceTrustRank } from "./provenance";

export type KnowledgeQuery = {
  text: string;
  locale?: string;
  region?: string;
  jurisdiction?: string;
  ruleset?: string;
  ownerId?: string;
  groupId?: string;
  kinds?: readonly KnowledgeItem["kind"][];
  minimumConfidence?: number;
  includeDrafts?: boolean;
  at?: string;
  limit?: number;
};

export type KnowledgeMatch = {
  item: KnowledgeItem;
  source: KnowledgeSource;
  provenance: KnowledgeProvenance;
  score: number;
};

function searchableText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es-MX");
}

function contentText(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.slice(0, 50).flatMap((item) => contentText(item, depth + 1));
  if (typeof value === "object") return Object.values(value).slice(0, 50).flatMap((item) => contentText(item, depth + 1));
  return [];
}

function canReadScope(item: KnowledgeItem, query: KnowledgeQuery) {
  if (item.scope === "GLOBAL") return true;
  if (!query.ownerId || item.ownerId !== query.ownerId) return false;
  return item.scope === "PERSONAL" || Boolean(query.groupId && item.groupId === query.groupId);
}

function appliesAt(item: KnowledgeItem, at: string) {
  const instant = Date.parse(at);
  return (!item.validFrom || Date.parse(item.validFrom) <= instant) && (!item.validUntil || Date.parse(item.validUntil) >= instant);
}

function matchesRequestedVariant(item: KnowledgeItem, query: KnowledgeQuery) {
  if (query.jurisdiction && item.jurisdiction !== query.jurisdiction && item.jurisdiction !== "GLOBAL") return false;
  if (query.region && item.region && item.region !== query.region) return false;
  if (query.ruleset && item.ruleset && item.ruleset !== query.ruleset) return false;
  return true;
}

function matchScore(item: KnowledgeItem, source: KnowledgeSource, query: KnowledgeQuery, tokens: string[]) {
  const title = searchableText(item.title);
  const aliases = item.aliases.map(searchableText);
  const searchable = [title, ...aliases, ...contentText(item.content).map(searchableText)].join(" ");
  if (!tokens.every((token) => searchable.includes(token))) return null;
  let score = sourceTrustRank(source.sourceType) * 100 + Math.round(item.confidence * 50) + Math.round(source.confidence * 50);
  const fullQuery = searchableText(query.text);
  if (title === fullQuery || aliases.includes(fullQuery)) score += 200;
  else if (title.startsWith(fullQuery)) score += 100;
  if (query.locale && item.locale === query.locale) score += 30;
  else if (query.locale && item.locale.split("-")[0] === query.locale.split("-")[0]) score += 15;
  if (query.region && item.region === query.region) score += 60;
  if (query.jurisdiction && item.jurisdiction === query.jurisdiction) score += 50;
  if (query.ruleset && item.ruleset === query.ruleset) score += 80;
  // A confirmed local variant is the applicable rule for that group/user,
  // while the original source classification remains visible to the caller.
  if (item.scope === "GROUP") score += 350;
  else if (item.scope === "PERSONAL") score += 250;
  return score;
}

/**
 * Returns independent candidates with their own provenance. Conflicting
 * official, community and group variants are never silently merged.
 */
export function retrieveKnowledge(
  items: readonly KnowledgeItem[],
  sources: readonly KnowledgeSource[],
  query: KnowledgeQuery,
): KnowledgeMatch[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const tokens = searchableText(query.text).split(/\s+/).filter(Boolean);
  const at = query.at && !Number.isNaN(Date.parse(query.at)) ? query.at : new Date().toISOString();
  const minimumConfidence = typeof query.minimumConfidence === "number"
    ? Math.max(0, Math.min(1, query.minimumConfidence))
    : 0;
  const kindSet = query.kinds ? new Set(query.kinds) : null;
  const limit = typeof query.limit === "number" && Number.isFinite(query.limit)
    ? Math.max(1, Math.min(100, Math.floor(query.limit)))
    : 20;

  return items.flatMap((item): KnowledgeMatch[] => {
    const source = sourceById.get(item.sourceId);
    if (!source || !source.active || auditKnowledgeItem(item, source).valid === false) return [];
    if (!canReadScope(item, query) || !appliesAt(item, at) || !matchesRequestedVariant(item, query)) return [];
    if (!query.includeDrafts && item.status !== "VERIFIED") return [];
    if (item.status === "RETIRED" || item.confidence < minimumConfidence) return [];
    if (kindSet && !kindSet.has(item.kind)) return [];
    const score = matchScore(item, source, query, tokens);
    return score === null ? [] : [{ item, source, provenance: knowledgeProvenance(source), score }];
  }).sort((left, right) => right.score - left.score || right.item.updatedAt.localeCompare(left.item.updatedAt)).slice(0, limit);
}

export function knowledgeItemById(
  items: readonly KnowledgeItem[],
  sources: readonly KnowledgeSource[],
  itemId: string,
  access: Pick<KnowledgeQuery, "ownerId" | "groupId"> = {},
): KnowledgeMatch | null {
  const item = items.find((candidate) => candidate.id === itemId);
  const source = item ? sources.find((candidate) => candidate.id === item.sourceId) : undefined;
  if (!item || !source || !source.active || !canReadScope(item, { text: "", ...access })) return null;
  if (!auditKnowledgeItem(item, source).valid) return null;
  return { item, source, provenance: knowledgeProvenance(source), score: sourceTrustRank(source.sourceType) * 100 };
}

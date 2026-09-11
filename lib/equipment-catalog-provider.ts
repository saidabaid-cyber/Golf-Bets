import type {
  ClubCategory,
  GolfBallCatalog,
  GolfClubCatalog,
  GolfShaftCatalog,
  ShaftUsage,
} from "./golf-equipment";
import type { GolfCatalogPage } from "./golf-catalog-domain";

export const EQUIPMENT_CATALOG_KINDS = ["BALL", "CLUB", "SHAFT"] as const;
export type EquipmentCatalogKind = (typeof EQUIPMENT_CATALOG_KINDS)[number];
export type EquipmentCatalogItem = GolfBallCatalog | GolfClubCatalog | GolfShaftCatalog;

export type EquipmentCatalogSearchInput = {
  kind: EquipmentCatalogKind;
  query?: string;
  category?: ClubCategory | null;
  shaftUsage?: ShaftUsage | null;
  cursor?: string | null;
  limit?: number;
  includeArchived?: boolean;
  /** Catalog identities already stored in a player snapshot. These are
   * returned alongside the requested page even when archived. */
  pinnedIds?: readonly string[];
};

export type EquipmentCatalogBrandFacet = {
  brand: string;
  count: number;
  currentCount: number;
  historicalCount: number;
};

export type EquipmentCatalogBrandFacetInput = Pick<EquipmentCatalogSearchInput,
  "kind" | "query" | "category" | "shaftUsage" | "cursor" | "limit" | "includeArchived">;

export type EquipmentBallFitCatalogInput = {
  /** An archived current ball may be included only as a comparison baseline. */
  currentBallId?: string | null;
  /** The caller must choose a finite ceiling. An incomplete scope is never
   * returned as a usable candidate list, preventing a partial ranking. */
  maximumCandidates: number;
};

export type EquipmentBallFitCatalogScope = {
  items: GolfBallCatalog[];
  complete: boolean;
  activeCandidateCount: number;
  evaluatedCandidateCount: number;
  maximumCandidates: number;
};

export interface EquipmentCatalogProvider {
  readonly id: string;
  search(input: EquipmentCatalogSearchInput): Promise<GolfCatalogPage<EquipmentCatalogItem>>;
  brandFacets(input: EquipmentCatalogBrandFacetInput): Promise<GolfCatalogPage<EquipmentCatalogBrandFacet>>;
  loadBallFitCatalog(input: EquipmentBallFitCatalogInput): Promise<EquipmentBallFitCatalogScope>;
}

function searchable(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™]/g, "")
    .replace(/\+/g, " plus ")
    .replace(/\bgeneration\s*(\d+)/gi, " g$1 ")
    .replace(/\bgen\s*(\d+)/gi, " g$1 ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es-MX");
}

function shaftSearchFacts(item: GolfShaftCatalog) {
  const weightFlexAliases = item.weightOptions.flatMap((weight) => item.flexOptions.flatMap((flex) => {
    const weightBand = Math.max(1, Math.floor(weight / 10));
    return [`${weight} ${flex}`, `${weight}${flex}`, `${weightBand}${flex}`];
  }));
  return [
    item.usage || "",
    item.oemStockOrAftermarket || "",
    ...item.weightOptions.map(String),
    ...item.flexOptions,
    ...weightFlexAliases,
  ].join(" ");
}

function safeLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(50, Math.trunc(value as number)));
}

function decodeCursor(value: string | null | undefined) {
  if (!value || value.length > 240) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function safePinnedIds(values: readonly string[] | undefined) {
  if (!values) return [];
  return [...new Set(values
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 240))]
    .slice(0, 25);
}

function safeBallFitMaximum(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5_000, Math.trunc(value)));
}

function rank(item: EquipmentCatalogItem, query: string) {
  if (!query) return 0;
  const brand = searchable(item.brand);
  const model = searchable(item.model);
  const combined = `${brand} ${model}`;
  if (model === query || combined === query) return 0;
  if (model.startsWith(query) || combined.startsWith(query)) return 1;
  if (brand.startsWith(query)) return 2;
  return 3;
}

function page<T extends EquipmentCatalogItem>(items: readonly T[], input: EquipmentCatalogSearchInput): GolfCatalogPage<EquipmentCatalogItem> {
  const query = searchable(input.query || "").slice(0, 120);
  const tokens = query.split(" ").filter(Boolean);
  const candidates = items
    .filter((item) => ("bagEligible" in item ? item.bagEligible : true))
    .filter((item) => input.includeArchived || item.active)
    .filter((item) => input.kind !== "CLUB" || !input.category || (item as GolfClubCatalog).category === input.category)
    .filter((item) => input.kind !== "SHAFT" || !input.shaftUsage || (item as GolfShaftCatalog).usage === input.shaftUsage)
    .filter((item) => {
      if (!tokens.length) return true;
      const generation = "generation" in item ? item.generation : "";
      const aliases = "aliases" in item && Array.isArray(item.aliases) ? item.aliases.join(" ") : "";
      const year = "year" in item ? item.year : "";
      const shaftFacts = input.kind === "SHAFT" ? shaftSearchFacts(item as GolfShaftCatalog) : "";
      const haystack = searchable(`${item.brand} ${item.model} ${generation || ""} ${year || ""} ${aliases} ${shaftFacts}`)
        .replace(/([a-z])\s+(\d)/g, "$1$2")
        .replace(/(\d)\s+([a-z])/g, "$1$2");
      const compactTokens = tokens.map((token) => token.replace(/\s+/g, ""));
      return compactTokens.every((token) => haystack.includes(token));
    })
    .sort((left, right) => rank(left, query) - rank(right, query)
      || left.brand.localeCompare(right.brand, "es-MX")
      || left.model.localeCompare(right.model, "es-MX")
      || left.id.localeCompare(right.id));

  const cursorId = decodeCursor(input.cursor);
  const cursorIndex = cursorId ? candidates.findIndex((item) => item.id === cursorId) : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const limit = safeLimit(input.limit);
  const selected = candidates.slice(start, start + limit);
  const hasMore = start + selected.length < candidates.length;
  const pinnedIds = safePinnedIds(input.pinnedIds);
  const byId = new Map<string, EquipmentCatalogItem>();
  for (const id of pinnedIds) {
    const pinned = items.find((item) => item.id === id);
    if (pinned) byId.set(pinned.id, pinned);
  }
  for (const item of selected) byId.set(item.id, item);
  return {
    items: [...byId.values()],
    hasMore,
    nextCursor: hasMore && selected.length ? encodeURIComponent(selected[selected.length - 1].id) : null,
  };
}

function facetPage<T extends EquipmentCatalogItem>(items: readonly T[], input: EquipmentCatalogBrandFacetInput): GolfCatalogPage<EquipmentCatalogBrandFacet> {
  const query = searchable(input.query || "").slice(0, 120);
  const source = items
    .filter((item) => ("bagEligible" in item ? item.bagEligible : true))
    .filter((item) => input.includeArchived || item.active)
    .filter((item) => input.kind !== "CLUB" || !input.category || (item as GolfClubCatalog).category === input.category)
    .filter((item) => input.kind !== "SHAFT" || !input.shaftUsage || (item as GolfShaftCatalog).usage === input.shaftUsage)
    .filter((item) => !query || searchable(item.brand).includes(query));
  const grouped = new Map<string, EquipmentCatalogBrandFacet>();
  for (const item of source) {
    const key = searchable(item.brand);
    const current = grouped.get(key) || { brand: item.brand, count: 0, currentCount: 0, historicalCount: 0 };
    current.count += 1;
    if (item.active) current.currentCount += 1;
    else current.historicalCount += 1;
    grouped.set(key, current);
  }
  const candidates = [...grouped.values()].sort((left, right) => {
    const leftMatch = query && searchable(left.brand) === query ? 0 : 1;
    const rightMatch = query && searchable(right.brand) === query ? 0 : 1;
    return leftMatch - rightMatch || left.brand.localeCompare(right.brand, "es-MX");
  });
  const cursorBrand = decodeCursor(input.cursor);
  const cursorIndex = cursorBrand ? candidates.findIndex((item) => searchable(item.brand) === cursorBrand) : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const limit = safeLimit(input.limit);
  const selected = candidates.slice(start, start + limit);
  const hasMore = start + selected.length < candidates.length;
  return {
    items: selected,
    hasMore,
    nextCursor: hasMore && selected.length ? encodeURIComponent(searchable(selected[selected.length - 1].brand)) : null,
  };
}

/**
 * Small QA provider backed by versioned, sourced seed files. UI consumes this
 * through a server route so replacing it with a paginated Supabase provider
 * does not change the picker contract or ship a future 40k-row catalog.
 */
export function createInternalEquipmentCatalogProvider(catalogs: {
  balls: readonly GolfBallCatalog[];
  clubs: readonly GolfClubCatalog[];
  shafts: readonly GolfShaftCatalog[];
}): EquipmentCatalogProvider {
  return {
    id: "backyard-equipment-seed",
    async search(input) {
      if (input.kind === "BALL") return page(catalogs.balls, input);
      if (input.kind === "CLUB") return page(catalogs.clubs, input);
      return page(catalogs.shafts, input);
    },
    async brandFacets(input) {
      if (input.kind === "BALL") return facetPage(catalogs.balls, input);
      if (input.kind === "CLUB") return facetPage(catalogs.clubs, input);
      return facetPage(catalogs.shafts, input);
    },
    async loadBallFitCatalog(input) {
      const maximumCandidates = safeBallFitMaximum(input.maximumCandidates);
      const active = catalogs.balls.filter((ball) => ball.active && ball.fitEligible);
      if (maximumCandidates === 0 || active.length > maximumCandidates) {
        return {
          items: [],
          complete: false,
          activeCandidateCount: active.length,
          evaluatedCandidateCount: 0,
          maximumCandidates,
        };
      }

      const byId = new Map(active.map((ball) => [ball.id, ball]));
      const currentBallId = input.currentBallId?.trim() || null;
      if (currentBallId) {
        const current = catalogs.balls.find((ball) => ball.id === currentBallId);
        if (current) byId.set(current.id, current);
      }
      return {
        items: [...byId.values()],
        complete: true,
        activeCandidateCount: active.length,
        evaluatedCandidateCount: active.length,
        maximumCandidates,
      };
    },
  };
}

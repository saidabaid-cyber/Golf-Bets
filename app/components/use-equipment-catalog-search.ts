"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EquipmentCatalogBrandFacet, EquipmentCatalogKind } from "../../lib/equipment-catalog-provider";
import {
  normalizeGolfBallCatalogEntries,
  normalizeGolfClubCatalogEntries,
  normalizeGolfShaftCatalogEntries,
  type ClubCategory,
  type GolfBallCatalog,
  type GolfClubCatalog,
  type GolfShaftCatalog,
  type ShaftUsage,
} from "../../lib/golf-equipment";

type CatalogIdentity = { id: string; brand: string; model: string; active: boolean };
type CatalogItem = GolfBallCatalog | GolfClubCatalog | GolfShaftCatalog;
type SearchStatus = "idle" | "loading" | "success" | "error";

const EMPTY_IDENTITIES: readonly CatalogItem[] = Object.freeze([]);
const EMPTY_IDS: readonly string[] = Object.freeze([]);

function localMatches<T extends CatalogIdentity>(items: readonly T[], query: string) {
  const tokens = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es-MX")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return [...items];
  return items.filter((item) => {
    const haystack = `${item.brand} ${item.model}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es-MX");
    return tokens.every((token) => haystack.includes(token));
  });
}

function normalizeResponseItems(kind: EquipmentCatalogKind, value: unknown): CatalogItem[] {
  if (kind === "BALL") return normalizeGolfBallCatalogEntries(value);
  if (kind === "CLUB") return normalizeGolfClubCatalogEntries(value);
  return normalizeGolfShaftCatalogEntries(value);
}

type CatalogPage = {
  items: CatalogItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

async function fetchCatalogPage({
  kind,
  query,
  category,
  shaftUsage,
  pinnedKey,
  cursor,
  signal,
  includeArchived,
}: {
  kind: EquipmentCatalogKind;
  query: string;
  category?: ClubCategory;
  shaftUsage?: ShaftUsage;
  pinnedKey: string;
  cursor?: string | null;
  signal?: AbortSignal;
  includeArchived?: boolean;
}): Promise<CatalogPage> {
  const params = new URLSearchParams({ type: kind, q: query, limit: "50" });
  if (category) params.set("category", category);
  if (shaftUsage) params.set("usage", shaftUsage);
  if (pinnedKey) params.set("ids", pinnedKey);
  if (cursor) params.set("cursor", cursor);
  if (includeArchived !== undefined) params.set("includeArchived", String(includeArchived));
  const response = await fetch(`/api/catalog/equipment?${params}`, { signal });
  if (!response.ok) throw new Error("catalog-search-failed");
  const payload: unknown = await response.json();
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  if (!record || !Array.isArray(record.items)) throw new Error("catalog-response-invalid");
  return {
    items: normalizeResponseItems(kind, record.items),
    hasMore: record.hasMore === true,
    nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : null,
  };
}

/**
 * Debounced, paginated server search. The optional fallback contains only
 * records already fetched during this session; catalog seed files never cross
 * the client boundary. `pinnedIds` keeps saved/archived selections resolvable.
 */
type CatalogSearchResult<T extends CatalogIdentity> = {
  items: T[];
  status: SearchStatus;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  retry: () => void;
};

type SearchArgs<T extends CatalogIdentity, K extends EquipmentCatalogKind> = {
  kind: K;
  query: string;
  category?: ClubCategory;
  shaftUsage?: ShaftUsage;
  fallback?: readonly T[];
  pinnedIds?: readonly string[];
  includeArchived?: boolean;
};

export function useEquipmentCatalogSearch(args: SearchArgs<GolfBallCatalog, "BALL">): CatalogSearchResult<GolfBallCatalog>;
export function useEquipmentCatalogSearch(args: SearchArgs<GolfClubCatalog, "CLUB">): CatalogSearchResult<GolfClubCatalog>;
export function useEquipmentCatalogSearch(args: SearchArgs<GolfShaftCatalog, "SHAFT">): CatalogSearchResult<GolfShaftCatalog>;
export function useEquipmentCatalogSearch({
  kind,
  query,
  category,
  shaftUsage,
  fallback = EMPTY_IDENTITIES,
  pinnedIds = EMPTY_IDS,
  includeArchived,
}: SearchArgs<CatalogItem, EquipmentCatalogKind>): CatalogSearchResult<CatalogItem> {
  const pinnedKey = useMemo(() => [...new Set(pinnedIds
    .map((value) => value.trim())
    .filter(Boolean))]
    .sort()
    .slice(0, 25)
    .join(","), [pinnedIds]);
  const local = useMemo(() => localMatches(fallback, query).slice(0, 50), [fallback, query]);
  const [items, setItems] = useState<CatalogItem[]>(local);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requestGenerationRef = useRef(0);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    const controller = new AbortController();
    setItems(local);
    setHasMore(false);
    setNextCursor(null);
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const page = await fetchCatalogPage({ kind, query, category, shaftUsage, pinnedKey, includeArchived, signal: controller.signal });
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
        setStatus("success");
      } catch (error) {
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        void error;
        setItems(local);
        setStatus("error");
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      loadMoreControllerRef.current?.abort();
      loadMoreControllerRef.current = null;
      if (requestGenerationRef.current === generation) requestGenerationRef.current += 1;
    };
  }, [category, includeArchived, kind, local, pinnedKey, query, revision, shaftUsage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || status === "loading") return;
    const generation = requestGenerationRef.current;
    const controller = new AbortController();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = controller;
    setStatus("loading");
    try {
      const page = await fetchCatalogPage({ kind, query, category, shaftUsage, pinnedKey, includeArchived, cursor: nextCursor, signal: controller.signal });
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      setItems((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()]);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      setStatus("success");
    } catch {
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      setStatus("error");
    } finally {
      if (loadMoreControllerRef.current === controller) loadMoreControllerRef.current = null;
    }
  }, [category, hasMore, includeArchived, kind, nextCursor, pinnedKey, query, shaftUsage, status]);

  const retry = useCallback(() => setRevision((value) => value + 1), []);

  return { items, status, hasMore, loadMore, retry } as const;
}

type BrandFacetResult = {
  items: EquipmentCatalogBrandFacet[];
  status: SearchStatus;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  retry: () => void;
};

async function fetchBrandFacetPage(input: {
  kind: EquipmentCatalogKind;
  query: string;
  category?: ClubCategory;
  shaftUsage?: ShaftUsage;
  cursor?: string | null;
  signal?: AbortSignal;
}): Promise<{ items: EquipmentCatalogBrandFacet[]; hasMore: boolean; nextCursor: string | null }> {
  const params = new URLSearchParams({ type: input.kind, facet: "brands", q: input.query, limit: "50", includeArchived: "true" });
  if (input.category) params.set("category", input.category);
  if (input.shaftUsage) params.set("usage", input.shaftUsage);
  if (input.cursor) params.set("cursor", input.cursor);
  const response = await fetch(`/api/catalog/equipment?${params}`, { signal: input.signal });
  if (!response.ok) throw new Error("catalog-brand-facets-failed");
  const payload: unknown = await response.json();
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const items = Array.isArray(record?.items) ? record.items.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.brand !== "string" || !item.brand.trim()) return [];
    const count = Number(item.count);
    const currentCount = Number(item.currentCount);
    const historicalCount = Number(item.historicalCount);
    if (![count, currentCount, historicalCount].every(Number.isFinite)) return [];
    return [{ brand: item.brand.trim(), count, currentCount, historicalCount }];
  }) : [];
  return { items, hasMore: record?.hasMore === true, nextCursor: typeof record?.nextCursor === "string" ? record.nextCursor : null };
}

/** Server-computed brand facets cover the complete eligible catalog. A brand
 * is never inferred from only the first 50 model rows sent to the client. */
export function useEquipmentBrandFacets({ kind, query, category, shaftUsage }: {
  kind: EquipmentCatalogKind;
  query: string;
  category?: ClubCategory;
  shaftUsage?: ShaftUsage;
}): BrandFacetResult {
  const [items, setItems] = useState<EquipmentCatalogBrandFacet[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generationRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    setItems([]);
    setHasMore(false);
    setNextCursor(null);
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const page = await fetchBrandFacetPage({ kind, query, category, shaftUsage, signal: controller.signal });
        if (controller.signal.aborted || generationRef.current !== generation) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
        setStatus("success");
      } catch {
        if (controller.signal.aborted || generationRef.current !== generation) return;
        setStatus("error");
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [category, kind, query, revision, shaftUsage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || status === "loading") return;
    const generation = generationRef.current;
    const controller = new AbortController();
    loadControllerRef.current?.abort();
    loadControllerRef.current = controller;
    setStatus("loading");
    try {
      const page = await fetchBrandFacetPage({ kind, query, category, shaftUsage, cursor: nextCursor, signal: controller.signal });
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setItems((current) => [...new Map([...current, ...page.items].map((item) => [item.brand.toLocaleLowerCase("es-MX"), item])).values()]);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      setStatus("success");
    } catch {
      if (!controller.signal.aborted && generationRef.current === generation) setStatus("error");
    }
  }, [category, hasMore, kind, nextCursor, query, shaftUsage, status]);

  const retry = useCallback(() => setRevision((value) => value + 1), []);
  return { items, status, hasMore, loadMore, retry };
}

/** Published database rows replace equal seed IDs. Missing IDs keep the
 * versioned seed fallback so migration is progressive and bags stay resolvable. */
export function mergePublishedCatalog<T extends { id: string }>(seed: readonly T[], published: readonly T[]) {
  const merged = new Map(seed.map((item) => [item.id, item]));
  for (const item of published) merged.set(item.id, item);
  return [...merged.values()];
}

export function resolveCatalogItem<T extends { id: string }>(id: string, seed: readonly T[], published: readonly T[]) {
  return published.find((item) => item.id === id) ?? seed.find((item) => item.id === id) ?? null;
}

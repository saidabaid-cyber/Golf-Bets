"use client";

import { useState, type ReactNode } from "react";
import type { GolfBallCatalog, GolfClubCatalog, GolfShaftCatalog } from "../../lib/golf-equipment";

type CatalogMediaItem = GolfBallCatalog | GolfClubCatalog | GolfShaftCatalog;

/** Catalog photos render only when an explicitly sourced HTTPS asset exists.
 * Missing or broken assets use the same clean fallback and never guess art. */
export function CatalogProductMedia({ item, fallback }: { item: CatalogMediaItem | null | undefined; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (!item?.imageUrl || failed) return <span className="catalogMediaFallback" aria-hidden="true">{fallback}</span>;
  return <span className="catalogMediaImage">{
    // Catalog image hosts are provenance-controlled data, not a fixed app
    // allowlist. A native image keeps the provider swappable without opening
    // Next Image to arbitrary remote hosts.
    <img src={item.imageUrl} alt={item.imageAlt || `${item.brand} ${item.model}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  }</span>;
}

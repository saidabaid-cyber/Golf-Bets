import { NextRequest, NextResponse } from "next/server";

import {
  EQUIPMENT_CATALOG_KINDS,
  type EquipmentCatalogKind,
} from "../../../../lib/equipment-catalog-provider";
import { internalEquipmentCatalogProvider } from "../../../../lib/equipment-catalog-provider.server";
import {
  CLUB_CATEGORIES,
  SHAFT_USAGES,
  type ClubCategory,
  type ShaftUsage,
} from "../../../../lib/golf-equipment";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const typeValue = request.nextUrl.searchParams.get("type")?.toUpperCase();
  if (!typeValue || !(EQUIPMENT_CATALOG_KINDS as readonly string[]).includes(typeValue)) {
    return NextResponse.json({ error: "Tipo de catálogo inválido." }, { status: 400 });
  }
  const categoryValue = request.nextUrl.searchParams.get("category")?.toUpperCase() || null;
  if (categoryValue && !(CLUB_CATEGORIES as readonly string[]).includes(categoryValue)) {
    return NextResponse.json({ error: "Categoría de bastón inválida." }, { status: 400 });
  }
  const shaftUsageValue = request.nextUrl.searchParams.get("usage")?.toUpperCase() || null;
  if (shaftUsageValue && !(SHAFT_USAGES as readonly string[]).includes(shaftUsageValue)) {
    return NextResponse.json({ error: "Uso de varilla inválido." }, { status: 400 });
  }
  const limitValue = Number(request.nextUrl.searchParams.get("limit") || "20");
  const pinnedIds = (request.nextUrl.searchParams.get("ids") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 25);
  const query = request.nextUrl.searchParams.get("q") || "";
  const includeArchivedParam = request.nextUrl.searchParams.get("includeArchived");
  const facet = request.nextUrl.searchParams.get("facet");
  if (facet && facet !== "brands") {
    return NextResponse.json({ error: "Faceta de catálogo inválida." }, { status: 400 });
  }
  if (facet === "brands") {
    const page = await internalEquipmentCatalogProvider.brandFacets({
      kind: typeValue as EquipmentCatalogKind,
      query,
      category: categoryValue as ClubCategory | null,
      shaftUsage: shaftUsageValue as ShaftUsage | null,
      cursor: request.nextUrl.searchParams.get("cursor"),
      limit: Number.isFinite(limitValue) ? limitValue : 20,
      includeArchived: includeArchivedParam !== "false",
    });
    return NextResponse.json({ provider: internalEquipmentCatalogProvider.id, facet: "brands", ...page }, {
      headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
    });
  }
  const page = await internalEquipmentCatalogProvider.search({
    kind: typeValue as EquipmentCatalogKind,
    query,
    category: categoryValue as ClubCategory | null,
    shaftUsage: shaftUsageValue as ShaftUsage | null,
    cursor: request.nextUrl.searchParams.get("cursor"),
    limit: Number.isFinite(limitValue) ? limitValue : 20,
    includeArchived: includeArchivedParam === "true" || (includeArchivedParam !== "false" && query.trim().length > 0),
    pinnedIds,
  });
  return NextResponse.json({ provider: internalEquipmentCatalogProvider.id, ...page }, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  });
}

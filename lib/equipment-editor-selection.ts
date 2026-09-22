import type { ClubHandedness, GolfClubCatalog, GolfClubCatalogVariant, GolfShaftCatalog } from "./golf-equipment";

export type ProfileHandedness = "right" | "left" | "ambidextrous" | "";

function sameCatalogText(left: string, right: string) {
  return left.localeCompare(right, "en-US", { sensitivity: "base" }) === 0;
}

/**
 * Equipment consumes the canonical profile preference; it does not create a
 * second user-level handedness setting. Ambidextrous/unknown profiles still
 * need an explicit per-club choice, so the legacy RH fallback remains visible
 * and editable in the club form.
 */
export function clubHandednessFromProfile(
  handedness: ProfileHandedness | null | undefined,
  fallback: ClubHandedness = "RH",
): ClubHandedness {
  if (handedness === "left") return "LH";
  if (handedness === "right") return "RH";
  return fallback;
}

/** All real catalog generations for the selected brand/model/category. */
export function catalogClubGenerationOptions(
  selected: GolfClubCatalog | null | undefined,
  catalog: readonly GolfClubCatalog[],
): GolfClubCatalog[] {
  if (!selected) return [];
  const byId = new Map(catalog
    .filter((candidate) => candidate.category === selected.category
      && sameCatalogText(candidate.brand, selected.brand)
      && sameCatalogText(candidate.model, selected.model))
    .map((candidate) => [candidate.id, candidate]));
  byId.set(selected.id, selected);
  return [...byId.values()].sort((left, right) => Number(right.active) - Number(left.active)
    || (right.year ?? -1) - (left.year ?? -1)
    || (right.generation || "").localeCompare(left.generation || "", "es-MX")
    || left.id.localeCompare(right.id));
}

/** One premium picker row per model; generation is resolved in the next step. */
export function groupCatalogClubModels(catalog: readonly GolfClubCatalog[]) {
  const groups = new Map<string, GolfClubCatalog[]>();
  for (const club of catalog) {
    const key = `${club.category}:${club.brand.toLocaleLowerCase("en-US")}:${club.model.toLocaleLowerCase("en-US")}`;
    groups.set(key, [...(groups.get(key) || []), club]);
  }
  return [...groups.entries()].map(([key, candidates]) => {
    const generations = catalogClubGenerationOptions(candidates[0], candidates);
    return { key, representative: generations[0], generations };
  });
}

/** No generic wedge degree list: only the selected model's published data. */
export function catalogClubLofts(club: Pick<GolfClubCatalog, "lofts" | "variants"> | null | undefined): number[] {
  return [...new Set([...(club?.lofts ?? []), ...(club?.variants.map(variant => variant.loft) ?? [])])]
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 90).sort((a, b) => a - b);
}

export function isCatalogLoftAllowed(loft: number | null, club: Pick<GolfClubCatalog, "lofts" | "variants"> | null | undefined) {
  const verified = catalogClubLofts(club);
  return loft === null || !verified.length || verified.includes(loft);
}

/**
 * Resolve the shaft currently selected by the editor.
 *
 * The saved shaft is only a fallback while its exact id remains selected. An
 * empty selection is an explicit request to remove the shaft and must never
 * resurrect the previously saved catalog snapshot.
 */
export function resolveCatalogShaftSelection(
  shaftId: string,
  availableShafts: readonly GolfShaftCatalog[],
  existingShaft: GolfShaftCatalog | null | undefined,
): GolfShaftCatalog | null {
  if (!shaftId) return null;

  return availableShafts.find((shaft) => shaft.id === shaftId)
    || (existingShaft?.id === shaftId ? existingShaft : null);
}

/** Empty handedness arrays mean that the source did not verify a restriction;
 * they must not make a historical club impossible to save. */
export function verifiedClubHandedness(
  club: Pick<GolfClubCatalog, "handedness"> | null | undefined,
  variant?: Pick<GolfClubCatalogVariant, "handedness"> | null,
): readonly ClubHandedness[] | null {
  if (variant?.handedness.length) return variant.handedness;
  if (club?.handedness.length) return club.handedness;
  return null;
}

export function isClubHandednessAllowed(
  selected: ClubHandedness,
  club: Pick<GolfClubCatalog, "handedness"> | null | undefined,
  variant?: Pick<GolfClubCatalogVariant, "handedness"> | null,
) {
  return verifiedClubHandedness(club, variant)?.includes(selected) ?? true;
}

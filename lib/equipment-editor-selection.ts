import type { ClubHandedness, GolfClubCatalog, GolfClubCatalogVariant, GolfShaftCatalog } from "./golf-equipment";

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

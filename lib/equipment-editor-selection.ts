import type { GolfShaftCatalog } from "./golf-equipment";

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

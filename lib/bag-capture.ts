import type { PlayerClub } from "./golf-equipment";

export type CapturedBagClubChoice = {
  id: string;
  label: string;
  category: PlayerClub["category"] | null;
  model: string | null;
  shaft: {
    id: string | null;
    brand: string | null;
    model: string | null;
    flex: string | null;
    weightGrams: number | null;
    source: "CATALOG" | "USER_ENTERED" | null;
  } | null;
};

/** Stable labels copied into each hole stat. A later bag change therefore
 * changes future choices without rewriting historical rounds. */
export function captureClubLabels(club: PlayerClub) {
  return captureClubChoices(club).map((choice) => choice.label);
}

/** Immutable, catalog-independent choices copied into a shot snapshot. */
export function captureClubChoices(club: PlayerClub): CapturedBagClubChoice[] {
  const category = club.category === "DRIVER" ? "Driver"
    : club.category === "MINI_DRIVER" ? "Mini Driver"
      : club.category === "FAIRWAY_WOOD" ? "Madera"
        : club.category === "HYBRID" ? "Híbrido"
          : club.category === "UTILITY_IRON" ? "Utility"
            : club.category === "IRON_SET" ? "Hierro"
              : club.category === "WEDGE" ? "Wedge"
                : "Putter";
  const labels = club.category === "IRON_SET" && club.setComposition.length
    ? club.setComposition.map((item) => /^\d$/.test(item) ? `${item}i` : item)
    : [club.loft ? `${category} ${club.loft}°` : category].map((spec) => club.customModel && club.customModel.localeCompare(spec, "es-MX", { sensitivity: "base" }) !== 0 ? `${spec} · ${club.customModel}` : spec);
  const shaftBrand = club.customShaftBrand || null;
  const shaftModel = club.customShaftModel || club.customShaft || null;
  const shaft = club.shaftId || shaftBrand || shaftModel || club.shaftFlexLabel || club.flex || club.shaftWeightGrams !== null
    ? {
      id: club.shaftId,
      brand: shaftBrand,
      model: shaftModel,
      flex: club.shaftFlexLabel || club.flex,
      weightGrams: club.shaftWeightGrams,
      source: club.shaftId ? "CATALOG" as const : "USER_ENTERED" as const,
    }
    : null;
  return labels.map((label) => ({
    id: club.id,
    label,
    category: club.category,
    model: club.customModel,
    shaft: shaft ? { ...shaft } : null,
  }));
}

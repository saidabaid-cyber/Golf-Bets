import type { PlayerClub } from "./golf-equipment";

/** Stable labels copied into each hole stat. A later bag change therefore
 * changes future choices without rewriting historical rounds. */
export function captureClubLabels(club: PlayerClub) {
  const category = club.category === "DRIVER" ? "Driver"
    : club.category === "MINI_DRIVER" ? "Mini Driver"
      : club.category === "FAIRWAY_WOOD" ? "Madera"
        : club.category === "HYBRID" ? "Híbrido"
          : club.category === "UTILITY_IRON" ? "Utility"
            : club.category === "IRON_SET" ? "Hierro"
              : club.category === "WEDGE" ? "Wedge"
                : "Putter";
  if (club.category === "IRON_SET" && club.setComposition.length) {
    return club.setComposition.map((item) => /^\d$/.test(item) ? `${item}i` : item);
  }
  const spec = club.loft ? `${category} ${club.loft}°` : category;
  return [club.customModel && club.customModel.localeCompare(spec, "es-MX", { sensitivity: "base" }) !== 0 ? `${spec} · ${club.customModel}` : spec];
}

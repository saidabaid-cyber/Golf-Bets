import type { ClubCategory, PlayerClub } from "./golf-equipment";

export const BAG_CATEGORY_SECTIONS = [
  { id: "driver", label: "Driver", description: "Máxima distancia para tus tiros de salida.", onboardingDescription: "Máxima distancia para tus tiros de salida.", categories: ["DRIVER"] },
  { id: "mini-driver", label: "Mini Driver", description: "Control desde el tee con una cabeza compacta.", onboardingDescription: "Control desde el tee con una cabeza compacta.", categories: ["MINI_DRIVER"] },
  { id: "woods", label: "Maderas", description: "Versatilidad y distancia desde el fairway.", onboardingDescription: "Versatilidad y distancia en el campo.", categories: ["FAIRWAY_WOOD"] },
  { id: "hybrids", label: "Híbridos", description: "Confianza desde cualquier lie.", onboardingDescription: "Confianza en cada lie.", categories: ["HYBRID"] },
  { id: "utility", label: "Utility / Driving Iron", description: "Trayectoria penetrante y control desde el tee.", onboardingDescription: "Trayectoria penetrante y control desde el tee.", categories: ["UTILITY_IRON"] },
  { id: "irons", label: "Hierros", description: "Precisión y control de distancia.", onboardingDescription: "Precisión para un mejor control.", categories: ["IRON_SET"] },
  { id: "wedges", label: "Wedges", description: "Creatividad alrededor del green.", onboardingDescription: "Creatividad alrededor del green.", categories: ["WEDGE"] },
  { id: "putter", label: "Putter", description: "Decisión en los últimos golpes.", onboardingDescription: "Decisión en los últimos golpes.", categories: ["PUTTER"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; description: string; onboardingDescription: string; categories: readonly [ClubCategory] }>;

export function bagCategoryManagement<T extends { category: ClubCategory }>(clubs: readonly T[]) {
  const populated = BAG_CATEGORY_SECTIONS.flatMap((section) => {
    const sectionClubs = clubs.filter((club) => section.categories.some((category) => category === club.category));
    return sectionClubs.length ? [{ ...section, clubs: sectionClubs }] : [];
  });
  const populatedIds = new Set(populated.map((section) => section.id));
  return { populated, missing: BAG_CATEGORY_SECTIONS.filter((section) => !populatedIds.has(section.id)) };
}

export function sortCurrentWedges(clubs: readonly PlayerClub[]) {
  return clubs
    .filter((club) => club.category === "WEDGE" && club.isCurrent)
    .sort((left, right) => {
      const leftLoft = left.loft ?? Number.POSITIVE_INFINITY;
      const rightLoft = right.loft ?? Number.POSITIVE_INFINITY;
      return leftLoft - rightLoft
        || left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id);
    });
}

export function wedgeLoftSummary(clubs: readonly PlayerClub[]) {
  return sortCurrentWedges(clubs)
    .flatMap((club) => club.loft === null ? [] : [`${club.loft}°`])
    .join(" · ");
}

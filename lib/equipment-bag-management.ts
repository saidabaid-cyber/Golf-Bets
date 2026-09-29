import type { ClubCategory } from "./golf-equipment";

export const BAG_CATEGORY_SECTIONS = [
  { id: "driver", label: "Driver", description: "Máxima distancia para tus tiros de salida.", categories: ["DRIVER"] },
  { id: "mini-driver", label: "Mini Driver", description: "Control desde el tee con una cabeza compacta.", categories: ["MINI_DRIVER"] },
  { id: "woods", label: "Maderas", description: "Versatilidad y distancia desde el fairway.", categories: ["FAIRWAY_WOOD"] },
  { id: "hybrids", label: "Híbridos", description: "Confianza desde cualquier lie.", categories: ["HYBRID"] },
  { id: "utility", label: "Utility / Driving Iron", description: "Trayectoria penetrante y control desde el tee.", categories: ["UTILITY_IRON"] },
  { id: "irons", label: "Hierros", description: "Precisión y control de distancia.", categories: ["IRON_SET"] },
  { id: "wedges", label: "Wedges", description: "Creatividad alrededor del green.", categories: ["WEDGE"] },
  { id: "putter", label: "Putter", description: "Decisión en los últimos golpes.", categories: ["PUTTER"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; description: string; categories: readonly ClubCategory[] }>;

export function bagCategoryManagement<T extends { category: ClubCategory }>(clubs: readonly T[]) {
  const populated = BAG_CATEGORY_SECTIONS.flatMap((section) => {
    const sectionClubs = clubs.filter((club) => section.categories.some((category) => category === club.category));
    return sectionClubs.length ? [{ ...section, clubs: sectionClubs }] : [];
  });
  const populatedIds = new Set(populated.map((section) => section.id));
  return { populated, missing: BAG_CATEGORY_SECTIONS.filter((section) => !populatedIds.has(section.id)) };
}

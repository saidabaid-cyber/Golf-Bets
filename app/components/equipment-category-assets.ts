import type { ClubCategory } from "../../lib/golf-equipment";

export type EquipmentCategoryAsset = Readonly<{
  src: string;
  width: number;
  height: number;
}>;

/** Canonical category photography shared by onboarding and Mi Bolsa. */
export const EQUIPMENT_CATEGORY_ASSETS = {
  DRIVER: { src: "/brand/equipment/onboarding-ref-b/driver_ref_b.png", width: 1006, height: 396 },
  MINI_DRIVER: { src: "/brand/equipment/onboarding-ref-b/mini-driver_ref_b.png", width: 1996, height: 788 },
  FAIRWAY_WOOD: { src: "/brand/equipment/onboarding-ref-b/maderas_ref_b.png", width: 1006, height: 408 },
  HYBRID: { src: "/brand/equipment/onboarding-ref-b/hibridos_ref_b.png", width: 1006, height: 410 },
  UTILITY_IRON: { src: "/brand/equipment/onboarding-ref-b/utility-driving-iron_ref_b.png", width: 1959, height: 803 },
  IRON_SET: { src: "/brand/equipment/onboarding-ref-b/hierros_ref_b.png", width: 1006, height: 412 },
  WEDGE: { src: "/brand/equipment/onboarding-ref-b/wedges_ref_b.png", width: 1006, height: 412 },
  PUTTER: { src: "/brand/equipment/onboarding-ref-b/putter_ref_b.png", width: 1006, height: 468 },
} as const satisfies Readonly<Record<ClubCategory, EquipmentCategoryAsset>>;

import Image from "next/image";

import type { ClubCategory } from "../../lib/golf-equipment";

const CLUB_PRODUCT_IMAGE: Record<ClubCategory, string> = {
  DRIVER: "/brand/equipment/backyard-driver-card.png",
  MINI_DRIVER: "/brand/equipment/backyard-driver-card.png",
  FAIRWAY_WOOD: "/brand/equipment/backyard-fairway-card.png",
  HYBRID: "/brand/equipment/backyard-hybrid-card.png",
  UTILITY_IRON: "/brand/equipment/backyard-irons-card.png",
  IRON_SET: "/brand/equipment/backyard-irons-card.png",
  WEDGE: "/brand/equipment/backyard-wedge-card.png",
  PUTTER: "/brand/equipment/backyard-putter-card.png",
};

/** Owned Backyard product art: no third-party marks, models or catalog claims. */
export function ClubCategoryVisual({ category, className }: { category: ClubCategory; className?: string }) {
  return <Image
    className={className}
    src={CLUB_PRODUCT_IMAGE[category]}
    width={1254}
    height={1254}
    sizes="(max-width: 540px) 34vw, 160px"
    alt=""
    aria-hidden="true"
  />;
}

export function GolfBallVisual({ className }: { className?: string }) {
  return <Image
    className={className}
    src="/brand/equipment/backyard-ball-premium.png"
    width={1024}
    height={1024}
    sizes="(max-width: 540px) 42vw, 220px"
    alt=""
    aria-hidden="true"
  />;
}

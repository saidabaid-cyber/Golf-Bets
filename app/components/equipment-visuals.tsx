import Image from "next/image";

import type { ClubCategory } from "../../lib/golf-equipment";

const CLUB_PRODUCT_IMAGE: Record<ClubCategory, string> = {
  DRIVER: "/brand/equipment/backyard-driver.png",
  MINI_DRIVER: "/brand/equipment/backyard-driver.png",
  FAIRWAY_WOOD: "/brand/equipment/backyard-fairway.png",
  HYBRID: "/brand/equipment/backyard-hybrid.png",
  UTILITY_IRON: "/brand/equipment/backyard-irons.png",
  IRON_SET: "/brand/equipment/backyard-irons.png",
  WEDGE: "/brand/equipment/backyard-wedge.png",
  PUTTER: "/brand/equipment/backyard-putter.png",
};

/** Owned Backyard product art: no third-party marks, models or catalog claims. */
export function ClubCategoryVisual({ category, className }: { category: ClubCategory; className?: string }) {
  return <Image
    className={className}
    src={CLUB_PRODUCT_IMAGE[category]}
    width={1024}
    height={1536}
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

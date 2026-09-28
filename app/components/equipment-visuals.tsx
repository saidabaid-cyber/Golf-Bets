import Image from "next/image";

import type { ClubCategory } from "../../lib/golf-equipment";
import { BackyardMark } from "./backyard-mark";
import styles from "./equipment-visuals.module.css";

const CLUB_PRODUCT_IMAGE: Record<ClubCategory, string> = {
  DRIVER: "/brand/equipment/backyard-driver-clean.png",
  MINI_DRIVER: "/brand/equipment/backyard-driver-clean.png",
  FAIRWAY_WOOD: "/brand/equipment/backyard-fairway-clean.png",
  HYBRID: "/brand/equipment/backyard-hybrid-clean.png",
  UTILITY_IRON: "/brand/equipment/backyard-irons-clean.png",
  IRON_SET: "/brand/equipment/backyard-irons-clean.png",
  WEDGE: "/brand/equipment/backyard-wedge-clean.png",
  PUTTER: "/brand/equipment/backyard-putter-clean.png",
};

/** Owned, unbranded product cutouts. The approved master mark is layered in DOM. */
export function ClubCategoryVisual({ category, className }: { category: ClubCategory; className?: string }) {
  return <span className={`${styles.clubVisual} ${className || ""}`} data-club-category={category}>
    <Image
      className={styles.productImage}
      src={CLUB_PRODUCT_IMAGE[category]}
      width={1254}
      height={1254}
      sizes="(max-width: 540px) 34vw, 160px"
      alt=""
      aria-hidden="true"
    />
    <span className={styles.clubBranding} aria-hidden="true"><BackyardMark className={styles.clubBrandMark} /><span>THE BACKYARD</span></span>
  </span>;
}

export function GolfBallVisual({ className }: { className?: string }) {
  return <span className={`${styles.ballVisual} ${className || ""}`}>
    <Image
      className={styles.productImage}
      src="/brand/equipment/backyard-ball-clean.png"
      width={1024}
      height={1024}
      sizes="(max-width: 540px) 42vw, 220px"
      alt=""
      aria-hidden="true"
    />
    <span className={styles.ballBranding} aria-hidden="true"><BackyardMark className={styles.ballBrandMark} /><span>THE BACKYARD</span></span>
  </span>;
}

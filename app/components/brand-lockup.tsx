"use client";

import Image from "next/image";
import { useState } from "react";

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  const [assetFallback, setAssetFallback] = useState<"svg" | "png" | "wordmark">("svg");
  return <div className={`backyardBrand ${compact ? "compact" : ""}`} aria-label="The Backyard">
    {assetFallback !== "wordmark" && <picture className="backyardLogoPicture">
      {assetFallback === "svg" && <source srcSet="/brand/the-backyard-logo.svg" type="image/svg+xml" />}
      <Image className="backyardLogo" src="/brand/the-backyard-logo.png" alt="THE BACKYARD" width={2290} height={1892} priority={!compact} onError={() => setAssetFallback((current) => current === "svg" ? "png" : "wordmark")} />
    </picture>}
    {assetFallback === "wordmark" && <span className="backyardWordmark">THE BACKYARD</span>}
    {!compact && <span className="backyardSlogan">Built for the games we play.</span>}
    {!compact && <span className="golfBetsSlogan">Play. Compete. Bet. Settle.</span>}
  </div>;
}

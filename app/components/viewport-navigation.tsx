"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useViewScrollReset } from "./use-view-scroll-reset";

export function ViewportNavigation() {
  useViewScrollReset(usePathname());
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => { history.scrollRestoration = previous; };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      document.documentElement.style.setProperty("--visual-viewport-height", `${viewport.height}px`);
      document.documentElement.style.setProperty("--visual-viewport-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--visual-viewport-height");
      document.documentElement.style.removeProperty("--visual-viewport-top");
    };
  }, []);
  return null;
}

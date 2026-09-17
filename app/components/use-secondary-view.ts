"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useViewScrollReset } from "./use-view-scroll-reset";

/** Secondary in-page views participate in browser Back without remounting their parent. */
export function useSecondaryView<T>(key: string) {
  const [value, setValue] = useState<T | null>(null);
  useViewScrollReset(value === null ? "root" : key);
  const active = useRef(false);
  useEffect(() => {
    const pop = () => {
      if (active.current && !window.history.state?.[key]) {
        active.current = false; setValue(null);
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [key]);
  const open = useCallback((next: T | null) => {
    if (next === null) { if (active.current) window.history.back(); else setValue(null); return; }
    if (!active.current) {
      window.history.pushState({ ...window.history.state, [key]: true }, "");
    }
    active.current = true; setValue(next);
  }, [key]);
  return [value, open] as const;
}

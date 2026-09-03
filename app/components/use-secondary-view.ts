"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Secondary in-page views participate in browser Back without remounting their parent. */
export function useSecondaryView<T>(key: string) {
  const [value, setValue] = useState<T | null>(null);
  const active = useRef(false);
  const scroll = useRef(0);
  useEffect(() => {
    const pop = () => {
      if (active.current && !window.history.state?.[key]) {
        active.current = false; setValue(null);
        requestAnimationFrame(() => window.scrollTo(0, scroll.current));
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [key]);
  const open = useCallback((next: T | null) => {
    if (next === null) { if (active.current) window.history.back(); else setValue(null); return; }
    if (!active.current) {
      scroll.current = window.scrollY;
      window.history.pushState({ ...window.history.state, [key]: true }, "");
    }
    active.current = true; setValue(next);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }, [key]);
  return [value, open] as const;
}

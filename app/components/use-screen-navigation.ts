"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppTab } from "../../lib/app-navigation";

/** App-local history entries retain the previous screen and its scroll position. */
export function useScreenNavigation() {
  const [tab, showTab] = useState<AppTab>("welcome");
  const current = useRef<AppTab>("welcome");
  const trail = useRef<Array<{ tab: AppTab; scroll: number }>>([]);
  useEffect(() => {
    const pop = () => {
      const target = window.history.state?.backyardTab as AppTab | undefined;
      if (!target || target === current.current) return;
      const previous = trail.current.pop();
      current.current = target;
      showTab(target);
      requestAnimationFrame(() => window.scrollTo(0, previous?.tab === target ? previous.scroll : 0));
    };
    window.history.replaceState({ ...window.history.state, backyardTab: current.current }, "");
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const setTab = useCallback((next: AppTab) => {
    if (next === current.current) return;
    trail.current.push({ tab: current.current, scroll: window.scrollY });
    window.history.pushState({ ...window.history.state, backyardTab: next }, "");
    current.current = next;
    showTab(next);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }, []);
  const goBack = useCallback(() => {
    if (trail.current.length) window.history.back();
    else setTab("welcome");
  }, [setTab]);
  return { tab, setTab, goBack };
}

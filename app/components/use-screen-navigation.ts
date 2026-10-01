"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { screenFromSearch, screenHref, type AppTab } from "../../lib/app-navigation";
import { useViewScrollReset } from "./use-view-scroll-reset";

type NavigationGuard = (next: AppTab) => AppTab;

/** App-local history preserves screens; every new view starts at the top. */
export function useScreenNavigation() {
  const [tab, showTab] = useState<AppTab>("welcome");
  useViewScrollReset(tab);
  const current = useRef<AppTab>("welcome");
  const trail = useRef<Array<{ tab: AppTab; scroll: number }>>([]);
  const guard = useRef<NavigationGuard>((next) => next);
  useEffect(() => {
    const pop = () => {
      const requested = window.history.state?.backyardTab as AppTab | undefined;
      const target = guard.current(requested || screenFromSearch(window.location.search));
      if (target !== requested) window.history.replaceState({ ...window.history.state, backyardTab: target }, "", screenHref(target, window.location.search));
      trail.current.pop();
      if (target === current.current) return;
      current.current = target;
      showTab(target);
    };
    const initial = guard.current(screenFromSearch(window.location.search));
    current.current = initial;
    showTab(initial);
    window.history.replaceState({ ...window.history.state, backyardTab: initial }, "", screenHref(initial, window.location.search));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const setTab = useCallback((next: AppTab) => {
    const target = guard.current(next);
    if (target === current.current) return;
    trail.current.push({ tab: current.current, scroll: window.scrollY });
    window.history.pushState({ ...window.history.state, backyardTab: target }, "", screenHref(target, window.location.search));
    current.current = target;
    showTab(target);
  }, []);
  const setNavigationGuard = useCallback((nextGuard?: NavigationGuard) => {
    guard.current = nextGuard ?? ((next) => next);
  }, []);
  const goBack = useCallback(() => {
    if (trail.current.length) window.history.back();
    else setTab("welcome");
  }, [setTab]);
  return { tab, setTab, goBack, setNavigationGuard };
}

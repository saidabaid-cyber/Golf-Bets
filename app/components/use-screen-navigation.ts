"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { historicalRoundIdFromSearch, screenFromSearch, screenHref, type AppTab } from "../../lib/app-navigation";
import { useViewScrollReset } from "./use-view-scroll-reset";

type NavigationGuard = (next: AppTab) => AppTab;

/** App-local history preserves screens; every new view starts at the top. */
export function useScreenNavigation() {
  const [tab, showTab] = useState<AppTab>("welcome");
  const [historyDetailId, selectHistoricalRound] = useState<string | null>(null);
  useViewScrollReset(tab);
  const current = useRef<AppTab>("welcome");
  const trail = useRef<Array<{ tab: AppTab; scroll: number }>>([]);
  const guard = useRef<NavigationGuard>((next) => next);
  useEffect(() => {
    const pop = () => {
      const stateTab = window.history.state?.backyardTab as string | undefined;
      const requested = screenFromSearch(stateTab ? `?screen=${encodeURIComponent(stateTab)}` : window.location.search);
      const target = guard.current(requested);
      selectHistoricalRound(target === "historyDetail" ? historicalRoundIdFromSearch(window.location.search) : null);
      window.history.replaceState({ ...window.history.state, backyardTab: target }, "", screenHref(target, window.location.search));
      if (target === current.current) return;
      trail.current.pop();
      current.current = target;
      showTab(target);
    };
    const initial = guard.current(screenFromSearch(window.location.search));
    selectHistoricalRound(initial === "historyDetail" ? historicalRoundIdFromSearch(window.location.search) : null);
    current.current = initial;
    showTab(initial);
    window.history.replaceState({ ...window.history.state, backyardTab: initial }, "", screenHref(initial, window.location.search));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const setTab = useCallback((next: AppTab, options?: { roundId?: string | null }) => {
    const target = guard.current(next);
    const href = screenHref(target, window.location.search, options?.roundId);
    if (target === current.current && href === `${window.location.pathname}${window.location.search}`) return;
    trail.current.push({ tab: current.current, scroll: window.scrollY });
    window.history.pushState({ ...window.history.state, backyardTab: target }, "", href);
    selectHistoricalRound(historicalRoundIdFromSearch(href.slice(1)));
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
  return { tab, setTab, goBack, setNavigationGuard, historyDetailId };
}

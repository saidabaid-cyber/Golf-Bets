"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { historicalRoundIdFromSearch, screenFromSearch, screenHref, type AppTab } from "../../lib/app-navigation";
import { useViewScrollReset } from "./use-view-scroll-reset";
import { careerDetailFromSearch, careerViewFromSearch, type CareerDetail, type CareerView } from "../../lib/career-navigation";

type NavigationGuard = (next: AppTab) => AppTab;

/** App-local history preserves screens; every new view starts at the top. */
export function useScreenNavigation() {
  const [tab, showTab] = useState<AppTab>("welcome");
  const [historyDetailId, selectHistoricalRound] = useState<string | null>(null);
  const [careerView, showCareerView] = useState<CareerView>("summary");
  const [careerDetail, showCareerDetail] = useState<CareerDetail>(null);
  const selectedCareer = useRef<CareerView>("summary");
  useViewScrollReset(tab === "career" ? `career:${careerView}` : tab);
  const current = useRef<AppTab>("welcome");
  const trail = useRef<Array<{ tab: AppTab; scroll: number }>>([]);
  const guard = useRef<NavigationGuard>((next) => next);
  useEffect(() => {
    const pop = () => {
      const stateTab = window.history.state?.backyardTab as string | undefined;
      const requested = screenFromSearch(stateTab ? `?screen=${encodeURIComponent(stateTab)}` : window.location.search);
      const target = guard.current(requested);
      selectedCareer.current = careerViewFromSearch(window.location.search);
      showCareerView(selectedCareer.current);
      showCareerDetail(target === "career" ? careerDetailFromSearch(window.location.search) : null);
      selectHistoricalRound(target === "historyDetail" ? historicalRoundIdFromSearch(window.location.search) : null);
      window.history.replaceState({ ...window.history.state, backyardTab: target }, "", screenHref(target, window.location.search));
      if (target === current.current) return;
      trail.current.pop();
      current.current = target;
      showTab(target);
    };
    const initial = guard.current(screenFromSearch(window.location.search));
    selectedCareer.current = careerViewFromSearch(window.location.search);
    showCareerView(selectedCareer.current);
    showCareerDetail(initial === "career" ? careerDetailFromSearch(window.location.search) : null);
    selectHistoricalRound(initial === "historyDetail" ? historicalRoundIdFromSearch(window.location.search) : null);
    current.current = initial;
    showTab(initial);
    window.history.replaceState({ ...window.history.state, backyardTab: initial }, "", screenHref(initial, window.location.search));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const setTab = useCallback((next: AppTab, options?: { roundId?: string | null; careerView?: CareerView }) => {
    const target = guard.current(next);
    const view = options?.careerView ?? selectedCareer.current;
    const search = new URLSearchParams(window.location.search);
    if (target === "career" && options?.careerView !== undefined) search.delete("careerDetail");
    const href = screenHref(target, search.toString(), options?.roundId, view);
    if (target === current.current && href === `${window.location.pathname}${window.location.search}`) return;
    trail.current.push({ tab: current.current, scroll: window.scrollY });
    window.history.pushState({ ...window.history.state, backyardTab: target }, "", href);
    selectHistoricalRound(historicalRoundIdFromSearch(href.slice(1)));
    current.current = target;
    selectedCareer.current = view;
    showCareerView(view);
    showCareerDetail(target === "career" ? careerDetailFromSearch(href.slice(1)) : null);
    showTab(target);
  }, []);
  const setCareerView = useCallback((view: CareerView) => setTab("career", { careerView: view }), [setTab]);
  const setCareerDetail = useCallback((detail: CareerDetail) => {
    if (current.current !== "career" || selectedCareer.current !== "summary") return;
    const search = new URLSearchParams(window.location.search);
    if (detail) search.set("careerDetail", detail); else search.delete("careerDetail");
    const href = screenHref("career", search.toString(), undefined, "summary");
    showCareerDetail(detail);
    if (href !== `${window.location.pathname}${window.location.search}`)
      window.history.pushState({ ...window.history.state, backyardTab: "career" }, "", href);
  }, []);
  const setNavigationGuard = useCallback((nextGuard?: NavigationGuard) => {
    guard.current = nextGuard ?? ((next) => next);
  }, []);
  const goBack = useCallback(() => {
    if (trail.current.length) window.history.back();
    else setTab("welcome");
  }, [setTab]);
  return { tab, setTab, goBack, setNavigationGuard, historyDetailId, careerView, setCareerView, careerDetail, setCareerDetail };
}

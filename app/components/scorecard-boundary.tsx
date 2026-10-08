"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { scorecardViewFromSearch, scorecardViewHref, type ScorecardView } from "../../lib/scorecard-view";
import { PremiumScorecard, type PremiumScorecardProps } from "./premium-scorecard";

function RoundContent({ render, onOpen }: { render: (open: () => void) => ReactNode; onOpen: () => void }) {
  return render(onOpen);
}

/** A round-local history stack. Global tabs and their active-section mapping remain unchanged. */
export function ScorecardBoundary({ children, ...props }: PremiumScorecardProps & { children: (open: () => void) => ReactNode }) {
  const [view, setView] = useState<ScorecardView>({ kind: "round" });
  const positions = useRef(new Map<string, number>()), returning = useRef(false), opener = useRef<HTMLElement | null>(null);
  const current = useRef<ScorecardView>(view);
  const parentScreen = useRef<string | null>(null);
  const holes = props.order.join(","), playerIds = JSON.stringify(props.players.map(player => player.id));
  const key = (value: ScorecardView) => value.kind === "hole" ? `hole:${value.hole}:${value.playerId}` : value.kind;
  useEffect(() => {
    const read = () => scorecardViewFromSearch(window.location.search, props.roundId, holes.split(",").map(Number), JSON.parse(playerIds) as string[]);
    parentScreen.current = new URLSearchParams(window.location.search).get("screen");
    const initial = read(); current.current = initial; setView(initial);
    function pop() { positions.current.set(key(current.current), window.scrollY); const next = read(); returning.current = true; current.current = next; setView(next); }
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      // A global tab change must not carry this round's child selection into another module.
      const params = new URLSearchParams(window.location.search);
      if (params.get("card") === props.roundId && params.get("screen") !== parentScreen.current)
        window.history.replaceState(window.history.state, "", scorecardViewHref(window.location.search, props.roundId, { kind: "round" }));
    };
  }, [props.roundId, holes, playerIds]);
  useLayoutEffect(() => {
    const top = returning.current ? positions.current.get(key(view)) ?? 0 : 0;
    returning.current = false;
    if (view.kind === "round" && !positions.current.has("round")) return;
    window.scrollTo({ top, behavior: "instant" });
    if (view.kind === "round") opener.current?.focus({ preventScroll: true });
  }, [view]);
  function navigate(next: ScorecardView) {
    positions.current.set(key(current.current), window.scrollY);
    if (next.kind === "card" && current.current.kind === "round") opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.history.pushState({ ...window.history.state, backyardScorecard: props.roundId }, "", scorecardViewHref(window.location.search, props.roundId, next));
    returning.current = false; current.current = next; setView(next);
  }
  function back() {
    if (window.history.state?.backyardScorecard === props.roundId) window.history.back();
    else { const next: ScorecardView = view.kind === "hole" ? { kind: "card" } : { kind: "round" }; returning.current = true; window.history.replaceState(window.history.state, "", scorecardViewHref(window.location.search, props.roundId, next)); current.current = next; setView(next); }
  }
  return <><div hidden={view.kind !== "round"}><RoundContent render={children} onOpen={() => navigate({ kind: "card" })} /></div>
    {view.kind !== "round" && <PremiumScorecard {...props} view={view} onBack={back} onHole={(hole, playerId) => navigate({ kind: "hole", hole, playerId })} />}
  </>;
}

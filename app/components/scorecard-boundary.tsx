"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { scorecardViewFromSearch, scorecardViewHref, type ScorecardView } from "../../lib/scorecard-view";
import { PremiumScorecard, type PremiumScorecardProps } from "./premium-scorecard";

function RoundContent({ render, onOpen }: { render: (open: (destination?: ScorecardDestination) => void) => ReactNode; onOpen: (destination?: ScorecardDestination) => void }) {
  return render(onOpen);
}

export type ScorecardDestination = { id: string; card: PremiumScorecardProps } | { id: string; summary: ReactNode };
type BoundaryOptions = { children: (open: (destination?: ScorecardDestination) => void) => ReactNode; navigation?: ReactNode; originLabel?: string;initialOpen?:boolean;onReturn?:()=>void };

/** A shared child-view stack for a round or a feed. The origin remains mounted. */
export function ScorecardNavigationBoundary({ children, navigation, originLabel = "ronda", destination,initialOpen=false,onReturn }: BoundaryOptions & { destination?: ScorecardDestination }) {
  const returnHandler=useRef(onReturn);useEffect(()=>{returnHandler.current=onReturn;},[onReturn]);
  const [opened, setOpened] = useState<ScorecardDestination>();
  const active = destination ?? opened;
  const props = active && "card" in active ? active.card : undefined;
  const roundId = active?.id ?? "";
  const [view, setView] = useState<ScorecardView>({ kind: "round" });
  const positions = useRef(new Map<string, number>()), returning = useRef(false), opener = useRef<HTMLElement | null>(null);
  const current = useRef<ScorecardView>(view);
  const parentScreen = useRef<string | null>(null);
  const holes = props?.order.join(",") ?? "", playerIds = JSON.stringify(props?.players.map(player => player.id) ?? []);
  const key = (value: ScorecardView) => value.kind === "hole" ? `hole:${value.hole}:${value.playerId}` : value.kind;
  useEffect(() => {
    if (!roundId) return;
    // Native history restoration happens after popstate and otherwise overwrites
    // the round-local position restored by the layout effect below.
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const read = () => roundId ? scorecardViewFromSearch(window.location.search, roundId, holes.split(",").map(Number), JSON.parse(playerIds) as string[]) : { kind: "round" } as const;
    parentScreen.current = new URLSearchParams(window.location.search).get("screen");
    let initial = read();
    if(initialOpen&&initial.kind==='round'){
      initial={kind:'card'};window.history.pushState({...window.history.state,backyardScorecard:roundId},'',scorecardViewHref(window.location.search,roundId,initial,window.location.pathname));
    }
    current.current = initial; setView(initial);
    function pop() { positions.current.set(key(current.current), window.scrollY); const next = read(); returning.current = true; current.current = next; setView(next);if(initialOpen&&next.kind==='round')returnHandler.current?.(); }
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      window.history.scrollRestoration = previousRestoration;
      // A global tab change must not carry this round's child selection into another module.
      const params = new URLSearchParams(window.location.search);
      if (roundId && params.get("card") === roundId && params.get("screen") !== parentScreen.current)
        window.history.replaceState(window.history.state, "", scorecardViewHref(window.location.search, roundId, { kind: "round" }, window.location.pathname));
    };
  }, [roundId, holes, playerIds,initialOpen]);
  useLayoutEffect(() => {
    const top = returning.current ? positions.current.get(key(view)) ?? 0 : 0;
    returning.current = false;
    if (view.kind === "round" && !positions.current.has("round")) return;
    window.scrollTo({ top, behavior: "instant" });
    if (view.kind === "round") opener.current?.focus({ preventScroll: true });
  }, [view]);
  function navigate(next: ScorecardView, selected = active) {
    if (!selected) return;
    positions.current.set(key(current.current), window.scrollY);
    if (next.kind === "card" && current.current.kind === "round") opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (selected !== active) setOpened(selected);
    window.history.pushState({ ...window.history.state, backyardScorecard: selected.id }, "", scorecardViewHref(window.location.search, selected.id, next, window.location.pathname));
    returning.current = false; current.current = next; setView(next);
  }
  function back() {
    if(initialOpen&&view.kind==='card'&&window.history.state?.backyardScorecard!==roundId){returnHandler.current?.();return;}
    if (window.history.state?.backyardScorecard === roundId) window.history.back();
    else { const next: ScorecardView = view.kind === "hole" ? { kind: "card" } : { kind: "round" }; returning.current = true; window.history.replaceState(window.history.state, "", scorecardViewHref(window.location.search, roundId, next, window.location.pathname)); current.current = next; setView(next); }
  }
  return <><div hidden={view.kind !== "round"}><RoundContent render={children} onOpen={selected => navigate({ kind: "card" }, selected ?? active)} /></div>
    {view.kind !== "round" && active && <div data-scorecard-origin={originLabel}>{props ? <PremiumScorecard {...props} originLabel={originLabel} view={view} onBack={back} onHole={(hole, playerId) => navigate({ kind: "hole", hole, playerId })} /> : <section className="premiumScorecard"><header className="premiumCardHeader"><button type="button" aria-label={`Volver a ${originLabel}`} onClick={back}>‹</button><h1>Resumen de ronda</h1><span className="premiumCardStatus">Solo lectura</span></header>{"summary" in active && active.summary}</section>}{navigation}</div>}
  </>;
}

/** Existing round callers retain the same API and the same capture permissions. */
export function ScorecardBoundary({ children, navigation, initialOpen = false, ...props }: PremiumScorecardProps & { children: (open: () => void) => ReactNode; navigation?: ReactNode; initialOpen?: boolean }) {
  return <ScorecardNavigationBoundary destination={{ id: props.roundId, card: props }} navigation={navigation} initialOpen={initialOpen}>{open => children(() => open())}</ScorecardNavigationBoundary>;
}

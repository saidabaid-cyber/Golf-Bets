"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { golfObjectFromSearch, golfObjectHref, restoreGolfObjectFrames, type GolfObject, type GolfObjectFrame } from "../../lib/golf-object-navigation";

export function useGolfObjectNavigation(identity: string) {
  const [frames, setFrames] = useState<GolfObjectFrame[]>([]);
  const current = useRef<GolfObjectFrame[]>([]), baseScroll = useRef(0), restoreScroll = useRef(0);
  const initialized = useRef(false);
  const apply = useCallback((next: GolfObjectFrame[], scroll: number) => {
    current.current = next; restoreScroll.current = scroll; setFrames(next);
  }, []);
  useEffect(() => {
    const read = () => {
      const object = golfObjectFromSearch(location.search);
      const next = restoreGolfObjectFrames(current.current, window.history.state?.backyardObjectKey || null, object);
      apply(next, next.at(-1)?.scroll ?? baseScroll.current);
    };
    initialized.current = true; read();
    window.addEventListener("popstate", read);
    return () => { window.removeEventListener("popstate", read); current.current = []; };
  }, [identity, apply]);
  const activeKey = frames.at(-1)?.key;
  useLayoutEffect(() => {
    if (!initialized.current) return;
    const scroll = restoreScroll.current;
    window.scrollTo({ top: scroll, behavior: "instant" });
    const frame = requestAnimationFrame(() => window.scrollTo({ top: scroll, behavior: "instant" }));
    if (activeKey) document.querySelector<HTMLElement>("[data-golf-object-active] h1")?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(frame);
  }, [activeKey]);
  const open = useCallback((object: GolfObject) => {
    const previous = current.current;
    if (previous.length) previous[previous.length - 1].scroll = window.scrollY; else baseScroll.current = window.scrollY;
    const key = crypto.randomUUID();
    window.history.pushState({ ...window.history.state, backyardObjectKey: key }, "", golfObjectHref(object, location.search));
    apply([...previous.slice(-11), { key, object, scroll: 0 }], 0);
  }, [apply]);
  const clear = useCallback(() => {
    window.history.replaceState({ ...window.history.state, backyardObjectKey: null }, "", golfObjectHref(null, location.search));
    apply([], 0);
  }, [apply]);
  const back = useCallback(() => {
    if (current.current.at(-1)?.key === "direct") {
      window.history.replaceState({ ...window.history.state, backyardObjectKey: null }, "", golfObjectHref(null, location.search));
      apply([], baseScroll.current);
    } else window.history.back();
  }, [apply]);
  return { frames, active: frames.at(-1)?.object ?? null, open, back, clear };
}
export type GolfNavigation = Pick<ReturnType<typeof useGolfObjectNavigation>, "open" | "back">;
export const GolfNavigationContext = createContext<GolfNavigation | null>(null);
export const useGolfNavigation = () => useContext(GolfNavigationContext);

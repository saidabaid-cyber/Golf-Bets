"use client";

import { useLayoutEffect, type RefObject } from "react";
import { resetViewScroll } from "../../lib/mobile-viewport";

/** Use a view/step identity, never form data: typing must not reset scroll.
 * Runs after the new screen commits, including Back, and cancels stale frames. */
export function useViewScrollReset(key: string | number | boolean | null, root?: RefObject<HTMLElement | null>, enabled = true) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const reset = () => resetViewScroll(root?.current);
    // The previous screen's keyboard must not scroll the new screen back down.
    if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
    reset();
    const frame = requestAnimationFrame(reset);
    return () => cancelAnimationFrame(frame);
  }, [key, root, enabled]);
}

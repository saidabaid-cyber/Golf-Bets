"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Small accessible-dialog behavior shared by equipment sheets: focus stays in
 * the open sheet, Escape closes it, scroll is locked, and focus is restored. */
export function useModalDialog(active: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      if (dialogRef.current) dialogRef.current.scrollTop = 0;
      const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first || dialogRef.current)?.focus({ preventScroll: true });
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => !element.hidden
          && element.getAttribute("aria-hidden") !== "true"
          && element.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = priorOverflow;
      if (priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
    };
  }, [active]);

  return dialogRef;
}

/** Keeps multi-step sheets at their own top without moving the page behind the
 * modal. The container receives focus without summoning the mobile keyboard. */
export function useWizardStepNavigation(dialogRef: RefObject<HTMLElement | null>, step: string) {
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.scrollTop = 0;
    dialog.focus({ preventScroll: true });
  }, [dialogRef, step]);
}

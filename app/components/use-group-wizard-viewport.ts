"use client";

import { useEffect, type RefObject } from "react";

/** Scoped to an open editor: Safari's keyboard must never recenter the sheet. */
export function useGroupWizardViewport(open: boolean, shell: RefObject<HTMLElement | null>, body: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const editor = shell.current;
    const scroller = body.current;
    if (!open || !editor || !scroller) return;
    const viewport = window.visualViewport;
    let frame = 0;
    let settled: ReturnType<typeof setTimeout>;
    const revealFocus = () => {
      const input = document.activeElement;
      if (!(input instanceof HTMLElement) || !scroller.contains(input)) return;
      const bounds = scroller.getBoundingClientRect();
      const field = input.getBoundingClientRect();
      // Scroll ONLY the body; scrollIntoView can also scroll Safari's document.
      if (field.bottom > bounds.bottom - 12) scroller.scrollTop += field.bottom - bounds.bottom + 12;
      else if (field.top < bounds.top + 12) scroller.scrollTop -= bounds.top - field.top + 12;
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (window.matchMedia("(max-width: 700px)").matches && viewport) {
          editor.style.setProperty("--group-visible-height", `${viewport.height}px`);
          editor.dataset.viewportMoving = "true";
          clearTimeout(settled);
          settled = setTimeout(() => { delete editor.dataset.viewportMoving; revealFocus(); }, 220);
        } else editor.style.removeProperty("--group-visible-height");
      });
    };
    const focus = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(revealFocus); };
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const controls = [...editor.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex='0']")].filter(control => control.getClientRects().length > 0);
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus({ preventScroll: true }); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus({ preventScroll: true }); }
    };
    const previousFocus = document.activeElement;
    editor.querySelector<HTMLButtonElement>(".modalCloseButton")?.focus({ preventScroll: true });
    update();
    viewport?.addEventListener("resize", update);
    scroller.addEventListener("focusin", focus);
    editor.addEventListener("keydown", trapFocus);
    return () => {
      viewport?.removeEventListener("resize", update);
      scroller.removeEventListener("focusin", focus);
      editor.removeEventListener("keydown", trapFocus);
      clearTimeout(settled); cancelAnimationFrame(frame);
      editor.style.removeProperty("--group-visible-height"); delete editor.dataset.viewportMoving;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, shell, body]);
}

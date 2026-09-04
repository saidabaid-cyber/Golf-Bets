"use client";

import { useState, type ReactNode } from "react";

type ResultAccordionProps = {
  id: string;
  title: string;
  children?: ReactNode;
  headerAction?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

export function ResultAccordion({
  id,
  title,
  children,
  headerAction,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className = "",
}: ResultAccordionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const contentId = `results-${id}`;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return <section id={`result-section-${id}`} data-result-section={id} className={`card resultAccordion ${className}`.trim()}>
    <h2 className="resultAccordionHeading">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        <span className="resultAccordionChevron" aria-hidden="true">{open ? "⌃" : "⌄"}</span>
      </button>
      {headerAction && <span className="resultAccordionHeaderAction">{headerAction}</span>}
    </h2>
    <div id={contentId} className="resultAccordionBody" hidden={!open}>{children}</div>
  </section>;
}

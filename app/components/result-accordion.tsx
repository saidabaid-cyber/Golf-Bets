"use client";

import { useState, type ReactNode } from "react";

type ResultAccordionProps = {
  id: string;
  title: string;
  children?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function ResultAccordion({ id, title, children, defaultOpen = false, className = "" }: ResultAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `results-${id}`;

  return <section className={`card resultAccordion ${className}`.trim()}>
    <h2 className="resultAccordionHeading">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{title}</span>
        <span className="resultAccordionChevron" aria-hidden="true">{open ? "⌃" : "⌄"}</span>
      </button>
    </h2>
    <div id={contentId} className="resultAccordionBody" hidden={!open}>{children}</div>
  </section>;
}

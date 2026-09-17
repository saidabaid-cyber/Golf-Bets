"use client";

import { useState, type ReactNode } from "react";
import { useWizardBetEditor } from "./round-wizard-context";

type ResultAccordionProps = {
  id: string;
  title: ReactNode;
  children?: ReactNode;
  headerAction?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  disclosureDisabled?: boolean;
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
  disclosureDisabled = false,
}: ResultAccordionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const wizard = useWizardBetEditor(id);
  const open = wizard ? wizard.selected === id && !disclosureDisabled : controlledOpen ?? uncontrolledOpen;
  const contentId = `results-${id}`;
  const setOpen = (next: boolean) => {
    if (wizard) wizard.select(next ? id : null);
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return <section hidden={wizard ? wizard.selected !== id : undefined} id={`result-section-${id}`} data-result-section={id} className={`card resultAccordion ${className}`.trim()}>
    <h2 className="resultAccordionHeading">
      <button
        type="button"
        aria-expanded={open}
        aria-disabled={disclosureDisabled}
        aria-controls={contentId}
        onClick={() => { if (!disclosureDisabled) setOpen(!open); }}
      >
        <span>{title}</span>
        <span className="resultAccordionChevron" aria-hidden="true">{open ? "⌃" : "⌄"}</span>
      </button>
      {headerAction && <span className="resultAccordionHeaderAction">{headerAction}</span>}
    </h2>
    <div id={contentId} className="resultAccordionBody" hidden={!open}>{children}</div>
  </section>;
}

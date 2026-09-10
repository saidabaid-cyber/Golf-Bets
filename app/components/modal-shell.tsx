"use client";

import { useEffect, type ReactNode } from "react";

export function ModalCloseButton({ onClose, disabled = false, label = "Cerrar" }: {
  onClose: () => void;
  disabled?: boolean;
  label?: string;
}) {
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [disabled, onClose]);
  return <button type="button" className="modalCloseButton" aria-label={label} title={label} disabled={disabled} onClick={onClose}>×</button>;
}

export function ModalShell({ open, onClose, label, labelledBy, describedBy, children, className = "confirmDialog", closeDisabled = false }: {
  open: boolean;
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  children: ReactNode;
  className?: string;
  closeDisabled?: boolean;
}) {
  if (!open) return null;
  return <div className="modalBackdrop" role="presentation"><section className={className} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy}>
    <ModalCloseButton onClose={onClose} disabled={closeDisabled} />
    {children}
  </section></div>;
}

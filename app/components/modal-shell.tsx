"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { isTopModal, registerModal } from "../../lib/mobile-viewport";

export function ModalCloseButton({ onClose, disabled = false, label = "Cerrar" }: {
  onClose: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  const disabledRef = useRef(disabled);
  useEffect(() => { closeRef.current = onClose; disabledRef.current = disabled; }, [onClose, disabled]);
  useEffect(() => {
    const dialog = buttonRef.current?.closest<HTMLElement>('[role="dialog"], [aria-modal="true"]') ?? buttonRef.current?.parentElement;
    if (!dialog) return;
    const release = registerModal(dialog);
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabledRef.current || event.defaultPrevented || event.key !== "Escape" || !isTopModal(dialog)) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { release(); document.removeEventListener("keydown", onKeyDown); };
  }, []);
  return <button ref={buttonRef} type="button" className="modalCloseButton" aria-label={label} title={label} disabled={disabled} onClick={onClose}>×</button>;
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

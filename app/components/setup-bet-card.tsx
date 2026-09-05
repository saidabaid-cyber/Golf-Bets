"use client";

import { useRef, useState, type ReactNode } from "react";
import { BetHelpButton, type BetKind } from "./supplemental-bets-editor";
import { ResultAccordion } from "./result-accordion";

export function SetupBetCard({ id, icon, title, description, help, enabled, locked = false, onEnabledChange, requestActivation, children }: {
  id: string;
  icon: string;
  title: string;
  description: string;
  help: BetKind;
  enabled: boolean;
  locked?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  requestActivation?: () => Promise<boolean>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const activationPending = useRef(false);
  const toggle = () => {
    if (enabled) { onEnabledChange(false); return; }
    setOpen(true);
    if (!requestActivation) { onEnabledChange(true); return; }
    if (activationPending.current) return;
    activationPending.current = true;
    void requestActivation().then((accepted) => { if (accepted) onEnabledChange(true); }).finally(() => { activationPending.current = false; });
  };
  return <ResultAccordion
    id={`setup-${id}`}
    title={<span className="setupModeTitle"><b>{icon} {title}</b><small>{description}</small></span>}
    open={open}
    onOpenChange={setOpen}
    className="setupBetsAccordion setupBetCard"
    headerAction={<span className="resultHeaderActions"><BetHelpButton kind={help} /><button type="button" className={`switch ${enabled ? "on" : ""}`} role="switch" aria-checked={enabled} aria-label={`${enabled ? "Desactivar" : "Activar"} ${title}`} onClick={(event) => { event.stopPropagation(); toggle(); }}><span /></button></span>}
  >{enabled && !locked ? children : <div className="empty">{enabled ? "Verificando el consentimiento guardado…" : "Activa la apuesta para configurar sus datos."}</div>}</ResultAccordion>;
}

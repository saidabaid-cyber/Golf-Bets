"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BET_PRESENTATION, type BetPresentationKey } from "../../lib/bet-catalog";
import { BetHelpButton, type BetKind } from "./supplemental-bets-editor";
import { ResultAccordion } from "./result-accordion";

const STANDARD_PRESENTATION_BY_HELP: Partial<Record<BetKind, BetPresentationKey>> = {
  rabbits: "rabbits",
  skins: "skins",
  units: "units",
  foursome: "foursome",
  ball_friend: "ball_friend",
  monkey: "monkey",
  mini_polla: "mini_polla",
};

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
  const presentationKey = STANDARD_PRESENTATION_BY_HELP[help];
  const presentation = presentationKey ? BET_PRESENTATION[presentationKey] : { icon, title };
  const [open, setOpen] = useState(false);
  const activationPending = useRef(false);
  const openAfterActivation = useRef(false);
  const switchRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!enabled) {
      openAfterActivation.current = false;
      setOpen(false);
      return;
    }
    if (openAfterActivation.current) {
      openAfterActivation.current = false;
      setOpen(true);
    }
  }, [enabled]);

  const activate = () => {
    openAfterActivation.current = true;
    setOpen(true);
    onEnabledChange(true);
    switchRef.current?.focus({ preventScroll: true });
  };
  const toggle = () => {
    if (locked) return;
    if (enabled) {
      openAfterActivation.current = false;
      setOpen(false);
      onEnabledChange(false);
      switchRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!requestActivation) { activate(); return; }
    if (activationPending.current) return;
    activationPending.current = true;
    void requestActivation().then((accepted) => {
      if (!accepted) return;
      activate();
    }).finally(() => { activationPending.current = false; });
  };
  return <ResultAccordion
    id={`setup-${id}`}
    title={<span className="setupModeTitle"><b>{presentation.icon} {presentation.title}</b><small>{description}</small></span>}
    open={enabled && open}
    onOpenChange={(next) => { if (enabled && !locked) setOpen(next); }}
    disclosureDisabled={!enabled || locked}
    className="setupBetsAccordion setupBetCard"
    headerAction={<span className="resultHeaderActions"><BetHelpButton kind={help} /><button ref={switchRef} type="button" className={`switch ${enabled ? "on" : ""}`} role="switch" aria-checked={enabled} aria-label={`${enabled ? "Desactivar" : "Activar"} ${presentation.title}`} title={locked ? "Completa el consentimiento específico desde Mi Cuenta" : undefined} disabled={locked} onClick={(event) => { event.stopPropagation(); toggle(); }}><span /></button></span>}
  >{enabled && !locked ? children : null}</ResultAccordion>;
}

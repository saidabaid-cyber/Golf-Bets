"use client";

import { createContext, useContext } from "react";

// Presentation only. Bet state and activation remain owned by the existing editors.
export const WizardBetEditorContext = createContext<{
  ids: readonly string[];
  selected: string | null;
  select: (id: string | null) => void;
} | null>(null);

export function useWizardBetEditor(id: string) {
  const catalog = useContext(WizardBetEditorContext);
  return catalog?.ids.includes(id) ? catalog : null;
}

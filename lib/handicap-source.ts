import { calculateBackyardIndex } from "./backyard-index";
import type { BackyardIndexPreference } from "./backyard-index-preferences";
import type { RoundSnapshot } from "./types";

export type SelectedHandicapIndex = { source: "BACKYARD" | "GHIN" | null; value: number | null };

/** Never promote legacy manual profile values or unverified Auth metadata into
 * an official Index. GHIN needs a future server-verified provider record. */
export function selectedHandicapIndex(preference: BackyardIndexPreference | null, history: readonly RoundSnapshot[], userId: string): SelectedHandicapIndex {
  if (!preference || preference.userId !== userId) return { source: null, value: null };
  if (preference.handicapSource === "GHIN") return { source: "GHIN", value: null };
  if (preference.enabled && (preference.handicapSource === undefined || preference.handicapSource === "BACKYARD")) {
    return { source: "BACKYARD", value: calculateBackyardIndex(history, userId).value };
  }
  return { source: null, value: null };
}

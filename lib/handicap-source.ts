import { calculateBackyardIndex } from "./backyard-index";
import type { BackyardIndexPreference } from "./backyard-index-preferences";
import type { RoundSnapshot } from "./types";
import type { GhinProfileProjection } from "./ghin/profile";

export type SelectedHandicapIndex = { source: "BACKYARD" | "GHIN" | null; value: number | null; resetAt?: string };

function usableIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -20 && value <= 54;
}

export function verifiedGhinHandicapIndex(profile: GhinProfileProjection | null | undefined): number | null {
  return profile?.associationStatus === "VERIFIED" && usableIndex(profile.handicapIndex)
    ? profile.handicapIndex
    : null;
}

/** Canonical account Index resolver shared by Profile, rounds and Ball Fit.
 * A verified GHIN association locks the active source until it is unlinked.
 * An explicit owner preference selects the source only while GHIN is unlinked.
 * An explicitly selected Backyard Index is calculated from frozen eligible-round evidence.
 * Legacy manual profile values, Auth metadata and unverified provider rows are
 * never promoted into an account Index. */
export function selectedHandicapIndex(preference: BackyardIndexPreference | null, history: readonly RoundSnapshot[], userId: string, ghinProfile: GhinProfileProjection | null = null): SelectedHandicapIndex {
  const ghinIndex = verifiedGhinHandicapIndex(ghinProfile);
  if (!userId || userId === "guest") return { source: null, value: null };
  if (ghinProfile?.associationStatus === "VERIFIED") return { source: "GHIN", value: ghinIndex };
  if (!preference) {
    return { source: null, value: null };
  }
  if (preference.userId !== userId) return { source: null, value: null };
  if (preference.handicapSource === "GHIN" && ghinIndex !== null) {
    return { source: "GHIN", value: ghinIndex };
  }
  if (preference.enabled && (preference.handicapSource === undefined || preference.handicapSource === "BACKYARD")) {
    const value = calculateBackyardIndex(history, userId, preference.resetAt).value;
    return { source: "BACKYARD", value: usableIndex(value) ? value : null, ...(preference.resetAt ? {resetAt:preference.resetAt} : {}) };
  }
  return { source: null, value: null };
}

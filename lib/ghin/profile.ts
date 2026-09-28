import type { NormalizedGhinScore } from "./core";

export type GhinProfileProjection = {
  ghinNumber: string;
  playerName: string;
  clubName: string | null;
  homeClubName: string | null;
  handicapIndex: number | null;
  status: string | null;
  revisionDate: string | null;
  lastSyncedAt: string;
  lastAttemptedAt: string;
  syncStatus: string;
  lastErrorCode: string | null;
  associationStatus: "LOOKUP_FOUND" | "SELF_ATTESTED" | "VERIFIED" | "DISCONNECTED";
};

export type GhinProfileResponse = {
  available: true;
  linkState: "GHIN_LINKED" | "GHIN_NOT_LINKED";
  profile: GhinProfileProjection | null;
};

export type GhinScoresResponse = {
  available: true;
  count: number;
  fetchedAt: string;
  httpStatus: number;
  items: NormalizedGhinScore[];
  truncated: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableText(value: unknown) {
  return value === null || (typeof value === "string" && value.length > 0) ? value as string | null : undefined;
}

export function parseGhinProfileResponse(value: unknown): GhinProfileResponse | null {
  const root = record(value);
  if (!root || root.available !== true) return null;
  if (root.profile === null) {
    return root.linkState === "GHIN_NOT_LINKED"
      ? { available: true, linkState: "GHIN_NOT_LINKED", profile: null }
      : null;
  }
  if (root.linkState !== "GHIN_LINKED") return null;
  const profile = record(root.profile);
  if (!profile
    || typeof profile.ghinNumber !== "string"
    || !/^\d{5,12}$/.test(profile.ghinNumber)
    || typeof profile.playerName !== "string"
    || typeof profile.lastSyncedAt !== "string"
    || typeof profile.lastAttemptedAt !== "string"
    || typeof profile.syncStatus !== "string"
    || !["LOOKUP_FOUND", "SELF_ATTESTED", "VERIFIED", "DISCONNECTED"].includes(String(profile.associationStatus))) return null;
  const clubName = nullableText(profile.clubName);
  const homeClubName = nullableText(profile.homeClubName);
  const status = nullableText(profile.status);
  const revisionDate = nullableText(profile.revisionDate);
  const lastErrorCode = nullableText(profile.lastErrorCode);
  const handicapIndex = profile.handicapIndex === null
    ? null
    : typeof profile.handicapIndex === "number" && Number.isFinite(profile.handicapIndex)
      ? profile.handicapIndex
      : undefined;
  if (clubName === undefined || homeClubName === undefined || status === undefined
    || revisionDate === undefined || lastErrorCode === undefined || handicapIndex === undefined) return null;
  return {
    available: true,
    linkState: "GHIN_LINKED",
    profile: {
      ghinNumber: profile.ghinNumber,
      playerName: profile.playerName,
      clubName,
      homeClubName,
      handicapIndex,
      status,
      revisionDate,
      lastSyncedAt: profile.lastSyncedAt,
      lastAttemptedAt: profile.lastAttemptedAt,
      syncStatus: profile.syncStatus,
      lastErrorCode,
      associationStatus: profile.associationStatus as GhinProfileProjection["associationStatus"],
    },
  };
}

import type { GhinErrorCode, NormalizedGhinGolfer } from "./core";
import type { GhinProfileProjection } from "./profile";

export type GhinProviderProfileRow = {
  external_player_id: string;
  association_status: GhinProfileProjection["associationStatus"];
  provider_player_name: string;
  provider_club_name: string | null;
  provider_home_club_name: string | null;
  provider_player_status: string | null;
  handicap_index: number | null;
  handicap_effective_at: string | null;
  provider_updated_at: string | null;
  last_successful_sync_at: string;
  last_attempted_sync_at: string;
  last_attempt_status: string;
  last_error_code: string | null;
};

function instantOrNull(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function providerRowToProfile(row: GhinProviderProfileRow): GhinProfileProjection {
  return {
    ghinNumber: row.external_player_id,
    playerName: row.provider_player_name,
    clubName: row.provider_club_name,
    homeClubName: row.provider_home_club_name ?? row.provider_club_name,
    handicapIndex: row.handicap_index,
    status: row.provider_player_status,
    revisionDate: row.provider_updated_at ?? row.handicap_effective_at,
    lastSyncedAt: row.last_successful_sync_at,
    lastAttemptedAt: row.last_attempted_sync_at,
    syncStatus: row.last_attempt_status,
    lastErrorCode: row.last_error_code,
    associationStatus: row.association_status,
  };
}

export function verifiedProviderWrite(ownerId: string, golfer: NormalizedGhinGolfer, attemptedAt: string) {
  const revision = instantOrNull(golfer.updatedAt);
  return {
    owner_id: ownerId,
    provider: "GHIN",
    external_player_id: golfer.ghinNumber,
    association_status: "VERIFIED",
    self_attested_at: attemptedAt,
    provider_player_name: golfer.name,
    provider_club_name: golfer.clubName ?? golfer.homeClubName,
    provider_home_club_name: golfer.homeClubName ?? golfer.clubName,
    provider_association_name: golfer.associationName,
    provider_player_status: golfer.rawStatus ?? golfer.status,
    handicap_index: golfer.handicapIndex,
    handicap_effective_at: revision,
    provider_updated_at: revision,
    last_successful_sync_at: attemptedAt,
    last_attempted_sync_at: attemptedAt,
    last_attempt_status: "SUCCESS",
    last_error_code: null,
  } as const;
}

export function failedAttemptStatus(code: GhinErrorCode) {
  switch (code) {
    case "not_found": return "NOT_FOUND";
    case "inactive_golfer": return "INACTIVE";
    case "rate_limited": return "RATE_LIMITED";
    case "invalid_credentials":
    case "unauthorized":
    case "forbidden": return "AUTH_FAILED";
    case "invalid_response": return "INVALID_RESPONSE";
    case "timeout": return "TIMEOUT";
    default: return "UNAVAILABLE";
  }
}

import { safeProfileAvatarValue, type BackyardProfile } from "./account-state";
import { validateProfileLocation } from "./profile-geography";

type OAuthMetadata = Record<string, unknown>;

const AUTH_GOLF_PROFILE_KEYS = ["handedness", "homeClub", "homeClubId", "homeCourse", "homeCourseId", "preferredTee"] as const;

function metadataText(metadata: OAuthMetadata, key: string) {
  return typeof metadata[key] === "string" ? metadata[key].trim() : "";
}

function isEmailLike(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Extracts identity claims supplied by an OAuth provider without ever
 * promoting an email address to the golfer's visible name. */
export function oauthIdentityFromMetadata(metadataValue: unknown, emailValue: unknown) {
  const metadata = metadataValue && typeof metadataValue === "object" && !Array.isArray(metadataValue)
    ? metadataValue as OAuthMetadata
    : {};
  const email = typeof emailValue === "string" ? emailValue.trim() : "";
  const givenName = metadataText(metadata, "given_name");
  const familyName = metadataText(metadata, "family_name");
  const combinedName = [givenName, familyName].filter(Boolean).join(" ");
  const displayName = [metadataText(metadata, "full_name"), metadataText(metadata, "name"), combinedName]
    .find((candidate) => candidate && candidate.toLocaleLowerCase("en-US") !== email.toLocaleLowerCase("en-US") && !isEmailLike(candidate)) || "";
  const avatarUrl = safeProfileAvatarValue(metadataText(metadata, "avatar_url") || metadataText(metadata, "picture"));
  return { email, displayName, givenName, familyName, avatarUrl };
}

/** Auth metadata is the durable fallback for owner-only golf fields that are
 * not yet projected by the canonical profile row. Property presence matters:
 * an explicit empty value clears a prior local cache, while an absent claim
 * must not erase data restored from that account's workspace. */
export function ownerProfileClaimsFromAuth(metadataValue: unknown) {
  const metadata = metadataValue && typeof metadataValue === "object" && !Array.isArray(metadataValue)
    ? metadataValue as OAuthMetadata
    : {};
  const claims: Record<string, string> = {};
  if (Object.hasOwn(metadata, "given_name")) claims.givenName = metadataText(metadata, "given_name");
  if (Object.hasOwn(metadata, "family_name")) claims.familyName = metadataText(metadata, "family_name");
  const golfValue = metadata.backyard_golf_profile_v1;
  const golf = golfValue && typeof golfValue === "object" && !Array.isArray(golfValue)
    ? golfValue as OAuthMetadata
    : null;
  if (!golf) return claims;
  for (const key of AUTH_GOLF_PROFILE_KEYS) {
    if (!Object.hasOwn(golf, key)) continue;
    const value = metadataText(golf, key);
    if (key === "handedness") claims[key] = ["right", "left", "ambidextrous"].includes(value) ? value : "";
    else claims[key] = value;
  }
  return claims;
}

export type InitialProfileField = "displayName" | "location" | "handedness";

/** Only these owner-profile facts block the golf onboarding hand-off. Avatar
 * and city remain optional and OAuth facts already present are never recaptured. */
export function missingInitialProfileFields(profile: Pick<BackyardProfile, "displayName" | "country" | "countryCode" | "state" | "stateCode" | "handedness">) {
  const missing: InitialProfileField[] = [];
  if (!profile.displayName.trim() || isEmailLike(profile.displayName.trim())) missing.push("displayName");
  if (!validateProfileLocation(profile, { countryRequired: true, stateRequired: true }).valid) missing.push("location");
  if (!profile.handedness) missing.push("handedness");
  return missing;
}

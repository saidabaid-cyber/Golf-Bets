import { safeProfileAvatarValue, type BackyardProfile } from "./account-state";
import { validateProfileLocation } from "./profile-geography";

type OAuthMetadata = Record<string, unknown>;

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

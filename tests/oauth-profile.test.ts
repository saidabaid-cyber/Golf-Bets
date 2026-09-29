import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { missingInitialProfileFields, oauthIdentityFromMetadata, ownerProfileClaimsFromAuth } from "../lib/oauth-profile";

test("OAuth identity prefers full_name and preserves Google avatar_url", () => {
  assert.deepEqual(oauthIdentityFromMetadata({ full_name: "Said Abaid", name: "Ignored", given_name: "Said", family_name: "Abaid", avatar_url: "https://images.example/said.jpg", picture: "https://images.example/fallback.jpg" }, "contacto@thebackyard.com.mx"), {
    email: "contacto@thebackyard.com.mx",
    displayName: "Said Abaid",
    givenName: "Said",
    familyName: "Abaid",
    avatarUrl: "https://images.example/said.jpg",
  });
});

test("OAuth identity falls back to given_name plus family_name and picture", () => {
  const identity = oauthIdentityFromMetadata({ given_name: "Ada", family_name: "Lovelace", picture: "https://images.example/ada.png" }, "ada@example.com");
  assert.equal(identity.displayName, "Ada Lovelace");
  assert.equal(identity.avatarUrl, "https://images.example/ada.png");
});

test("email is never promoted to displayName", () => {
  assert.equal(oauthIdentityFromMetadata({ full_name: "golfer@example.com", name: "golfer@example.com" }, "golfer@example.com").displayName, "");
});

test("durable owner claims override stale profile cache only when Auth supplied them", () => {
  assert.deepEqual(ownerProfileClaimsFromAuth({
    given_name: "QA",
    family_name: "Preview",
    backyard_golf_profile_v1: {
      handedness: "right",
      homeClub: "",
      preferredTee: "Azules",
    },
  }), {
    givenName: "QA",
    familyName: "Preview",
    handedness: "right",
    homeClub: "",
    preferredTee: "Azules",
  });
  assert.deepEqual(ownerProfileClaimsFromAuth({ backyard_golf_profile_v1: { handedness: "invalid", homeClubId: 42 } }), {
    handedness: "",
    homeClubId: "",
  });
  assert.deepEqual(ownerProfileClaimsFromAuth({ full_name: "No owner claims" }), {});
});

test("profile setup tracks supplemental golf facts independently from personal review", () => {
  const complete = { displayName: "Said Abaid", country: "México", countryCode: "MX", state: "Puebla", stateCode: "MX-PUE", handedness: "right" as const };
  assert.deepEqual(missingInitialProfileFields(complete), []);
  assert.deepEqual(missingInitialProfileFields({ ...complete, displayName: "" }), ["displayName"]);
  assert.deepEqual(missingInitialProfileFields({ ...complete, country: "", countryCode: "", state: "", stateCode: "" }), ["location"]);
  assert.deepEqual(missingInitialProfileFields({ ...complete, handedness: "" }), ["handedness"]);
});

test("new Google/email accounts always review editable personal fields while existing accounts resume", () => {
  const source = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.doesNotMatch(source, /identityAlreadyNamed|Continuando tu alta/);
  assert.match(source, /id="profile-setup-given"/);
  assert.match(source, /id="profile-setup-family"/);
  assert.match(source, /<ProfileImagePicker value=\{avatarUrl\}/);
  assert.match(source, /const displayName = \[givenName\.trim\(\), familyName\.trim\(\)\]/);
  assert.match(source, /!givenName\.trim\(\) \|\| !familyName\.trim\(\)/);
  assert.match(source, /missing\.includes\("location"\)/);
  assert.match(source, /missing\.includes\("handedness"\)/);
  assert.match(source, /if \(mapping\.existingAccount\)[\s\S]*setProfileSetupRequired\(false\)/);
  assert.match(source, /setBetaOnboardingRequired\(mapping\.onboardingProgress\?\.status === "in_progress"\)/);
});

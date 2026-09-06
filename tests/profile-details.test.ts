import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_STORAGE_KEYS,
  emptyBackyardProfileDetails,
  mergeBackyardProfile,
  normalizeBackyardProfileCache,
  readOfflineAuthenticatedProfile,
  type BackyardProfile,
} from "../lib/account-state";

const baseProfile: BackyardProfile = {
  userId: "account-1",
  displayName: "Said",
  email: "said@example.test",
  avatarUrl: "",
  defaultHandicap: 8.4,
  ...emptyBackyardProfileDetails(),
};

test("perfil legacy recibe detalles vacíos sin perder identidad ni HCP", () => {
  const restored = normalizeBackyardProfileCache({ displayName: "  Said A.  ", defaultHandicap: 7.2 }, baseProfile);
  assert.equal(restored.displayName, "Said A.");
  assert.equal(restored.defaultHandicap, 7.2);
  assert.equal(restored.username, "");
  assert.equal(restored.profileVisibility, "private");
});

test("edición ampliada conserva campos, normaliza usuario y no cambia email", () => {
  const edited = mergeBackyardProfile(baseProfile, {
    displayName: "  Said Abaid  ",
    defaultHandicap: -1.2,
    avatarUrl: "",
    givenName: " Said ",
    familyName: " Abaid ",
    username: "@@said.golf",
    city: " Puebla ",
    state: " Puebla ",
    country: " México ",
    homeClub: " La Vista ",
    preferredTee: " Azules ",
    handedness: "right",
    bio: " Golf de fin de semana. ",
    profileVisibility: "friends",
  });
  assert.equal(edited.displayName, "Said Abaid");
  assert.equal(edited.email, baseProfile.email);
  assert.equal(edited.defaultHandicap, -1.2);
  assert.equal(edited.username, "said.golf");
  assert.equal(edited.homeClub, "La Vista");
  assert.equal(edited.profileVisibility, "friends");
});

test("perfil offline autenticado recupera detalles locales y no inventa los ausentes", () => {
  const values = new Map<string, string>([
    [ACCOUNT_STORAGE_KEYS.mode, "authenticated"],
    ["backyard-profile-cache-v1:account-1", JSON.stringify({
      displayName: "Said",
      email: "said@example.test",
      defaultHandicap: 5,
      username: "said",
      city: "Puebla",
      profileVisibility: "friends",
    })],
  ]);
  const profile = readOfflineAuthenticatedProfile({ getItem: (key) => values.get(key) ?? null }, "account-1");
  assert.equal(profile?.username, "said");
  assert.equal(profile?.city, "Puebla");
  assert.equal(profile?.homeClub, "");
  assert.equal(profile?.profileVisibility, "friends");
});

test("datos ampliados inválidos vuelven a defaults seguros", () => {
  const restored = normalizeBackyardProfileCache({ handedness: "upside-down", profileVisibility: "public", bio: 99 }, baseProfile);
  assert.equal(restored.handedness, "");
  assert.equal(restored.profileVisibility, "private");
  assert.equal(restored.bio, "");
});

test("Sin indicar elimina una mano guardada previamente", () => {
  const withHandedness = { ...baseProfile, handedness: "right" as const };
  const cleared = mergeBackyardProfile(withHandedness, {
    displayName: withHandedness.displayName,
    defaultHandicap: withHandedness.defaultHandicap,
    avatarUrl: withHandedness.avatarUrl,
    handedness: "",
  });
  assert.equal(cleared.handedness, "");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_STORAGE_KEYS,
  emptyBackyardProfileDetails,
  mergeBackyardProfile,
  normalizeBackyardProfileCache,
  readOfflineAuthenticatedProfile,
  validateProfileAvatarUrl,
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
    homeClubId: " club-la-vista ",
    preferredTee: " Azules ",
    handedness: "right",
    typicalScore: 82,
    driverDistanceYards: 245,
    driverSwingSpeedBand: "FROM_95_TO_105",
    usualTrajectory: "MID",
    shotTendency: "FADE",
    greenSpeed: "FAST",
    gamePriority: "CONTROL",
    priceImportance: "MID",
    golfProfileUpdatedAt: "2026-09-06T20:00:00.000Z",
    bio: " Golf de fin de semana. ",
    profileVisibility: "friends",
  });
  assert.equal(edited.displayName, "Said Abaid");
  assert.equal(edited.email, baseProfile.email);
  assert.equal(edited.defaultHandicap, -1.2);
  assert.equal(edited.username, "said.golf");
  assert.equal(edited.homeClub, "La Vista");
  assert.equal(edited.homeClubId, "club-la-vista");
  assert.equal(edited.typicalScore, 82);
  assert.equal(edited.driverDistanceYards, 245);
  assert.equal(edited.driverSwingSpeedBand, "FROM_95_TO_105");
  assert.equal(edited.usualTrajectory, "MID");
  assert.equal(edited.shotTendency, "FADE");
  assert.equal(edited.greenSpeed, "FAST");
  assert.equal(edited.gamePriority, "CONTROL");
  assert.equal(edited.priceImportance, "MID");
  assert.equal(edited.golfProfileUpdatedAt, "2026-09-06T20:00:00.000Z");
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
  const restored = normalizeBackyardProfileCache({
    handedness: "upside-down",
    profileVisibility: "public",
    bio: 99,
    typicalScore: 12,
    driverDistanceYards: 2_000,
    driverSwingSpeedBand: "PRO",
    usualTrajectory: "MOON",
    shotTendency: "KNUCKLE",
    greenSpeed: "GLASS",
    gamePriority: "ADS",
    priceImportance: "FREE",
    golfProfileUpdatedAt: "not-a-date",
  }, baseProfile);
  assert.equal(restored.handedness, "");
  assert.equal(restored.profileVisibility, "private");
  assert.equal(restored.bio, "");
  assert.equal(restored.typicalScore, null);
  assert.equal(restored.driverDistanceYards, null);
  assert.equal(restored.driverSwingSpeedBand, "");
  assert.equal(restored.usualTrajectory, "");
  assert.equal(restored.shotTendency, "");
  assert.equal(restored.greenSpeed, "");
  assert.equal(restored.gamePriority, "");
  assert.equal(restored.priceImportance, "");
  assert.equal(restored.golfProfileUpdatedAt, null);
});

test("Mi juego permite borrar datos opcionales sin duplicar HCP ni mano", () => {
  const populated = mergeBackyardProfile(baseProfile, {
    displayName: baseProfile.displayName,
    defaultHandicap: 4.3,
    avatarUrl: baseProfile.avatarUrl,
    handedness: "left",
    typicalScore: 78,
    driverDistanceYards: 260,
    usualTrajectory: "HIGH",
  });
  const cleared = mergeBackyardProfile(populated, {
    displayName: populated.displayName,
    defaultHandicap: populated.defaultHandicap,
    avatarUrl: populated.avatarUrl,
    handedness: "",
    typicalScore: null,
    driverDistanceYards: null,
    usualTrajectory: "",
  });
  assert.equal(cleared.defaultHandicap, 4.3);
  assert.equal(cleared.handedness, "");
  assert.equal(cleared.typicalScore, null);
  assert.equal(cleared.driverDistanceYards, null);
  assert.equal(cleared.usualTrajectory, "");
  assert.equal("handicap" in cleared, false);
  assert.equal("playingHand" in cleared, false);
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

test("avatar de perfil acepta foto preparada, preset interno o HTTPS legacy sin credenciales", () => {
  assert.deepEqual(validateProfileAvatarUrl("   "), { ok: true, avatarUrl: "" });
  assert.deepEqual(validateProfileAvatarUrl("  https://images.example.test/me.webp  "), { ok: true, avatarUrl: "https://images.example.test/me.webp" });
  assert.deepEqual(validateProfileAvatarUrl("/avatars/golf-ball.svg"), { ok: true, avatarUrl: "/avatars/golf-ball.svg" });
  assert.deepEqual(validateProfileAvatarUrl("data:image/png;base64,aGVsbG8="), { ok: true, avatarUrl: "data:image/png;base64,aGVsbG8=" });
  assert.deepEqual(validateProfileAvatarUrl("🐺"), { ok: true, avatarUrl: "🐺" });
  for (const invalid of [
    "http://images.example.test/me.webp",
    "data:image/png;base64,abc",
    "javascript:alert(1)",
    "https://user:secret@images.example.test/me.webp",
    "not-a-url",
    `https://images.example.test/${"a".repeat(2050)}`,
  ]) {
    const result = validateProfileAvatarUrl(invalid);
    assert.equal(result.ok, false, invalid);
    if (!result.ok) assert.match(result.message, /foto o avatar válido/);
  }
});

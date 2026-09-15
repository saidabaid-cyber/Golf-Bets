import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";

import {
  ACCOUNT_STORAGE_KEYS,
  mergeBackyardProfile,
  normalizeBackyardProfileCache,
  readOfflineAuthenticatedProfile,
  safeProfileAvatarValue,
  validateProfileAvatarUrl,
  type BackyardProfile,
} from "../lib/account-state";
import { ensureCloudProfile, saveCloudProfile } from "../lib/cloud-account";
import {
  isProfileEmojiAvatar,
  normalizeProfileEmojiAvatar,
  profileAvatarGraphemes,
  profileAvatarType,
} from "../lib/profile-avatar";
import { CloudDb } from "./helpers/cloud-db";

const userId = "avatar-user";
const oauthAvatar = "https://oauth.example.test/avatar.webp";
const first = "2026-09-15T10:00:00.000Z";
const second = "2026-09-15T11:00:00.000Z";
const third = "2026-09-15T12:00:00.000Z";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

function baseProfile(avatarUrl = oauthAvatar): BackyardProfile {
  return { userId, displayName: "Said", email: "said@example.test", defaultHandicap: 7, avatarUrl };
}

function photoAvatar() {
  const canvas = createCanvas(16, 16);
  const context = canvas.getContext("2d");
  context.fillStyle = "#195e43";
  context.fillRect(0, 0, 16, 16);
  return canvas.toDataURL("image/png");
}

function saveCache(storage: MemoryStorage, profile: BackyardProfile) {
  storage.setItem(`backyard-profile-cache-v1:${userId}`, JSON.stringify(profile));
}

test("un emoji Unicode completo, con VS16, tono y ZWJ, es un avatar; dos o texto no lo son", () => {
  const valid = ["😎", "🏌️", "🏌🏽‍♂️", "🏌🏻‍♀️", "👩🏽‍💻", "👍🏽"];
  for (const emoji of valid) {
    assert.deepEqual(profileAvatarGraphemes(emoji), [emoji]);
    assert.equal(normalizeProfileEmojiAvatar(emoji), emoji);
    assert.equal(isProfileEmojiAvatar(emoji), true);
    assert.equal(profileAvatarType(emoji), "emoji");
    assert.deepEqual(validateProfileAvatarUrl(emoji), { ok: true, avatarUrl: emoji });
  }
  for (const invalid of ["Said", "Said 😎", "😎 Said", "😎🏌️", "🏌️🏌️", "😎 👩🏽‍💻", "😎‍🏌️"]) {
    assert.equal(normalizeProfileEmojiAvatar(invalid), null, invalid);
    assert.equal(isProfileEmojiAvatar(invalid), false, invalid);
    assert.equal(validateProfileAvatarUrl(invalid).ok, false, invalid);
  }
  assert.equal(normalizeProfileEmojiAvatar(123), null);
  assert.equal(normalizeProfileEmojiAvatar("😎".repeat(40)), null);
  assert.equal(profileAvatarType(""), "none");
});

test("merge rechaza texto/secuencias múltiples sin alterar el avatar anterior", () => {
  const original = baseProfile("🏌🏽‍♂️");
  for (const invalid of ["Said 😎", "😎🏌️", "🏌️🏌️"]) {
    assert.throws(() => mergeBackyardProfile(original, { displayName: "Said", defaultHandicap: 7, avatarUrl: invalid }), /avatar válido|foto o avatar válido/i);
    assert.equal(original.avatarUrl, "🏌🏽‍♂️");
  }
});

test("validación emoji con ZWJ funciona sin Intl.Segmenter", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
  try {
    Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
    assert.equal(normalizeProfileEmojiAvatar("🏌🏽‍♂️"), "🏌🏽‍♂️");
    assert.equal(normalizeProfileEmojiAvatar("🏌🏽‍♂️😎"), null);
  } finally {
    if (descriptor) Object.defineProperty(Intl, "Segmenter", descriptor);
    else Reflect.deleteProperty(Intl, "Segmenter");
  }
});

test("cache autenticado recarga emoji → foto real → sin imagen; OAuth no revive", () => {
  const storage = new MemoryStorage();
  storage.setItem(ACCOUNT_STORAGE_KEYS.mode, "authenticated");
  const photo = photoAvatar();
  assert.equal(validateProfileAvatarUrl(photo).ok, true);

  let profile = mergeBackyardProfile(baseProfile(), { displayName: "Said", defaultHandicap: 7, avatarUrl: "🏌🏽‍♂️" });
  saveCache(storage, profile);
  profile = readOfflineAuthenticatedProfile(storage, userId)!;
  assert.equal(profile.avatarUrl, "🏌🏽‍♂️");
  assert.equal(normalizeBackyardProfileCache(JSON.parse(storage.getItem(`backyard-profile-cache-v1:${userId}`)!), baseProfile()).avatarUrl, "🏌🏽‍♂️");

  profile = mergeBackyardProfile(profile, { displayName: "Said", defaultHandicap: 7, avatarUrl: photo });
  saveCache(storage, profile);
  profile = readOfflineAuthenticatedProfile(storage, userId)!;
  assert.equal(profile.avatarUrl, photo);
  assert.equal(profileAvatarType(profile.avatarUrl), "photo");

  profile = mergeBackyardProfile(profile, { displayName: "Said", defaultHandicap: 7, avatarUrl: "" });
  saveCache(storage, profile);
  profile = readOfflineAuthenticatedProfile(storage, userId)!;
  assert.equal(profile.avatarUrl, "");
  assert.equal(profileAvatarType(profile.avatarUrl), "none");
  assert.equal(safeProfileAvatarValue("", oauthAvatar), "");
  assert.equal(normalizeBackyardProfileCache(JSON.parse(storage.getItem(`backyard-profile-cache-v1:${userId}`)!), baseProfile()).avatarUrl, "");
  assert.equal(normalizeBackyardProfileCache({ avatarUrl: "" }, baseProfile()).avatarUrl, "");
});

test("avatar inválido en cache usa fallback seguro, pero vaciar explícitamente nunca lo usa", () => {
  const fallback = baseProfile();
  assert.equal(normalizeBackyardProfileCache({ avatarUrl: "Said 😎" }, fallback).avatarUrl, oauthAvatar);
  assert.equal(normalizeBackyardProfileCache({ avatarUrl: "" }, fallback).avatarUrl, "");
  assert.equal(safeProfileAvatarValue("", oauthAvatar), "");
  assert.equal(safeProfileAvatarValue("😎🏌️", oauthAvatar), oauthAvatar);
});

test("cache de avatar no fabrica sesión ni cruza identidad", () => {
  const storage = new MemoryStorage();
  saveCache(storage, baseProfile("😎"));
  assert.equal(readOfflineAuthenticatedProfile(storage, userId), null);
  storage.setItem(ACCOUNT_STORAGE_KEYS.mode, "authenticated");
  assert.equal(readOfflineAuthenticatedProfile(storage, "otro-usuario"), null);
  assert.equal(readOfflineAuthenticatedProfile(storage, "guest"), null);
  assert.equal(readOfflineAuthenticatedProfile(storage, userId)?.avatarUrl, "😎");
});

test("cloud confirma emoji → foto → none; hydration no resucita avatar OAuth", async () => {
  const db = new CloudDb();
  const photo = photoAvatar();
  for (const [avatarUrl, updatedAt] of [["😎", first], [photo, second], ["", third]] as const) {
    await saveCloudProfile(db.client, userId, { displayName: "Said", defaultHandicap: 7, avatarUrl }, updatedAt);
    assert.equal(db.rows("profiles")[0].avatar_url, avatarUrl);
    const restored = await ensureCloudProfile(db.client, userId, baseProfile());
    assert.equal(restored.avatar_url, avatarUrl);
    assert.equal(safeProfileAvatarValue(restored.avatar_url, oauthAvatar), avatarUrl);
  }
  assert.equal(db.rows("profiles").length, 1);
  assert.equal(db.calls.filter((call) => call.table === "profiles" && call.op === "insert").length, 1);
});

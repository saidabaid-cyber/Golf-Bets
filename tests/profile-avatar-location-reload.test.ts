import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCanvas } from "@napi-rs/canvas";

import { safeProfileAvatarValue } from "../lib/account-state";
import { ensureCloudProfile, saveCloudProfile } from "../lib/cloud-account";
import { readProfileLocationMetadata } from "../lib/profile-location-sync";
import { profileAvatarType } from "../lib/profile-avatar";
import { acknowledgePendingProfileWrite, queuePendingProfileWrite, readPendingProfileWrite } from "../lib/profile-sync";
import { CloudDb } from "./helpers/cloud-db";

const ownerId = "avatar-location-owner";
const oauthAvatar = "https://oauth.example.test/avatar.webp";
const puebla = { countryCode: "MX", country: "México", stateCode: "MX-PUE", state: "Puebla" };

function isolatedCloud(options: { failLocationWrite?: boolean } = {}) {
  const db = new CloudDb();
  let metadata: Record<string, unknown> = { picture: oauthAvatar };
  const authWrites: Record<string, unknown>[] = [];
  const client = {
    from: (table: string) => db.client.from(table),
    auth: {
      getUser: async () => ({ error: null, data: { user: { id: ownerId, user_metadata: metadata } } }),
      updateUser: async (attributes: { data: Record<string, unknown> }) => {
        authWrites.push(attributes.data);
        if (options.failLocationWrite) return { error: new Error("isolated Auth unavailable"), data: { user: null } };
        metadata = { ...metadata, ...attributes.data };
        return { error: null, data: { user: { id: ownerId, user_metadata: metadata } } };
      },
    },
  } as unknown as SupabaseClient;
  return { client, db, authWrites, metadata: () => metadata };
}

function localQueue() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function validPhoto() {
  const canvas = createCanvas(16, 16);
  const context = canvas.getContext("2d");
  context.fillStyle = "#195e43";
  context.fillRect(0, 0, 16, 16);
  return canvas.toDataURL("image/png");
}

test("un cloud aislado recarga avatar canónico y ubicación privada sin reactivar OAuth", async () => {
  const { client, db, authWrites, metadata } = isolatedCloud();
  const local = localQueue();
  const photo = validPhoto();
  const edits = [
    { avatarUrl: "🏌🏽‍♂️", updatedAt: "2026-09-15T10:00:00.000Z", location: puebla },
    { avatarUrl: photo, updatedAt: "2026-09-15T11:00:00.000Z" },
    { avatarUrl: "", updatedAt: "2026-09-15T12:00:00.000Z" },
  ] as const;

  for (const edit of edits) {
    const pending = queuePendingProfileWrite(local, ownerId, {
      displayName: "Said", defaultHandicap: 7, avatarUrl: edit.avatarUrl,
      ...( "location" in edit ? { location: edit.location } : {}),
    }, edit.updatedAt);
    const saved = await saveCloudProfile(client, ownerId, pending.profile, pending.updatedAt);
    assert.equal(saved.updatedAt, pending.updatedAt);
    assert.equal(acknowledgePendingProfileWrite(local, ownerId, pending.revision), true);

    // Emulate a second browser with no local profile cache: read the same
    // confirmed PostgREST row and owner-verified Auth metadata anew.
    const cloud = await ensureCloudProfile(client, ownerId, { displayName: "", defaultHandicap: null, avatarUrl: oauthAvatar });
    const location = await readProfileLocationMetadata(client, ownerId);
    assert.equal(safeProfileAvatarValue(cloud.avatar_url, oauthAvatar), edit.avatarUrl);
    assert.deepEqual(location && { countryCode: location.countryCode, country: location.country, stateCode: location.stateCode, state: location.state }, puebla);
    assert.equal(readPendingProfileWrite(local, ownerId), null);
  }

  assert.equal(db.rows("profiles").length, 1);
  assert.equal(db.rows("profiles")[0].avatar_url, "");
  assert.equal(authWrites.length, 1, "avatar-only edits do not rewrite geography metadata");
  assert.doesNotMatch(JSON.stringify(metadata()), /data:image|🏌🏽‍♂️/);
});

test("Auth rechaza ubicación: el cloud core no se escribe y la cola sigue disponible para reintento", async () => {
  const { client, db } = isolatedCloud({ failLocationWrite: true });
  const local = localQueue();
  const pending = queuePendingProfileWrite(local, ownerId, {
    displayName: "Said", defaultHandicap: 7, avatarUrl: "🐺", location: puebla,
  }, "2026-09-15T10:00:00.000Z");
  await assert.rejects(() => saveCloudProfile(client, ownerId, pending.profile, pending.updatedAt), /isolated Auth unavailable/);
  assert.equal(readPendingProfileWrite(local, ownerId)?.revision, pending.revision);
  assert.equal(db.rows("profiles").length, 0);
  assert.equal(db.rows("user_preferences").length, 0);
});

test("avatar generado conserva su tipo, pero no abre creación automáticamente al recargar", () => {
  const generatedUrl = "https://mock-avatar-storage.invalid/storage/v1/object/public/mock-avatar/generated-avatar/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp";
  assert.equal(profileAvatarType(generatedUrl), "generated_avatar");
  const picker = readFileSync("app/components/profile-image-picker.tsx", "utf8");
  assert.match(picker, /function modeFromValue\(value: string\)[\s\S]*?type === "generated_avatar" \? "photo" : type/);
  assert.match(picker, /mode === "create" && <AvatarCreationPanel/);
});

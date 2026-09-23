import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ensureCloudProfile, saveCloudProfile } from "../lib/cloud-account";
import { acknowledgePendingProfileWrite, cloudProfileFields, queuePendingProfileWrite, readPendingProfileWrite } from "../lib/profile-sync";
import { canonicalProfileUsername, checkProfileUsernameAvailability, normalizeProfileUsername } from "../lib/profile-username";
import { CloudDb } from "./helpers/cloud-db";

const core = { displayName: "QA", defaultHandicap: null, avatarUrl: "" };
function storage() { const values = new Map<string, string>(); return {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
}; }

test("username normalizado coincide con constraint Social; inválido nunca se omite silenciosamente", () => {
  assert.equal(normalizeProfileUsername(" @Said.QA_1 "), "said.qa_1");
  for (const invalid of ["x", "two words", "-invalid", "a".repeat(41), "😀"]) assert.throws(() => normalizeProfileUsername(invalid), { code: "PROFILE_USERNAME_INVALID" });
  assert.equal(normalizeProfileUsername(undefined), undefined); assert.equal(normalizeProfileUsername(""), undefined);
  assert.deepEqual(cloudProfileFields(core), core);
  assert.deepEqual(cloudProfileFields({ ...core, username: "José legacy-name" }), core, "untrusted legacy metadata cannot block login");
  assert.throws(() => queuePendingProfileWrite(storage(), "A", { ...core, username: "José invalid" }), { code: "PROFILE_USERNAME_INVALID" });
});

test("validación server-side distingue disponible y ocupado sin aceptar otro userId", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const available = await checkProfileUsernameAvailability("jwt", "@Said.QA", (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ available: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch);
  assert.equal(available, true);
  assert.match(calls[0].url, /username=said\.qa/);
  assert.equal(calls[0].init?.headers && (calls[0].init.headers as Record<string, string>).authorization, "Bearer jwt");
  assert.doesNotMatch(calls[0].url, /userId|email/);
  assert.equal(await checkProfileUsernameAvailability("jwt", "occupied", (async () => new Response(JSON.stringify({ available: false }), { status: 200 })) as typeof fetch), false);
});

test("la disponibilidad se resuelve con auth.uid y los índices únicos cierran carreras", () => {
  const migration = readFileSync("supabase/migrations/202609230001_profile_username_availability.sql", "utf8");
  const base = readFileSync("supabase/migrations/202609100001_phase2_social_groups_memberships.sql", "utf8");
  const route = readFileSync("app/api/account/username/route.ts", "utf8");
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /profile\.id <> \(select auth\.uid\(\)\)/);
  assert.match(migration, /profile\.user_id <> \(select auth\.uid\(\)\)/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
  assert.match(base, /profiles_username_normalized_uidx/);
  assert.match(base, /social_profiles_username_uidx/);
  assert.match(route, /getUser\(token\)/);
  assert.doesNotMatch(route, /searchParams\.get\("userId"\)|searchParams\.get\("email"\)/);
});

test("un conflicto concurrente revierte la proyección local y muestra el mensaje exacto", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const panel = readFileSync("app/components/profile-account-panel.tsx", "utf8");
  assert.match(provider, /cloudError\.code === "23505"/);
  assert.match(provider, /restorePendingProfileWrite/);
  assert.match(provider, /Ese nombre de usuario ya está en uso\./);
  assert.match(panel, /checkProfileUsernameAvailability/);
  assert.match(panel, /Ese nombre de usuario ya está en uso\./);
});

test("pending username sobrevive reload y una edición posterior de avatar sin rename", () => {
  const local = storage();
  queuePendingProfileWrite(local, "A", { ...core, username: "@Said.QA" });
  const next = queuePendingProfileWrite(local, "A", { ...core, avatarUrl: "😎" });
  assert.equal(next.profile.username, "said.qa");
  assert.equal(readPendingProfileWrite(local, "A")?.profile.username, "said.qa");
});

test("perfil canónico versionado guarda y recarga username sin Auth metadata", async () => {
  const db = new CloudDb();
  await saveCloudProfile(db.client, "A", { ...core, username: "@Said.QA" }, "2026-09-17T12:00:00Z");
  const loaded = await ensureCloudProfile(db.client, "A", core);
  assert.equal(loaded.username, "said.qa");
  assert.equal(canonicalProfileUsername(loaded.username, "stale_metadata"), "said.qa");
  await saveCloudProfile(db.client, "A", { ...core, avatarUrl: "😎" }, "2026-09-17T12:01:00Z");
  assert.equal(db.rows("profiles")[0].username, "said.qa", "legacy/avatar-only payload omits username");
  assert.equal(canonicalProfileUsername(null, "legacy_metadata"), "legacy_metadata");
  assert.equal(canonicalProfileUsername(null, undefined), "");
});

test("conflicto23505 canónico no acknowledge ni overwrite; retry válido converge", async () => {
  const db = new CloudDb(), local = storage();
  await saveCloudProfile(db.client, "A", { ...core, username: "original" }, "2026-09-17T12:00:00Z");
  const pending = queuePendingProfileWrite(local, "A", { ...core, username: "taken" }, "2026-09-17T12:01:00Z");
  db.before = (table, op) => { if (table === "profiles" && op === "update") throw Object.assign(new Error("unique"), { code: "23505" }); };
  async function sync() { await saveCloudProfile(db.client, "A", pending.profile, pending.updatedAt); return acknowledgePendingProfileWrite(local, "A", pending.revision); }
  await assert.rejects(sync(), { code: "23505" });
  assert.equal(readPendingProfileWrite(local, "A")?.revision, pending.revision);
  assert.equal(db.rows("profiles")[0].username, "original");
  db.before = undefined; assert.equal(await sync(), true); assert.equal(db.rows("profiles")[0].username, "taken");
});

test("CAS obsoleto verifica username, no confunde otros campos iguales con rename confirmado", async () => {
  const db = new CloudDb();
  await saveCloudProfile(db.client, "A", { ...core, username: "newer" }, "2026-09-17T12:00:00Z");
  await assert.rejects(saveCloudProfile(db.client, "A", { ...core, username: "older" }, "2026-09-17T12:00:00Z"), { code: "CLOUD_FIELD_CONFLICT" });
  assert.equal(db.rows("profiles")[0].username, "newer");
});

test("hidratación usa canonical username dentro del guard de usuario/revisión y no requiere metadata rename", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /if \(keepLocalProfile\) return current;[\s\S]*?canonicalProfileUsername\(cloudProfile.username, current.username\)/);
  assert.match(provider, /current\.userId !== authenticatedUserId/);
  assert.match(provider, /return \{ \.\.\.current, displayName, username, avatarUrl/);
  assert.doesNotMatch(provider, /username: next\.username,/);
});

test("edición sólo avatar desde sesión antigua no revierte username canónico remoto", async () => {
  const db = new CloudDb(), local = storage();
  await saveCloudProfile(db.client, "A", { ...core, username: "renamed_remotely" }, "2026-09-17T12:00:00Z");
  const staleIdentity = { ...core, username: "old_cached_handle", avatarUrl: "😎" };
  const avatarPatch = { avatarUrl: "😎" };
  const queued = queuePendingProfileWrite(local, "A", {
    ...cloudProfileFields(staleIdentity),
    username: Object.hasOwn(avatarPatch, "username") ? staleIdentity.username : undefined,
  }, "2026-09-17T12:01:00Z");
  await saveCloudProfile(db.client, "A", queued.profile, queued.updatedAt);
  assert.equal(db.rows("profiles")[0].username, "renamed_remotely");
  assert.equal(db.rows("profiles")[0].avatar_url, "😎");
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /username: Object\.hasOwn\(profile, "username"\) \? next\.username : undefined/);
});

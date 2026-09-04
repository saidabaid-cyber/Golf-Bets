import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cloudAccountErrorMessage, ensureCloudProfile } from "../lib/cloud-account";
import { findAmbiguousCloudConflicts, resolveAmbiguousCloudConflicts, stableValue, type CloudDataBundle } from "../lib/cloud-sync";
import { runCloudSyncCycle, type SyncStatus } from "../lib/cloud-sync-cycle";
import { readCloudBundle, writeCloudBundle } from "../lib/cloud-sync-service";
import { offlineRetryDelayMs, outboxAcknowledged } from "../lib/offline-store";
import { CloudDb } from "./helpers/cloud-db";
import { ACCOUNT_STORAGE_KEYS, readOfflineAuthenticatedProfile } from "../lib/account-state";

const at = "2026-09-03T12:00:00.000Z";
function bundle(data: Partial<CloudDataBundle> = {}): CloudDataBundle {
  return { version: 1, history: [], frequentPlayers: [], frequentGroups: [], rivals: [], courses: [], preferences: { highContrast: true, language: "es-MX", notificationsEnabled: false, defaultHandicap: null }, activeDraft: null, tombstones: [], ...data };
}

test("perfil faltante se autocorrige con auth uid y no usa email como propietario", async () => {
  const db = new CloudDb();
  await ensureCloudProfile(db.client, "auth-user-a", { displayName: "Said", defaultHandicap: 8.4, avatarUrl: "" });
  assert.equal(db.rows("profiles")[0].display_name, "Said");
  assert.equal(db.rows("profiles")[0].id, "auth-user-a");
  assert.equal(db.rows("profiles")[0].email, undefined);
});

test("perfil existente se lee sin sobrescribirlo con la caché de otro dispositivo", async () => {
  const db = new CloudDb();
  db.rows("profiles").push({ id: "auth-user-a", display_name: "Nombre nube", default_handicap: 12.7, onboarding_completed_at: at });
  const row = await ensureCloudProfile(db.client, "auth-user-a", { displayName: "Nombre local", defaultHandicap: 1, avatarUrl: "" });
  assert.equal(row.display_name, "Nombre nube");
  assert.equal(db.rows("profiles").length, 1);
});

test("errores de permisos, esquema y red son recuperables sin jerga ni secretos", () => {
  assert.match(cloudAccountErrorMessage({ code: "42501", message: "permission denied" }, "tu perfil"), /rechazó el acceso a tu perfil/);
  assert.match(cloudAccountErrorMessage({ code: "PGRST205" }), /no pudo leer tu cuenta/);
  assert.match(cloudAccountErrorMessage(new TypeError("Failed to fetch")), /conectar con Supabase/);
  assert.doesNotMatch(cloudAccountErrorMessage({ code: "PGRST205" }), /migraci|RLS|PGRST/i);
});

test("migración reparadora es aditiva, repara perfiles y otorga Data API solo con RLS", () => {
  const sql = readFileSync("supabase/migrations/20260904013601_repair_cloud_profiles_and_permissions.sql", "utf8");
  assert.match(sql, /insert into public\.profiles[\s\S]*from auth\.users/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /grant select, insert, update, delete on table[\s\S]*public\.profiles[\s\S]*to authenticated/);
  assert.match(sql, /alter table public\.user_devices enable row level security/);
  assert.match(sql, /last_error_code text/);
  assert.match(sql, /auth\.uid\(\)\) = user_id/);
  assert.match(sql, /revoke all on table public\.polla_join_attempts from public, anon, authenticated/);
  assert.doesNotMatch(sql, /\btruncate\b|delete from public\.profiles|drop table/i);
});

test("dos versiones con mismo reloj no se sobrescriben silenciosamente", () => {
  const localRound = { id: "round-a", date: "2026-09-03", updatedAt: at, courseName: "Local" } as CloudDataBundle["history"][number];
  const cloudRound = { ...localRound, courseName: "Nube" };
  const local = bundle({ history: [localRound] });
  const cloud = bundle({ history: [cloudRound] });
  const conflicts = findAmbiguousCloudConflicts(local, cloud);
  assert.equal(conflicts.length, 1);
  const chosen = resolveAmbiguousCloudConflicts(local, cloud, conflicts, "cloud", "2026-09-03T12:01:00.000Z");
  assert.equal(chosen.history[0].courseName, "Nube");
  assert.equal(chosen.history[0].updatedAt, "2026-09-03T12:01:00.000Z");
});

test("dos dispositivos que editaron el mismo draft desde una base común generan conflicto aunque sus relojes difieran", () => {
  const baseDraft = { roundId: "round-a", players: [{ id: "p", name: "Said" }], scores: { 1: { p: 4 } } };
  const baseFingerprint = JSON.stringify(stableValue(baseDraft));
  const local = bundle({
    activeDraft: { ...baseDraft, scores: { 1: { p: 3 } } },
    activeDraftUpdatedAt: "2026-09-03T12:02:00.000Z",
    baseDraftUpdatedAt: "2026-09-03T12:00:00.000Z",
    baseDraftFingerprint: baseFingerprint,
  });
  const cloud = bundle({ activeDraft: { ...baseDraft, scores: { 1: { p: 5 } } }, activeDraftUpdatedAt: "2026-09-03T12:01:00.000Z" });
  assert.equal(findAmbiguousCloudConflicts(local, cloud)[0]?.collection, "activeDraft");
  const unchangedCloud = bundle({ activeDraft: baseDraft, activeDraftUpdatedAt: "2026-09-03T12:00:00.000Z" });
  assert.equal(findAmbiguousCloudConflicts(local, unchangedCloud).length, 0);
});

test("un conflicto ambiguo detiene upload y nunca declara sincronizado", async () => {
  const states: SyncStatus[] = [];
  let uploads = 0;
  const result = await runCloudSyncCycle({
    read: () => bundle(), download: async () => bundle(), upload: async () => { uploads += 1; }, media: async () => {}, apply: () => {}, current: () => true,
    status: (value) => states.push(value), conflicts: () => true,
  });
  assert.equal(result, false);
  assert.equal(uploads, 0);
  assert.equal(states.at(-1), "pending");
});

test("ACK de IndexedDB solo vacía el snapshot exacto", () => {
  const pending = { fingerprint: "v1-new" };
  assert.equal(outboxAcknowledged(pending, "v1-old"), false);
  assert.equal(outboxAcknowledged(pending, "v1-new"), true);
  assert.equal(outboxAcknowledged(null, "v1-new"), false);
});

test("reintentos offline usan backoff creciente y acotado", () => {
  assert.equal(offlineRetryDelayMs(0), 0);
  assert.equal(offlineRetryDelayMs(1), 15_000);
  assert.equal(offlineRetryDelayMs(2), 30_000);
  assert.equal(offlineRetryDelayMs(99), 5 * 60_000);
});

test("modo avión restaura el workspace autenticado sin guardar tokens", () => {
  const values = new Map<string, string>([
    [ACCOUNT_STORAGE_KEYS.mode, "authenticated"],
    ["backyard-profile-cache-v1:auth-user-a", JSON.stringify({ displayName: "Said", email: "said@example.test", defaultHandicap: 8.4, avatarUrl: "" })],
  ]);
  const profile = readOfflineAuthenticatedProfile({ getItem: key => values.get(key) ?? null }, "auth-user-a");
  assert.equal(profile?.displayName, "Said");
  assert.equal(profile?.defaultHandicap, 8.4);
  assert.equal("accessToken" in (profile || {}), false);
  assert.equal(readOfflineAuthenticatedProfile({ getItem: key => values.get(key) ?? null }, "guest"), null);
});

test("offline-first usa IndexedDB y una sola operación por cuenta", () => {
  const source = readFileSync("lib/offline-store.ts", "utf8");
  assert.match(source, /indexedDB\.open/);
  assert.match(source, /createObjectStore\(OUTBOX, \{ keyPath: "ownerId" \}\)/);
  assert.match(source, /tx\.objectStore\(OUTBOX\)\.put/);
  assert.match(source, /outboxAcknowledged\(current, fingerprint\)/);
});

test("service worker cachea shell pero nunca APIs ni datos privados", () => {
  const worker = readFileSync("public/sw.js", "utf8");
  const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /caches\.match\("\/"\)/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.icons.length >= 2);
});

test("UI distingue guardado local, pendiente, offline, nube y error", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const account = readFileSync("app/components/account-panel.tsx", "utf8");
  for (const label of ["Guardado en este dispositivo", "Pendiente de sincronizar", "Sin conexión", "Sincronizando", "Guardado en la nube", "Error de sincronización"]) {
    assert.match(`${page}\n${account}`, new RegExp(label, "i"));
  }
  assert.match(page, /todavía tiene cambios pendientes de sincronizar/);
  assert.match(page, /window\.addEventListener\("focus", onFocus\)/);
  assert.match(page, /45_000/);
});

test("dos dispositivos conservan identidad estable y una ronda se actualiza sin duplicarse", async () => {
  const db = new CloudDb();
  const first = bundle({
    deviceId: "device-computer",
    history: [{ id: "round-qa", date: "2026-09-03", updatedAt: "2026-09-03T12:00:00.000Z", scores: { 1: { player: 4 } } } as unknown as CloudDataBundle["history"][number]],
  });
  await writeCloudBundle(db.client, "auth-user-a", { data: first, fingerprint: "computer-v1" });
  const second = bundle({
    deviceId: "device-phone",
    history: [{ id: "round-qa", date: "2026-09-03", updatedAt: "2026-09-03T12:01:00.000Z", scores: { 1: { player: 3 } } } as unknown as CloudDataBundle["history"][number]],
  });
  await writeCloudBundle(db.client, "auth-user-a", { data: second, fingerprint: "phone-v2" });
  const restored = await readCloudBundle(db.client, "auth-user-a");
  assert.equal(restored.history.length, 1);
  assert.deepEqual(restored.history[0].scores, { 1: { player: 3 } });
  assert.equal(db.rows("user_devices").length, 2);
  assert.equal(db.rows("rounds_cloud")[0].updated_by_device, "device-phone");
});

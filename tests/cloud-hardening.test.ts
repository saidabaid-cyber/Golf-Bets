import test from "node:test";
import assert from "node:assert/strict";
import { CloudDb } from "./helpers/cloud-db";
import { readCloudBundle, writeCloudBundle, writeVersionedRow } from "../lib/cloud-sync-service";
import { CLOUD_LOCAL_META_KEY, collectLocalCloudData, mergeLocalAndCloud, trackLocalCloudEdits, persistCloudMetadata, uploadCloudData, downloadCloudData, type CloudDataBundle } from "../lib/cloud-sync";
import { runCloudSyncCycle, type SyncStatus } from "../lib/cloud-sync-cycle";
import { ownsLocalWorkspace, switchAccountWorkspace, preserveDraftConflict, CLOUD_CONFLICTS_KEY } from "../lib/account-workspace";
import { adoptGuestPhotoJobs, queuePhoto, photoJobs, flushPhotoQueue } from "../lib/photo-sync-queue";
import { STORAGE_KEYS } from "../lib/round-utils";
import { OtpSendGate, otpRetrySeconds, authIdentityChanged, closeAuthSession, type AuthFlowClient } from "../lib/auth-flow";
import { authErrorMessage } from "../lib/account-state";
import { saveCloudProfile } from "../lib/cloud-account";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const earlier = "2026-09-03T10:00:00.000Z", later = "2026-09-03T11:00:00.000Z";
const draft = (score = 4) => ({ roundId: "r", players: [{ id: "p", name: "Said", handicap: 7 }], scores: { 1: { p: score } }, currentIndex: 0 });
function bundle(data: Partial<CloudDataBundle> = {}): CloudDataBundle {
  return { version: 1, history: [], frequentPlayers: [], frequentGroups: [], rivals: [], courses: [], preferences: { highContrast: false, defaultHandicap: null, language: "es-MX", notificationsEnabled: false }, activeDraft: null, tombstones: [], ...data };
}
function round(score = 4, updatedAt = earlier) {
  return { id: "r", updatedAt, date: "2026-09-03", photoId: "photo", players: draft().players, scores: draft(score).scores, personalBets: [{ carryEnabled: true }], betConfig: { foursome: { mode: "fixed" } }, categoryResults: { personal: { p: -600 } }, manualBets: [], expenses: { food: 150 }, courseSnapshot: { holes: [{ number: 1, par: 4, strokeIndex: 1 }] } } as unknown as CloudDataBundle["history"][number];
}
const write = (db: CloudDb, data: CloudDataBundle) => writeCloudBundle(db.client, "user-a", { data, fingerprint: "test" });

for (const winner of ["local", "remote"] as const) test("draft " + winner + " más reciente conserva todos los scores", () => {
  const local = bundle({ activeDraft: draft(3), activeDraftUpdatedAt: winner === "local" ? later : earlier });
  const remote = bundle({ activeDraft: draft(5), activeDraftUpdatedAt: winner === "remote" ? later : earlier });
  assert.deepEqual(mergeLocalAndCloud(local, remote).activeDraft, winner === "local" ? local.activeDraft : remote.activeDraft);
});
for (const side of ["local", "remote"] as const) test("borrado draft " + side + " no resucita al sincronizar", () => {
  const deleted = bundle({ activeDraft: null, activeDraftUpdatedAt: later }), stale = bundle({ activeDraft: draft(), activeDraftUpdatedAt: earlier });
  assert.equal(mergeLocalAndCloud(side === "local" ? deleted : stale, side === "local" ? stale : deleted).activeDraft, null);
});
test("edición avanza reloj; autosave y reload no lo avanzan; vaciar conserva tombstone", () => {
  const storage = new MemoryStorage();
  trackLocalCloudEdits(storage, draft(), bundle().preferences, earlier);
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft()));
  trackLocalCloudEdits(storage, draft(), bundle().preferences, later);
  assert.equal(collectLocalCloudData(storage).activeDraftUpdatedAt, earlier);
  trackLocalCloudEdits(storage, null, bundle().preferences, later);
  storage.setItem(STORAGE_KEYS.draft, "null");
  assert.equal(collectLocalCloudData(storage).activeDraftUpdatedAt, later);
});
test("aplicar preferencias remotas no se convierte en nueva edición; HCP puede vaciarse", () => {
  const storage = new MemoryStorage(), remote = bundle({ activeDraft: draft(), activeDraftUpdatedAt: earlier, preferences: { ...bundle().preferences, updatedAt: earlier } });
  persistCloudMetadata(storage, remote);
  trackLocalCloudEdits(storage, remote.activeDraft, remote.preferences, later);
  assert.equal(JSON.parse(storage.getItem(CLOUD_LOCAL_META_KEY)!).preferencesAt, earlier);
  const local = bundle({ preferences: { ...remote.preferences, defaultHandicap: 7, updatedAt: "2026-01-01" } });
  assert.equal(mergeLocalAndCloud(local, remote).preferences.defaultHandicap, null);
});
test("histórico corregido gana sin duplicado y conserva foto/configuración/resultados", () => {
  const merged = mergeLocalAndCloud(bundle({ history: [round()] }), bundle({ history: [round(3, later)] }));
  assert.equal(merged.history.length, 1); assert.deepEqual(merged.history[0], round(3, later));
});
for (const localDeletion of [true, false]) test("tombstones permanentes ganan contra una edición posterior del dispositivo obsoleto " + localDeletion, () => {
  const stale = bundle({ history: [round(3, later)] }), deleted = bundle({ tombstones: [{ entityType: "round", localId: "r", deletedAt: earlier }] });
  assert.equal(mergeLocalAndCloud(localDeletion ? deleted : stale, localDeletion ? stale : deleted).history.length, 0);
});
test("cambio A→B→A y logout/login archivan sin mezclar ni borrar datos", () => {
  const storage = new MemoryStorage(); storage.setItem(STORAGE_KEYS.history, "guest-data");
  switchAccountWorkspace(storage, "user-a"); storage.setItem(STORAGE_KEYS.history, "a-data");
  switchAccountWorkspace(storage, "user-b"); assert.equal(storage.getItem(STORAGE_KEYS.history), null);
  storage.setItem(STORAGE_KEYS.history, "b-data"); switchAccountWorkspace(storage, "user-a");
  assert.equal(storage.getItem(STORAGE_KEYS.history), "a-data"); assert.equal(ownsLocalWorkspace(storage, "user-b"), false);
  switchAccountWorkspace(storage, "guest"); assert.equal(storage.getItem(STORAGE_KEYS.history), "guest-data");
  switchAccountWorkspace(storage, "user-a"); assert.equal(storage.getItem(STORAGE_KEYS.history), "a-data");
});
test("versiones de draft perdedor se preservan sin duplicados", () => {
  const storage = new MemoryStorage(); preserveDraftConflict(storage, draft()); preserveDraftConflict(storage, draft());
  assert.deepEqual(JSON.parse(storage.getItem(CLOUD_CONFLICTS_KEY)!), [draft()]);
});
test("token refresh no cambia identidad; cuenta distinta sí", () => {
  assert.equal(authIdentityChanged("a", "a"), false); assert.equal(authIdentityChanged("a", "b"), true);
});
test("logout revoca la sesión global y propaga fallo sin éxito falso", async () => {
  let scope: unknown;
  await assert.rejects(closeAuthSession({ signOut: async options => { scope = options; return { error: new Error("network") }; } } as AuthFlowClient));
  assert.equal(scope, undefined);
});
test("sin JWT ni siquiera se envía petición cloud", async () => {
  await assert.rejects(uploadCloudData(bundle(), ""), /Inicia sesión/); await assert.rejects(downloadCloudData(" "), /Inicia sesión/);
});
test("200 sin acknowledgment o fingerprint correcto no significa sincronizado", async () => {
  const original = globalThis.fetch;
  try { globalThis.fetch = async () => Response.json({ ok: true, fingerprint: "wrong" }); await assert.rejects(uploadCloudData(bundle(), "mock-jwt"), /no confirmó/); }
  finally { globalThis.fetch = original; }
});
for (const step of ["download", "upload", "media"] as const) test("fallo " + step + " conserva local, no aplica ni declara synced; retry funciona", async () => {
  const statuses: SyncStatus[] = []; let failed = true, applied = 0;
  const run = () => runCloudSyncCycle({ read: () => bundle(), current: () => true, status: value => statuses.push(value),
    download: async () => { if (failed && step === "download") throw new Error("network"); return bundle(); },
    upload: async () => { if (failed && step === "upload") throw new Error("partial projection"); },
    media: async () => { if (failed && step === "media") throw new Error("photo failed"); },
    apply: () => { applied++; },
  });
  await assert.rejects(run()); assert.equal(applied, 0); assert.equal(statuses.includes("synced"), false);
  failed = false; assert.equal(await run(), true); assert.equal(applied, 1); assert.equal(statuses.at(-1), "synced");
});
test("edición durante upload no se sobrescribe con respuesta vieja", async () => {
  let local = bundle(), applied = false; const states: SyncStatus[] = [];
  const complete = await runCloudSyncCycle({ read: () => local, download: async () => bundle(), upload: async () => { local = bundle({ activeDraft: draft() }); }, media: async () => {}, apply: () => { applied = true; }, current: () => true, status: value => states.push(value) });
  assert.equal(complete, false); assert.equal(applied, false); assert.equal(states.at(-1), "pending");
});
test("logout/cambio de usuario durante request bloquea apply y acknowledgment", async () => {
  let current = true, applied = false; const states: SyncStatus[] = [];
  await assert.rejects(runCloudSyncCycle({ read: () => bundle(), download: async () => { current = false; return bundle(); }, upload: async () => {}, media: async () => {}, apply: () => { applied = true; }, current: () => current, status: value => states.push(value) }));
  assert.equal(applied, false); assert.equal(states.includes("synced"), false);
});
test("fallo parcial de proyección se reintenta aun con snapshot idéntico", async () => {
  const db = new CloudDb(), data = bundle({ history: [round()], activeDraft: draft(), activeDraftUpdatedAt: earlier });
  db.fail = (table, op) => table === "round_scores_cloud" && op === "insert";
  await assert.rejects(write(db, data));
  assert.equal(db.rows("rounds_cloud").length, 1); assert.equal(db.rows("account_data_migrations")[0].status, "failed");
  db.fail = undefined; await write(db, data); await write(db, data);
  assert.equal(db.rows("rounds_cloud").length, 1); assert.equal(db.rows("round_scores_cloud").length, 1);
  assert.equal(db.rows("round_scores_cloud")[0].score, 4);
  assert.deepEqual((await readCloudBundle(db.client, "user-a")).history, data.history);
  assert.deepEqual((await readCloudBundle(db.client, "user-a")).activeDraft, draft());
  assert.equal(db.rows("account_data_migrations")[0].status, "completed");
});
test("proyecciones siempre usan snapshot remoto más reciente, no versión rechazada", async () => {
  const db = new CloudDb(); await write(db, bundle({ history: [round(3, later)] })); await write(db, bundle({ history: [round(5, earlier)] }));
  assert.equal(db.rows("round_scores_cloud")[0].score, 3);
  assert.deepEqual(db.rows("round_bet_results")[0].results, round().categoryResults);
});
test("CAS detecta carrera y cero filas actualizadas: nunca acknowledgment falso", async () => {
  const db = new CloudDb(); db.rows("players").push({ owner_id: "a", local_id: "p", updated_at: earlier });
  db.before = (table, op) => { if (table === "players" && op === "update") db.rows(table)[0].updated_at = later; };
  await assert.rejects(writeVersionedRow(db.client, "players", { owner_id: "a", local_id: "p" }, { updated_at: later }), /Conflicto/);
});
test("tombstone posterior a la primera página sigue borrando datos", async () => {
  const db = new CloudDb(); db.tables.cloud_deletions = Array.from({ length: 1200 }, (_, i) => ({ owner_id: "user-a", local_id: "r" + i, entity_type: "round", deleted_at: earlier }));
  db.rows("rounds_cloud").push({ owner_id: "user-a", local_id: "r1199", snapshot: { ...round(), id: "r1199" }, updated_at: later });
  const cloud = await readCloudBundle(db.client, "user-a");
  assert.equal(cloud.tombstones.length, 1200); assert.equal(cloud.history.length, 0);
  await write(db, bundle({ history: [{ ...round(), id: "r1199" }] })); assert.equal(db.rows("rounds_cloud").length, 0);
});
test("fallo escritura de colección propaga error y conserva snapshot local", async () => {
  const db = new CloudDb(), data = bundle({ history: [round()] }), before = structuredClone(data);
  db.fail = (table, op) => table === "rounds_cloud" && op === "insert";
  await assert.rejects(write(db, data)); assert.deepEqual(data, before);
});
test("onboarding no se completa cuando fallan preferencias; retry confirma ambas", async () => {
  const db = new CloudDb(), profile = { displayName: "Said", defaultHandicap: 7, avatarUrl: "" };
  db.fail = table => table === "user_preferences";
  await assert.rejects(saveCloudProfile(db.client, "a", profile, later));
  assert.equal(db.rows("profiles").length, 0);
  db.fail = undefined; await saveCloudProfile(db.client, "a", profile, later);
  assert.equal(db.rows("profiles")[0].onboarding_completed_at, later);
});
test("perfil cloud conserva HCP Index opcional como null", async () => {
  const db = new CloudDb();
  await saveCloudProfile(db.client, "a", { displayName: "Said", defaultHandicap: null, avatarUrl: "" }, later);
  assert.equal(db.rows("profiles")[0].default_handicap, null);
  assert.equal(db.rows("user_preferences")[0].default_handicap, null);
  assert.equal(db.rows("profiles")[0].name, "Said");
});
test("foto pendiente/fallida/retry conserva blob y solo quita cola con confirmación", async () => {
  const storage = new MemoryStorage(); queuePhoto(storage, { userId: "a", roundId: "r", photoId: "photo", operation: "upload", revision: "v1" });
  const blob = new Blob(["fixture"]); let failed = true, uploads = 0;
  const transport = { read: async () => blob, upload: async () => { uploads++; return !failed; }, remove: async () => true };
  assert.equal(photoJobs(storage)[0].status, "pending");
  await assert.rejects(flushPhotoQueue(storage, "a", bundle({ history: [round()] }), transport));
  assert.equal(photoJobs(storage)[0].status, "failed");
  failed = false; await flushPhotoQueue(storage, "a", bundle({ history: [round()] }), transport);
  assert.equal(photoJobs(storage).length, 0); assert.equal(uploads, 2); assert.equal(await blob.text(), "fixture");
});
test("foto no disponible no se marca subida ni se pierde cola", async () => {
  const storage = new MemoryStorage(); queuePhoto(storage, { userId: "a", roundId: "r", photoId: "photo", operation: "upload", revision: "v" });
  await assert.rejects(flushPhotoQueue(storage, "a", bundle({ history: [round()] }), { read: async () => undefined, upload: async () => { throw new Error("should not call"); }, remove: async () => true }));
  assert.equal(photoJobs(storage)[0].status, "failed");
});
test("foto de otra cuenta no se envía y ACK viejo no borra foto nueva", async () => {
  const storage = new MemoryStorage(); const job = { userId: "a", roundId: "r", photoId: "photo", operation: "upload" as const, revision: "v" }; queuePhoto(storage, job);
  let calls = 0;
  const transport = { read: async () => new Blob(), upload: async () => { calls++; queuePhoto(storage, { ...job, photoId: "new", revision: "v2" }); return true; }, remove: async () => true };
  await flushPhotoQueue(storage, "b", bundle({ history: [round()] }), transport); assert.equal(calls, 0);
  await flushPhotoQueue(storage, "a", bundle({ history: [round()] }), transport); assert.equal(photoJobs(storage)[0].photoId, "new");
});
test("ronda borrada convierte foto pendiente en limpieza remota recuperable", async () => {
  const storage = new MemoryStorage(); queuePhoto(storage, { userId: "a", roundId: "r", photoId: "photo", operation: "upload", revision: "v" });
  let removed = 0;
  await flushPhotoQueue(storage, "a", bundle({ tombstones: [{ entityType: "round", localId: "r", deletedAt: later }] }), { read: async () => undefined, upload: async () => { throw new Error("never upload"); }, remove: async () => { removed++; return true; } });
  assert.equal(removed, 1); assert.equal(photoJobs(storage).length, 0);
});
test("OTP contador/reenvío bloquea doble click, cooldown y envío simultáneo", () => {
  const gate = new OtpSendGate(); assert.equal(gate.begin(100), true);
  assert.equal(gate.begin(101), false); assert.equal(otpRetrySeconds(gate.nextSendAt, 100), 60);
  gate.finish(); assert.equal(gate.begin(59_100), false);
  assert.equal(gate.begin(60_100), true); assert.equal(gate.begin(999_999), false);
});
test("OTP errores Supabase no-Error son humanos: expirado, incorrecto, red y rate limit", () => {
  assert.match(authErrorMessage({ code: "otp_expired" }, "otp"), /expiró/);
  assert.match(authErrorMessage({ code: "invalid_otp" }, "otp"), /no es correcto/);
  assert.match(authErrorMessage({ message: "Failed to fetch" }, "otp"), /conexión/);
  assert.match(authErrorMessage({ status: 429 }, "email"), /Demasiados/);
});
test("importación aprobada adopta cola invitado incluyendo borrados, sin duplicar", () => {
  const storage = new MemoryStorage();
  queuePhoto(storage, { userId: "guest", roundId: "r", photoId: "p", operation: "delete", revision: "v" });
  adoptGuestPhotoJobs(storage, "a"); adoptGuestPhotoJobs(storage, "a");
  assert.equal(photoJobs(storage).length, 1); assert.equal(photoJobs(storage)[0].userId, "a"); assert.equal(photoJobs(storage)[0].operation, "delete");
});
test("todos los catálogos, incluida edición de campo predeterminado, se conservan tras ciclo servidor", async () => {
  const db = new CloudDb();
  const data = bundle({
    frequentPlayers: [{ id: "p", name: "Said", handicap: 7, uses: 1, updatedAt: earlier }],
    frequentGroups: [{ id: "g", name: "Miércoles", players: [{ name: "Said", handicap: 7 }], uses: 1, updatedAt: earlier }],
    rivals: [{ id: "v", name: "Flavio", updatedAt: earlier }] as CloudDataBundle["rivals"],
    courses: [{ id: "c", name: "La Vista", builtIn: true, holes: [{ number: 1, par: 4, strokeIndex: 1 }], updatedAt: earlier }] as CloudDataBundle["courses"],
    preferences: { ...bundle().preferences, highContrast: true, defaultHandicap: 7, updatedAt: earlier },
  });
  await write(db, data); const restored = await readCloudBundle(db.client, "user-a");
  for (const key of ["frequentPlayers", "frequentGroups", "rivals", "courses"] as const) assert.deepEqual(restored[key], data[key]);
  assert.equal(restored.preferences.highContrast, true); assert.equal(restored.preferences.defaultHandicap, 7);
  assert.equal((await readCloudBundle(db.client, "user-b")).history.length, 0); // Query scope, NOT real RLS proof.
});
test("18 hoyos y cuatro jugadores: 72 scores, retry sin duplicados y corrección conserva configuración", async () => {
  const db = new CloudDb();
  const players = ["Said", "Carlos", "Flavio", "Javier"].map((name, i) => ({ id: "p" + i, name, handicap: i * 3 }));
  const scores = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, Object.fromEntries(players.map((player, j) => [player.id, 3 + (i + j) % 4]))]));
  const snapshot = { ...round(), players, scores, roundHoles: 18 as const, startHole: 10 as const, playOrder: [10,11,12,13,14,15,16,17,18,1,2,3,4,5,6,7,8,9] };
  await write(db, bundle({ history: [snapshot] })); await write(db, bundle({ history: [snapshot] }));
  assert.equal(db.rows("round_players_cloud").length, 4); assert.equal(db.rows("round_scores_cloud").length, 72);
  const corrected = { ...snapshot, scores: { ...scores, 1: { ...scores[1], p0: 2 } }, updatedAt: later };
  await write(db, bundle({ history: [corrected] }));
  assert.equal(db.rows("round_scores_cloud").length, 72);
  assert.deepEqual((await readCloudBundle(db.client, "user-a")).history, [corrected]);
  assert.equal(db.rows("round_scores_cloud").filter(score => score.hole === 1 && score.score === 2).length, 1);
  assert.equal(Object.hasOwn(db.rows("round_scores_cloud")[0], "id"), false);
});

test("proyección de scores usa la clave compuesta real y nunca consulta una columna id inexistente", async () => {
  const db = new CloudDb();
  await write(db, bundle({ history: [round()] }));
  assert.deepEqual(
    Object.keys(db.rows("round_scores_cloud")[0]).sort(),
    ["hole", "round_player_id", "score", "updated_by_device"].sort(),
  );
  const source = await import("node:fs/promises").then(fs => fs.readFile("lib/cloud-sync-service.ts", "utf8"));
  assert.doesNotMatch(source, /from\("round_scores_cloud"\)[\s\S]{0,160}select\("id"\)/);
  assert.match(source, /select\("round_player_id,hole"\)/);
});

test("esquema cloud anterior sincroniza ronda completa sin columnas aditivas ni éxito local falso", async () => {
  const db = new CloudDb();
  db.extendedSchema = false;
  const players = ["Said", "Flavio"].map((name, index) => ({ id: `legacy-p${index}`, name, handicap: index * 5 }));
  const scores = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [index + 1, Object.fromEntries(players.map((player, playerIndex) => [player.id, 3 + (index + playerIndex) % 4]))]));
  const snapshot = { ...round(), id: "legacy-round", players, scores, updatedAt: later };
  const data = bundle({ deviceId: "device-phone", history: [snapshot] });
  await write(db, data);
  await write(db, data);
  assert.equal(db.rows("rounds_cloud").length, 1);
  assert.equal(db.rows("round_players_cloud").length, 2);
  assert.equal(db.rows("round_scores_cloud").length, 36);
  assert.equal(db.rows("account_data_migrations")[0].status, "completed");
  assert.equal(db.calls.some(call => call.table === "user_devices"), false);
  for (const table of ["rounds_cloud", "round_players_cloud", "round_scores_cloud", "round_bet_configs", "round_bet_results", "user_preferences", "user_cloud_state"]) {
    assert.equal(db.rows(table).some(row => Object.hasOwn(row, "updated_by_device")), false, `${table} no debe recibir columnas nuevas`);
  }
  assert.deepEqual((await readCloudBundle(db.client, "user-a")).history, [snapshot]);
});

test("un error PostgREST conserva su código para diagnóstico seguro del Preview", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile("lib/cloud-sync-service.ts", "utf8"));
  assert.match(source, /throw error;/);
  assert.doesNotMatch(source, /throw new Error\(message\)/);
  const route = await import("node:fs/promises").then(fs => fs.readFile("app/api/cloud/sync/route.ts", "utf8"));
  assert.match(route, /candidate\.code/);
  assert.doesNotMatch(route, /console\.error\([^\n]*(message|token|body)/);
});

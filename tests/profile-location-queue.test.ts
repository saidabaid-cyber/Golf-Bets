import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgePendingProfileWrite,
  cloudProfileFields,
  createProfileWriteCoordinator,
  pendingProfileWriteKey,
  queuePendingProfileWrite,
  readPendingProfileWrite,
  retimePendingProfileWrite,
} from "../lib/profile-sync";

const firstAt = "2026-09-15T12:00:00.000Z";
const secondAt = "2026-09-15T12:01:00.000Z";
const thirdAt = "2026-09-15T12:02:00.000Z";
const puebla = { countryCode: "MX", country: "México", stateCode: "MX-PUE", state: "Puebla" };
const jalisco = { countryCode: "MX", country: "México", stateCode: "MX-JAL", state: "Jalisco" };

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const core = { displayName: "Said", defaultHandicap: 7, avatarUrl: "🐺" };

test("geo explícita sobrevive edición core, reload y rebase con su reloj propio", () => {
  const local = storage();
  const first = queuePendingProfileWrite(local, "geo-preserve", { ...core, location: puebla }, firstAt, "revision-geo");
  assert.deepEqual(first.profile.location, puebla);
  assert.equal(first.profile.locationUpdatedAt, firstAt);

  const renamed = queuePendingProfileWrite(local, "geo-preserve", { ...core, displayName: "Said AT" }, secondAt, "revision-name");
  assert.equal(renamed.profile.displayName, "Said AT");
  assert.deepEqual(renamed.profile.location, puebla);
  assert.equal(renamed.profile.locationUpdatedAt, firstAt);
  assert.ok(Date.parse(renamed.updatedAt) > Date.parse(first.updatedAt));
  assert.equal(acknowledgePendingProfileWrite(local, "geo-preserve", first.revision), false);

  const reloaded = readPendingProfileWrite(local, "geo-preserve");
  assert.deepEqual(reloaded?.profile.location, puebla);
  assert.equal(reloaded?.profile.locationUpdatedAt, firstAt);
  assert.equal(retimePendingProfileWrite(local, "geo-preserve", renamed.revision, thirdAt), true);
  assert.equal(readPendingProfileWrite(local, "geo-preserve")?.profile.locationUpdatedAt, firstAt);
  assert.equal(acknowledgePendingProfileWrite(local, "geo-preserve", renamed.revision), true);
  assert.equal(readPendingProfileWrite(local, "geo-preserve"), null);
});

test("geo nueva reemplaza geo pending; limpieza explícita no recupera selección anterior", () => {
  const local = storage();
  queuePendingProfileWrite(local, "geo-replace", { ...core, location: puebla }, firstAt);
  const changed = queuePendingProfileWrite(local, "geo-replace", { ...core, location: jalisco }, secondAt);
  assert.deepEqual(changed.profile.location, jalisco);
  assert.equal(changed.profile.locationUpdatedAt, secondAt);

  const cleared = queuePendingProfileWrite(local, "geo-replace", {
    ...core, location: { countryCode: "", country: "", stateCode: "", state: "" },
  }, thirdAt);
  assert.deepEqual(cleared.profile.location, { countryCode: "", country: "", stateCode: "", state: "" });
  assert.equal(cleared.profile.locationUpdatedAt, thirdAt);
});

test("dos selecciones geo en el mismo milisegundo reciben relojes distintos", () => {
  const local = storage();
  const first = queuePendingProfileWrite(local, "geo-same-ms", { ...core, location: puebla, locationUpdatedAt: firstAt }, firstAt);
  const second = queuePendingProfileWrite(local, "geo-same-ms", { ...core, location: jalisco, locationUpdatedAt: firstAt }, firstAt);
  assert.ok(Date.parse(second.profile.locationUpdatedAt || "") > Date.parse(first.profile.locationUpdatedAt || ""));
  assert.deepEqual(second.profile.location, jalisco);
});

test("pending legacy sin reloj geo lo recupera desde updatedAt; pending core sigue intacto", () => {
  const local = storage();
  local.setItem(pendingProfileWriteKey("geo-legacy"), JSON.stringify({
    profile: { ...core, location: puebla }, updatedAt: firstAt, revision: "legacy-revision",
  }));
  const recovered = readPendingProfileWrite(local, "geo-legacy");
  assert.deepEqual(recovered?.profile.location, puebla);
  assert.equal(recovered?.profile.locationUpdatedAt, firstAt);

  const coreOnly = queuePendingProfileWrite(local, "core-only", core, firstAt);
  assert.deepEqual(coreOnly.profile, core);
  assert.deepEqual(cloudProfileFields({ ...core, locationUpdatedAt: null }), core);
  assert.equal(readPendingProfileWrite(local, "core-only")?.profile.location, undefined);
});

test("geo inválida se rechaza antes de normalizar y no pisa la queue existente", () => {
  assert.throws(() => cloudProfileFields({ ...core, location: { countryCode: "ZZ", country: "Inventado", stateCode: "", state: "" } }), /profile_location_invalid/);
  assert.throws(() => cloudProfileFields({ ...core, location: { ...puebla, state: "Jalisco" } }), /profile_location_invalid/);
  const local = storage();
  const initial = queuePendingProfileWrite(local, "geo-invalid", { ...core, location: puebla }, firstAt);
  assert.throws(() => queuePendingProfileWrite(local, "geo-invalid", {
    ...core, location: { ...puebla, stateCode: "MX-UNKNOWN" },
  }, secondAt), /profile_location_invalid/);
  assert.equal(readPendingProfileWrite(local, "geo-invalid")?.revision, initial.revision);
});

test("snapshot USER_UPDATED no reejecuta pending ya confirmado al entrar al coordinador", async () => {
  const local = storage();
  const pending = queuePendingProfileWrite(local, "geo-user-updated", { ...core, location: puebla }, firstAt);
  const writer = createProfileWriteCoordinator();
  let finishFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { finishFirst = resolve; });
  let writes = 0;
  const first = writer.run(async () => {
    writes += 1;
    await firstGate;
    assert.equal(acknowledgePendingProfileWrite(local, "geo-user-updated", pending.revision), true);
  });
  const snapshotFromAuthEvent = readPendingProfileWrite(local, "geo-user-updated");
  const replay = writer.run(async () => {
    const current = readPendingProfileWrite(local, "geo-user-updated");
    if (!current || current.revision !== snapshotFromAuthEvent?.revision) return "skipped";
    writes += 1;
    return "replayed";
  });
  finishFirst();
  await first;
  assert.equal(await replay, "skipped");
  assert.equal(writes, 1);
});

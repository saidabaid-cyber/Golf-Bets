import assert from "node:assert/strict";
import test from "node:test";

import { accountDeletionMarkerKey } from "../lib/account-state";
import {
  acknowledgeEquipmentSyncOutbox,
  equipmentSyncStateStorageKey,
  queueEquipmentSyncOutbox,
  readEquipmentSyncState,
  recordEquipmentSyncBase,
} from "../lib/equipment-offline-store";
import {
  equipmentProfilesSemanticallyEqual,
  reconcileEquipmentProfiles,
  resolveEquipmentProfileConflicts,
} from "../lib/equipment-sync";
import {
  createEmptyEquipmentProfile,
  upsertPlayerClub,
  type EquipmentProfile,
  type PlayerClub,
} from "../lib/golf-equipment";

const USER_ID = "equipment-offline-user";
const BASE_AT = "2026-09-28T12:00:00.000Z";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

function baseProfile(): EquipmentProfile {
  const value = createEmptyEquipmentProfile(USER_ID, BASE_AT);
  assert.ok(value);
  return value;
}

function driver(updatedAt = BASE_AT): PlayerClub {
  return {
    id: "driver-1",
    userId: USER_ID,
    category: "DRIVER",
    catalogClubId: null,
    customBrand: "QA Brand",
    customModel: "QA Driver",
    generation: null,
    year: null,
    loft: 10,
    handedness: "RH",
    shaftId: null,
    customShaftBrand: null,
    customShaftModel: null,
    customShaft: null,
    flex: null,
    shaftFlexLabel: null,
    shaftWeightGrams: null,
    lengthInches: null,
    lieDegrees: null,
    grip: null,
    notes: null,
    setComposition: [],
    isCurrent: true,
    startedUsingAt: BASE_AT,
    stoppedUsingAt: null,
    createdAt: BASE_AT,
    updatedAt,
  };
}

test("timestamps de auditoría nunca crean un conflicto de equipo", () => {
  const base = baseProfile();
  const local = { ...base, updatedAt: "2026-09-28T12:01:00.000Z" };
  const remote = { ...base, updatedAt: "2026-09-28T12:02:00.000Z" };
  const result = reconcileEquipmentProfiles(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.needsUpload, false);
  assert.ok(equipmentProfilesSemanticallyEqual(result.profile, remote));
});

test("cambios unilaterales suben o bajan sin pedir elección manual", () => {
  const base = baseProfile();
  const local = { ...base, equipmentOnboarding: "COMPLETED" as const, updatedAt: "2026-09-28T12:01:00.000Z" };
  const localOnly = reconcileEquipmentProfiles(base, local, base);
  assert.deepEqual(localOnly.conflicts, []);
  assert.equal(localOnly.needsUpload, true);
  assert.equal(localOnly.profile?.equipmentOnboarding, "COMPLETED");

  const remote = { ...base, ballOnboarding: "COMPLETED" as const, updatedAt: "2026-09-28T12:02:00.000Z" };
  const remoteOnly = reconcileEquipmentProfiles(base, base, remote);
  assert.deepEqual(remoteOnly.conflicts, []);
  assert.equal(remoteOnly.needsUpload, false);
  assert.equal(remoteOnly.needsLocalWrite, true);
  assert.equal(remoteOnly.profile?.ballOnboarding, "COMPLETED");
});

test("un dispositivo nuevo sin copia persistida descarga la nube sin inventar un empty local", () => {
  const remote = {
    ...baseProfile(),
    equipmentOnboarding: "COMPLETED" as const,
    ballOnboarding: "COMPLETED" as const,
    updatedAt: "2026-09-28T12:02:00.000Z",
  };
  const result = reconcileEquipmentProfiles(null, null, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.needsUpload, false);
  assert.equal(result.needsLocalWrite, true);
  assert.equal(result.profile?.equipmentOnboarding, "COMPLETED");
  assert.equal(result.profile?.ballOnboarding, "COMPLETED");
});

test("ediciones disjuntas se combinan por campo y por id de equipo", () => {
  const original = upsertPlayerClub(baseProfile(), driver());
  assert.ok(original);
  const localClub = { ...original.clubs[0], grip: "Grip local", updatedAt: "2026-09-28T12:02:00.000Z" };
  const remoteClub = { ...original.clubs[0], loft: 11, updatedAt: "2026-09-28T12:03:00.000Z" };
  const local = upsertPlayerClub({ ...original, equipmentOnboarding: "COMPLETED" }, localClub, localClub.updatedAt);
  const remote = upsertPlayerClub({ ...original, ballOnboarding: "COMPLETED" }, remoteClub, remoteClub.updatedAt);
  assert.ok(local && remote);

  const result = reconcileEquipmentProfiles(original, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.needsUpload, true);
  assert.equal(result.profile?.equipmentOnboarding, "COMPLETED");
  assert.equal(result.profile?.ballOnboarding, "COMPLETED");
  assert.equal(result.profile?.clubs[0].grip, "Grip local");
  assert.equal(result.profile?.clubs[0].loft, 11);
});

test("sólo el mismo campo divergente pide elección y la resolución conserva lo compatible", () => {
  const base = baseProfile();
  const local = {
    ...base,
    equipmentOnboarding: "COMPLETED" as const,
    ballPreference: "NO_FIXED_BALL" as const,
    updatedAt: "2026-09-28T12:01:00.000Z",
  };
  const remote = {
    ...base,
    ballOnboarding: "COMPLETED" as const,
    ballPreference: "SKIPPED" as const,
    updatedAt: "2026-09-28T12:02:00.000Z",
  };
  const result = reconcileEquipmentProfiles(base, local, remote);
  assert.deepEqual(result.conflicts.map((item) => item.path), ["/ballPreference"]);

  const resolved = resolveEquipmentProfileConflicts(base, local, remote, "remote");
  assert.equal(resolved.ballPreference, "SKIPPED");
  assert.equal(resolved.equipmentOnboarding, "COMPLETED");
  assert.equal(resolved.ballOnboarding, "COMPLETED");
});

test("offline → reload → reconnect conserva outbox, usa la base y reconoce sólo el ACK exacto", () => {
  const storage = new MemoryStorage();
  const base = baseProfile();
  recordEquipmentSyncBase(storage, USER_ID, {
    profile: base,
    version: 1,
    lastMutationId: "server-base-mutation",
    updatedAt: BASE_AT,
  });
  const local = { ...base, equipmentOnboarding: "COMPLETED" as const, updatedAt: "2026-09-28T12:04:00.000Z" };
  const queued = queueEquipmentSyncOutbox(storage, USER_ID, local, "offline-mutation", "2026-09-28T12:04:01.000Z");

  const afterReload = readEquipmentSyncState(storage, USER_ID);
  assert.equal(afterReload.base?.version, 1);
  assert.equal(afterReload.outbox?.mutationId, "offline-mutation");
  const reconnect = reconcileEquipmentProfiles(afterReload.base?.profile ?? null, afterReload.outbox?.profile ?? null, base);
  assert.deepEqual(reconnect.conflicts, []);
  assert.equal(reconnect.needsUpload, true);

  const newer = { ...local, ballOnboarding: "COMPLETED" as const, updatedAt: "2026-09-28T12:05:00.000Z" };
  const newerQueued = queueEquipmentSyncOutbox(storage, USER_ID, newer, "newer-mutation", "2026-09-28T12:05:01.000Z");
  assert.equal(acknowledgeEquipmentSyncOutbox(storage, USER_ID, queued.fingerprint, queued.mutationId), false);
  assert.equal(readEquipmentSyncState(storage, USER_ID).outbox?.mutationId, "newer-mutation");

  recordEquipmentSyncBase(storage, USER_ID, {
    profile: newer,
    version: 2,
    lastMutationId: newerQueued.mutationId,
    updatedAt: "2026-09-28T12:05:02.000Z",
  });
  assert.equal(acknowledgeEquipmentSyncOutbox(storage, USER_ID, newerQueued.fingerprint, newerQueued.mutationId), true);
  assert.equal(readEquipmentSyncState(storage, USER_ID).outbox, null);
  assert.equal(readEquipmentSyncState(storage, USER_ID).base?.version, 2);
});

test("el barrier de eliminación impide recrear el outbox del owner", () => {
  const storage = new MemoryStorage();
  storage.setItem(accountDeletionMarkerKey(USER_ID), "pending");
  assert.throws(() => queueEquipmentSyncOutbox(storage, USER_ID, baseProfile(), "blocked-mutation"), /account_deletion_in_progress/);
  assert.equal(storage.getItem(equipmentSyncStateStorageKey(USER_ID)!), null);
});

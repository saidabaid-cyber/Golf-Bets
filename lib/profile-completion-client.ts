import { readEquipmentSyncState } from "./equipment-offline-store";
import {
  equipmentProfileFingerprint,
  loadEquipmentProfile,
  type EquipmentProfile,
} from "./golf-equipment";

export type CompletionEquipmentRevision = {
  version: number;
  updatedAt: string;
} | null;

/** Select a local EquipmentProfile only when it is demonstrably ahead of the
 * cloud revision used by /api/account/completion. */
export function completionEquipmentOverride(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  userId: string,
  remote: CompletionEquipmentRevision,
): EquipmentProfile | null {
  const localRead = loadEquipmentProfile(storage, userId);
  if (!localRead.ok || !localRead.profile) return null;
  const local = localRead.profile;
  const state = readEquipmentSyncState(storage, userId);
  // The locally-confirmed aggregate is authoritative for the current device.
  // An outbox may lag it when the profile write succeeds but replacing the
  // queued mutation hits a quota/storage error.
  if (state.outbox) return local;

  const localFingerprint = equipmentProfileFingerprint(local, userId);
  const baseFingerprint = equipmentProfileFingerprint(state.base?.profile ?? null, userId);
  if (state.base) {
    if (!remote || remote.version < state.base.version) return local;
    return localFingerprint !== baseFingerprint ? local : null;
  }
  if (!remote) return local;
  return Date.parse(local.updatedAt) > Date.parse(remote.updatedAt) ? local : null;
}

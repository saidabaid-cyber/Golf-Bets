import { equipmentProfileFingerprint, type EquipmentProfile } from "./golf-equipment";

export const EQUIPMENT_PROFILE_UPDATED_EVENT = "backyard:equipment-profile-updated";

export type EquipmentProfileUpdatedDetail = {
  userId: string;
  fingerprint: string;
};

export function publishEquipmentProfileUpdated(profile: EquipmentProfile) {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  const fingerprint = equipmentProfileFingerprint(profile, profile.userId);
  if (!fingerprint) return;
  window.dispatchEvent(new CustomEvent<EquipmentProfileUpdatedDetail>(EQUIPMENT_PROFILE_UPDATED_EVENT, {
    detail: { userId: profile.userId, fingerprint },
  }));
}

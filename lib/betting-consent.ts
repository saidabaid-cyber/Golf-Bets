import {
  ACCOUNT_STORAGE_KEYS,
  buildBettingDataAcceptance,
  hasCurrentBettingDataConsent,
  mergeLegalAcceptances,
  parseLegalAcceptances,
  type ConsentSyncStatus,
  type LegalAcceptance,
} from "./account-state";

type ConsentStorage = Pick<Storage, "getItem" | "setItem">;

export type PersistBettingConsentResult = {
  acceptance: LegalAcceptance;
  acceptances: LegalAcceptance[];
};

/** Persist and read back the exact express consent before a protected feature
 * can continue. Existing evidence is merged, never migrated or overwritten. */
export function persistBettingDataConsent(
  storage: ConsentStorage,
  userId: string,
  syncStatus: ConsentSyncStatus,
  acceptedAt = new Date().toISOString(),
): PersistBettingConsentResult {
  const current = parseLegalAcceptances(storage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
  const acceptance = buildBettingDataAcceptance(userId, acceptedAt, syncStatus);
  const merged = mergeLegalAcceptances(current, [acceptance]);
  storage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
  const verified = parseLegalAcceptances(storage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
  if (!hasCurrentBettingDataConsent(verified, userId)) {
    throw new Error("No se pudo comprobar la aceptación en este dispositivo.");
  }
  const exact = verified.find((item) => item.userId === userId
    && item.type === acceptance.type
    && item.documentVersion === acceptance.documentVersion
    && item.acceptedAt === acceptance.acceptedAt);
  if (!exact) throw new Error("La evidencia de aceptación no coincide con lo guardado.");
  return { acceptance: exact, acceptances: verified };
}

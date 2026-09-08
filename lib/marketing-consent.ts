export const MARKETING_CONSENT_VERSION = "2026-09-08-v1";
const PREFIX = "backyard-marketing-consent-v1";

export type MarketingConsentRecord = {
  userId: string;
  scope: "MARKETING_OPTIONAL";
  policyVersion: string;
  presentedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export function marketingConsentStorageKey(userId: string) {
  return `${PREFIX}:${encodeURIComponent(userId)}`;
}

export function readMarketingConsent(storage: Pick<Storage, "getItem">, userId: string): MarketingConsentRecord | null {
  try {
    const value = JSON.parse(storage.getItem(marketingConsentStorageKey(userId)) || "null") as Partial<MarketingConsentRecord> | null;
    if (!value || value.userId !== userId || value.scope !== "MARKETING_OPTIONAL" || value.policyVersion !== MARKETING_CONSENT_VERSION) return null;
    return value as MarketingConsentRecord;
  } catch { return null; }
}

export function writeMarketingConsent(storage: Pick<Storage, "getItem" | "setItem">, userId: string, accepted: boolean, now = new Date().toISOString()) {
  const previous = readMarketingConsent(storage, userId);
  const record: MarketingConsentRecord = {
    userId,
    scope: "MARKETING_OPTIONAL",
    policyVersion: MARKETING_CONSENT_VERSION,
    presentedAt: previous?.presentedAt || now,
    acceptedAt: accepted ? now : previous?.acceptedAt || null,
    revokedAt: accepted ? null : now,
  };
  storage.setItem(marketingConsentStorageKey(userId), JSON.stringify(record));
  return record;
}

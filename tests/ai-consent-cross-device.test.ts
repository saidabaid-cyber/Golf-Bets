import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptAiProcessingConsent, acknowledgeRemoteAiProcessingConsentRevocation,
  readAiProcessingConsent, reconcileAuthoritativeAiProcessingConsent, revokeAiProcessingConsent,
} from "../lib/backyard-ai/processing-consent";
import { AI_PROVIDER_PROCESSING_CONSENT as SCOPE } from "../lib/backyard-ai/privacy";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  reload() { const other = new MemoryStorage(); other.values = new Map(this.values); return other; }
}
const ACCEPTED = "2026-09-16T01:00:00.000Z";
const REVOKED = "2026-09-16T02:00:00.000Z";
const active = (recordId: string) => ({ active: true, recordId, acceptedAt: ACCEPTED, revokedAt: null });
const revoked = (recordId: string) => ({ active: false, recordId, acceptedAt: ACCEPTED, revokedAt: REVOKED });

test("pending local revocation stays fail-closed even with a newer remote acceptance", () => {
  const storage = new MemoryStorage();
  const owner = "pending-across-devices";
  reconcileAuthoritativeAiProcessingConsent(storage, owner, SCOPE, active("10"));
  revokeAiProcessingConsent(storage, owner, SCOPE, REVOKED);
  assert.equal(readAiProcessingConsent(storage, owner, SCOPE)?.revocationSync, "pending");
  const result = reconcileAuthoritativeAiProcessingConsent(storage.reload(), owner, SCOPE, active("11"));
  assert.equal(result.active, false);
  assert.equal(result.pendingLocalRevocation, true);
  assert.equal(result.consent?.serverRecordId, "10");
});

test("server acknowledgement persists and a new ledger identity restores consent on another device after reload", () => {
  const storage = new MemoryStorage();
  const owner = "confirmed-across-devices";
  reconcileAuthoritativeAiProcessingConsent(storage, owner, SCOPE, active("10"));
  // Deliberate browser clock skew: comparisons MUST use server ledger identities.
  revokeAiProcessingConsent(storage, owner, SCOPE, "2050-01-01T00:00:00.000Z");
  const acknowledged = acknowledgeRemoteAiProcessingConsentRevocation(storage, owner, SCOPE, revoked("10"));
  assert.equal(acknowledged.ok, true);
  assert.equal(acknowledged.ok && acknowledged.consent.revocationSync, "confirmed");
  const refreshed = storage.reload();
  assert.equal(readAiProcessingConsent(refreshed, owner, SCOPE)?.revocationSync, "confirmed");
  // Same timestamp is intentional: identity, not wall clock, proves new acceptance.
  const reauthorized = reconcileAuthoritativeAiProcessingConsent(refreshed, owner, SCOPE, active("11"));
  assert.equal(reauthorized.active, true);
  assert.equal(reauthorized.pendingLocalRevocation, false);
  assert.equal(reauthorized.consent?.serverRecordId, "11");
  assert.equal(readAiProcessingConsent(refreshed.reload(), owner, SCOPE)?.revokedAt, null);
});

test("GET of the server revocation also acknowledges the pending local tombstone", () => {
  const storage = new MemoryStorage();
  const owner = "server-get-acknowledgement";
  reconcileAuthoritativeAiProcessingConsent(storage, owner, SCOPE, active("50"));
  revokeAiProcessingConsent(storage, owner, SCOPE, REVOKED);
  const result = reconcileAuthoritativeAiProcessingConsent(storage, owner, SCOPE, revoked("50"));
  assert.equal(result.active, false);
  assert.equal(result.pendingLocalRevocation, false);
  assert.equal(result.consent?.revocationSync, "confirmed");
});

test("stale pre-revocation GET cannot resurrect acknowledged consent", () => {
  const storage = new MemoryStorage();
  const owner = "stale-server-active";
  acknowledgeRemoteAiProcessingConsentRevocation(storage, owner, SCOPE, revoked("50"));
  for (const identity of ["49", "50"]) {
    const result = reconcileAuthoritativeAiProcessingConsent(storage, owner, SCOPE, active(identity));
    assert.equal(result.active, false);
    assert.equal(result.pendingLocalRevocation, false);
    assert.equal(result.consent?.serverRecordId, "50");
    assert.equal(result.consent?.revocationSync, "confirmed");
  }
});

test("an older server revocation cannot acknowledge or overwrite a newer pending one", () => {
  const storage = new MemoryStorage();
  const owner = "old-server-revoked";
  reconcileAuthoritativeAiProcessingConsent(storage, owner, SCOPE, active("100"));
  revokeAiProcessingConsent(storage, owner, SCOPE, REVOKED);
  assert.equal(acknowledgeRemoteAiProcessingConsentRevocation(storage, owner, SCOPE, revoked("99")).ok, false);
  assert.equal(readAiProcessingConsent(storage, owner, SCOPE)?.serverRecordId, "100");
  assert.equal(readAiProcessingConsent(storage, owner, SCOPE)?.revocationSync, "pending");
  assert.equal(reconcileAuthoritativeAiProcessingConsent(storage, owner, SCOPE, revoked("99")).pendingLocalRevocation, true);
});

test("legacy revoked cache without sync metadata remains pending until server confirms matching acceptance", () => {
  const storage = new MemoryStorage();
  const owner = "legacy-revoked-cache";
  acceptAiProcessingConsent(storage, owner, SCOPE, ACCEPTED);
  revokeAiProcessingConsent(storage, owner, SCOPE, REVOKED);
  for (const [key, value] of storage.values) {
    const document = JSON.parse(value);
    for (const item of document.items) { delete item.revocationSync; delete item.serverRecordId; }
    storage.setItem(key, JSON.stringify(document));
  }
  const existing = readAiProcessingConsent(storage.reload(), owner, SCOPE);
  assert.equal(existing?.revocationSync, "pending");
  assert.equal(reconcileAuthoritativeAiProcessingConsent(storage, owner, SCOPE, active("500")).active, false);
  assert.equal(acknowledgeRemoteAiProcessingConsentRevocation(storage, owner, SCOPE, revoked("500")).ok, true);
  assert.equal(reconcileAuthoritativeAiProcessingConsent(storage.reload(), owner, SCOPE, active("501")).active, true);
});

test("server confirmation requires a real monotonic ledger identity, not a newer date alone", () => {
  const storage = new MemoryStorage();
  const owner = "malformed-server-identity";
  reconcileAuthoritativeAiProcessingConsent(storage, owner, SCOPE, active("7"));
  revokeAiProcessingConsent(storage, owner, SCOPE, REVOKED);
  for (const recordId of ["", "0", "-1", "7.1", "not-an-id"]) {
    assert.equal(acknowledgeRemoteAiProcessingConsentRevocation(storage, owner, SCOPE, revoked(recordId)).ok, false);
  }
  assert.equal(readAiProcessingConsent(storage, owner, SCOPE)?.revocationSync, "pending");
});

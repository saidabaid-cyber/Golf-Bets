import { mergeActiveDraftGranular, stableValue, stripLocalRoundUi, type CloudDataBundle } from "./cloud-sync";

const fingerprint = (value: unknown) => JSON.stringify(stableValue(stripLocalRoundUi(value)));
const id = (value: unknown) => value && typeof value === "object" ? (value as { roundId?: unknown }).roundId : undefined;

/** A render revision fences this tab only. This boundary additionally fences
 * writes from another tab of the same account, before autosave/pagehide/sync
 * can replace its newer active slot with this tab's old card or empty bootstrap.
 * It is neither an auth check nor a cloud ACK. */
export class RoundDraftTabBoundary {
  private base: unknown = null;
  remember(value: unknown) { this.base = structuredClone(value); }
  isCurrent(value: unknown) { return fingerprint(this.base) === fingerprint(value); }
  reconcile(local: unknown, incoming: unknown) {
    const localChanged = fingerprint(local) !== fingerprint(this.base);
    if (!localChanged) return { draft: incoming, preserveLocal: false };
    // Different cards cannot be merged field by field. Keep the superseded
    // tab's edits in the existing conflict archive before adopting the slot.
    if (!id(local) || id(local) !== id(incoming)) return { draft: incoming, preserveLocal: local !== null };
    const bundle = (activeDraft: unknown): CloudDataBundle => ({ version: 1, history: [], frequentPlayers: [], frequentGroups: [], rivals: [], courses: [], tombstones: [],
      preferences: { highContrast: true, language: "es-MX", notificationsEnabled: false, defaultHandicap: null }, activeDraft });
    const merged = mergeActiveDraftGranular({ ...bundle(local), baseDraft: this.base, baseDraftFingerprint: fingerprint(this.base) }, bundle(incoming));
    // Divergent same-cell edits are archived rather than silently discarded.
    return { draft: merged.value, preserveLocal: merged.conflicts.length > 0 };
  }
}

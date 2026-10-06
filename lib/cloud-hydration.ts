import { stableValue, stripLocalRoundUi } from "./cloud-sync";
import type { RoundSnapshot } from "./types";

const equal = (a: unknown, b: unknown) => JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Apply only changes made to the hydrated view. Defaults/migrations used for
 * display are not edits, and server fields absent from the editor survive.
 * The cloud base/revision is deliberately NOT acknowledged here. CAS and the
 * normal sync cycle still decide which pending edits have been persisted. */
function viewEdits(canonical: unknown, baseline: unknown, next: unknown): unknown {
  if (equal(baseline, next)) return structuredClone(canonical);
  if (record(baseline) && record(next)) {
    const result = record(canonical) ? structuredClone(canonical) : {};
    for (const key of new Set([...Object.keys(baseline), ...Object.keys(next)])) {
      if (equal(baseline[key], next[key])) continue;
      if (next[key] === undefined) delete result[key];
      else result[key] = viewEdits(result[key], baseline[key], next[key]);
    }
    return result;
  }
  return structuredClone(next);
}

function historyMaterial(round: RoundSnapshot) {
  const { updatedAt, ...material } = round; void updatedAt;
  return material;
}

/** Private, account-scoped in-memory editing boundary; never shared or stored
 * as an authorization/ACK. Raw canonical data remains in the owned workspace. */
export class CloudHydrationBoundary {
  private draft: { canonical: unknown; view: unknown; roundId: unknown } | null = null;
  private history = new Map<string, { canonical: RoundSnapshot; view: RoundSnapshot }>();

  rememberDraft(canonical: unknown, view: unknown) {
    this.draft = record(canonical) && record(view) && canonical.roundId === view.roundId
      ? { canonical: structuredClone(stripLocalRoundUi(canonical)), view: structuredClone(stripLocalRoundUi(view)), roundId: canonical.roundId }
      : null;
  }

  projectDraft<T>(next: T): T {
    const baseline = this.draft;
    if (!baseline || !record(next) || next.roundId !== baseline.roundId) return next;
    const result = viewEdits(baseline.canonical, baseline.view, stripLocalRoundUi(next));
    // Local navigation stays durable locally, outside the synchronized material.
    return (record(result) && Object.hasOwn(next, "currentIndex") ? { ...result, currentIndex: next.currentIndex } : result) as T;
  }

  rememberHistory(canonical: RoundSnapshot[], view: RoundSnapshot[]) {
    const byId = new Map(canonical.map(round => [round.id, round]));
    this.history = new Map(view.flatMap(round => {
      const source = byId.get(round.id);
      return source ? [[round.id, { canonical: structuredClone(source), view: structuredClone(round) }] as const] : [];
    }));
  }

  projectHistory(next: RoundSnapshot[]) {
    return next.map(round => {
      const baseline = this.history.get(round.id);
      // A timestamp alone does not make a completed card a new material edit.
      return baseline && equal(historyMaterial(round), historyMaterial(baseline.view))
        ? structuredClone(baseline.canonical) : round;
    });
  }

  clear() { this.draft = null; this.history.clear(); }
}

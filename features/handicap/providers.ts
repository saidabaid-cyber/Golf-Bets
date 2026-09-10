import type { HandicapProvider, HandicapRecord, ProviderResult } from "../../lib/golf-providers";
import { normalizeBackyardHandicap } from "./course-handicap";

export function createManualHandicapProvider(records: Readonly<Record<string, number>>, effectiveAt: string): HandicapProvider {
  return {
    id: "backyard-manual",
    label: "HCP manual de The Backyard",
    capabilities: { current_index: true, history: false, account_link: false, authorized_write: false },
    async getCurrent(input): Promise<ProviderResult<HandicapRecord>> {
      const value = records[input.userId];
      if (value === undefined) return { ok: false, code: "not_found", message: "Este jugador no tiene HCP manual.", providerId: this.id };
      return { ok: true, providerId: this.id, data: { value: normalizeBackyardHandicap(value), effectiveAt, classification: "manual", authorityLabel: "The Backyard · manual" } };
    },
  };
}

/** Explicitly fail-closed until an authorized GHIN integration exists. */
export const futureGhinHandicapProvider: HandicapProvider = {
  id: "ghin-official-future",
  label: "GHIN oficial (requiere autorización)",
  capabilities: { current_index: false, history: false, account_link: false, authorized_write: false },
  async getCurrent() {
    return { ok: false, code: "not_authorized", message: "La integración GHIN oficial aún no está autorizada.", providerId: this.id };
  },
};

import type { HandicapProvider, HandicapRecord, ProviderResult } from "../../lib/golf-providers";
import type { GhinReadResult } from "../../lib/ghin/client";
import type { NormalizedGhinGolfer } from "../../lib/ghin/core";
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

export type GhinGolferReader = {
  lookupGolfer(ghinNumber: string): Promise<GhinReadResult<NormalizedGhinGolfer>>;
};

export type GhinHandicapProviderOptions = {
  enabled: boolean;
  /** Must stay false until a live identity lookup has been explicitly validated. */
  allowAccountLink?: boolean;
};

function providerFailure(error: unknown): Extract<ProviderResult<never>, { ok: false }> {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    if (error.code === "unauthorized" || error.code === "forbidden" || error.code === "invalid_credentials") {
      return { ok: false, code: "not_authorized", message: "GHIN no autorizó la consulta.", providerId: "ghin-read-only" };
    }
    if (error.code === "not_found" || error.code === "inactive_golfer") {
      return { ok: false, code: "not_found", message: "GHIN no encontró un handicap activo.", providerId: "ghin-read-only" };
    }
    if (error.code === "invalid_response") {
      return { ok: false, code: "invalid_response", message: "GHIN devolvió una respuesta no reconocida.", providerId: "ghin-read-only" };
    }
  }
  return { ok: false, code: "temporarily_unavailable", message: "GHIN no está disponible temporalmente.", providerId: "ghin-read-only" };
}

/**
 * Adapter over the existing provider abstraction. It reads an official index
 * as-is; it never caps it to The Backyard's manual-entry range and never
 * fabricates zero when GHIN reports NH/null.
 */
export function createGhinHandicapProvider(
  reader: GhinGolferReader,
  options: GhinHandicapProviderOptions,
): HandicapProvider {
  const accountLink = options.enabled && options.allowAccountLink === true;
  return {
    id: "ghin-read-only",
    label: "GHIN · sólo lectura",
    capabilities: {
      current_index: options.enabled,
      history: false,
      account_link: accountLink,
      authorized_write: false,
    },
    async getCurrent(input) {
      if (!options.enabled) {
        return { ok: false, code: "not_configured", message: "La lectura GHIN no está habilitada.", providerId: this.id };
      }
      const ghinNumber = input.externalPlayerId?.trim();
      if (!ghinNumber) {
        return { ok: false, code: "not_found", message: "Falta asociar un número GHIN.", providerId: this.id };
      }
      try {
        const { data, fetchedAt } = await reader.lookupGolfer(ghinNumber);
        if (data.ghinNumber !== ghinNumber) {
          return { ok: false, code: "invalid_response", message: "GHIN devolvió una identidad distinta.", providerId: this.id };
        }
        if (data.status === "inactive" || data.handicapIndex === null) {
          return { ok: false, code: "not_found", message: "GHIN no reportó un handicap activo.", providerId: this.id };
        }
        return {
          ok: true,
          providerId: this.id,
          data: {
            value: data.handicapIndex,
            effectiveAt: data.updatedAt ?? fetchedAt,
            classification: "official",
            authorityLabel: "USGA GHIN",
            externalPlayerId: data.ghinNumber,
          },
        };
      } catch (error) {
        return providerFailure(error);
      }
    },
  };
}

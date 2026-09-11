import type { Hole } from "../../lib/types";

export type CaddieShotPhase = "TEE_SHOT" | "APPROACH" | "AROUND_GREEN";

export type CaddieHoleContext = {
  hole: number;
  par: number;
  yards: number | null;
  strokeIndex: number;
  shotPhase: CaddieShotPhase;
  gpsAvailable: boolean;
  greenDistances: { front?: number; center?: number; back?: number } | null;
  hazardsVerified: boolean;
  bagClubCount: number;
  clubDistanceSamplesAvailable: boolean;
  wind: { speed: number; direction: string } | null;
  elevationChange: number | null;
  pinPosition: string | null;
};

/** The Caddie receives only explicit facts. Missing inputs stay null/false. */
export function buildCaddieHoleContext(input: {
  hole: Hole;
  shotPhase?: CaddieShotPhase;
  gpsAvailable?: boolean;
  greenDistances?: CaddieHoleContext["greenDistances"];
  hazardsVerified?: boolean;
  bagClubCount?: number;
  clubDistanceSamplesAvailable?: boolean;
}): CaddieHoleContext {
  return {
    hole: input.hole.number,
    par: input.hole.par,
    yards: typeof input.hole.yards === "number" && Number.isFinite(input.hole.yards) ? input.hole.yards : null,
    strokeIndex: input.hole.strokeIndex,
    shotPhase: input.shotPhase ?? "TEE_SHOT",
    gpsAvailable: input.gpsAvailable === true,
    greenDistances: input.greenDistances ?? null,
    hazardsVerified: input.hazardsVerified === true,
    bagClubCount: Math.max(0, Math.trunc(input.bagClubCount ?? 0)),
    clubDistanceSamplesAvailable: input.clubDistanceSamplesAvailable === true,
    wind: null,
    elevationChange: null,
    pinPosition: null,
  };
}

export function missingCaddieInputs(context: CaddieHoleContext) {
  const missing: string[] = [];
  if (!context.gpsAvailable || !context.greenDistances) missing.push("distancias GPS");
  if (!context.hazardsVerified) missing.push("hazards verificados");
  if (!context.bagClubCount) missing.push("Mi Bolsa");
  if (!context.clubDistanceSamplesAvailable) missing.push("distancias por palo");
  if (!context.wind) missing.push("viento");
  if (!context.pinPosition) missing.push("posición de bandera");
  return missing;
}

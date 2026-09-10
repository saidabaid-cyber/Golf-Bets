import { haversineDistanceKm, isValidGeographicPoint, type CourseGeographicPoint } from "../../lib/course-distance";
import type { GolfHole } from "../../lib/golf-course-directory";

export type GpsFix = CourseGeographicPoint & {
  accuracyMeters?: number;
  capturedAt: string;
};

export type GreenDistances = {
  frontYards?: number;
  centerYards?: number;
  backYards?: number;
  accuracyMeters?: number;
};

export type HoleSuggestion = {
  holeNumber: number;
  distanceYards: number;
  shouldOffer: boolean;
};

function yardsBetween(origin: CourseGeographicPoint, target: CourseGeographicPoint) {
  const distanceKm = haversineDistanceKm(origin, target);
  return distanceKm === null ? undefined : Math.round(distanceKm * 1093.6133);
}

function point(latitude: number | undefined, longitude: number | undefined) {
  const value = { latitude, longitude };
  return isValidGeographicPoint(value) ? value : null;
}

export function calculateGreenDistances(fix: GpsFix, hole: Pick<GolfHole, "greenFrontLatitude" | "greenFrontLongitude" | "greenCenterLatitude" | "greenCenterLongitude" | "greenBackLatitude" | "greenBackLongitude">): GreenDistances {
  if (!isValidGeographicPoint(fix)) return {};
  const front = point(hole.greenFrontLatitude, hole.greenFrontLongitude);
  const center = point(hole.greenCenterLatitude, hole.greenCenterLongitude);
  const back = point(hole.greenBackLatitude, hole.greenBackLongitude);
  return {
    ...(front ? { frontYards: yardsBetween(fix, front) } : {}),
    ...(center ? { centerYards: yardsBetween(fix, center) } : {}),
    ...(back ? { backYards: yardsBetween(fix, back) } : {}),
    ...(Number.isFinite(fix.accuracyMeters) ? { accuracyMeters: Math.max(0, fix.accuracyMeters as number) } : {}),
  };
}

/** Returns an offer only; callers must never jump holes without user action. */
export function suggestCurrentHole(input: { fix: GpsFix; holes: readonly GolfHole[]; currentHole: number; maxDistanceYards?: number; minimumImprovementYards?: number }): HoleSuggestion | null {
  if (!isValidGeographicPoint(input.fix)) return null;
  const candidates = input.holes.flatMap((hole) => {
    const target = point(hole.greenCenterLatitude, hole.greenCenterLongitude) ?? point(hole.teeLatitude, hole.teeLongitude);
    const distanceYards = target ? yardsBetween(input.fix, target) : undefined;
    return distanceYards === undefined ? [] : [{ holeNumber: hole.holeNumber, distanceYards }];
  }).sort((left, right) => left.distanceYards - right.distanceYards || left.holeNumber - right.holeNumber);
  const closest = candidates[0];
  if (!closest || closest.distanceYards > (input.maxDistanceYards ?? 750)) return null;
  const current = candidates.find((candidate) => candidate.holeNumber === input.currentHole);
  const improvement = current ? current.distanceYards - closest.distanceYards : Number.POSITIVE_INFINITY;
  return { ...closest, shouldOffer: closest.holeNumber !== input.currentHole && improvement >= (input.minimumImprovementYards ?? 100) };
}

export type GpsFallbackState = "DENIED" | "UNAVAILABLE" | "TIMEOUT" | "INACCURATE";

export function gpsFallbackMessage(state: GpsFallbackState) {
  const messages: Record<GpsFallbackState, string> = {
    DENIED: "No compartiste tu ubicación. Puedes seguir capturando score.",
    UNAVAILABLE: "GPS no disponible. Puedes seguir capturando score.",
    TIMEOUT: "La ubicación tardó demasiado. Puedes seguir capturando score.",
    INACCURATE: "La señal GPS no es suficientemente precisa; no mostraremos una distancia dudosa.",
  };
  return messages[state];
}

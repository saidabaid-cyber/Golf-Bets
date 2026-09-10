import { haversineDistanceKm, isValidGeographicPoint } from "../../lib/course-distance";
import type { RoundShotSnapshot } from "../../lib/types";

export type ShotLocation = { latitude: number; longitude: number; accuracyMeters?: number };
export type ShotShaftSnapshot = NonNullable<RoundShotSnapshot["clubSnapshot"]["shaft"]>;

function buildClubSnapshot(input: {
  clubId?: string;
  clubLabel: string;
  category?: string;
  model?: string;
  shaft?: ShotShaftSnapshot | null;
}): RoundShotSnapshot["clubSnapshot"] {
  return {
    ...(input.clubId ? { id: input.clubId } : {}),
    label: input.clubLabel.trim(),
    ...(input.category ? { category: input.category } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.shaft ? { shaft: structuredClone(input.shaft) } : {}),
  };
}

export function startShot(input: {
  id: string;
  roundId: string;
  playerId: string;
  hole: number;
  clubId?: string;
  clubLabel: string;
  category?: string;
  model?: string;
  shaft?: ShotShaftSnapshot | null;
  location?: ShotLocation;
  startedAt: string;
  existing: readonly RoundShotSnapshot[];
}): RoundShotSnapshot {
  if (!input.id || !input.roundId || !input.playerId || !input.clubLabel.trim()) throw new Error("Falta información del golpe.");
  if (!Number.isInteger(input.hole) || input.hole < 1 || input.hole > 18) throw new Error("Hoyo inválido.");
  const sequence = input.existing.filter((shot) => shot.roundId === input.roundId && shot.playerId === input.playerId && shot.hole === input.hole).reduce((max, shot) => Math.max(max, shot.sequence), 0) + 1;
  return {
    id: input.id,
    roundId: input.roundId,
    playerId: input.playerId,
    hole: input.hole,
    sequence,
    ...(input.clubId ? { clubId: input.clubId } : {}),
    clubLabel: input.clubLabel.trim(),
    clubSnapshot: buildClubSnapshot(input),
    ...(input.location && isValidGeographicPoint(input.location) ? { startLocation: { ...input.location } } : {}),
    startedAt: input.startedAt,
    source: input.location ? "GPS" : "MANUAL",
  };
}

export function closeShot(shot: RoundShotSnapshot, location: ShotLocation | undefined, endedAt: string): RoundShotSnapshot {
  if (shot.endedAt) return shot;
  if (!location || !shot.startLocation || !isValidGeographicPoint(location) || !isValidGeographicPoint(shot.startLocation)) return { ...shot, endedAt };
  const accuracy = Math.max(location.accuracyMeters ?? 0, shot.startLocation.accuracyMeters ?? 0);
  const distanceKm = haversineDistanceKm(shot.startLocation, location);
  if (distanceKm === null || accuracy > 50) return { ...shot, endLocation: { ...location }, endedAt };
  return { ...shot, endLocation: { ...location }, distanceYards: Math.round(distanceKm * 1093.6133), endedAt };
}

export function cancelShot(shots: readonly RoundShotSnapshot[], shotId: string) {
  return shots.filter((shot) => shot.id !== shotId);
}

export function updateShotClub(shot: RoundShotSnapshot, input: { clubId?: string; label: string; category?: string; model?: string; shaft?: ShotShaftSnapshot | null }) {
  if (!input.label.trim()) return shot;
  return { ...shot, clubId: input.clubId, clubLabel: input.label.trim(), clubSnapshot: buildClubSnapshot({ ...input, clubLabel: input.label }) };
}

export type ClubDistanceSummary = { clubLabel: string; averageYards: number | null; sampleCount: number; confidence: "INSUFFICIENT" | "EARLY" | "RELIABLE" };

export function summarizeClubDistances(shots: readonly RoundShotSnapshot[], minimumSamples = 3, reliableSamples = 8): ClubDistanceSummary[] {
  const groups = new Map<string, number[]>();
  for (const shot of shots) {
    if (!Number.isFinite(shot.distanceYards) || (shot.distanceYards as number) < 5 || (shot.distanceYards as number) > 500) continue;
    groups.set(shot.clubLabel, [...(groups.get(shot.clubLabel) ?? []), shot.distanceYards as number]);
  }
  return Array.from(groups, ([clubLabel, values]): ClubDistanceSummary => ({
    clubLabel,
    averageYards: values.length >= minimumSamples ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    sampleCount: values.length,
    confidence: values.length >= reliableSamples ? "RELIABLE" : values.length >= minimumSamples ? "EARLY" : "INSUFFICIENT",
  })).sort((a, b) => (b.averageYards ?? -1) - (a.averageYards ?? -1) || a.clubLabel.localeCompare(b.clubLabel, "es-MX"));
}

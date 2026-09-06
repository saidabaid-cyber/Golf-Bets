import type { PhysicalNine, RoundHalf } from "./types";

export const ROUND_HALF_SIZE = 9;

/** Classifies a physical hole by its position in the actual played order. */
export function getRoundHalf({
  hole,
  roundHoles,
}: {
  hole: number;
  roundHoles: readonly number[];
}): RoundHalf {
  const index = roundHoles.indexOf(hole);
  if (index < 0) throw new RangeError(`Hole ${hole} is not part of the round order.`);
  return index < ROUND_HALF_SIZE ? "first_half" : "second_half";
}

export function roundHalfForHole(hole: number, roundHoles: readonly number[]): RoundHalf | null {
  return roundHoles.includes(hole) ? getRoundHalf({ hole, roundHoles }) : null;
}

export function roundHalfHoles(roundHoles: readonly number[], half: RoundHalf) {
  return half === "first_half"
    ? [...roundHoles.slice(0, ROUND_HALF_SIZE)]
    : [...roundHoles.slice(ROUND_HALF_SIZE, ROUND_HALF_SIZE * 2)];
}

/** Compatibility key for old keeper records that were stored by physical nine. */
export function physicalNineForPlayedHalf(roundHoles: readonly number[], half: RoundHalf): PhysicalNine | null {
  const holes = roundHalfHoles(roundHoles, half);
  if (holes.length && holes.every((hole) => hole >= 1 && hole <= 9)) return "holes_1_9";
  if (holes.length && holes.every((hole) => hole >= 10 && hole <= 18)) return "holes_10_18";
  return null;
}

export function playedHalfLabel(half: RoundHalf) {
  return half === "first_half" ? "PRIMERA VUELTA" : "SEGUNDA VUELTA";
}

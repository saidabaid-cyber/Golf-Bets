import type { FoursomeSegment } from "./types";

export type FoursomeGenerationResult =
  | { ok: true; segments: FoursomeSegment[]; maxBaseAppearances: number }
  | { ok: false; code: "unsupported_player_count" | "impossible_max_appearances"; message: string };

export function defaultMaxBaseAppearances(segmentSize: 3 | 6 | 9 | 18) {
  if (segmentSize === 3) return 3;
  if (segmentSize === 6) return 2;
  return 1;
}

function bounds(order: readonly number[], segmentSize: number) {
  return Array.from({ length: Math.ceil(order.length / segmentSize) }, (_, index) => ({
    startIndex: index * segmentSize,
    endIndex: Math.min(order.length - 1, (index + 1) * segmentSize - 1),
  }));
}

function pairKey(pair: readonly string[]) {
  return [...pair].sort().join("::");
}

function fourPlayerPairs(ids: readonly string[]) {
  const [a, b, c, d] = ids;
  return [[a, b], [a, c], [a, d]] as [string, string][];
}

function fivePlayerPairs(ids: readonly string[]) {
  const pairs: [string, string][] = [];
  for (let first = 0; first < ids.length; first += 1) {
    for (let second = first + 1; second < ids.length; second += 1) pairs.push([ids[first], ids[second]]);
  }
  return pairs;
}

function chooseFivePlayerPairs(ids: readonly string[], count: number, maximum: number) {
  const candidates = fivePlayerPairs(ids);
  const appearances = Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>;
  const pairUses = new Map<string, number>();
  const selected: [string, string][] = [];
  for (let index = 0; index < count; index += 1) {
    const previous = selected.at(-1);
    const eligible = candidates.filter((pair) => pair.every((id) => appearances[id] < maximum));
    if (!eligible.length) return null;
    eligible.sort((left, right) => {
      const leftRepeat = previous && pairKey(left) === pairKey(previous) ? 1 : 0;
      const rightRepeat = previous && pairKey(right) === pairKey(previous) ? 1 : 0;
      if (leftRepeat !== rightRepeat) return leftRepeat - rightRepeat;
      const leftUse = pairUses.get(pairKey(left)) || 0;
      const rightUse = pairUses.get(pairKey(right)) || 0;
      if (leftUse !== rightUse) return leftUse - rightUse;
      const leftLoad = left.reduce((sum, id) => sum + appearances[id], 0);
      const rightLoad = right.reduce((sum, id) => sum + appearances[id], 0);
      if (leftLoad !== rightLoad) return leftLoad - rightLoad;
      return pairKey(left).localeCompare(pairKey(right));
    });
    const pair = eligible[0];
    selected.push(pair);
    pair.forEach((id) => { appearances[id] += 1; });
    pairUses.set(pairKey(pair), (pairUses.get(pairKey(pair)) || 0) + 1);
  }
  return selected;
}

export function generateAutomaticFoursomes(input: {
  participantIds: readonly string[];
  order: readonly number[];
  segmentSize: 3 | 6 | 9 | 18;
  maxBaseAppearances?: number;
  idFactory?: () => string;
}): FoursomeGenerationResult {
  const participantIds = [...new Set(input.participantIds)];
  if (participantIds.length !== 4 && participantIds.length !== 5) {
    return { ok: false, code: "unsupported_player_count", message: "La generación automática requiere exactamente 4 o 5 jugadores." };
  }
  const ranges = bounds(input.order, input.segmentSize);
  const maximum = input.maxBaseAppearances ?? defaultMaxBaseAppearances(input.segmentSize);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum * participantIds.length < ranges.length * 2) {
    return { ok: false, code: "impossible_max_appearances", message: "Ese máximo no alcanza para cubrir todos los segmentos. Auméntalo y vuelve a intentar." };
  }
  const pairs = participantIds.length === 4
    ? ranges.map((_, index) => fourPlayerPairs(participantIds)[index % 3])
    : chooseFivePlayerPairs(participantIds, ranges.length, maximum);
  if (!pairs) return { ok: false, code: "impossible_max_appearances", message: "No existe una rotación equilibrada con ese máximo. Auméntalo y vuelve a intentar." };
  let sequence = 0;
  const idFactory = input.idFactory || (() => `backyard-foursome-${++sequence}`);
  return {
    ok: true,
    maxBaseAppearances: maximum,
    segments: ranges.map((range, index) => ({ ...range, id: idFactory(), basePair: [...pairs[index]], generatedByBackyard: true })),
  };
}

export function markFoursomeSegmentEdited(segment: FoursomeSegment): FoursomeSegment {
  return { ...segment, generatedByBackyard: false };
}

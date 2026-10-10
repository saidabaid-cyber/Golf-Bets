import type { BallFriendHole, CounterBetKind, CounterBetPeriod, FoursomeSegment, LobaHole, RoundSnapshot } from "./types";
import { confirmCounterQuantity, counterCaptureQuantity, setCounterDistance, updateCounterBetKeeper } from "./side-bets";
import { viperQuantityFromPutts } from "./round-capture";
import { SharedLiveError } from "./shared-round-live";

export type SharedPlayerFacts = { camels?: number | null; fish?: number | null; units?: number | null; viperDistance?: number | null };
export type SharedGroupFacts = { loba?: LobaHole; ballFriend?: BallFriendHole;
  keepers?: Array<{ kind: CounterBetKind; period: CounterBetPeriod; playerId: string }>;
  counterDistances?: Array<{ playerId: string; hole: number; distance: number | null }>;
  externalScores?: Record<string, number | null>; segments?: FoursomeSegment[] };
const invalid = () => { throw new SharedLiveError("INVALID_REQUEST", 400, "Revisa los datos de la apuesta."); };
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const count = (v: unknown, min = 0, max = 20) => v === null || (Number.isInteger(v) && Number(v) >= min && Number(v) <= max);
const keys = (v: object, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const active = (r: RoundSnapshot, kind: "camels" | "fish" | "vipers" | "units", p: string) => r.betConfig?.[kind].enabled && r.betConfig[kind].participantIds.includes(p);

/** Only facts consumed by the existing engines. Prices, handicaps and roster
 * never come from a participant patch. Group decisions are organizer-only. */
export function applySharedPlayerFacts(round: RoundSnapshot, player: string, hole: number, facts: SharedPlayerFacts | undefined, putts: number | null | undefined, now: string) {
  if (facts && (!record(facts) || !keys(facts, ["camels", "fish", "units", "viperDistance"]))) invalid();
  let events = round.counterBetEvents || [];
  if (putts !== undefined && active(round, "vipers", player) && (putts !== round.putts?.[hole]?.[player] || counterCaptureQuantity(events, "vipers", hole, player) === undefined))
    events = confirmCounterQuantity(events, "vipers", hole, player, putts === null ? null : viperQuantityFromPutts(putts));
  for (const kind of ["camels", "fish"] as const) if (facts?.[kind] !== undefined) {
    if (!active(round, kind, player) || !count(facts[kind])) invalid();
    if (facts[kind] !== counterCaptureQuantity(events, kind, hole, player)) events = confirmCounterQuantity(events, kind, hole, player, facts[kind]!);
  }
  if (facts?.viperDistance !== undefined) {
    if (!active(round, "vipers", player) || (facts.viperDistance !== null && (!Number.isFinite(facts.viperDistance) || facts.viperDistance < 0 || facts.viperDistance > 100000))) invalid();
    events = setCounterDistance(events, "vipers", hole, player, facts.viperDistance);
  }
  const previousIds = new Set((round.counterBetEvents || []).map(e => `${e.id}:${e.captureOrder}`));
  events = events.map(e => previousIds.has(`${e.id}:${e.captureOrder}`) ? e : { ...e, capturedAt: now });
  let units = round.unitEvents || [];
  if (facts?.units !== undefined) {
    if (!active(round, "units", player) || !count(facts.units, -100, 100)) invalid();
    units = units.filter(e => !(e.playerId === player && e.hole === hole));
    if (facts.units !== null) units = [...units, { id: `shared-units:${hole}:${player}`, hole, playerId: player, amount: facts.units, label: "Unidades manuales confirmadas" }];
  }
  return { ...round, ...(events !== round.counterBetEvents && (putts !== undefined || facts) ? { counterBetEvents: events } : {}),
    ...(facts?.units !== undefined ? { unitEvents: units } : {}) };
}

export function applySharedGroupFacts(round: RoundSnapshot, hole: number, group: SharedGroupFacts) {
  if (!record(group) || !Object.keys(group).length || !keys(group, ["loba", "ballFriend", "keepers", "counterDistances", "externalScores", "segments"])) invalid();
  const next = { ...round };
  const ids = new Set(round.players?.map(p => p.id));
  if (group.loba !== undefined) {
    const l = group.loba, config = round.betConfig?.loba;
    if (!config?.enabled || !record(l) || !keys(l, ["lobaPlayerId", "partnerId", "mode", "fireMultiplier", "unitCounts"])
      || !Number.isInteger(l.fireMultiplier) || l.fireMultiplier < 1 || l.fireMultiplier > 99 || !record(l.unitCounts)
      || (l.mode !== undefined && !["partner", "solo", "solo_anticipated", ""].includes(l.mode))
      || [l.lobaPlayerId, l.partnerId].some(id => id && !config.participantIds.includes(id))
      || Object.entries(l.unitCounts).some(([id, value]) => !config.participantIds.includes(id) || !count(value, 0, 100))) invalid();
    next.lobaHoles = { ...round.lobaHoles, [hole]: structuredClone(l) };
  }
  if (group.ballFriend !== undefined) {
    const b = group.ballFriend, config = round.betConfig?.ballFriend;
    if (!config?.enabled || !record(b) || !keys(b, ["teamA", "restPlayerId"]) || !Array.isArray(b.teamA)
      || b.teamA.length > 2 || new Set(b.teamA).size !== b.teamA.length
      || [...b.teamA, ...(b.restPlayerId ? [b.restPlayerId] : [])].some(id => !config.participantIds.includes(id))
      || (b.restPlayerId && b.teamA.includes(b.restPlayerId))) invalid();
    next.ballFriendSetup = { ...round.ballFriendSetup, [hole]: structuredClone(b) };
  }
  if (group.keepers !== undefined && (!Array.isArray(group.keepers) || group.keepers.length > 9)) invalid();
  for (const k of group.keepers || []) {
    if (!record(k) || !keys(k, ["kind", "period", "playerId"]) || !["vipers", "camels", "fish"].includes(k.kind)
      || !["round", "first_half", "second_half", "holes_1_9", "holes_10_18"].includes(k.period)
      || !round.betConfig?.[k.kind]?.enabled || (k.playerId && !round.betConfig[k.kind].participantIds.includes(k.playerId))) invalid();
    next.counterBetKeepers = updateCounterBetKeeper(next.counterBetKeepers || { vipers: {}, camels: {}, fish: {} }, k.kind, k.period, k.playerId, round.order || []);
  }
  if (group.externalScores !== undefined) {
    if (!record(group.externalScores) || Object.keys(group.externalScores).length > 20) invalid();
    for (const [betId, score] of Object.entries(group.externalScores)) {
      if (!count(score, 1, 20) || !round.personalBets?.some(b => b.id === betId && b.enabled !== false && b.rivalMode === "external")) invalid();
      next.personalBets = next.personalBets!.map(b => b.id === betId ? { ...b, externalScores: { ...b.externalScores, [hole]: score } } : b);
    }
  }
  if (group.counterDistances !== undefined && (!Array.isArray(group.counterDistances) || group.counterDistances.length > 25)) invalid();
  for (const d of group.counterDistances || []) {
    if (!record(d) || !keys(d, ["playerId", "hole", "distance"]) || !round.order?.includes(d.hole) || !active(round, "vipers", d.playerId)
      || (d.distance !== null && (!Number.isFinite(d.distance) || d.distance < 0 || d.distance > 100000))) invalid();
    next.counterBetEvents = setCounterDistance(next.counterBetEvents || [], "vipers", d.hole, d.playerId, d.distance);
  }
  if (group.segments !== undefined) {
    const s = group.segments;
    if (!round.betConfig?.foursome.enabled || !Array.isArray(s) || s.length !== round.segments?.length || s.some((row, i) => {
      const original = round.segments![i];
      return !record(row) || !keys(row, ["id", "startIndex", "endIndex", "basePair", "generatedByBackyard"])
        || row.id !== original.id || row.startIndex !== original.startIndex || row.endIndex !== original.endIndex
        || row.generatedByBackyard !== original.generatedByBackyard || !Array.isArray(row.basePair) || row.basePair.length > 2
        || new Set(row.basePair).size !== row.basePair.length || row.basePair.some(id => !ids.has(id) || !round.betConfig!.foursome.participantIds.includes(id));
    })) invalid();
    next.segments = structuredClone(s);
  }
  return next;
}

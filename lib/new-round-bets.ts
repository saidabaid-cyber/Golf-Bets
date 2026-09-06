import type { BetConfig, CounterBetConfig } from "./types";

/** Defaults complete missing fields without converting a pre-change round to the new settlement. */
export function restoreCounterBetConfig(fallback: CounterBetConfig, saved?: CounterBetConfig): CounterBetConfig {
  if (!saved) return fallback;
  const restored = { ...fallback, ...saved };
  if (saved.settlementMode === undefined) delete restored.settlementMode;
  return restored;
}

/** Only used for a new round, never to overwrite saved configurations. */
export function initialBets(ids: string[]): BetConfig {
  return {
    monkey: { enabled: false, value: 20, hcpPct: 100, participantIds: ids.slice(0, 3) },
    rabbits: { enabled: false, mode: "continuous", value: 100, hcpPct: 100, decimals: "decimal", accumulate: true, participantIds: [...ids] },
    skins: { enabled: false, mode: "carry", value: 50, hcpPct: 100, decimals: "decimal", accumulate: true, participantIds: [...ids] },
    units: { enabled: false, value: 100, participantIds: [...ids] },
    foursome: {
      handicapMethod: "configured", baseMode: "moving",
      enabled: false, hcpPct: 100, decimals: "round", segmentSize: 6,
      mode: "fixed", fixedValue: 200, pointValue: 100, pressSecond9: false,
      pressureMultiplier: 1, pressureNine: "holes_10_18", participantIds: [...ids],
    },
    ballFriend: { enabled: false, baseMode: "moving", value: 20, hcpPct: 100, decimals: "round", maxScore: 9, participantIds: [...ids] },
    polla: {
      first9: { enabled: false, value: 100, hcpPct: 100, decimals: "round", participantIds: [...ids] },
      second9: { enabled: false, value: 100, hcpPct: 100, decimals: "round", participantIds: [...ids] },
      total18: { enabled: false, value: 100, hcpPct: 100, decimals: "round", participantIds: [...ids] },
    },
    miniPolla: { enabled: false, value: 100, hcpPct: 100, decimals: "round", participantIds: [...ids] },
    // Each physical nine has its own bag. Pressure only changes H10–H18 event values.
    vipers: { enabled: false, value: 100, secondNinePressed: false, secondNineMultiplier: 2, settlementMode: "halves", participantIds: [...ids] },
    camels: { enabled: false, value: 100, secondNinePressed: false, secondNineMultiplier: 2, settlementMode: "halves", participantIds: [...ids] },
    fish: { enabled: false, value: 100, secondNinePressed: false, secondNineMultiplier: 2, settlementMode: "halves", participantIds: [...ids] },
    loba: { enabled: false, value: 100, hcpPct: 100, unitsEnabled: false, unitValue: 100, duplicateUnitsByMode: false, participantIds: [...ids] },
  };
}

/** Completes an editable legacy/draft config without mutating its saved snapshot. */
export function restoreBetConfig(saved: Partial<BetConfig> | null | undefined, ids: string[]): BetConfig {
  const defaults = initialBets(ids);
  const source = saved && typeof saved === "object" ? saved : {};
  const objectConfig = <T>(value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Partial<T> : undefined;
  const mergeParticipant = <T extends { participantIds: string[]; enabled?: boolean }>(fallback: T, value: Partial<T> | null | undefined): T => {
    const candidate = objectConfig<T>(value);
    return {
      ...fallback,
      ...candidate,
      participantIds: Array.isArray(candidate?.participantIds)
        ? [...candidate.participantIds]
        : candidate?.enabled === true ? [] : [...fallback.participantIds],
    };
  };
  const requireActiveFields = <T extends { enabled?: boolean }>(restored: T, value: unknown, fields: Array<keyof T>) => {
    const candidate = objectConfig<T>(value);
    if (candidate?.enabled !== true) return restored;
    const mutable = restored as Record<keyof T, unknown>;
    for (const field of fields) {
      if (!Object.hasOwn(candidate, field)) mutable[field] = undefined;
    }
    return restored;
  };
  const mergeLegacyBase = <T extends { participantIds: string[]; enabled?: boolean; baseMode?: "fixed" | "moving" }>(fallback: T, value: Partial<T> | null | undefined): T => {
    const candidate = objectConfig<T>(value);
    const restored = mergeParticipant(fallback, candidate);
    if (candidate && candidate.baseMode === undefined) delete restored.baseMode;
    return restored;
  };
  const polla = objectConfig<BetConfig["polla"]>(source.polla) || defaults.polla;
  const counter = (fallback: CounterBetConfig, value: CounterBetConfig | undefined) => {
    const candidate = objectConfig<CounterBetConfig>(value) as CounterBetConfig | undefined;
    const restored = restoreCounterBetConfig(fallback, candidate);
    const selected = { ...restored, participantIds: Array.isArray(candidate?.participantIds)
      ? [...candidate.participantIds]
      : candidate?.enabled === true ? [] : [...fallback.participantIds] };
    return requireActiveFields(selected, candidate, ["value"]);
  };
  const monkey = requireActiveFields(mergeParticipant(defaults.monkey!, source.monkey), source.monkey, ["value"]);
  const rabbits = mergeParticipant(defaults.rabbits, source.rabbits);
  requireActiveFields(rabbits, source.rabbits, [
    "value",
    "hcpPct",
    "decimals",
    ...(rabbits.mode === undefined || rabbits.mode === "continuous" ? ["accumulate"] as Array<keyof typeof rabbits> : []),
  ]);
  const skins = mergeParticipant(defaults.skins, source.skins);
  const savedSkins = objectConfig<typeof skins>(source.skins);
  if (savedSkins && savedSkins.mode === undefined) delete skins.mode;
  requireActiveFields(skins, source.skins, [
    "value",
    "hcpPct",
    "decimals",
    ...(skins.mode === undefined ? ["accumulate"] as Array<keyof typeof skins> : []),
  ]);
  const units = requireActiveFields(mergeParticipant(defaults.units, source.units), source.units, ["value"]);
  const foursome = mergeLegacyBase(defaults.foursome, source.foursome);
  requireActiveFields(foursome, source.foursome, [
    "segmentSize",
    "mode",
    ...(foursome.handicapMethod === "excel" ? [] : ["decimals"] as Array<keyof typeof foursome>),
    ...(foursome.handicapMethod === "excel" ? [] : ["hcpPct"] as Array<keyof typeof foursome>),
    ...(foursome.mode === "fixed" || foursome.mode === "fixed_points" ? ["fixedValue"] as Array<keyof typeof foursome> : []),
    ...(foursome.mode === "points" || foursome.mode === "fixed_points" ? ["pointValue"] as Array<keyof typeof foursome> : []),
  ]);
  const ballFriend = requireActiveFields(mergeLegacyBase(defaults.ballFriend, source.ballFriend), source.ballFriend, ["value", "hcpPct", "decimals", "maxScore"]);
  const pollaFirst = requireActiveFields(mergeParticipant(defaults.polla.first9, polla.first9), polla.first9, ["value", "hcpPct", "decimals"]);
  const pollaSecond = requireActiveFields(mergeParticipant(defaults.polla.second9, polla.second9), polla.second9, ["value", "hcpPct", "decimals"]);
  const pollaTotal = requireActiveFields(mergeParticipant(defaults.polla.total18, polla.total18), polla.total18, ["value", "hcpPct", "decimals"]);
  const miniPolla = requireActiveFields(mergeParticipant(defaults.miniPolla, source.miniPolla), source.miniPolla, ["value", "hcpPct", "decimals"]);
  const loba = requireActiveFields(mergeParticipant(defaults.loba, source.loba), source.loba, [
    "value",
    ...(objectConfig<typeof defaults.loba>(source.loba)?.unitsEnabled ? ["unitValue"] as Array<keyof typeof defaults.loba> : []),
  ]);
  return {
    monkey,
    rabbits,
    skins,
    units,
    foursome,
    ballFriend,
    polla: {
      first9: pollaFirst,
      second9: pollaSecond,
      total18: pollaTotal,
    },
    miniPolla,
    vipers: counter(defaults.vipers, source.vipers),
    camels: counter(defaults.camels, source.camels),
    fish: counter(defaults.fish, source.fish),
    loba,
  };
}

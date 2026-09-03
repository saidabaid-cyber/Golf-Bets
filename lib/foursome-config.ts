import type { BetConfig, FoursomeSegment } from "./types";

export function foursomePressure(config: BetConfig["foursome"]) {
  return config.pressureMultiplier ?? (config.pressSecond9 ? 2 : 1);
}

export function setFoursomePressure(config: BetConfig["foursome"], multiplier: 1 | 2 | 3 | 4 | 5): BetConfig["foursome"] {
  return { ...config, pressureMultiplier: multiplier, pressSecond9: false,
    pressureNine: multiplier > 1 ? config.pressureNine ?? "holes_10_18" : undefined };
}

export function foursomeHoleConfigurationError(
  config: BetConfig["foursome"],
  segments: FoursomeSegment[],
  order: number[],
  holeNumber: number,
) {
  if (!config.enabled) return "";
  const participants = [...new Set(config.participantIds)];
  const index = order.indexOf(holeNumber);
  const segment = index < 0 ? undefined : segments.find((item) => index >= item.startIndex && index <= item.endIndex);
  const basePair = segment?.basePair ?? [];
  const baseIsValid = basePair.length === 2
    && new Set(basePair).size === 2
    && basePair.every((id) => participants.includes(id));
  const remaining = participants.filter((id) => !basePair.includes(id));
  const opponentIsValid = participants.length === 3 ? remaining.length === 1 : remaining.length >= 2;
  return participants.length >= 3 && segment && baseIsValid && opponentIsValid
    ? ""
    : "Completa Foursome para este hoyo antes de continuar.";
}

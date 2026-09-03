import type { BetConfig } from "./types";

export function foursomePressure(config: BetConfig["foursome"]) {
  return config.pressureMultiplier ?? (config.pressSecond9 ? 2 : 1);
}

export function setFoursomePressure(config: BetConfig["foursome"], multiplier: 1 | 2 | 3 | 4 | 5): BetConfig["foursome"] {
  return { ...config, pressureMultiplier: multiplier, pressSecond9: false,
    pressureNine: multiplier > 1 ? config.pressureNine ?? "holes_10_18" : undefined };
}

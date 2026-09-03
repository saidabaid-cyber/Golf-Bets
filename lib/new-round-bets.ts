import type { BetConfig } from "./types";

/** Only used for a new round, never to overwrite saved configurations. */
export function initialBets(ids: string[]): BetConfig {
  return {
    monkey: { enabled: false, value: 20, participantIds: ids.slice(0, 3) },
    rabbits: { enabled: false, value: 100, hcpPct: 100, decimals: "decimal", accumulate: true, participantIds: [...ids] },
    skins: { enabled: false, value: 50, hcpPct: 100, decimals: "decimal", accumulate: true, participantIds: [...ids] },
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
    vipers: { enabled: false, value: 100, secondNineMultiplier: 1, participantIds: [...ids] },
    camels: { enabled: false, value: 100, secondNineMultiplier: 1, participantIds: [...ids] },
    fish: { enabled: false, value: 100, secondNineMultiplier: 1, participantIds: [...ids] },
    loba: { enabled: false, value: 100, unitsEnabled: false, unitValue: 100, duplicateUnitsByMode: false, participantIds: [...ids] },
  };
}

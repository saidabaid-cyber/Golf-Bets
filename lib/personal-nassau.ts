import type { PersonalBet } from "./types";

/** Draft-only migration. Never apply to settled historical amounts/snapshots. */
export function migratePersonalNassau(bet: PersonalBet, startHole: number, roundHoles: number): PersonalBet {
  const swap = bet.nassauVersion !== 2 && roundHoles === 18 && startHole === 10;
  const components = bet.components ?? {match1:true,medal1:true,match2:true,medal2:true,match18:true,medal18:true};
  return {
    ...bet,
    nassauVersion: 2,
    carryEnabled: bet.carryEnabled ?? false,
    pressureMultiplier: bet.pressureMultiplier ?? Math.min(5, Math.max(1, bet.back9Multiplier ?? 1)) as 1|2|3|4|5,
    pressureNine: startHole === 10 ? "holes_1_9" : "holes_10_18",
    components: swap ? {
      ...components,
      match1: components.match2, medal1: components.medal2,
      match2: components.match1, medal2: components.medal1,
    } : { ...components },
  };
}

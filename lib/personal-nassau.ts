import type { PersonalBet } from "./types";

/** Draft-only migration. Never apply to settled historical amounts/snapshots. */
export function migratePersonalNassau(bet: PersonalBet, startHole: number, roundHoles: number): PersonalBet {
  const legacy = bet.nassauVersion !== 2;
  if (!legacy) {
    // V2 is already the canonical draft shape. Do not make a corrupt modern
    // wager look valid here: the setup validator/editor must receive the
    // original mode, identities, components and economic terms so the user
    // can repair them explicitly.
    const hasKnownPressureNine = bet.pressureNine === "holes_1_9" || bet.pressureNine === "holes_10_18";
    const pressureNine = startHole === 10 ? "holes_1_9" as const : "holes_10_18" as const;
    return {
      ...bet,
      // Personal pressure follows the second nine played. A recognized value
      // remains a derived physical label; an invalid value is left untouched
      // so validation can report it instead of concealing the corruption.
      ...(bet.pressureNine === undefined || hasKnownPressureNine ? { pressureNine } : {}),
    };
  }
  const swap = legacy && roundHoles === 18 && startHole === 10;
  const components = bet.components ?? {match1:true,medal1:true,match2:true,medal2:true,match18:true,medal18:true};
  return {
    ...bet,
    rivalMode: bet.rivalMode === "group" || bet.rivalMode === "external"
      ? bet.rivalMode
      : bet.rivalPlayerId ? "group" : "external",
    nassauVersion: 2,
    carryEnabled: bet.carryEnabled ?? false,
    pressureMultiplier: bet.pressureMultiplier ?? Math.min(5, Math.max(1, bet.back9Multiplier ?? 1)) as 1|2|3|4|5,
    pressureNine: startHole === 10 ? "holes_1_9" : "holes_10_18",
    components: swap && components ? {
      ...components,
      match1: components.match2, medal1: components.medal2,
      match2: components.match1, medal2: components.medal1,
    } : components ? { ...components } : undefined as unknown as PersonalBet["components"],
  };
}

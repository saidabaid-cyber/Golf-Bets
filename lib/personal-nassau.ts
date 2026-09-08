import type { PersonalBet } from "./types";

/**
 * Personal Nassau component keys describe the first/second nine PLAYED. A
 * nine-hole round therefore has only its first played-nine components; the
 * back-nine and 18-hole flags are not merely hidden UI, they are inapplicable
 * configuration and must stay disabled in the draft consumed by the engine.
 */
export function personalNassauComponentsForRoundHoles(
  components: PersonalBet["components"],
  roundHoles: 9 | 18,
): PersonalBet["components"] {
  const cloned = { ...components };
  if (roundHoles === 18) return cloned;
  return {
    ...cloned,
    match2: false,
    medal2: false,
    match18: false,
    medal18: false,
  };
}

/** Draft-only duration normalization. Settled historical results stay intact. */
export function personalNassauBetsForRoundHoles(bets: PersonalBet[], roundHoles: 9 | 18) {
  if (roundHoles === 18) return bets;
  return bets.map((bet) => ({
    ...bet,
    components: personalNassauComponentsForRoundHoles(bet.components, roundHoles),
  }));
}

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
    const migrated = {
      ...bet,
      // Personal pressure follows the second nine played. A recognized value
      // remains a derived physical label; an invalid value is left untouched
      // so validation can report it instead of concealing the corruption.
      ...(bet.pressureNine === undefined || hasKnownPressureNine ? { pressureNine } : {}),
    };
    return roundHoles === 9
      ? { ...migrated, components: personalNassauComponentsForRoundHoles(migrated.components, 9) }
      : migrated;
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
    components: personalNassauComponentsForRoundHoles(swap && components ? {
      ...components,
      match1: components.match2, medal1: components.medal2,
      match2: components.match1, medal2: components.medal1,
    } : components ? { ...components } : undefined as unknown as PersonalBet["components"], roundHoles === 9 ? 9 : 18),
  };
}

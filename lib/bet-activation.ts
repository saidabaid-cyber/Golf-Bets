import type { SupplementalBet } from "./types";

export const PERSONAL_SUPPLEMENTAL_TYPES: SupplementalBet["type"][] = [
  "individual_nassau",
  "dollar_stroke",
  "individual_pressures",
];

export function isPersonalSupplementalType(type: SupplementalBet["type"]) {
  return PERSONAL_SUPPLEMENTAL_TYPES.includes(type);
}

/** Category OFF never destroys either configuration or the previous instance
 * selection. Turning the category back on restores exactly that selection. */
export function setSupplementalCategoryEnabled(
  bets: SupplementalBet[],
  type: SupplementalBet["type"],
  enabled: boolean,
) {
  const matching = bets.filter((bet) => bet.type === type);
  if (!matching.length) return bets;
  if (!enabled) return bets.map((bet) => bet.type === type
    ? { ...bet, enabledBeforeCategoryOff: bet.enabled, enabled: false } as SupplementalBet
    : bet);
  const rememberedAny = matching.some((bet) => bet.enabledBeforeCategoryOff === true);
  return bets.map((bet) => {
    if (bet.type !== type) return bet;
    const restored = rememberedAny ? bet.enabledBeforeCategoryOff === true : matching[0].id === bet.id;
    const next = { ...bet, enabled: restored } as SupplementalBet;
    delete next.enabledBeforeCategoryOff;
    return next;
  });
}

export function setRememberedCategoryEnabled<T extends { id: string; enabled?: boolean; enabledBeforeCategoryOff?: boolean }>(items: T[], enabled: boolean): T[] {
  if (!enabled) return items.map((item) => ({ ...item, enabledBeforeCategoryOff: item.enabled !== false, enabled: false }) as T);
  const rememberedAny = items.some((item) => item.enabledBeforeCategoryOff === true);
  return items.map((item, index) => {
    const next = { ...item, enabled: rememberedAny ? item.enabledBeforeCategoryOff === true : index === 0 };
    delete next.enabledBeforeCategoryOff;
    return next as T;
  });
}

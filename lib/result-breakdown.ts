import type { MedalPollaDetail } from "./engine";

export function pollaDetailBalance(detail: MedalPollaDetail, playerId: string) {
  if (!detail.complete || !Object.hasOwn(detail.totals, playerId)) return 0;
  return -detail.value + (detail.winnerIds.includes(playerId) ? detail.grossPrizePerWinner : 0);
}

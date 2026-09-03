import type { MedalPollaDetail } from "./engine";

const MONEY_EPSILON = 0.001;

export type ResultCategoryColumn = {
  key: string;
  label: string;
  balances: Record<string, number>;
  active: boolean;
  played: boolean;
};

export function pollaDetailBalance(detail: MedalPollaDetail, playerId: string) {
  if (!detail.complete || !Object.hasOwn(detail.totals, playerId)) return 0;
  return -detail.value + (detail.winnerIds.includes(playerId) ? detail.grossPrizePerWinner : 0);
}

export function buildGeneralResultsTable(
  playerIds: string[],
  categoryColumns: ResultCategoryColumn[],
  consolidatedBalances: Record<string, number>,
) {
  const categories = categoryColumns.filter(category => category.active && (
    category.played || Object.values(category.balances).some(amount => Math.abs(amount) >= MONEY_EPSILON)
  ));
  const rows = playerIds.map(playerId => {
    const cells = Object.fromEntries(categories.map(category => [category.key, category.balances[playerId] || 0]));
    const categorySum = Object.values(cells).reduce((sum, amount) => sum + amount, 0);
    const total = consolidatedBalances[playerId] || 0;
    return { playerId, cells, categorySum, total, consistent: Math.abs(categorySum - total) < MONEY_EPSILON };
  });
  const categoryTotals = Object.fromEntries(categories.map(category => [
    category.key,
    playerIds.reduce((sum, playerId) => sum + (category.balances[playerId] || 0), 0),
  ]));
  const grandTotal = playerIds.reduce((sum, playerId) => sum + (consolidatedBalances[playerId] || 0), 0);
  return { categories, rows, categoryTotals, grandTotal };
}

import type { MedalPollaDetail } from "./engine";

const MONEY_EPSILON = 0.001;

export type ResultCategoryColumn = {
  key: string;
  label: string;
  balances: Record<string, number>;
  active: boolean;
  played: boolean;
  quantityTotal?: number;
  quantities?: Record<string, number>;
  quantityLabel?: string;
  signedQuantity?: boolean;
  detailByPlayer?: Record<string, string>;
};

export function pollaDetailBalance(detail: MedalPollaDetail, playerId: string) {
  if (!detail.complete || !Object.hasOwn(detail.totals, playerId)) return 0;
  return -detail.value + (detail.winnerIds.includes(playerId) ? detail.grossPrizePerWinner : 0);
}

export function pollaDetailBalances(detail: MedalPollaDetail | undefined) {
  if (!detail) return {} as Record<string, number>;
  return Object.fromEntries(Object.keys(detail.totals).map(playerId => [playerId, pollaDetailBalance(detail, playerId)]));
}

export function pollaPositionLabel(detail: MedalPollaDetail | undefined, playerId: string) {
  if (!detail || !Object.hasOwn(detail.totals, playerId)) return "";
  if (!detail.complete) return "Pendiente";
  const score = detail.totals[playerId];
  const rankedScores = [...new Set(Object.values(detail.totals).sort((a, b) => a - b))];
  const position = rankedScores.indexOf(score) + 1;
  const tied = Object.values(detail.totals).filter(value => Math.abs(value - score) < MONEY_EPSILON).length > 1;
  if (position === 1) return tied ? "Empate 1º" : "Ganó";
  return `${tied ? "Empate · " : ""}${position}º`;
}

export function pollaPositionLabels(detail: MedalPollaDetail | undefined, playerIds: string[]) {
  return Object.fromEntries(playerIds.map(playerId => [playerId, pollaPositionLabel(detail, playerId)]));
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

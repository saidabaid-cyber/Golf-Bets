export const SETTLEMENT_EPSILON = 1e-9;

export function isFiniteZeroSum(values: readonly number[]) {
  return values.every(Number.isFinite)
    && Math.abs(values.reduce((sum, value) => sum + value, 0)) < SETTLEMENT_EPSILON;
}

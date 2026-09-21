import type * as Core from './engine';
import type * as Side from './side-bets';
import type * as Supplemental from './supplemental-bets';
type Engines = Pick<typeof Core, 'calculateRabbits' | 'calculateSkins' | 'calculateUnits' | 'calculateMonkey' | 'calculateFoursomes' | 'calculateBallFriend' | 'calculatePersonalBets' | 'calculatePolla' | 'calculateMiniPolla' | 'calculateManualBets'> & Pick<typeof Side, 'calculateCounterBet' | 'calculateLoba'> & Pick<typeof Supplemental, 'calculateSupplementalBets'>;
const empty: { [K in keyof Engines]: ReturnType<Engines[K]> } = {
  calculateRabbits: { events: [], won: {}, pending: 0, missingHandicapPlayerIds: [] },
  calculateSkins: { events: [], won: {}, carry: 0, missingHandicapPlayerIds: [] },
  calculateUnits: { positive: {}, negative: {}, manualNet: {}, autoNet: {}, autoByHole: {}, net: {}, registeredTotal: 0, balances: {} },
  calculateMonkey: { balances: {}, points: {}, details: [], valid: true, missingHandicapPlayerIds: [] },
  calculateFoursomes: { balances: {}, provisionalBalances: {}, matches: [], missingHandicapPlayerIds: [] },
  calculateBallFriend: { points: {}, balances: {}, details: [], missingHandicapPlayerIds: [] },
  calculatePersonalBets: { results: [], balances: {}, provisionalBalances: {} },
  calculatePolla: { balances: {}, details: [] },
  calculateMiniPolla: { balances: {}, details: [] },
  calculateManualBets: { balances: {}, details: [] },
  calculateCounterBet: { kind: 'vipers', halves: [], balances: {}, transfers: [], totalQuantity: 0, totalBagValue: 0, zeroSum: true, settlementMode: 'halves' },
  calculateLoba: { balances: {}, transfers: [], details: [], zeroSum: true, missingHandicapPlayerIds: [] },
  calculateSupplementalBets: { balances: {}, results: [] },
};
/** No money/HCP engine is invoked for score-only, even if a stale draft contains bets. */
export function roundBetResult<K extends keyof Engines>(mode: string | undefined, engine: K, calculate: () => ReturnType<Engines[K]>): ReturnType<Engines[K]> {
  return mode === 'score_only' ? structuredClone(empty[engine]) : calculate();
}

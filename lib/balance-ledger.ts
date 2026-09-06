import type { RoundSnapshot } from "./types";

const EPSILON = 1e-9;

export type LedgerIdentityKind = "account" | "guest";
export type LedgerRoundSource = "player_balances" | "legacy_owner";

export type LedgerIdentity = {
  key: string;
  kind: LedgerIdentityKind;
  playerId: string;
  accountUserId?: string;
  name: string;
};

export type LedgerRoundBalance = LedgerIdentity & {
  amount: number;
};

export type LedgerRound = {
  roundId: string;
  date: string;
  courseName: string;
  source: LedgerRoundSource;
  /** True only when the persisted round contains a complete, finite, zero-sum ledger. */
  settleable: boolean;
  balances: LedgerRoundBalance[];
};

export type LedgerEntry = LedgerIdentity & {
  /** Exact plus legacy owner-only results. Expenses are intentionally excluded. */
  balance: number;
  /** Only complete zero-sum `playerBalances`; safe input for transfer suggestions. */
  settleableBalance: number;
  /** Owner-perspective compatibility value from snapshots without `playerBalances`. */
  legacyBalance: number;
  rounds: number;
  wins: number;
  losses: number;
  ties: number;
};

export type SuggestedLedgerTransfer = {
  fromKey: string;
  toKey: string;
  amount: number;
};

export type HistoricalLedgerTransfer = SuggestedLedgerTransfer & {
  roundId: string;
  date: string;
  courseName: string;
};

export type LedgerIssue = {
  roundId: string;
  reason: "invalid_player_balances" | "invalid_legacy_bet_result";
};

export type BalanceLedger = {
  rounds: LedgerRound[];
  entries: LedgerEntry[];
  /** Per-round mathematical references over exact ledgers; never evidence of payment or debt. */
  suggestedTransfers: HistoricalLedgerTransfer[];
  issues: LedgerIssue[];
};

export type LedgerEntryComparison = {
  leftKey: string;
  rightKey: string;
  roundsTogether: number;
  leftAhead: number;
  rightAhead: number;
  ties: number;
  /** Shared rounds containing exactly these two canonical identities. */
  bilateralRounds: number;
  /** Each player's complete-round result while both identities were present; not a bilateral debt. */
  leftBalance: number;
  rightBalance: number;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonblankString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableIdentity(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !/\s/.test(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function runtimePlayers(round: RoundSnapshot) {
  const value: unknown = round.players;
  return Array.isArray(value) ? value.map(recordValue).filter((player): player is Record<string, unknown> => Boolean(player)) : [];
}

function runtimeOpponents(round: RoundSnapshot) {
  const value: unknown = round.personalOpponentResults;
  return Array.isArray(value) ? value.map(recordValue).filter((opponent): opponent is Record<string, unknown> => Boolean(opponent)) : [];
}

function normalizedAmount(value: number) {
  return Math.abs(value) <= EPSILON ? 0 : value;
}

function normalizedZeroSumBalances(balances: Array<[string, number]>) {
  const normalized = balances.map(([playerId, amount]) => [playerId, normalizedAmount(amount)] as [string, number]);
  const residue = normalized.reduce((sum, [, amount]) => sum + amount, 0);
  if (residue === 0 || !normalized.length) return normalized;

  // Each raw ledger was already accepted within EPSILON. Remove only its rounding residue
  // from the largest absolute entry so valid residuals cannot accumulate across rounds.
  const target = normalized.reduce((selected, entry, index, entries) => {
    const selectedMagnitude = Math.abs(entries[selected][1]);
    const magnitude = Math.abs(entry[1]);
    return magnitude > selectedMagnitude
      || (magnitude === selectedMagnitude && entry[0].localeCompare(entries[selected][0]) < 0)
      ? index
      : selected;
  }, 0);
  normalized[target][1] = normalizedAmount(normalized[target][1] - residue);
  return normalized;
}

function snapshotTime(round: RoundSnapshot) {
  for (const candidate of [round.updatedAt, round.completedAt, round.date]) {
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Number.NEGATIVE_INFINITY;
}

/** Keeps the latest persisted correction for each local round id. Equal timestamps prefer the later input. */
export function deduplicateRoundSnapshots(rounds: readonly RoundSnapshot[]) {
  const latest = new Map<string, { round: RoundSnapshot; timestamp: number; index: number }>();
  rounds.forEach((round, index) => {
    const timestamp = snapshotTime(round);
    const previous = latest.get(round.id);
    if (!previous || timestamp > previous.timestamp || (timestamp === previous.timestamp && index > previous.index)) {
      latest.set(round.id, { round, timestamp, index });
    }
  });
  return [...latest.values()]
    .sort((left, right) => right.timestamp - left.timestamp || right.index - left.index)
    .map(({ round }) => round);
}

function playerName(round: RoundSnapshot, playerId: string) {
  const player = runtimePlayers(round).find((candidate) => candidate.id === playerId);
  const storedPlayerName = nonblankString(player?.name);
  if (storedPlayerName) return storedPlayerName;
  const opponent = runtimeOpponents(round).find((candidate) => candidate.opponentId === playerId);
  return nonblankString(opponent?.opponentName) || playerId;
}

function identityFor(round: RoundSnapshot, playerId: string): LedgerIdentity {
  const player = runtimePlayers(round).find((candidate) => candidate.id === playerId);
  const accountUserId = stableIdentity(player?.accountUserId) ? player.accountUserId : undefined;
  const name = nonblankString(player?.name) || playerName(round, playerId);
  if (accountUserId) {
    return {
      key: `account:${accountUserId}`,
      kind: "account",
      playerId,
      accountUserId,
      name,
    };
  }
  return {
    key: `guest:${round.id}:${playerId}`,
    kind: "guest",
    playerId,
    name,
  };
}

function roundBalances(round: RoundSnapshot): { row?: LedgerRound; issue?: LedgerIssue } {
  if (!stableIdentity(round.id)) {
    return { issue: { roundId: nonblankString(round.id) || "invalid-round", reason: "invalid_player_balances" } };
  }
  if (round.playerBalances !== undefined) {
    if (!round.playerBalances || typeof round.playerBalances !== "object" || Array.isArray(round.playerBalances)) {
      return { issue: { roundId: round.id, reason: "invalid_player_balances" } };
    }
    const balances = Object.entries(round.playerBalances);
    const valid = balances.length > 0
      && balances.every(([playerId]) => stableIdentity(playerId))
      && balances.every(([, amount]) => finiteNumber(amount))
      && Math.abs(balances.reduce((sum, [, amount]) => sum + amount, 0)) <= EPSILON;
    if (!valid) return { issue: { roundId: round.id, reason: "invalid_player_balances" } };

    const normalizedBalances = normalizedZeroSumBalances(balances);
    const identities = normalizedBalances.map(([playerId, amount]) => ({
      ...identityFor(round, playerId),
      amount,
    }));
    if (new Set(identities.map((identity) => identity.key)).size !== identities.length) {
      return { issue: { roundId: round.id, reason: "invalid_player_balances" } };
    }
    return {
      row: {
        roundId: round.id,
        date: nonblankString(round.date) || "Fecha no disponible",
        courseName: nonblankString(round.courseName) || "Campo no disponible",
        source: "player_balances",
        settleable: true,
        balances: identities,
      },
    };
  }

  if (!finiteNumber(round.betResult)) {
    return { issue: { roundId: round.id, reason: "invalid_legacy_bet_result" } };
  }

  const ownerByName = runtimePlayers(round).find((player) => nonblankString(player.name) === nonblankString(round.ownerName));
  const ownerId = stableIdentity(round.ownerId)
    ? round.ownerId
    : stableIdentity(ownerByName?.id) ? ownerByName.id : "owner";
  return {
    row: {
      roundId: round.id,
      date: nonblankString(round.date) || "Fecha no disponible",
      courseName: nonblankString(round.courseName) || "Campo no disponible",
      source: "legacy_owner",
      settleable: false,
      balances: [{
        ...identityFor(round, ownerId),
        name: nonblankString(round.ownerName) || playerName(round, ownerId),
        amount: normalizedAmount(round.betResult),
      }],
    },
  };
}

/**
 * Produces a deterministic set of transfers that mathematically settles a finite zero-sum map.
 * The result is a suggestion only; it does not assert that somebody owes or paid money.
 */
export function suggestLedgerTransfers(balances: Readonly<Record<string, number>>): SuggestedLedgerTransfer[] {
  const values = Object.entries(balances);
  if (!values.length || values.some(([, amount]) => !finiteNumber(amount))) return [];
  if (Math.abs(values.reduce((sum, [, amount]) => sum + amount, 0)) > EPSILON) return [];

  const positive = values
    .filter(([, amount]) => amount > EPSILON)
    .map(([key, amount]) => ({ key, amount }))
    .sort((left, right) => right.amount - left.amount || left.key.localeCompare(right.key));
  const negative = values
    .filter(([, amount]) => amount < -EPSILON)
    .map(([key, amount]) => ({ key, amount: -amount }))
    .sort((left, right) => right.amount - left.amount || left.key.localeCompare(right.key));

  const transfers: SuggestedLedgerTransfer[] = [];
  let fromIndex = 0;
  let toIndex = 0;
  while (fromIndex < negative.length && toIndex < positive.length) {
    const amount = Math.min(negative[fromIndex].amount, positive[toIndex].amount);
    if (amount > EPSILON) {
      transfers.push({
        fromKey: negative[fromIndex].key,
        toKey: positive[toIndex].key,
        amount: normalizedAmount(amount),
      });
    }
    negative[fromIndex].amount -= amount;
    positive[toIndex].amount -= amount;
    if (negative[fromIndex].amount <= EPSILON) fromIndex += 1;
    if (positive[toIndex].amount <= EPSILON) toIndex += 1;
  }
  return transfers;
}

export function buildBalanceLedger(snapshots: readonly RoundSnapshot[]): BalanceLedger {
  const rounds: LedgerRound[] = [];
  const issues: LedgerIssue[] = [];
  for (const snapshot of deduplicateRoundSnapshots(snapshots)) {
    const result = roundBalances(snapshot);
    if (result.row) rounds.push(result.row);
    if (result.issue) issues.push(result.issue);
  }

  const entries = new Map<string, LedgerEntry>();
  for (const round of rounds) {
    for (const balance of round.balances) {
      const existing = entries.get(balance.key);
      const current = existing || {
        key: balance.key,
        kind: balance.kind,
        playerId: balance.playerId,
        ...(balance.accountUserId ? { accountUserId: balance.accountUserId } : {}),
        name: balance.name,
        balance: 0,
        settleableBalance: 0,
        legacyBalance: 0,
        rounds: 0,
        wins: 0,
        losses: 0,
        ties: 0,
      };
      // Rounds are newest-first, so a linked account keeps its latest persisted name/player id.
      current.balance = normalizedAmount(current.balance + balance.amount);
      if (round.settleable) current.settleableBalance = normalizedAmount(current.settleableBalance + balance.amount);
      else current.legacyBalance = normalizedAmount(current.legacyBalance + balance.amount);
      current.rounds += 1;
      if (balance.amount > EPSILON) current.wins += 1;
      else if (balance.amount < -EPSILON) current.losses += 1;
      else current.ties += 1;
      entries.set(balance.key, current);
    }
  }

  const orderedEntries = [...entries.values()].sort((left, right) =>
    right.balance - left.balance || left.name.localeCompare(right.name, "es-MX") || left.key.localeCompare(right.key));
  const suggestedTransfers = rounds.flatMap((round) => {
    if (!round.settleable) return [];
    const balances = Object.fromEntries(round.balances.map((entry) => [entry.key, entry.amount]));
    return suggestLedgerTransfers(balances).map((transfer) => ({
      ...transfer,
      roundId: round.roundId,
      date: round.date,
      courseName: round.courseName,
    }));
  });
  return {
    rounds,
    entries: orderedEntries,
    suggestedTransfers,
    issues,
  };
}

/**
 * Compares two identities only across exact ledgers in which both participated.
 * “Ahead” means the player finished that round with the higher persisted overall
 * balance. Multi-player snapshots cannot prove a direct debt between this pair.
 */
export function compareLedgerEntries(ledger: Pick<BalanceLedger, "rounds">, leftKey: string, rightKey: string): LedgerEntryComparison {
  const comparison: LedgerEntryComparison = {
    leftKey,
    rightKey,
    roundsTogether: 0,
    leftAhead: 0,
    rightAhead: 0,
    ties: 0,
    bilateralRounds: 0,
    leftBalance: 0,
    rightBalance: 0,
  };
  if (!leftKey || !rightKey || leftKey === rightKey) return comparison;

  for (const round of ledger.rounds) {
    if (!round.settleable) continue;
    const left = round.balances.find((entry) => entry.key === leftKey);
    const right = round.balances.find((entry) => entry.key === rightKey);
    if (!left || !right) continue;
    comparison.roundsTogether += 1;
    comparison.leftBalance = normalizedAmount(comparison.leftBalance + left.amount);
    comparison.rightBalance = normalizedAmount(comparison.rightBalance + right.amount);
    if (round.balances.length !== 2) continue;
    comparison.bilateralRounds += 1;
    const difference = left.amount - right.amount;
    if (difference > EPSILON) comparison.leftAhead += 1;
    else if (difference < -EPSILON) comparison.rightAhead += 1;
    else comparison.ties += 1;
  }
  return comparison;
}

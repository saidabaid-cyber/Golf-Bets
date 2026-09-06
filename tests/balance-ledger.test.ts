import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBalanceLedger, compareLedgerEntries, deduplicateRoundSnapshots, suggestLedgerTransfers } from "../lib/balance-ledger";
import type { Expense, Player, RoundSnapshot } from "../lib/types";

const EPSILON_FOR_TESTS = 1e-9;
const noExpenses: Expense = { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 };

function snapshot(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    id: "round-1",
    date: "2026-09-06",
    courseName: "Campo",
    teeName: "General",
    ownerId: "said",
    ownerName: "Said",
    betResult: 0,
    expenses: noExpenses,
    expenseTotal: 0,
    netResult: 0,
    categoryResults: {},
    completedAt: "2026-09-06T18:00:00.000Z",
    updatedAt: "2026-09-06T18:00:00.000Z",
    ...overrides,
  };
}

const player = (id: string, name: string, accountUserId?: string): Player => ({
  id, name, handicap: 0, ...(accountUserId ? { accountUserId } : {}),
});

test("uses a complete finite zero-sum playerBalances snapshot and ignores expenses", () => {
  const ledger = buildBalanceLedger([snapshot({
    players: [player("said", "Said", "user-said"), player("juan", "Juan")],
    playerBalances: { said: 800, juan: -800 },
    betResult: 800,
    expenses: { ...noExpenses, caddie: 600 },
    expenseTotal: 600,
    netResult: 200,
  })]);

  assert.deepEqual(ledger.rounds.map((round) => [round.source, round.settleable]), [["player_balances", true]]);
  assert.equal(ledger.entries.find((entry) => entry.accountUserId === "user-said")?.balance, 800);
  assert.equal(ledger.entries.find((entry) => entry.playerId === "juan")?.balance, -800);
  assert.equal(ledger.entries.reduce((sum, entry) => sum + entry.balance, 0), 0);
  assert.deepEqual(ledger.suggestedTransfers, [{
    fromKey: "guest:round-1:juan", toKey: "account:user-said", amount: 800,
    roundId: "round-1", date: "2026-09-06", courseName: "Campo",
  }]);
});

test("legacy snapshots use only finite owner betResult and never fabricate a counterparty", () => {
  const ledger = buildBalanceLedger([snapshot({
    players: [player("said", "Said", "user-said"), player("juan", "Juan")],
    playerBalances: undefined,
    betResult: 275,
    expenses: { ...noExpenses, food: 90 },
    expenseTotal: 90,
    netResult: 185,
  })]);

  assert.equal(ledger.rounds[0].source, "legacy_owner");
  assert.equal(ledger.rounds[0].balances.length, 1);
  assert.equal(ledger.entries[0].balance, 275);
  assert.equal(ledger.entries[0].legacyBalance, 275);
  assert.equal(ledger.entries[0].settleableBalance, 0);
  assert.deepEqual(ledger.suggestedTransfers, []);
});

test("rejects corrupt, non-finite, non-zero-sum and empty persisted ledgers", () => {
  const corrupt = [
    snapshot({ id: "nan", playerBalances: { said: Number.NaN, juan: 0 } }),
    snapshot({ id: "infinite", playerBalances: { said: Number.POSITIVE_INFINITY, juan: Number.NEGATIVE_INFINITY } }),
    snapshot({ id: "not-zero", playerBalances: { said: 100, juan: -90 } }),
    snapshot({ id: "empty", playerBalances: {} }),
    snapshot({ id: "legacy-nan", playerBalances: undefined, betResult: Number.NaN }),
  ];
  const ledger = buildBalanceLedger(corrupt);
  assert.deepEqual(ledger.rounds, []);
  assert.deepEqual(ledger.entries, []);
  assert.deepEqual(ledger.suggestedTransfers, []);
  assert.deepEqual(ledger.issues.map((issue) => [issue.roundId, issue.reason]), [
    ["legacy-nan", "invalid_legacy_bet_result"],
    ["empty", "invalid_player_balances"],
    ["not-zero", "invalid_player_balances"],
    ["infinite", "invalid_player_balances"],
    ["nan", "invalid_player_balances"],
  ]);
});

test("deduplicates round ids using the newest updatedAt, then completedAt/date", () => {
  const old = snapshot({ id: "same", updatedAt: "2026-09-01T10:00:00Z", playerBalances: { said: 100, juan: -100 } });
  const corrected = snapshot({ id: "same", updatedAt: "2026-09-02T10:00:00Z", playerBalances: { said: -50, juan: 50 } });
  const other = snapshot({ id: "other", date: "2026-09-03", updatedAt: undefined, completedAt: undefined, playerBalances: { said: 25, juan: -25 } });
  assert.deepEqual(deduplicateRoundSnapshots([corrected, other, old]).map((round) => round.id), ["other", "same"]);
  const ledger = buildBalanceLedger([corrected, other, old]);
  assert.equal(ledger.rounds.length, 2);
  assert.equal(ledger.rounds.find((round) => round.roundId === "same")?.balances.find((entry) => entry.playerId === "said")?.amount, -50);
});

test("never merges guests by player id or display name across rounds", () => {
  const rounds = ["one", "two"].map((id, index) => snapshot({
    id,
    date: `2026-09-0${index + 1}`,
    updatedAt: `2026-09-0${index + 1}T18:00:00Z`,
    players: [player("guest", "Carlos"), player("other", "Otro")],
    playerBalances: { guest: 100, other: -100 },
  }));
  const ledger = buildBalanceLedger(rounds);
  const carlos = ledger.entries.filter((entry) => entry.name === "Carlos");
  assert.equal(carlos.length, 2);
  assert.deepEqual(new Set(carlos.map((entry) => entry.key)), new Set(["guest:one:guest", "guest:two:guest"]));
  assert.ok(carlos.every((entry) => entry.rounds === 1));
});

test("aggregates a linked account by stable accountUserId despite changing player ids", () => {
  const first = snapshot({
    id: "one", updatedAt: "2026-09-01T18:00:00Z",
    players: [player("said-old", "Said", "user-said"), player("guest-a", "A")],
    playerBalances: { "said-old": 100, "guest-a": -100 },
  });
  const second = snapshot({
    id: "two", updatedAt: "2026-09-02T18:00:00Z",
    players: [player("said-new", "Said A.", "user-said"), player("guest-b", "B")],
    playerBalances: { "said-new": -40, "guest-b": 40 },
  });
  const ledger = buildBalanceLedger([first, second]);
  const account = ledger.entries.find((entry) => entry.key === "account:user-said");
  assert.deepEqual({ balance: account?.balance, rounds: account?.rounds, wins: account?.wins, losses: account?.losses }, {
    balance: 60, rounds: 2, wins: 1, losses: 1,
  });
  assert.equal(account?.name, "Said A.");
  assert.equal(account && "amount" in account, false);
  assert.equal(ledger.entries.filter((entry) => entry.accountUserId === "user-said").length, 1);
});

test("malformed persisted names degrade to safe identity labels instead of crashing", () => {
  const corruptPlayers = [
    { id: "said", name: null, handicap: 0, accountUserId: "user-said" },
    { id: "juan", name: 42, handicap: 0 },
  ] as unknown as Player[];
  const corruptOpponents = [{ opponentId: "juan", opponentName: null }] as unknown as RoundSnapshot["personalOpponentResults"];
  const input = snapshot({ players: corruptPlayers, personalOpponentResults: corruptOpponents, playerBalances: { said: 100, juan: -100 } });
  assert.doesNotThrow(() => buildBalanceLedger([input]));
  const ledger = buildBalanceLedger([input]);
  assert.equal(ledger.entries.find((entry) => entry.playerId === "said")?.name, "said");
  assert.equal(ledger.entries.find((entry) => entry.playerId === "juan")?.name, "juan");
  assert.deepEqual(ledger.issues, []);
});

test("rejects two player ids mapped to the same stable account within one round", () => {
  const ledger = buildBalanceLedger([snapshot({
    players: [player("said-a", "Said", "user-said"), player("said-b", "Said duplicado", "user-said"), player("juan", "Juan", "user-juan")],
    playerBalances: { "said-a": 100, "said-b": -40, juan: -60 },
  })]);
  assert.deepEqual(ledger.rounds, []);
  assert.deepEqual(ledger.entries, []);
  assert.deepEqual(ledger.issues, [{ roundId: "round-1", reason: "invalid_player_balances" }]);
});

test("treats a runtime-null playerBalances payload as corrupt instead of crashing or falling back to legacy", () => {
  const corrupt = snapshot({ playerBalances: null as unknown as Record<string, number>, betResult: 500 });
  assert.doesNotThrow(() => buildBalanceLedger([corrupt]));
  const ledger = buildBalanceLedger([corrupt]);
  assert.deepEqual(ledger.rounds, []);
  assert.deepEqual(ledger.issues, [{ roundId: "round-1", reason: "invalid_player_balances" }]);
});

test("suggested transfers are deterministic, complete and reject unbalanced input", () => {
  const suggestions = suggestLedgerTransfers({ said: 700, ana: 300, juan: -500, carlos: -500, tied: 0 });
  assert.deepEqual(suggestions, [
    { fromKey: "carlos", toKey: "said", amount: 500 },
    { fromKey: "juan", toKey: "said", amount: 200 },
    { fromKey: "juan", toKey: "ana", amount: 300 },
  ]);
  assert.equal(suggestions.reduce((sum, transfer) => sum + transfer.amount, 0), 1_000);
  assert.deepEqual(suggestLedgerTransfers({ said: 100, juan: -99 }), []);
  assert.deepEqual(suggestLedgerTransfers({ said: Number.NaN, juan: 0 }), []);
});

test("per-round accepted floating residues are neutralized before they can accumulate", () => {
  const rounds = [1, 2, 3].map((number) => snapshot({
    id: `floating-${number}`,
    updatedAt: `2026-09-0${number}T18:00:00Z`,
    players: [player("a", "A", "user-a"), player("b", "B", "user-b")],
    playerBalances: { a: 100, b: -99.9999999995 },
  }));
  const ledger = buildBalanceLedger(rounds);
  assert.equal(ledger.rounds.length, 3);
  assert.ok(ledger.rounds.every((round) => Math.abs(round.balances.reduce((sum, entry) => sum + entry.amount, 0)) <= Number.EPSILON));
  assert.ok(Math.abs(ledger.entries.reduce((sum, entry) => sum + entry.settleableBalance, 0)) <= Number.EPSILON);
  assert.equal(ledger.suggestedTransfers.length, 3);
  assert.ok(ledger.suggestedTransfers.every((transfer) => transfer.fromKey === "account:user-b" && transfer.toKey === "account:user-a"));
  assert.ok(Math.abs(ledger.suggestedTransfers.reduce((sum, transfer) => sum + transfer.amount, 0) - 299.9999999985) <= EPSILON_FOR_TESTS);
});

test("legacy owner-only values do not contaminate exact transfer suggestions", () => {
  const exact = snapshot({
    id: "exact", updatedAt: "2026-09-02T18:00:00Z",
    players: [player("said", "Said", "user-said"), player("juan", "Juan", "user-juan")],
    playerBalances: { said: 100, juan: -100 },
  });
  const legacy = snapshot({
    id: "legacy", updatedAt: "2026-09-03T18:00:00Z",
    players: [player("said-legacy", "Said", "user-said")],
    ownerId: "said-legacy", playerBalances: undefined, betResult: 1_000,
  });
  const ledger = buildBalanceLedger([exact, legacy]);
  const said = ledger.entries.find((entry) => entry.key === "account:user-said");
  assert.deepEqual({ balance: said?.balance, exact: said?.settleableBalance, legacy: said?.legacyBalance }, {
    balance: 1_100, exact: 100, legacy: 1_000,
  });
  assert.deepEqual(ledger.suggestedTransfers, [{
    fromKey: "account:user-juan", toKey: "account:user-said", amount: 100,
    roundId: "exact", date: "2026-09-06", courseName: "Campo",
  }]);
});

test("settlement references stay inside each round and never connect unrelated participants", () => {
  const first = snapshot({
    id: "first", updatedAt: "2026-09-01T18:00:00Z",
    players: [player("said-1", "Said", "user-said"), player("carlos-1", "Carlos")],
    playerBalances: { "said-1": 100, "carlos-1": -100 },
  });
  const second = snapshot({
    id: "second", updatedAt: "2026-09-02T18:00:00Z",
    players: [player("said-2", "Said", "user-said"), player("carlos-2", "Carlos")],
    playerBalances: { "said-2": -100, "carlos-2": 100 },
  });
  const ledger = buildBalanceLedger([first, second]);
  assert.deepEqual(ledger.suggestedTransfers.map(({ roundId, fromKey, toKey, amount }) => ({ roundId, fromKey, toKey, amount })), [
    { roundId: "second", fromKey: "account:user-said", toKey: "guest:second:carlos-2", amount: 100 },
    { roundId: "first", fromKey: "guest:first:carlos-1", toKey: "account:user-said", amount: 100 },
  ]);
  assert.equal(ledger.suggestedTransfers.some((transfer) => transfer.fromKey.includes("carlos") && transfer.toKey.includes("carlos")), false);
});

test("comparison counts only exact shared rounds and never presents legacy owner values as head-to-head", () => {
  const sharedWin = snapshot({
    id: "shared-win", updatedAt: "2026-09-01T18:00:00Z",
    players: [player("said-1", "Said", "user-said"), player("juan-1", "Juan", "user-juan"), player("ana", "Ana", "user-ana")],
    playerBalances: { "said-1": 150, "juan-1": -100, ana: -50 },
  });
  const sharedLoss = snapshot({
    id: "shared-loss", updatedAt: "2026-09-02T18:00:00Z",
    players: [player("said-2", "Said", "user-said"), player("juan-2", "Juan", "user-juan")],
    playerBalances: { "said-2": -40, "juan-2": 40 },
  });
  const separate = snapshot({
    id: "separate", updatedAt: "2026-09-03T18:00:00Z",
    players: [player("said-3", "Said", "user-said"), player("ana-2", "Ana", "user-ana")],
    playerBalances: { "said-3": 500, "ana-2": -500 },
  });
  const legacy = snapshot({
    id: "legacy-shared", updatedAt: "2026-09-04T18:00:00Z",
    players: [player("said-4", "Said", "user-said"), player("juan-4", "Juan", "user-juan")],
    playerBalances: undefined,
    betResult: 1_000,
  });
  const ledger = buildBalanceLedger([sharedWin, sharedLoss, separate, legacy]);

  assert.deepEqual(compareLedgerEntries(ledger, "account:user-said", "account:user-juan"), {
    leftKey: "account:user-said",
    rightKey: "account:user-juan",
    roundsTogether: 2,
    leftAhead: 0,
    rightAhead: 1,
    ties: 0,
    bilateralRounds: 1,
    leftBalance: 110,
    rightBalance: -60,
  });
  assert.equal(compareLedgerEntries(ledger, "account:user-said", "account:user-said").roundsTogether, 0);
  assert.equal(compareLedgerEntries(ledger, "missing", "account:user-juan").roundsTogether, 0);
});

test("Balances UI is wired from Home and Jugar without presenting payment as known state", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const home = readFileSync("app/components/home-dashboard.tsx", "utf8");
  const play = readFileSync("app/components/play-hub.tsx", "utf8");
  const panel = readFileSync("app/components/balance-ledger-panel.tsx", "utf8");
  const css = readFileSync("app/components/balance-ledger-panel.module.css", "utf8");
  assert.match(page, /tab === "balances" && <BalanceLedgerPanel history=\{history\}/);
  assert.match(home, /onOpenBalances/);
  assert.match(play, /onOpenBalances/);
  assert.match(panel, /REFERENCIA POR RONDA/);
  assert.match(panel, /Puede haber sido liquidada fuera de The Backyard/);
  assert.doesNotMatch(panel, /> paga a </);
  assert.match(panel, /currentUserId && entry\.accountUserId === currentUserId/);
  assert.match(css, /\.selectors select \{[^}]*min-height: 44px/);
  assert.match(css, /\.heroPositive \{ color: #dcffe5 !important; \}/);
});

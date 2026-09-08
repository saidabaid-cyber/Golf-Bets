import type { Transfer } from "../../types";

export type RoundRecapPlayer = { id: string; name: string };

export type DeterministicRoundRecapInput = {
  players: RoundRecapPlayer[];
  balances: Record<string, number>;
  skinsWon?: Record<string, number>;
  rabbitsWon?: Record<string, number>;
  transfers?: Transfer[];
};

export type DeterministicRoundRecap = {
  headline: string;
  highlights: string[];
  provenance: "deterministic_round_results";
};

function signedMoney(value: number) {
  const rounded = Math.round(value);
  if (rounded === 0) return "$0";
  return `${rounded > 0 ? "+" : "−"}$${Math.abs(rounded).toLocaleString("es-MX")}`;
}

function safeCount(value: number | undefined) {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.trunc(value ?? 0) : 0;
}

/** Builds narrative exclusively from supplied deterministic engine output. */
export function buildDeterministicRoundRecap(input: DeterministicRoundRecapInput): DeterministicRoundRecap {
  const ranked = input.players
    .map((player) => ({ ...player, balance: Number.isFinite(input.balances[player.id]) ? input.balances[player.id] : 0 }))
    .sort((left, right) => right.balance - left.balance || left.name.localeCompare(right.name, "es-MX"));
  const winner = ranked[0];
  const headline = winner && winner.balance > 0
    ? `${winner.name} terminó como mayor ganador con ${signedMoney(winner.balance)}.`
    : "La ronda terminó sin un ganador económico neto.";
  const highlights: string[] = [];
  for (const player of ranked) {
    const skins = safeCount(input.skinsWon?.[player.id]);
    if (skins > 0) highlights.push(`${player.name} ganó ${skins} skin${skins === 1 ? "" : "s"}.`);
    const rabbits = safeCount(input.rabbitsWon?.[player.id]);
    if (rabbits > 0) highlights.push(`${player.name} ganó ${rabbits} conejo${rabbits === 1 ? "" : "s"}.`);
  }
  const transferCount = input.transfers?.filter((transfer) => Number.isFinite(transfer.amount) && transfer.amount > 0).length ?? 0;
  if (transferCount > 0) highlights.push(`La liquidación mínima requiere ${transferCount} pago${transferCount === 1 ? "" : "s"}.`);
  return { headline, highlights, provenance: "deterministic_round_results" };
}

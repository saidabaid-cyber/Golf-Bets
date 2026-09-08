import type { RoundSetupQuestion } from "../schemas/actions";

export type UnknownPlayerClarification = {
  name: string;
  handicap: number;
};

const MIN_HANDICAP = -15;
const MAX_HANDICAP = 54;

function originalPlayerName(question: RoundSetupQuestion) {
  const quoted = /[“"]([^”"]+)[”"]/.exec(question.prompt)?.[1]?.trim();
  if (quoted) return quoted;
  return question.field.startsWith("players.") ? question.field.slice("players.".length).trim() : "";
}

/**
 * Parses only the focused answer to an unknown-player question. The result is
 * an ephemeral candidate; normal round persistence remains the source of truth.
 */
export function parseUnknownPlayerClarification(
  question: RoundSetupQuestion | undefined,
  answer: string,
): UnknownPlayerClarification | null {
  if (!question || question.code !== "unknown_player" || !question.field.startsWith("players.")) return null;
  const matches = [...answer.matchAll(/[+-]?\d+(?:[.,]\d+)?/g)];
  const handicapMatch = matches.at(-1);
  if (!handicapMatch || handicapMatch.index === undefined) return null;
  const normalizedHandicap = handicapMatch[0].replace(",", ".");
  const numericHandicap = Number(normalizedHandicap);
  const handicap = normalizedHandicap.startsWith("+") ? -Math.abs(numericHandicap) : numericHandicap;
  if (!Number.isFinite(handicap) || handicap < MIN_HANDICAP || handicap > MAX_HANDICAP) return null;

  const prefix = answer.slice(0, handicapMatch.index)
    .replace(/\b(?:con\s+)?(?:hcp|handicap)(?:\s+(?:de|es))?\s*[:=]?\s*$/i, "")
    .replace(/\b(?:tiene|es)\s*$/i, "")
    .replace(/^(?:s[ií][,.]?\s*)?(?:agr[eé]galo|agrega(?:r)?|nuevo(?:\s+jugador)?)[,:]?\s*/i, "")
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const name = prefix || originalPlayerName(question);
  if (!name || name.length > 120 || /[\r\n]/.test(name)) return null;
  return { name, handicap };
}

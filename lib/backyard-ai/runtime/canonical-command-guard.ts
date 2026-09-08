import type { ParsedRoundSetupAction, RoundMemoryReference } from "../schemas/actions";
import { normalizeMexicanSpanish, parseRoundSetupIntent } from "./intent-parser";

export type CanonicalCommandIntegrityIssueCode =
  | "empty_canonical_command"
  | "explicit_numbers_changed"
  | "explicit_actions_changed"
  | "memory_reference_changed"
  | "unknown_catalog_term_changed";

export type CanonicalCommandIntegrityIssue = {
  code: CanonicalCommandIntegrityIssueCode;
  message: string;
};

export type CanonicalCommandIntegrityResult =
  | { ok: true; command: string; issues: [] }
  | { ok: false; command: string; issues: CanonicalCommandIntegrityIssue[] };

function normalizedName(value: string) {
  return normalizeMexicanSpanish(value);
}

function normalizedNames(values: readonly string[] | undefined, preserveOrder = false) {
  const names = (values ?? []).map(normalizedName);
  return preserveOrder ? names : names.sort();
}

function teamPartition(left: readonly string[] | undefined, right: readonly string[] | undefined) {
  const teams = [normalizedNames(left), normalizedNames(right)]
    .filter((team) => team.length > 0)
    .map((team) => team.join("+"))
    .sort();
  return teams;
}

/**
 * Only fields with domain meaning belong in this fingerprint. Confidence,
 * evidence and prose are deliberately excluded so the provider may normalize
 * language, but cannot mutate a fact that reaches the deterministic engine.
 */
function actionFingerprint(action: ParsedRoundSetupAction) {
  switch (action.type) {
    case "replace_players":
      return [action.type, normalizedNames(action.playerNames, true)];
    case "set_player_handicap":
      return [action.type, normalizedName(action.playerName), action.handicap];
    case "select_course":
      return [action.type, normalizedName(action.courseName)];
    case "select_tee":
      return [action.type, normalizedName(action.teeName)];
    case "set_start_hole":
      return [action.type, action.startHole];
    case "set_round_holes":
      return [action.type, action.roundHoles];
    case "set_handicap_basis":
      return [action.type, action.handicapBasis];
    case "configure_core_bet":
      return [
        action.type,
        action.bet,
        action.enabled,
        action.value ?? null,
        normalizedNames(action.excludedPlayerNames),
        action.allPlayers ?? false,
        action.skinsMode ?? null,
        action.secondNinePressed ?? null,
        action.secondNineMultiplier ?? null,
      ];
    case "configure_group_nassau":
      return [
        action.type,
        action.enabled,
        action.value ?? null,
        normalizedNames(action.excludedPlayerNames),
        action.allPlayers ?? false,
        action.hcpPct ?? null,
        action.decimals ?? null,
        action.modificationOnly ?? false,
      ];
    case "configure_polla_component":
      return [
        action.type,
        action.component,
        action.enabled,
        action.value ?? null,
        normalizedNames(action.excludedPlayerNames),
        action.allPlayers ?? false,
        action.hcpPct ?? null,
        action.decimals ?? null,
      ];
    case "configure_individual_nassau":
      return [
        action.type,
        action.enabled,
        normalizedName(action.playerAName),
        normalizedName(action.playerBName),
        action.value ?? null,
      ];
    case "configure_ball_friend":
      return [
        action.type,
        action.enabled,
        action.value ?? null,
        teamPartition(action.teamAPlayerNames, action.teamBPlayerNames),
        normalizedNames(action.excludedPlayerNames),
        action.allPlayers ?? false,
      ];
    case "configure_supplemental_bet":
      return [
        action.type,
        action.betType,
        action.enabled,
        action.value ?? null,
        action.playerAName ? normalizedName(action.playerAName) : null,
        action.playerBName ? normalizedName(action.playerBName) : null,
        normalizedNames(action.participantNames),
        normalizedNames(action.excludedPlayerNames),
        action.allPlayers ?? false,
        teamPartition(action.teamAPlayerNames, action.teamBPlayerNames),
        action.carryEnabled ?? null,
        action.hcpPct ?? null,
        action.decimals ?? null,
        action.matchPlayEnabled ?? null,
        action.advantageReceiverName ? normalizedName(action.advantageReceiverName) : null,
        action.advantageStrokes ?? null,
        action.clearAdvantage ?? null,
        action.quotaBase ?? null,
        action.chicagoPoints
          ? Object.entries(action.chicagoPoints).sort(([left], [right]) => left.localeCompare(right))
          : null,
        action.rotation ?? null,
        action.blockSize ?? null,
        action.birdiePenalty ?? null,
        action.holes ?? null,
      ];
  }
}

function actionFingerprints(actions: readonly ParsedRoundSetupAction[]) {
  return actions.map((action) => JSON.stringify(actionFingerprint(action))).sort();
}

function referenceFingerprint(reference: RoundMemoryReference | undefined) {
  if (!reference) return null;
  switch (reference.type) {
    case "same_players_last_sunday":
    case "same_as_last_week":
    case "same_as_previous":
      return JSON.stringify([reference.type]);
    case "same_usual_group":
      return JSON.stringify([reference.type, reference.playerCount ?? null]);
    case "frequent_group":
      return JSON.stringify([reference.type, normalizedName(reference.groupName)]);
    case "last_round_at_course":
      return JSON.stringify([reference.type, normalizedName(reference.courseName)]);
  }
}

function normalizedNumericLiteral(raw: string) {
  const sign = raw.startsWith("-") ? "-" : "";
  let value = raw.replace(/^[+-]/, "");
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalIndex = Math.max(lastComma, lastDot);
    const decimals = value.length - decimalIndex - 1;
    const integer = value.slice(0, decimalIndex).replace(/[.,]/g, "");
    value = decimals > 0 && decimals <= 2
      ? `${integer}.${value.slice(decimalIndex + 1)}`
      : value.replace(/[.,]/g, "");
  } else {
    const separator = lastComma >= 0 ? "," : lastDot >= 0 ? "." : "";
    if (separator) {
      const pieces = value.split(separator);
      value = pieces.length > 2 || (pieces.length === 2 && pieces[1].length === 3)
        ? pieces.join("")
        : `${pieces[0]}.${pieces[1]}`;
    }
  }
  const number = Number(`${sign}${value}`);
  return Number.isFinite(number) ? String(number) : `${sign}${value}`;
}

function numericLiteralFingerprints(command: string) {
  return [...command.matchAll(/[+-]?\d+(?:[.,]\d+)*/g)]
    .map((match) => normalizedNumericLiteral(match[0]))
    .sort();
}

function unknownCatalogFacts(interpretation: ReturnType<typeof parseRoundSetupIntent>) {
  return interpretation.questions
    .filter((question) => question.code === "unknown_bet")
    .map((question) => `${question.code}:${normalizeMexicanSpanish(question.field)}`)
    .sort();
}

function sameFacts(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Validates a provider rewrite before it can enter the setup pipeline.
 *
 * The guard is intentionally fail-closed: a harmless rewrite that cannot be
 * proven equivalent falls back to the original/local command. The review UI
 * remains the final user confirmation, while no provider-authored mutation can
 * silently change money, participants, teams, exclusions or memory references.
 */
export function validateCanonicalRoundCommand(
  originalCommand: string,
  proposedCanonicalCommand: string,
): CanonicalCommandIntegrityResult {
  const command = proposedCanonicalCommand.trim();
  if (!command) {
    return {
      ok: false,
      command: originalCommand,
      issues: [{ code: "empty_canonical_command", message: "El proveedor devolvió una instrucción vacía." }],
    };
  }

  const original = parseRoundSetupIntent(originalCommand);
  const proposed = parseRoundSetupIntent(command);
  const issues: CanonicalCommandIntegrityIssue[] = [];

  if (!sameFacts(numericLiteralFingerprints(originalCommand), numericLiteralFingerprints(command))) {
    issues.push({
      code: "explicit_numbers_changed",
      message: "La reescritura cambió o agregó una cifra explícita.",
    });
  }
  if (!sameFacts(actionFingerprints(original.actions), actionFingerprints(proposed.actions))) {
    issues.push({
      code: "explicit_actions_changed",
      message: "La reescritura cambió jugadores, equipos, exclusiones o configuración de juego.",
    });
  }
  if (referenceFingerprint(original.reference) !== referenceFingerprint(proposed.reference)) {
    issues.push({
      code: "memory_reference_changed",
      message: "La reescritura cambió la referencia al contexto o histórico.",
    });
  }
  if (!sameFacts(unknownCatalogFacts(original), unknownCatalogFacts(proposed))) {
    issues.push({
      code: "unknown_catalog_term_changed",
      message: "La reescritura cambió un término que el catálogo todavía debe aclarar.",
    });
  }

  return issues.length
    ? { ok: false, command: originalCommand, issues }
    : { ok: true, command, issues: [] };
}

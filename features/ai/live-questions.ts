import type { LiveScoreboard } from "../live-rounds/domain";

export type LiveQuestionKind = "HOW_AM_I" | "WHO_LEADS" | "MY_PUTTS" | "GAME_STATUS";

export type LiveQuestionFacts = {
  kind: LiveQuestionKind;
  status: "PROVISIONAL" | "FINAL";
  player: { gross: number; net: number | null; relativeToPar: number; thru: number } | null;
  balance: number | null;
  putts?: number;
  gameFacts?: Record<string, string | number | boolean | null>;
  engineVersion: string;
};
export type LiveQuestionExplanation = { answer: string };

export function classifyLiveQuestion(question: string): LiveQuestionKind | null {
  const value = question.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/como voy|cuanto voy/.test(value)) return "HOW_AM_I";
  if (/quien (va|lleva|gana)/.test(value)) return "WHO_LEADS";
  if (/cuantos putts/.test(value)) return "MY_PUTTS";
  if (/skins|camellos|peces|viboras|juegos/.test(value)) return "GAME_STATUS";
  return null;
}

/** Produces only structured facts already calculated by deterministic domains. */
export function liveQuestionFacts(input: { kind: LiveQuestionKind; playerId: string; scoreboard: LiveScoreboard; putts?: number; gameFacts?: Record<string, string | number | boolean | null> }): LiveQuestionFacts {
  const player = input.scoreboard.golf.find((row) => row.playerId === input.playerId);
  return {
    kind: input.kind,
    status: input.scoreboard.status,
    player: player ? { gross: player.gross, net: player.net, relativeToPar: player.relativeToPar, thru: player.thru } : null,
    balance: input.scoreboard.balances[input.playerId] ?? null,
    ...(input.putts !== undefined ? { putts: input.putts } : {}),
    ...(input.gameFacts ? { gameFacts: { ...input.gameFacts } } : {}),
    engineVersion: input.scoreboard.engineVersion,
  };
}

const KINDS = new Set<LiveQuestionKind>(["HOW_AM_I", "WHO_LEADS", "MY_PUTTS", "GAME_STATUS"]);

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Accepts only facts already produced by deterministic domains; identities and raw round data are rejected. */
export function parseLiveQuestionFacts(value: unknown): LiveQuestionFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["kind", "status", "player", "balance", "putts", "gameFacts", "engineVersion"].includes(key))) return null;
  if (!KINDS.has(source.kind as LiveQuestionKind) || !["PROVISIONAL", "FINAL"].includes(String(source.status))) return null;
  if (typeof source.engineVersion !== "string" || !source.engineVersion.trim() || source.engineVersion.length > 80) return null;
  if (!(source.balance === null || finiteNumber(source.balance))) return null;
  if (source.putts !== undefined && (!finiteNumber(source.putts) || (source.putts as number) < 0 || (source.putts as number) > 400)) return null;
  let player: LiveQuestionFacts["player"] = null;
  if (source.player !== null) {
    if (!source.player || typeof source.player !== "object" || Array.isArray(source.player)) return null;
    const raw = source.player as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["gross", "net", "relativeToPar", "thru"].includes(key))) return null;
    if (!finiteNumber(raw.gross) || !(raw.net === null || finiteNumber(raw.net)) || !finiteNumber(raw.relativeToPar) || !finiteNumber(raw.thru)) return null;
    player = { gross: raw.gross as number, net: raw.net as number | null, relativeToPar: raw.relativeToPar as number, thru: raw.thru as number };
  }
  let gameFacts: Record<string, string | number | boolean | null> | undefined;
  if (source.gameFacts !== undefined) {
    if (!source.gameFacts || typeof source.gameFacts !== "object" || Array.isArray(source.gameFacts)) return null;
    const entries = Object.entries(source.gameFacts as Record<string, unknown>);
    if (entries.length > 16 || entries.some(([key, item]) => !/^[a-zA-Z0-9_.-]{1,48}$/.test(key) || !(item === null || typeof item === "string" || typeof item === "boolean" || finiteNumber(item)) || (typeof item === "string" && item.length > 100))) return null;
    gameFacts = Object.fromEntries(entries) as Record<string, string | number | boolean | null>;
  }
  return {
    kind: source.kind as LiveQuestionKind,
    status: source.status as "PROVISIONAL" | "FINAL",
    player,
    balance: source.balance as number | null,
    ...(source.putts !== undefined ? { putts: source.putts as number } : {}),
    ...(gameFacts ? { gameFacts } : {}),
    engineVersion: source.engineVersion.trim(),
  };
}

export function validateLiveQuestionExplanation(value: unknown): LiveQuestionExplanation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "answer") || typeof source.answer !== "string") return null;
  const answer = source.answer.trim();
  return answer && answer.length <= 500 ? { answer } : null;
}

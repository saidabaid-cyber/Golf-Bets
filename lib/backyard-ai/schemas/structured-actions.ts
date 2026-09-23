import type { CoreRoundBetKey, RoundSetupAction } from "./actions";

export const STRUCTURED_ACTION_VERSION = 1 as const;
export type StructuredBetKey = CoreRoundBetKey | "nassau" | "ballFriend";
export type BettingConfiguration = Extract<RoundSetupAction, {
  type: "configure_core_bet" | "configure_group_nassau" | "configure_polla_component"
    | "configure_individual_nassau" | "configure_ball_friend" | "upsert_supplemental_bet";
}>;

/** IDs reference the authenticated host's authorized catalog, never model-supplied records. */
export type StructuredAction =
  | { type: "find_player"; query: string }
  | { type: "add_player"; playerId: string }
  | { type: "remove_player"; playerId: string }
  | { type: "select_group"; groupId: string }
  | { type: "select_course"; courseId: string }
  | { type: "select_tee"; teeId: string; playerIds: string[] }
  | { type: "set_round_holes"; holes: 9 | 18 }
  | { type: "set_start_hole"; hole: number }
  | { type: "set_handicap_source"; playerId: string; source: "manual" | "profile_index" }
  | { type: "set_handicap"; playerId: string; handicap: number }
  | { type: "enable_bet"; bet: StructuredBetKey }
  | { type: "disable_bet"; bet: StructuredBetKey }
  | { type: "configure_bet"; configuration: BettingConfiguration }
  | { type: "assign_bet_participants"; bet: StructuredBetKey; playerIds: string[] }
  | { type: "start_round" }
  | { type: "record_score"; playerId: string; hole: number; score: number }
  | { type: "correct_score"; playerId: string; hole: number; score: number }
  | { type: "record_putts"; playerId: string; hole: number; putts: number }
  | { type: "query_round_status" }
  | { type: "query_results" }
  | { type: "query_statistics"; playerId: string };

export type StructuredActionBatch = { version: 1; requestId: string; expectedRevision: number; actions: StructuredAction[] };
export const STRUCTURED_ACTION_TYPES = [
  "find_player", "add_player", "remove_player", "select_group", "select_course", "select_tee",
  "set_round_holes", "set_start_hole", "set_handicap_source", "set_handicap", "enable_bet", "disable_bet",
  "configure_bet", "assign_bet_participants", "start_round", "record_score", "correct_score", "record_putts",
  "query_round_status", "query_results", "query_statistics",
] as const satisfies readonly StructuredAction["type"][];
const BETS = new Set<string>(["monkey", "rabbits", "skins", "units", "foursome", "miniPolla", "vipers", "camels", "fish", "loba", "nassau", "ballFriend"]);
const FIELDS: Record<StructuredAction["type"], readonly string[]> = {
  find_player: ["query"], add_player: ["playerId"], remove_player: ["playerId"], select_group: ["groupId"],
  select_course: ["courseId"], select_tee: ["teeId", "playerIds"], set_round_holes: ["holes"], set_start_hole: ["hole"],
  set_handicap_source: ["playerId", "source"], set_handicap: ["playerId", "handicap"], enable_bet: ["bet"], disable_bet: ["bet"],
  configure_bet: ["configuration"], assign_bet_participants: ["bet", "playerIds"], start_round: [],
  record_score: ["playerId", "hole", "score"], correct_score: ["playerId", "hole", "score"], record_putts: ["playerId", "hole", "putts"],
  query_round_status: [], query_results: [], query_statistics: ["playerId"],
};
const CONFIG_FIELDS: Record<BettingConfiguration["type"], readonly string[]> = {
  configure_core_bet: ["bet", "enabled", "value", "participantIds", "skinsMode", "secondNinePressed", "secondNineMultiplier", "foursomeMode", "foursomeBasePair", "foursomePressureMultiplier"],
  configure_group_nassau: ["enabled", "value", "participantIds", "componentScope", "participantIdsByComponent", "hcpPct", "decimals"],
  configure_polla_component: ["component", "enabled", "value", "participantIds", "hcpPct", "decimals"],
  configure_individual_nassau: ["id", "enabled", "playerAId", "playerBId", "value"],
  configure_ball_friend: ["enabled", "value", "participantIds", "teamA"],
  upsert_supplemental_bet: ["bet"],
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function identifier(value: unknown) { return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 200 && !/\s/.test(value) && !["__proto__", "prototype", "constructor"].includes(value); }
function ids(value: unknown) { return Array.isArray(value) && value.length > 0 && value.length <= 64 && value.every(identifier) && new Set(value).size === value.length; }
function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 8000;
  if (value === null || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => safeJson(item, depth + 1));
  return object(value) && Object.entries(value).every(([key, item]) => !["__proto__", "prototype", "constructor"].includes(key) && safeJson(item, depth + 1));
}
/** Defensive wire validation runs before the existing domain validator. No free-form state patches. */
export function parseStructuredActionBatch(value: unknown): StructuredActionBatch {
  if (!object(value) || !safeJson(value) || Object.keys(value).some((key) => !["version", "requestId", "expectedRevision", "actions"].includes(key))
    || value.version !== 1 || !identifier(value.requestId) || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0
    || !Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > 64) throw new Error("INVALID_ACTION_BATCH");
  for (const raw of value.actions) {
    if (!object(raw) || typeof raw.type !== "string" || !Object.hasOwn(FIELDS, raw.type)) throw new Error("UNKNOWN_ACTION");
    const type = raw.type as StructuredAction["type"];
    const fields = FIELDS[type];
    if (Object.keys(raw).some((key) => key !== "type" && !fields.includes(key)) || fields.some((key) => !(key in raw))) throw new Error("INVALID_ACTION_FIELDS");
    for (const key of ["playerId", "groupId", "courseId", "teeId"]) if (key in raw && !identifier(raw[key])) throw new Error("INVALID_ID");
    if ("playerIds" in raw && !ids(raw.playerIds)) throw new Error("INVALID_PARTICIPANTS");
    if ("bet" in raw && (typeof raw.bet !== "string" || !BETS.has(raw.bet))) throw new Error("UNKNOWN_BET");
    if (type === "find_player" && (typeof raw.query !== "string" || !raw.query.trim() || raw.query.length > 200)) throw new Error("INVALID_QUERY");
    if (type === "set_round_holes" && raw.holes !== 9 && raw.holes !== 18) throw new Error("INVALID_HOLES");
    if (type === "set_start_hole" && (typeof raw.hole !== "number" || !Number.isInteger(raw.hole) || raw.hole < 1 || raw.hole > 18)) throw new Error("INVALID_START_HOLE");
    if (type === "set_handicap_source" && raw.source !== "manual" && raw.source !== "profile_index") throw new Error("UNAVAILABLE_HANDICAP_SOURCE");
    if (type === "set_handicap" && (typeof raw.handicap !== "number" || raw.handicap < -15 || raw.handicap > 36)) throw new Error("INVALID_HANDICAP");
    if (["record_score", "correct_score", "record_putts"].includes(type)) {
      if (!Number.isInteger(raw.hole) || Number(raw.hole) < 1 || Number(raw.hole) > 18) throw new Error("INVALID_HOLE");
      const count = type === "record_putts" ? raw.putts : raw.score;
      if (!Number.isSafeInteger(count) || Number(count) < (type === "record_putts" ? 0 : 1) || Number(count) > 99) throw new Error("INVALID_CAPTURE");
    }
    if (type === "configure_bet") {
      const cfg = raw.configuration;
      if (!object(cfg) || typeof cfg.type !== "string" || !Object.hasOwn(CONFIG_FIELDS, cfg.type)) throw new Error("INVALID_BET_CONFIGURATION");
      const allowed = [...CONFIG_FIELDS[cfg.type as BettingConfiguration["type"]], "type", "source", "confidence", "evidence"];
      if (Object.keys(cfg).some((key) => !allowed.includes(key)) || cfg.source !== "explicit" || cfg.confidence !== 1 || typeof cfg.evidence !== "string") throw new Error("INVALID_BET_CONFIGURATION");
      if ("enabled" in cfg && typeof cfg.enabled !== "boolean") throw new Error("INVALID_BET_ENABLED");
      if ("participantIds" in cfg && !ids(cfg.participantIds)) throw new Error("INVALID_PARTICIPANTS");
      if (cfg.type === "configure_core_bet" && (typeof cfg.bet !== "string" || !BETS.has(cfg.bet) || cfg.bet === "nassau" || cfg.bet === "ballFriend")) throw new Error("UNKNOWN_BET");
      if (cfg.type === "configure_polla_component" && !["first9", "second9", "total18"].includes(String(cfg.component))) throw new Error("INVALID_BET_COMPONENT");
      if ("skinsMode" in cfg && cfg.skinsMode !== "carry" && cfg.skinsMode !== "no_carry") throw new Error("INVALID_CARRY");
      if ("participantIdsByComponent" in cfg && (!object(cfg.participantIdsByComponent) || Object.entries(cfg.participantIdsByComponent).some(([key, value]) => !["first9", "second9", "total18"].includes(key) || !ids(value)))) throw new Error("INVALID_PARTICIPANTS");
      if (cfg.type === "upsert_supplemental_bet") {
        const bet = cfg.bet;
        const base = ["id", "type", "enabled"];
        const allowedByType: Record<string, string[]> = {
          dollar_stroke: ["playerAId", "playerBId", "valuePerStroke", "advantageReceiverId", "advantageStrokes"],
          individual_pressures: ["participantIds", "value", "hcpPct", "decimals", "carryEnabled", "matchPlayEnabled"],
          team_pressures: ["participantIds", "abandonedPlayerIds", "teamA", "metric", "virtualMode", "value", "hcpPct", "decimals", "carryEnabled", "abandonedMaxScore"],
          chicago: ["participantIds", "quotaBase", "hcpPct", "valuePerPoint", "points"],
          vegas: ["participantIds", "teamA", "valuePerUnit", "rotation", "blockSize", "hcpPct", "decimals", "birdiePenalty"],
          minimum_putts: ["participantIds", "ante", "holes"],
        };
        if (!object(bet) || typeof bet.type !== "string" || !Object.hasOwn(allowedByType, bet.type)
          || Object.keys(bet).some((key) => ![...base, ...allowedByType[bet.type as string]].includes(key))) throw new Error("INVALID_SUPPLEMENTAL_FIELDS");
        if ("points" in bet && (!object(bet.points) || Object.keys(bet.points).some((key) => !["birdieOrBetter", "par", "bogey", "doubleBogeyOrWorse"].includes(key)))) throw new Error("INVALID_POINTS");
      }
    }
  }
  return structuredClone(value) as StructuredActionBatch;
}

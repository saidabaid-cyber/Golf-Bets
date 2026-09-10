import type { Course, HoleScore, Player } from "../../lib/types";
import { privateLeaderboard, type PrivateLeaderboardRow } from "../../lib/round-utils";

export const LIVE_ROUND_ROLES = ["ORGANIZER", "SCOREKEEPER", "PLAYER", "VIEWER"] as const;
export type LiveRoundRole = (typeof LIVE_ROUND_ROLES)[number];

export type LiveRoundParticipant = {
  id: string;
  roundId: string;
  role: LiveRoundRole;
  userId?: string | null;
  guestPlayerId?: string | null;
  playerId?: string | null;
  joinedAt: string;
};

export type LiveRoundOperation = {
  id: string;
  roundId: string;
  actorId: string;
  kind: "SCORE_SET" | "PUTTS_SET" | "STAT_PATCH" | "ROUND_SETTINGS_PATCH";
  playerId?: string;
  hole?: number;
  value: unknown;
  baseVersion: number;
  createdAt: string;
};

export type LiveRoundState = {
  id: string;
  ownerId: string;
  groupId?: string | null;
  version: number;
  lifecycle: "DRAFT" | "LIVE" | "COMPLETED" | "CANCELLED";
  participants: LiveRoundParticipant[];
  scores: Record<number, HoleScore>;
  putts: Record<number, Record<string, number | null>>;
  stats: Record<number, Record<string, Record<string, unknown>>>;
  appliedOperationIds: string[];
  cellVersions: Record<string, number>;
  updatedAt: string;
};

export type LiveRoundConflict = {
  operationId: string;
  cellKey: string;
  remoteVersion: number;
  baseVersion: number;
};

export function liveRoundRole(state: LiveRoundState, actorId: string) {
  if (state.ownerId === actorId) return "ORGANIZER" as const;
  return state.participants.find((participant) => participant.userId === actorId)?.role ?? null;
}

export function canViewLiveRound(state: LiveRoundState, actorId: string) {
  return liveRoundRole(state, actorId) !== null;
}

export function canEditLiveRoundOperation(state: LiveRoundState, operation: LiveRoundOperation) {
  if (state.id !== operation.roundId || state.lifecycle === "COMPLETED" || state.lifecycle === "CANCELLED") return false;
  const role = liveRoundRole(state, operation.actorId);
  if (role === "ORGANIZER" || role === "SCOREKEEPER") return true;
  if (role !== "PLAYER" || !operation.playerId) return false;
  const participant = state.participants.find((candidate) => candidate.userId === operation.actorId);
  return participant?.playerId === operation.playerId && operation.kind !== "ROUND_SETTINGS_PATCH";
}

function operationCellKey(operation: LiveRoundOperation) {
  if (operation.kind === "ROUND_SETTINGS_PATCH") return "settings";
  return `${operation.kind}:${operation.hole ?? "?"}:${operation.playerId ?? "?"}`;
}

function validHolePlayerOperation(operation: LiveRoundOperation) {
  return Boolean(operation.playerId && Number.isInteger(operation.hole) && (operation.hole as number) >= 1 && (operation.hole as number) <= 18);
}

export function applyLiveRoundOperation(state: LiveRoundState, operation: LiveRoundOperation): { state: LiveRoundState; conflict?: LiveRoundConflict; applied: boolean } {
  if (state.appliedOperationIds.includes(operation.id)) return { state, applied: false };
  if (!canEditLiveRoundOperation(state, operation)) return { state, applied: false };
  const cellKey = operationCellKey(operation);
  const remoteVersion = state.cellVersions[cellKey] ?? 0;
  if (remoteVersion > operation.baseVersion) return { state, conflict: { operationId: operation.id, cellKey, remoteVersion, baseVersion: operation.baseVersion }, applied: false };
  if (operation.kind !== "ROUND_SETTINGS_PATCH" && !validHolePlayerOperation(operation)) return { state, applied: false };
  const version = state.version + 1;
  let next: LiveRoundState = { ...state, version, updatedAt: operation.createdAt, appliedOperationIds: [...state.appliedOperationIds, operation.id].slice(-500), cellVersions: { ...state.cellVersions, [cellKey]: version } };
  if (operation.kind === "SCORE_SET") {
    if (operation.value !== null && (!Number.isInteger(operation.value) || (operation.value as number) < 1 || (operation.value as number) > 20)) return { state, applied: false };
    next = { ...next, scores: { ...state.scores, [operation.hole as number]: { ...(state.scores[operation.hole as number] || {}), [operation.playerId as string]: operation.value as number | null } } };
  } else if (operation.kind === "PUTTS_SET") {
    if (operation.value !== null && (!Number.isInteger(operation.value) || (operation.value as number) < 0 || (operation.value as number) > 20)) return { state, applied: false };
    next = { ...next, putts: { ...state.putts, [operation.hole as number]: { ...(state.putts[operation.hole as number] || {}), [operation.playerId as string]: operation.value as number | null } } };
  } else if (operation.kind === "STAT_PATCH") {
    if (!operation.value || typeof operation.value !== "object" || Array.isArray(operation.value)) return { state, applied: false };
    next = { ...next, stats: { ...state.stats, [operation.hole as number]: { ...(state.stats[operation.hole as number] || {}), [operation.playerId as string]: { ...(state.stats[operation.hole as number]?.[operation.playerId as string] || {}), ...(operation.value as Record<string, unknown>) } } } };
  }
  return { state: next, applied: true };
}

export type DeterministicBalanceSnapshot = {
  engineVersion: string;
  balances: Record<string, number>;
  calculatedAt: string;
};

export type LiveScoreboard = {
  status: "PROVISIONAL" | "FINAL";
  golf: PrivateLeaderboardRow[];
  balances: Record<string, number>;
  engineVersion: string;
  calculatedAt: string;
};

/** Uses Phase 1 scoring plus a caller-provided canonical engine snapshot. */
export function buildLiveScoreboard(input: { course: Course; players: Player[]; scores: Record<number, HoleScore>; order: number[]; deterministic: DeterministicBalanceSnapshot }): LiveScoreboard {
  const golf = privateLeaderboard(input.course, input.players, input.scores, input.order);
  const balances = { ...input.deterministic.balances };
  const total = Object.values(balances).reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || Math.abs(total) > 0.01) throw new Error("El snapshot económico del motor no suma cero.");
  return { status: golf.length > 0 && golf.every((row) => row.finished) ? "FINAL" : "PROVISIONAL", golf, balances, engineVersion: input.deterministic.engineVersion, calculatedAt: input.deterministic.calculatedAt };
}

import { applyLiveRoundOperation, type LiveRoundState } from "../features/live-rounds/domain";
import { linkedRoundPlayers } from "./shared-round-participants";
import type { RoundSnapshot } from "./types";
import { applySharedGroupFacts, applySharedPlayerFacts, type SharedGroupFacts, type SharedPlayerFacts } from "./shared-round-bet-capture";

export class SharedLiveError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export type SharedScorePatch = { id: string; playerKey: string; hole: number; score: number | null; putts?: number | null; facts?: SharedPlayerFacts; group?: SharedGroupFacts; baseVersion: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sharedEditablePlayers(snapshot: RoundSnapshot, ownerId: string, actorId: string) {
  linkedRoundPlayers(snapshot);
  if (snapshot.lifecycleState !== "live") return [];
  const linked = snapshot.players?.some(p => p.accountUserId === actorId);
  if (ownerId !== actorId && !linked) return [];
  return (snapshot.players || []).filter(p => snapshot.scorekeeping?.mode === "owner"
    ? actorId === ownerId
    : p.accountUserId === actorId || (actorId === ownerId && !p.accountUserId)).map(p => p.id);
}

/** Reuses the existing live-operation domain. Never merges a changed same cell.
 * Whole-row CAS retries are safe only because each patch has its own base. */
export function patchSharedScores(roundId: string, ownerId: string, version: number, snapshot: RoundSnapshot,
  actorId: string, patches: SharedScorePatch[], now: string) {
  if (snapshot.lifecycleState !== "live" || snapshot.scorekeeping?.version !== 1)
    throw new SharedLiveError("ROUND_CLOSED", 409, "La ronda está cerrada.");
  if (!Array.isArray(patches) || patches.length < 1 || patches.length > 25)
    throw new SharedLiveError("INVALID_REQUEST", 400, "Captura inválida.");
  const allowed = sharedEditablePlayers(snapshot, ownerId, actorId);
  const metadata = snapshot.sharedLive;
  // Older owner writes did not carry per-cell revisions. Fence them with the
  // canonical version instead of assuming their scores have revision zero.
  let state: LiveRoundState = { id: roundId, ownerId, version, lifecycle: "LIVE",
    participants: (snapshot.players || []).filter(p => p.accountUserId).map(p => ({ id: p.id, roundId,
      userId: p.accountUserId, playerId: p.id, role: p.accountUserId === ownerId ? "ORGANIZER" : "PLAYER", joinedAt: now })),
    scores: snapshot.scores || {}, putts: snapshot.putts || {}, stats: {},
    appliedOperationIds: metadata?.operationIds || [], cellVersions: { ...(metadata?.cellVersions || {}) }, updatedAt: now };
  const audit = [...(metadata?.audit || [])];
  let applied = false;
  let captures = snapshot;
  for (const patch of patches) {
    if (!patch || !uuid.test(patch.id) || !Number.isInteger(patch.baseVersion) || patch.baseVersion < 0
      || patch.baseVersion > version || !snapshot.order?.includes(patch.hole)
      || (patch.score !== null && (!Number.isInteger(patch.score) || patch.score < 1 || patch.score > 20))
      || (patch.putts !== undefined && patch.putts !== null && (!Number.isInteger(patch.putts) || patch.putts < 0 || patch.putts > 20)))
      throw new SharedLiveError("INVALID_REQUEST", 400, "Captura inválida.");
    const groupPatch = patch.playerKey === "@round";
    if (groupPatch ? actorId !== ownerId : !allowed.includes(patch.playerKey)) throw new SharedLiveError("FORBIDDEN", 403, "Sólo puedes capturar tu tarjeta o las decisiones de grupo autorizadas.");
    if (groupPatch ? (!patch.group || patch.facts || patch.putts !== undefined || patch.score !== null) : patch.group !== undefined)
      throw new SharedLiveError("INVALID_REQUEST", 400, "Captura inválida.");
    const nextCaptures = groupPatch ? applySharedGroupFacts(captures, patch.hole, patch.group!) : applySharedPlayerFacts(captures, patch.playerKey, patch.hole, patch.facts, patch.putts, now);
    const kinds: Array<"SCORE_SET" | "PUTTS_SET" | "STAT_PATCH" | "ROUND_SETTINGS_PATCH"> = groupPatch ? ["ROUND_SETTINGS_PATCH"] : ["SCORE_SET", ...(patch.putts !== undefined ? ["PUTTS_SET" as const] : []), ...(patch.facts ? ["STAT_PATCH" as const] : [])];
    if (audit.some(item => item.id === patch.id) && kinds.some(kind => !audit.some(item => item.id === (kind === "SCORE_SET" ? patch.id : `${patch.id}:${kind}`))))
      throw new SharedLiveError("IDEMPOTENCY_CONFLICT", 409, "La operación ya tiene otros datos.");
    for (const kind of kinds) {
      const cell = kind === "ROUND_SETTINGS_PATCH" ? "settings" : `${kind}:${patch.hole}:${patch.playerKey}`;
      const id = kind === "SCORE_SET" ? patch.id : `${patch.id}:${kind}`;
      if (!Object.hasOwn(state.cellVersions, cell) && (kind === "SCORE_SET" ? snapshot.scores?.[patch.hole]?.[patch.playerKey] : snapshot.putts?.[patch.hole]?.[patch.playerKey]) != null)
        state.cellVersions[cell] = version;
      if (!Object.hasOwn(state.cellVersions, cell) && (kind === "STAT_PATCH" || kind === "ROUND_SETTINGS_PATCH")
        && (kind === "STAT_PATCH" ? snapshot.unitEvents?.some(e => e.hole === patch.hole && e.playerId === patch.playerKey) || snapshot.counterBetEvents?.some(e => e.hole === patch.hole && e.playerId === patch.playerKey)
          : snapshot.lobaHoles?.[patch.hole] || snapshot.ballFriendSetup?.[patch.hole])) state.cellVersions[cell] = version;
      const value = kind === "SCORE_SET" ? patch.score : kind === "PUTTS_SET" ? patch.putts! : kind === "STAT_PATCH" ? patch.facts! : { hole: patch.hole, ...patch.group };
      const previous = audit.find(item => item.id === id);
      if (previous && (previous.actorId !== actorId || previous.playerKey !== patch.playerKey || previous.hole !== patch.hole || JSON.stringify(previous.value) !== JSON.stringify(value)))
        throw new SharedLiveError("IDEMPOTENCY_CONFLICT", 409, "La operación ya tiene otros datos.");
      const operation = { id, roundId, actorId, kind, playerId: patch.playerKey, hole: patch.hole, value, baseVersion: patch.baseVersion, createdAt: now };
      const result = applyLiveRoundOperation(state, operation);
      if (result.conflict) throw new SharedLiveError("SCORE_CONFLICT", 409, "Este score cambió en otro dispositivo. Revisa ambas capturas.");
      if (!result.applied) continue;
      applied = true;
      captures = nextCaptures;
      // One atomic snapshot update increments the database revision once.
      state = { ...result.state, version, cellVersions: { ...result.state.cellVersions, [cell]: version + 1 } };
      audit.push({ id, actorId, playerKey: patch.playerKey, hole: patch.hole, kind, value, baseVersion: patch.baseVersion, resultingVersion: version + 1, createdAt: now });
    }
  }
  return { applied, snapshot: { ...captures, scores: state.scores, putts: state.putts, updatedAt: now,
    sharedLive: { cellVersions: state.cellVersions, operationIds: state.appliedOperationIds, joinedUserIds: metadata?.joinedUserIds || [], audit: audit.slice(-500) } } as RoundSnapshot };
}

export function sharedRoundComplete(snapshot: RoundSnapshot) {
  return Boolean(snapshot.order?.length && snapshot.players?.length && snapshot.order.every(h => snapshot.players!.every(p => Number.isInteger(snapshot.scores?.[h]?.[p.id]) && snapshot.scores![h][p.id]! > 0)));
}

import { playOrder } from "../../engine";
import { buildPlayerRoundStats } from "../../round-statistics";
import { teeAssignmentSnapshot } from "../../player-tee-assignments";
import { withPlayerCourseCards } from "../../player-course-card";
import { applyRoundCourseHandicaps } from "../../../features/handicap/round-player-handicap";
import type { Course, HoleScore, Player, PuttsByHole, RoundLifecycleState } from "../../types";
import type { RoundSetupAction } from "../schemas/actions";
import { validateRoundSetupDraft, type RoundSetupDraft } from "../schemas/round-setup";
import { parseStructuredActionBatch, type StructuredAction, type StructuredActionBatch, type StructuredBetKey } from "../schemas/structured-actions";
import { executeRoundSetupActions } from "./action-executor";
import { roundSetupDraftHasActiveBets } from "./betting-consent-boundary";
import { normalizeMexicanSpanish } from "./intent-parser";

export type StructuredRoundState = {
  roundId: string;
  ownerUserId: string;
  revision: number;
  lifecycle: RoundLifecycleState;
  draft: RoundSetupDraft;
  scores: Record<number, HoleScore>;
  putts: PuttsByHole;
  /** Persisted with the draft by the host, scoped to this round/account. */
  receipts: Record<string, { batch: string; revision: number }>;
};
export type ActionPrincipal = { userId: string; canEdit: boolean; bettingConsent: boolean };
export type StructuredActionHost = {
  /** Must come from authenticated state. Never pass identity/consent supplied by a model. */
  principal: () => ActionPrincipal | null;
  /** Only public/authorized identities and catalog-backed cards may enter these collections. */
  players: readonly Player[];
  courses: readonly Course[];
  groups: readonly { id: string; name: string; playerIds: readonly string[] }[];
  /** Trusted integration point for the application's existing deterministic Games Engine. */
  queryResults?: (state: Readonly<StructuredRoundState>) => unknown;
};
export type StructuredPreview = {
  token: string | null;
  requestId: string;
  revision: number;
  actions: StructuredAction[];
  next: StructuredRoundState;
  warnings: string[];
  queries: unknown[];
  requiresConfirmation: boolean;
  canConfirm: boolean;
  errors: string[];
};
export type StructuredUndo = { token: string; requestId: string; fromRevision: number; toRevision: number; actionTypes: StructuredAction["type"][] };
const evidence = { source: "explicit", confidence: 1, evidence: "Acción estructurada confirmada" } as const;
const readOnly = (action: StructuredAction) => ["find_player", "query_round_status", "query_results", "query_statistics"].includes(action.type);
const bettingAction = (type: StructuredAction["type"]) => ["enable_bet", "disable_bet", "configure_bet", "assign_bet_participants"].includes(type);
const clone = <T>(value: T): T => structuredClone(value);
function normalized(value: string) { return normalizeMexicanSpanish(value).replace(/^@/, "").trim(); }
function betAction(bet: StructuredBetKey, patch: { enabled?: boolean; participantIds?: string[] }): RoundSetupAction {
  if (bet === "nassau") return { type: "configure_group_nassau", ...evidence, ...patch };
  if (bet === "ballFriend") return { type: "configure_ball_friend", ...evidence, ...patch };
  return { type: "configure_core_bet", bet, ...evidence, ...patch };
}
function applySetup(state: StructuredRoundState, action: RoundSetupAction) {
  const result = executeRoundSetupActions(state.draft, [action]);
  if (result.rejected.length) throw new Error(result.rejected[0].validation.valid ? "INVALID_SETUP" : result.rejected[0].validation.message);
  state.draft = result.draft;
}
function player(state: StructuredRoundState, id: string) {
  const value = state.draft.players.find((item) => item.id === id);
  if (!value) throw new Error("RESOLVE_PLAYER_IDENTITY");
  return value;
}
function captured(state: StructuredRoundState) { return Object.values(state.scores).some((hole) => Object.values(hole).some((value) => typeof value === "number")); }
function sameLayout(left: Course, right: Course) { return (left.catalogCourseId || left.id) === (right.catalogCourseId || right.id); }

/** Pure, atomic projection. Existing setup validators and engine adapters remain authoritative. */
function project(state: StructuredRoundState, batch: StructuredActionBatch, host: StructuredActionHost) {
  const next = clone(state);
  const warnings: string[] = [];
  const queries: unknown[] = [];
  for (const action of batch.actions) {
    if (!readOnly(action) && ["cancelled", "completed"].includes(next.lifecycle)) throw new Error("ROUND_READ_ONLY");
    const changingRules = !readOnly(action) && !["record_score", "correct_score", "record_putts", "start_round"].includes(action.type);
    if (changingRules && captured(next)) warnings.push("Cambiar jugadores, tees, handicap o reglas afecta los resultados de los hoyos ya capturados; el Games Engine los recalculará.");
    switch (action.type) {
      case "find_player": {
        const q = normalized(action.query);
        queries.push({ type: action.type, players: host.players.filter((item) => normalized(item.name).includes(q) || item.id === action.query).map(({ id, name }) => ({ id, name })) });
        break;
      }
      case "add_player": {
        const found = host.players.find((item) => item.id === action.playerId);
        if (!found) throw new Error("RESOLVE_PLAYER_IDENTITY");
        if (next.draft.players.some((item) => item.id === found.id)) break;
        if (captured(next)) throw new Error("CANNOT_REPLACE_CAPTURED_ROSTER");
        if (roundSetupDraftHasActiveBets(next.draft)) warnings.push("Agregar un jugador reinicia la configuración de apuestas. Revisa y configura las modalidades antes de iniciar.");
        const assignments = clone(next.draft.playerTeeAssignments);
        applySetup(next, { type: "replace_players", players: [...next.draft.players, clone(found)], ownerId: next.draft.ownerId || found.id, ...evidence });
        next.draft.playerTeeAssignments = assignments;
        break;
      }
      case "remove_player": {
        player(next, action.playerId);
        if (action.playerId === next.draft.ownerId) throw new Error("CANNOT_REMOVE_OWNER");
        if (Object.values(next.scores).some((hole) => typeof hole[action.playerId] === "number")) throw new Error("CANNOT_REMOVE_CAPTURED_PLAYER");
        if (captured(next)) throw new Error("CANNOT_REPLACE_CAPTURED_ROSTER");
        if (roundSetupDraftHasActiveBets(next.draft)) warnings.push("Quitar un jugador reinicia la configuración de apuestas. Revisa las modalidades antes de iniciar.");
        const assignments = next.draft.playerTeeAssignments.filter((item) => item.playerId !== action.playerId);
        applySetup(next, { type: "replace_players", players: next.draft.players.filter((item) => item.id !== action.playerId), ownerId: next.draft.ownerId, ...evidence });
        next.draft.playerTeeAssignments = assignments;
        break;
      }
      case "select_group": {
        if (captured(next)) throw new Error("CANNOT_REPLACE_CAPTURED_ROSTER");
        const group = host.groups.find((item) => item.id === action.groupId);
        if (!group) throw new Error("RESOLVE_GROUP");
        const members = group.playerIds.map((id) => host.players.find((item) => item.id === id));
        if (!members.length || members.some((item) => !item) || !group.playerIds.includes(next.draft.ownerId)) throw new Error("RESOLVE_GROUP_PLAYERS_AND_OWNER");
        if (roundSetupDraftHasActiveBets(next.draft)) warnings.push("Seleccionar un grupo reinicia la configuración de apuestas. Revisa las modalidades y los tees antes de iniciar.");
        applySetup(next, { type: "replace_players", players: members as Player[], ownerId: next.draft.ownerId, ...evidence });
        next.draft.playerTeeAssignments = [];
        break;
      }
      case "select_course": {
        const options = host.courses.filter((item) => (item.catalogCourseId || item.id) === action.courseId);
        if (!options.length) throw new Error("RESOLVE_COURSE");
        if (captured(next)) throw new Error("CANNOT_CHANGE_CAPTURED_COURSE");
        applySetup(next, { type: "identify_course", courseName: options[0].name, catalogCourseId: action.courseId, candidateCourseIds: options.map((item) => item.id), ...evidence });
        // Identifying a course is not consent to use its first tee.
        next.draft.course = null;
        next.draft.courseSelected = false;
        next.draft.playerTeeAssignments = [];
        break;
      }
      case "select_tee": {
        action.playerIds.forEach((id) => player(next, id));
        const tee = host.courses.find((item) => item.id === action.teeId || item.catalogTeeId === action.teeId);
        const selected = next.draft.courseIdentity?.catalogCourseId || next.draft.course?.catalogCourseId || next.draft.course?.id;
        if (!tee || (tee.catalogCourseId || tee.id) !== selected) throw new Error("RESOLVE_TEE_FOR_SELECTED_COURSE");
        if (next.draft.course && !sameLayout(next.draft.course, tee)) throw new Error("TEE_COURSE_MISMATCH");
        const prior = clone(next.draft.playerTeeAssignments);
        if (!next.draft.course) {
          applySetup(next, { type: "select_course", course: clone(tee), ...evidence });
          // Existing setup selects a default for all; structured actions require each explicit assignment.
          next.draft.playerTeeAssignments = prior;
        }
        const assignments = action.playerIds.map((id) => ({ ...teeAssignmentSnapshot(id, tee, `${next.draft.date}T12:00:00.000Z`), holes: clone(tee.holes) }));
        applySetup(next, { type: "set_player_tees", assignments, ...evidence });
        next.draft.course = withPlayerCourseCards(next.draft.course!, next.draft.playerTeeAssignments);
        next.draft.players = applyRoundCourseHandicaps(next.draft.players, next.draft.playerTeeAssignments, next.draft.course, `${next.draft.date}T12:00:00.000Z`);
        break;
      }
      case "set_round_holes":
        if (captured(next)) throw new Error("CANNOT_CHANGE_CAPTURED_GEOMETRY");
        applySetup(next, { type: "set_round_holes", roundHoles: action.holes, ...evidence }); break;
      case "set_start_hole":
        if (captured(next)) throw new Error("CANNOT_CHANGE_CAPTURED_GEOMETRY");
        applySetup(next, { type: "set_start_hole", startHole: action.hole, ...evidence }); break;
      case "set_handicap_source": {
        const target = player(next, action.playerId);
        if (action.source === "profile_index") {
          const known = host.players.find((item) => item.id === target.id);
          if (known?.handicapSource !== "profile_index" || typeof known.handicapIndex !== "number" || !Number.isFinite(known.handicapIndex)) throw new Error("PROFILE_INDEX_UNAVAILABLE");
          if (known.handicapIndexSource === "GHIN_OFFICIAL_FUTURE" || known.handicapIndexSource === "BACKYARD_WHS_FUTURE") throw new Error("HANDICAP_PROVIDER_UNAVAILABLE");
          target.handicapIndex = known.handicapIndex;
          target.handicapIndexSource = known.handicapIndexSource;
          if (!next.draft.course) throw new Error("RESOLVE_COURSE");
        } else {
          delete target.handicapIndex;
          delete target.handicapIndexSource;
        }
        target.handicapSource = action.source;
        delete target.courseHandicapSnapshot;
        if (action.source === "profile_index" && next.draft.course) next.draft.players = applyRoundCourseHandicaps(next.draft.players, next.draft.playerTeeAssignments, next.draft.course, `${next.draft.date}T12:00:00.000Z`);
        break;
      }
      case "set_handicap":
        applySetup(next, { type: "set_player_handicap", playerId: action.playerId, handicap: action.handicap, ...evidence });
        player(next, action.playerId).handicapSource = "manual";
        delete player(next, action.playerId).handicapIndex;
        delete player(next, action.playerId).handicapIndexSource;
        delete player(next, action.playerId).courseHandicapSnapshot;
        break;
      case "enable_bet": case "disable_bet":
        if (next.draft.presentation?.playMode === "score_only") throw new Error("SCORE_ONLY_BETTING_DISABLED");
        applySetup(next, betAction(action.bet, { enabled: action.type === "enable_bet" })); break;
      case "assign_bet_participants":
        if (next.draft.presentation?.playMode === "score_only") throw new Error("SCORE_ONLY_BETTING_DISABLED");
        applySetup(next, betAction(action.bet, { participantIds: action.playerIds })); break;
      case "configure_bet":
        if (next.draft.presentation?.playMode === "score_only") throw new Error("SCORE_ONLY_BETTING_DISABLED");
        applySetup(next, action.configuration); break;
      case "start_round": {
        if (next.lifecycle !== "draft") throw new Error("ROUND_ALREADY_STARTED");
        const issues = validateRoundSetupDraft(next.draft);
        if (issues.length) throw new Error(issues.map((issue) => issue.message).join(" "));
        if (next.draft.players.some((item) => !next.draft.playerTeeAssignments.some((tee) => tee.playerId === item.id))) throw new Error("RESOLVE_EACH_PLAYER_TEE");
        next.lifecycle = "live";
        break;
      }
      case "record_score": case "correct_score": case "record_putts": {
        player(next, action.playerId);
        if (next.lifecycle !== "live") throw new Error("ROUND_NOT_LIVE");
        if (!playOrder(next.draft.startHole).slice(0, next.draft.roundHoles).includes(action.hole)) throw new Error("HOLE_OUTSIDE_ROUND");
        const oldScore = next.scores[action.hole]?.[action.playerId];
        if (action.type === "record_putts") {
          if (typeof oldScore !== "number" || action.putts > oldScore) throw new Error("PUTTS_REQUIRE_VALID_SCORE");
          const previous = next.putts[action.hole]?.[action.playerId];
          if (previous != null && previous !== action.putts) warnings.push(`Se corregirán los putts capturados del hoyo ${action.hole}.`);
          next.putts[action.hole] = { ...next.putts[action.hole], [action.playerId]: action.putts };
        } else {
          if (action.type === "record_score" && oldScore != null && oldScore !== action.score) throw new Error("USE_CORRECT_SCORE");
          if (action.type === "correct_score" && oldScore == null) throw new Error("NO_SCORE_TO_CORRECT");
          if ((next.putts[action.hole]?.[action.playerId] ?? 0) > action.score) throw new Error("SCORE_BELOW_CAPTURED_PUTTS");
          if (action.type === "correct_score" && oldScore !== action.score) warnings.push(`Se corregirá el score del hoyo ${action.hole}: ${oldScore} → ${action.score}. El Games Engine recalculará los resultados.`);
          next.scores[action.hole] = { ...next.scores[action.hole], [action.playerId]: action.score };
        }
        break;
      }
      case "query_round_status": queries.push({ type: action.type, roundId: next.roundId, lifecycle: next.lifecycle, revision: next.revision, scoredHoles: Object.keys(next.scores).map(Number) }); break;
      case "query_results":
        if (next.draft.presentation?.playMode === "score_only") queries.push({ type: action.type, results: null, reason: "SCORE_ONLY_BETTING_DISABLED" });
        else {
          if (!host.queryResults) throw new Error("DETERMINISTIC_ENGINE_ADAPTER_REQUIRED");
          queries.push({ type: action.type, results: host.queryResults(clone(next)) });
        }
        break;
      case "query_statistics":
        player(next, action.playerId);
        if (!next.draft.course) throw new Error("RESOLVE_COURSE");
        queries.push({ type: action.type, statistics: buildPlayerRoundStats({ playerId: action.playerId, course: next.draft.course, order: playOrder(next.draft.startHole).slice(0, next.draft.roundHoles), scores: next.scores, putts: next.putts }) });
        break;
    }
  }
  return { next, warnings: [...new Set(warnings)], queries };
}

/**
 * Local conversation controller. Tokens are opaque capabilities held in this closure,
 * not signatures and not a replacement for server Auth/RLS. The host persists the
 * confirmed state + receipts atomically through its existing local-first repository.
 */
export function createStructuredActionSession(initial: StructuredRoundState, host: StructuredActionHost) {
  let state = clone(initial);
  const sessionId = crypto.randomUUID();
  let sequence = 0;
  const pending = new Map<string, { batch: StructuredActionBatch; before: string; preview: StructuredPreview; principal: string }>();
  const undos = new Map<string, { before: StructuredRoundState; after: string; metadata: StructuredUndo }>();
  function authorize(write: boolean) {
    const principal = host.principal();
    if (!principal || principal.userId !== state.ownerUserId || (write && !principal.canEdit)) throw new Error("FORBIDDEN");
    return principal;
  }
  function preview(raw: unknown): StructuredPreview {
    authorize(false);
    const batch = parseStructuredActionBatch(raw);
    const write = batch.actions.some((action) => !readOnly(action));
    const principal = authorize(write);
    const fingerprint = JSON.stringify(batch);
    if (Object.hasOwn(state.receipts, batch.requestId)) {
      if (state.receipts[batch.requestId].batch !== fingerprint) throw new Error("IDEMPOTENCY_KEY_REUSED");
      return { token: null, requestId: batch.requestId, revision: state.revision, actions: clone(batch.actions), next: clone(state), warnings: [], queries: [], requiresConfirmation: false, canConfirm: false, errors: ["ALREADY_EXECUTED"] };
    }
    if (batch.expectedRevision !== state.revision) throw new Error("STALE_REVISION");
    if (!principal.bettingConsent && ((write && roundSetupDraftHasActiveBets(state.draft))
      || batch.actions.some((action) => bettingAction(action.type)
        || (action.type === "query_results" && state.draft.presentation?.playMode !== "score_only")))) throw new Error("BETTING_CONSENT_REQUIRED");
    let projection: ReturnType<typeof project>;
    try { projection = project(state, batch, host); }
    catch (error) { return { token: null, requestId: batch.requestId, revision: state.revision, actions: clone(batch.actions), next: clone(state), warnings: [], queries: [], requiresConfirmation: write, canConfirm: false, errors: [error instanceof Error ? error.message : "INVALID_ACTION"] }; }
    if (write && roundSetupDraftHasActiveBets(projection.next.draft) && !principal.bettingConsent) throw new Error("BETTING_CONSENT_REQUIRED");
    const token = write ? `preview:${sessionId}:${++sequence}` : null;
    const result: StructuredPreview = { ...projection, token, requestId: batch.requestId, revision: state.revision, actions: clone(batch.actions), requiresConfirmation: write, canConfirm: write, errors: [] };
    if (token) {
      // Bound memory and invalidate older previews for the same request.
      for (const [key, value] of pending) if (value.batch.requestId === batch.requestId) pending.delete(key);
      if (pending.size >= 32) pending.delete(pending.keys().next().value!);
      pending.set(token, { batch: clone(batch), before: JSON.stringify(state), preview: clone(result), principal: principal.userId });
    }
    return clone(result);
  }
  function confirm(token: string, confirmation: { confirmed: true; acknowledgeImpact: boolean }) {
    const principal = authorize(true);
    const item = pending.get(token);
    if (!item || item.principal !== principal.userId || confirmation?.confirmed !== true) throw new Error("EXPLICIT_CONFIRMATION_REQUIRED");
    if (JSON.stringify(state) !== item.before) throw new Error("STALE_PREVIEW");
    if (item.preview.warnings.length && confirmation.acknowledgeImpact !== true) throw new Error("IMPACT_ACKNOWLEDGEMENT_REQUIRED");
    if ((roundSetupDraftHasActiveBets(state.draft) || roundSetupDraftHasActiveBets(item.preview.next.draft) || item.batch.actions.some((action) => bettingAction(action.type))) && !principal.bettingConsent) throw new Error("BETTING_CONSENT_REQUIRED");
    const before = clone(state);
    state = clone(item.preview.next);
    state.revision += 1;
    state.receipts[item.batch.requestId] = { batch: JSON.stringify(item.batch), revision: state.revision };
    const undo: StructuredUndo = { token: `undo:${sessionId}:${++sequence}`, requestId: item.batch.requestId, fromRevision: before.revision, toRevision: state.revision, actionTypes: item.batch.actions.map((action) => action.type) };
    undos.clear();
    undos.set(undo.token, { before, after: JSON.stringify(state), metadata: undo });
    pending.clear();
    return { state: clone(state), undo: clone(undo) };
  }
  function undo(token: string, confirmed: boolean) {
    const principal = authorize(true);
    const item = undos.get(token);
    if (!item || confirmed !== true) throw new Error("EXPLICIT_UNDO_CONFIRMATION_REQUIRED");
    if (JSON.stringify(state) !== item.after) throw new Error("STALE_UNDO");
    if ((roundSetupDraftHasActiveBets(state.draft) || roundSetupDraftHasActiveBets(item.before.draft) || item.metadata.actionTypes.some(bettingAction)) && !principal.bettingConsent) throw new Error("BETTING_CONSENT_REQUIRED");
    // Keep receipts: retrying an undone request must not reapply it.
    state = { ...clone(item.before), revision: state.revision + 1, receipts: clone(state.receipts) };
    pending.clear(); undos.clear();
    return clone(state);
  }
  return {
    snapshot() { authorize(false); return clone(state); }, preview, confirm, undo,
    cancel(token: string) { authorize(false); pending.delete(token); },
    /** Refresh only from the host repository/session; any external write invalidates capabilities. */
    refresh(next: StructuredRoundState) {
      authorize(false);
      if (next.ownerUserId !== state.ownerUserId || next.roundId !== state.roundId || next.revision < state.revision) throw new Error("INVALID_REFRESH");
      state = clone(next); pending.clear(); undos.clear();
    },
  };
}

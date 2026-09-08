import { accountPrimaryPlayerId } from "../../account-primary-player";
import type { BackyardProfile } from "../../account-state";
import {
  createGroupGameTemplate,
  instantiateGroupGameTemplate,
  type GroupTemplateDraftSource,
} from "../../group-game-template";
import { restoreBetConfig } from "../../new-round-bets";
import { missingHandicapsForActiveBets } from "../../handicap-base";
import { playOrder } from "../../engine";
import { createSupplementalBet } from "../../supplemental-bets";
import type {
  Course,
  FrequentGroup,
  FrequentPlayer,
  GroupGameTemplate,
  Player,
  RoundSnapshot,
  SupplementalBet,
} from "../../types";
import type {
  ParsedRoundSetupAction,
  RoundMemoryReference,
  RoundSetupAction,
  RoundSetupInterpretation,
  RoundSetupQuestion,
} from "../schemas/actions";
import type { GroupPreference, UserPreference } from "../memory/types";
import { cloneRoundSetupDraft, createRoundSetupDraft, type RoundSetupDraft } from "../schemas/round-setup";
import { executeRoundSetupAction } from "./action-executor";
import { normalizeMexicanSpanish } from "./intent-parser";

export type RoundSetupMemoryContext = {
  profile?: BackyardProfile | null;
  frequentPlayers?: readonly FrequentPlayer[];
  frequentGroups?: readonly FrequentGroup[];
  history?: readonly RoundSnapshot[];
  courses?: readonly Course[];
  userPreferences?: readonly UserPreference[];
  groupPreferences?: readonly GroupPreference[];
  activeDraft?: RoundSetupDraft | null;
  /** YYYY-MM-DD. Inject in tests and server calls to keep planning deterministic. */
  today?: string;
  idFactory?: () => string;
};

export type RoundSetupMemoryTrace = {
  source: "active_draft" | "frequent_group" | "round_history" | "profile" | "user_preference" | "group_preference";
  id: string;
  label: string;
  confidence: number;
};

export type ResolvedRoundSetupIntent = {
  baseDraft: RoundSetupDraft;
  actions: RoundSetupAction[];
  questions: RoundSetupQuestion[];
  memory: RoundSetupMemoryTrace[];
};

type PlayerCandidate = {
  key: string;
  label: string;
  player: Pick<Player, "name" | "handicap" | "accountUserId">;
  rank: number;
  aliases: string[];
  profileGivenName?: string;
  isProfile: boolean;
};

function localDate(date = new Date()) {
  const pieces = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => pieces.find((piece) => piece.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validDate(value: string | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDate();
}

function cleanLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function playerIdentity(player: Pick<Player, "name" | "accountUserId">) {
  return player.accountUserId ? `account:${player.accountUserId}` : `name:${normalizeMexicanSpanish(player.name)}`;
}

function candidatePool(draft: RoundSetupDraft, context: RoundSetupMemoryContext): PlayerCandidate[] {
  const candidates: PlayerCandidate[] = [];
  const push = (
    player: Pick<Player, "name" | "handicap" | "accountUserId">,
    rank: number,
    key?: string,
    options: { aliases?: string[]; profileGivenName?: string; isProfile?: boolean } = {},
  ) => {
    if (!player.name?.trim()) return;
    candidates.push({
      key: key ?? playerIdentity(player),
      label: cleanLabel(player.name),
      player,
      rank,
      aliases: [...new Set([player.name, ...(options.aliases ?? [])].map(cleanLabel).filter(Boolean))],
      ...(options.profileGivenName?.trim() ? { profileGivenName: cleanLabel(options.profileGivenName) } : {}),
      isProfile: options.isProfile === true,
    });
  };
  if (context.profile?.displayName.trim()) push({
    name: context.profile.displayName,
    handicap: context.profile.defaultHandicap,
    accountUserId: context.profile.userId,
  }, 0, undefined, {
    aliases: [context.profile.givenName ?? "", context.profile.username ?? ""],
    profileGivenName: context.profile.givenName,
    isProfile: true,
  });
  draft.players.forEach((player) => push(player, 1, `round:${player.id}`));
  context.frequentPlayers?.forEach((player) => push(player, 2));
  context.frequentGroups?.forEach((group) => group.players.forEach((member) => push(member, 3)));
  context.history?.forEach((round) => round.players?.forEach((player) => push(player, 4)));

  const best = new Map<string, PlayerCandidate>();
  for (const candidate of candidates) {
    const identity = candidate.key.startsWith("round:") ? playerIdentity(candidate.player) : candidate.key;
    const current = best.get(identity);
    if (!current) best.set(identity, { ...candidate, key: identity });
    else {
      const preferred = candidate.rank < current.rank || (candidate.isProfile && !current.isProfile) ? candidate : current;
      best.set(identity, {
        ...preferred,
        key: identity,
        aliases: [...new Set([...current.aliases, ...candidate.aliases])],
      });
    }
  }
  return [...best.values()];
}

function playerMatches(query: string, candidates: PlayerCandidate[]) {
  const comparable = normalizeMexicanSpanish(query);
  const scored = candidates.map((candidate) => {
    const label = normalizeMexicanSpanish(candidate.label);
    const aliases = candidate.aliases.map(normalizeMexicanSpanish);
    const profileNameMatch = candidate.isProfile && (
      normalizeMexicanSpanish(candidate.profileGivenName ?? "") === comparable
      || label.startsWith(`${comparable} `)
      || label.split(" ").some((part) => part === comparable)
    );
    const score = candidate.isProfile && label === comparable ? 0
      : profileNameMatch ? 1
        : label === comparable ? 2
          : aliases.includes(comparable) ? 3
            : label.startsWith(`${comparable} `) || label.split(" ").some((part) => part === comparable) ? 4
              : Number.POSITIVE_INFINITY;
    return { candidate, score };
  }).filter((entry) => Number.isFinite(entry.score));
  const best = Math.min(...scored.map((entry) => entry.score));
  return scored.filter((entry) => entry.score === best).map((entry) => entry.candidate);
}

function runtimePlayer(candidate: PlayerCandidate, draft: RoundSetupDraft, idFactory: () => string): Player {
  const current = draft.players.find((player) => playerIdentity(player) === playerIdentity(candidate.player));
  if (current) return candidate.isProfile
    ? { ...structuredClone(current), name: candidate.player.name, accountUserId: candidate.player.accountUserId }
    : structuredClone(current);
  const id = candidate.player.accountUserId ? accountPrimaryPlayerId(candidate.player.accountUserId) : idFactory();
  return {
    id,
    name: candidate.player.name,
    handicap: candidate.player.handicap,
    ...(candidate.player.accountUserId ? { accountUserId: candidate.player.accountUserId } : {}),
  };
}

function courseLabels(course: Course) {
  return [course.name, course.clubName, course.teeName, `${course.name} ${course.teeName}`, course.clubName ? `${course.clubName} ${course.teeName}` : ""]
    .filter((label): label is string => Boolean(label?.trim()))
    .map(normalizeMexicanSpanish);
}

function matchingCourses(query: string, context: RoundSetupMemoryContext) {
  const comparable = normalizeMexicanSpanish(query.replace(/^(?:el\s+)?campo\s+/i, ""));
  const courses = [...(context.courses ?? [])];
  const exact = courses.filter((course) => courseLabels(course).includes(comparable));
  const matches = exact.length ? exact : courses.filter((course) => courseLabels(course).some((label) => label.includes(comparable)));
  if (matches.length > 1 && context.profile?.preferredTee) {
    const preferred = normalizeMexicanSpanish(context.profile.preferredTee);
    const teeMatches = matches.filter((course) => normalizeMexicanSpanish(course.teeName) === preferred);
    if (teeMatches.length === 1) return teeMatches;
  }
  return matches;
}

function sharedCatalogCourse(matches: readonly Course[]) {
  const catalogCourseId = matches[0]?.catalogCourseId;
  if (!catalogCourseId || matches.length < 2 || !matches.every((course) => course.catalogCourseId === catalogCourseId)) return null;
  return { catalogCourseId, name: matches[0].name, candidateCourseIds: matches.map((course) => course.id) };
}

function sortedHistory(context: RoundSetupMemoryContext) {
  return [...(context.history ?? [])].sort((left, right) => {
    const leftKey = left.completedAt || left.updatedAt || left.date || "";
    const rightKey = right.completedAt || right.updatedAt || right.date || "";
    return rightKey.localeCompare(leftKey);
  });
}

function dateOnly(value: string | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function utcDay(value: string) {
  return new Date(`${value}T12:00:00Z`).getUTCDay();
}

function previousWeekRange(today: string) {
  const current = new Date(`${today}T12:00:00Z`);
  const mondayOffset = (current.getUTCDay() + 6) % 7;
  const currentMonday = new Date(current);
  currentMonday.setUTCDate(current.getUTCDate() - mondayOffset);
  const previousMonday = new Date(currentMonday);
  previousMonday.setUTCDate(currentMonday.getUTCDate() - 7);
  const previousSunday = new Date(currentMonday);
  previousSunday.setUTCDate(currentMonday.getUTCDate() - 1);
  return [previousMonday.toISOString().slice(0, 10), previousSunday.toISOString().slice(0, 10)] as const;
}

function historyForReference(reference: RoundMemoryReference, context: RoundSetupMemoryContext, today: string) {
  const history = sortedHistory(context);
  if (reference.type === "same_players_last_sunday") {
    return history.find((round) => {
      const date = dateOnly(round.date);
      return date && date < today && utcDay(date) === 0;
    });
  }
  if (reference.type === "same_as_last_week") {
    const [from, to] = previousWeekRange(today);
    return history.find((round) => {
      const date = dateOnly(round.date);
      return date >= from && date <= to;
    });
  }
  if (reference.type === "same_as_previous") return history.find((round) => dateOnly(round.date) < today);
  if (reference.type === "last_round_at_course") {
    const comparable = normalizeMexicanSpanish(reference.courseName);
    return history.find((round) => [round.courseName, round.courseSnapshot?.name, round.courseSnapshot?.clubName]
      .some((label) => label && normalizeMexicanSpanish(label).includes(comparable)));
  }
  return undefined;
}

function runtimePlayersFromSnapshot(snapshot: RoundSnapshot, idFactory: () => string) {
  return (snapshot.players ?? []).map((player): Player => ({
    id: player.accountUserId ? accountPrimaryPlayerId(player.accountUserId) : idFactory(),
    name: player.name,
    handicap: player.handicap,
    ...(player.accountUserId ? { accountUserId: player.accountUserId } : {}),
  }));
}

function draftFromGroup(group: FrequentGroup, current: RoundSetupDraft, date: string, idFactory: () => string) {
  const loaded = instantiateGroupGameTemplate(group, idFactory);
  return createRoundSetupDraft({
    date,
    locale: current.locale,
    course: current.course,
    courseSelected: current.courseSelected,
    players: loaded.players,
    ownerId: loaded.ownerId,
    startHole: loaded.startHole,
    roundHoles: loaded.roundHoles,
    handicapBasis: loaded.roundHandicapBasis,
    bets: loaded.bets,
    segments: loaded.segments,
    personalBets: loaded.personalBets,
    supplementalBets: loaded.supplementalBets,
    manualBets: loaded.manualBets,
    templateOrigin: loaded.origin,
  });
}

/** Reuses GroupGameTemplate's tested ID remapping and result-stripping path. */
function draftFromHistory(snapshot: RoundSnapshot, current: RoundSetupDraft, date: string, idFactory: () => string, context: RoundSetupMemoryContext) {
  const sourcePlayers = snapshot.players ?? [];
  if (!sourcePlayers.length) return null;
  const storedOrder = Array.isArray(snapshot.order) ? snapshot.order : [];
  const storedStart = storedOrder[0] === 10 ? 10 : storedOrder[0] === 1 ? 1 : undefined;
  const storedLength = storedOrder.length === 9 ? 9 : storedOrder.length === 18 ? 18 : undefined;
  const expectedOrder = storedStart === undefined ? [] : playOrder(storedStart).slice(0, storedLength ?? 0);
  const orderIsValid = storedLength !== undefined
    && storedOrder.every((hole, index) => Number.isInteger(hole) && hole === expectedOrder[index]);
  const startHole: 1 | 10 = orderIsValid ? storedStart! : snapshot.startHole === 10 ? 10 : 1;
  const roundHoles: 9 | 18 = orderIsValid ? storedLength : snapshot.roundHoles === 9 ? 9 : 18;
  const memberIdByPlayerId = Object.fromEntries(sourcePlayers.map((player, index) => [player.id, `history-member-${index + 1}`]));
  const source: GroupTemplateDraftSource = {
    ownerId: sourcePlayers.some((player) => player.id === snapshot.ownerId)
      ? snapshot.ownerId!
      : sourcePlayers.find((player) => normalizeMexicanSpanish(player.name) === normalizeMexicanSpanish(snapshot.ownerName))?.id ?? sourcePlayers[0].id,
    players: sourcePlayers,
    startHole,
    roundHoles,
    roundHandicapBasis: snapshot.handicapBasis === "course" ? "course" : "relative",
    bets: restoreBetConfig(snapshot.betConfig, sourcePlayers.map((player) => player.id), { startHole, roundHoles }),
    segments: snapshot.segments ?? [],
    personalBets: snapshot.personalBets ?? [],
    supplementalBets: snapshot.supplementalBets ?? [],
    manualBets: snapshot.manualBets ?? [],
  };
  const gameTemplate: GroupGameTemplate = createGroupGameTemplate(source, memberIdByPlayerId);
  const memoryGroup: FrequentGroup = {
    id: `history-${snapshot.id}`,
    name: `Ronda ${snapshot.date}`,
    players: sourcePlayers.map((player, index) => ({
      memberId: `history-member-${index + 1}`,
      name: player.name,
      handicap: player.handicap,
      ...(player.accountUserId ? { accountUserId: player.accountUserId } : {}),
    })),
    gameTemplate,
    uses: 0,
    updatedAt: snapshot.updatedAt || snapshot.completedAt || snapshot.date,
  };
  const loaded = instantiateGroupGameTemplate(memoryGroup, idFactory);
  let course = snapshot.courseSnapshot ?? null;
  if (!course) {
    const candidates = matchingCourses(`${snapshot.courseName} ${snapshot.teeName}`.trim(), context);
    course = candidates.length === 1 ? candidates[0] : null;
  }
  return createRoundSetupDraft({
    date,
    locale: current.locale,
    course,
    courseSelected: Boolean(course),
    players: loaded.players,
    ownerId: loaded.ownerId,
    startHole: loaded.startHole,
    roundHoles: loaded.roundHoles,
    handicapBasis: loaded.roundHandicapBasis,
    bets: loaded.bets,
    segments: loaded.segments,
    personalBets: loaded.personalBets,
    supplementalBets: loaded.supplementalBets,
    manualBets: loaded.manualBets,
    presentation: snapshot.presentation,
    templateOrigin: loaded.origin,
    basedOnRoundId: snapshot.id,
  });
}

function blankDraft(context: RoundSetupMemoryContext, date: string) {
  const profile = context.profile;
  const players = profile?.displayName.trim() ? [{
    id: accountPrimaryPlayerId(profile.userId),
    name: profile.displayName,
    handicap: profile.defaultHandicap,
    accountUserId: profile.userId,
  }] : [];
  return createRoundSetupDraft({ date, players, ownerId: players[0]?.id });
}

function matchingGroups(query: string, context: RoundSetupMemoryContext) {
  const comparable = normalizeMexicanSpanish(query);
  const groups = [...(context.frequentGroups ?? [])];
  const exact = groups.filter((group) => normalizeMexicanSpanish(group.name) === comparable);
  return exact.length ? exact : groups.filter((group) => normalizeMexicanSpanish(group.name).includes(comparable));
}

function usualGroups(reference: Extract<RoundMemoryReference, { type: "same_usual_group" }>, context: RoundSetupMemoryContext) {
  const matching = [...(context.frequentGroups ?? [])]
    .filter((group) => reference.playerCount === undefined || group.players.length === reference.playerCount)
    .sort((left, right) => right.uses - left.uses || right.updatedAt.localeCompare(left.updatedAt));
  if (matching.length < 2) return matching;
  const first = matching[0];
  return matching.filter((group) => group.uses === first.uses && group.updatedAt === first.updatedAt);
}

function memoryQuestion(reference: RoundMemoryReference): RoundSetupQuestion {
  return {
    code: "missing_context",
    field: "memory",
    prompt: reference.type === "same_players_last_sunday"
      ? "No encontré una ronda del domingo. ¿Qué jugadores participan hoy?"
      : reference.type === "same_usual_group"
        ? "No pude identificar con certeza al grupo de siempre. ¿Cuál grupo quieres usar?"
        : reference.type === "frequent_group"
          ? `No encontré el grupo “${reference.groupName}”. ¿Cuál grupo quieres usar?`
          : "No encontré una ronda anterior que corresponda. ¿Qué configuración quieres usar?",
  };
}

function questionForPlayer(name: string, matches: PlayerCandidate[]): RoundSetupQuestion {
  return matches.length
    ? {
        code: "ambiguous_player",
        field: `players.${normalizeMexicanSpanish(name)}`,
        prompt: `Encontré más de un jugador llamado “${name}”. ¿Cuál es?`,
        candidates: matches.map((candidate) => ({ id: candidate.key, label: candidate.label })),
      }
    : {
        code: "unknown_player",
        field: `players.${normalizeMexicanSpanish(name)}`,
        prompt: `No encontré a “${name}” entre tu perfil, jugadores, grupos o rondas anteriores. ¿Lo agregamos con su handicap?`,
      };
}

function questionForCourse(name: string, matches: Course[]): RoundSetupQuestion {
  return matches.length
    ? {
        code: "ambiguous_course",
        field: "course",
        prompt: `Encontré varias opciones para “${name}”. ¿Qué campo y tee quieres usar?`,
        candidates: matches.map((course) => ({ id: course.id, label: `${course.name} ${course.teeName}`.trim() })),
      }
    : {
        code: "unknown_course",
        field: "course",
        prompt: `No encontré “${name}” en tus campos disponibles. ¿Qué campo y tee quieres usar?`,
      };
}

function questionForTee(name: string, matches: Course[]): RoundSetupQuestion {
  return {
    code: "missing_tee",
    field: "course.tee",
    prompt: `¿Qué tee juegan hoy en ${name}?`,
    candidates: matches.map((course) => ({ id: course.id, label: course.teeName })),
  };
}

function isCoreEnabled(draft: RoundSetupDraft, bet: Extract<ParsedRoundSetupAction, { type: "configure_core_bet" }>["bet"]) {
  return Boolean(draft.bets[bet]?.enabled);
}

function amountQuestion(field: string, label: string): RoundSetupQuestion {
  return { code: "missing_amount", field, prompt: `¿Cuál es el monto de ${label}?` };
}

function uniqueQuestions(questions: RoundSetupQuestion[]) {
  const seen = new Set<string>();
  return questions.filter((question) => {
    const key = `${question.code}:${question.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Resolves names/references before asking, then emits ID-backed domain actions. */
export function resolveRoundSetupContext(
  interpretation: RoundSetupInterpretation,
  context: RoundSetupMemoryContext,
): ResolvedRoundSetupIntent {
  const today = validDate(context.today);
  let sequence = 0;
  const suppliedIdFactory = context.idFactory ?? (() => `ai-round-${++sequence}`);
  const reservedIds = new Set<string>([
    ...(context.activeDraft?.players.map((player) => player.id) ?? []),
    ...(context.activeDraft?.personalBets.map((bet) => bet.id) ?? []),
    ...(context.activeDraft?.supplementalBets.map((bet) => bet.id) ?? []),
    ...(context.activeDraft?.manualBets.map((bet) => bet.id) ?? []),
  ]);
  const idFactory = () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = suppliedIdFactory();
      if (typeof candidate === "string" && candidate && !/\s/.test(candidate) && !reservedIds.has(candidate)) {
        reservedIds.add(candidate);
        return candidate;
      }
    }
    let fallback = "";
    do fallback = `ai-round-fallback-${++sequence}`; while (reservedIds.has(fallback));
    reservedIds.add(fallback);
    return fallback;
  };
  let baseDraft = context.activeDraft ? cloneRoundSetupDraft(context.activeDraft) : blankDraft(context, today);
  baseDraft.date = today;
  const questions = [...interpretation.questions];
  const memory: RoundSetupMemoryTrace[] = context.activeDraft
    ? [{ source: "active_draft", id: "active", label: "Ronda activa", confidence: 1 }]
    : [];

  const reference = interpretation.reference;
  let referencePlayers: Player[] | undefined;
  if (reference?.type === "frequent_group") {
    const groups = matchingGroups(reference.groupName, context);
    if (groups.length === 1) {
      baseDraft = draftFromGroup(groups[0], baseDraft, today, idFactory);
      memory.push({ source: "frequent_group", id: groups[0].id, label: groups[0].name, confidence: 0.98 });
    } else {
      questions.push(groups.length ? {
        code: "missing_context",
        field: "memory.group",
        prompt: `Hay varios grupos que coinciden con “${reference.groupName}”. ¿Cuál quieres usar?`,
        candidates: groups.map((group) => ({ id: group.id, label: group.name })),
      } : memoryQuestion(reference));
    }
  } else if (reference?.type === "same_usual_group") {
    const groups = usualGroups(reference, context);
    if (groups.length === 1) {
      referencePlayers = instantiateGroupGameTemplate(groups[0], idFactory).players;
      memory.push({ source: "frequent_group", id: groups[0].id, label: groups[0].name, confidence: 0.9 });
    } else {
      questions.push(groups.length ? {
        code: "missing_context",
        field: "memory.group",
        prompt: "Hay más de un grupo que podría ser el de siempre. ¿Cuál quieres usar?",
        candidates: groups.map((group) => ({ id: group.id, label: group.name })),
      } : memoryQuestion(reference));
    }
  } else if (reference) {
    if (reference.type === "same_as_previous" && context.activeDraft) {
      // The active draft is already the exact base requested by “lo mismo”.
    } else {
      const snapshot = historyForReference(reference, context, today);
      if (!snapshot) questions.push(memoryQuestion(reference));
      else if (reference.type === "same_players_last_sunday") {
        referencePlayers = runtimePlayersFromSnapshot(snapshot, idFactory);
        memory.push({ source: "round_history", id: snapshot.id, label: snapshot.date, confidence: 0.94 });
      } else {
        const historicalDraft = draftFromHistory(snapshot, baseDraft, today, idFactory, context);
        if (historicalDraft) {
          baseDraft = historicalDraft;
          memory.push({ source: "round_history", id: snapshot.id, label: snapshot.date, confidence: 0.96 });
        } else questions.push(memoryQuestion(reference));
      }
    }
  }

  const resolvedActions: RoundSetupAction[] = [];
  let preview = cloneRoundSetupDraft(baseDraft);
  const record = (action: RoundSetupAction) => {
    const result = executeRoundSetupAction(preview, action);
    if (result.rejected.length) {
      questions.push({ code: "invalid_action", field: action.type, prompt: result.rejected[0].validation.message });
      return false;
    }
    resolvedActions.push(action);
    preview = result.draft;
    return true;
  };
  const hasCoreAmount = (bet: Extract<ParsedRoundSetupAction, { type: "configure_core_bet" }>["bet"]) => interpretation.actions.some((action) => action.type === "configure_core_bet" && action.bet === bet && action.value !== undefined);
  const hasGroupNassauAmount = () => interpretation.actions.some((action) => action.type === "configure_group_nassau" && action.value !== undefined);
  const hasPollaAmount = (component: Extract<ParsedRoundSetupAction, { type: "configure_polla_component" }>["component"]) => interpretation.actions.some((action) => action.type === "configure_polla_component" && action.component === component && action.value !== undefined);
  const hasIndividualNassauAmount = (playerAName: string, playerBName: string) => interpretation.actions.some((action) => action.type === "configure_individual_nassau"
    && action.value !== undefined
    && new Set([normalizeMexicanSpanish(action.playerAName), normalizeMexicanSpanish(action.playerBName)]).has(normalizeMexicanSpanish(playerAName))
    && new Set([normalizeMexicanSpanish(action.playerAName), normalizeMexicanSpanish(action.playerBName)]).has(normalizeMexicanSpanish(playerBName)));
  const explicitPlayerHandicaps = new Map(
    interpretation.actions
      .filter((action): action is Extract<ParsedRoundSetupAction, { type: "set_player_handicap" }> => action.type === "set_player_handicap")
      .map((action) => [normalizeMexicanSpanish(action.playerName), action.handicap]),
  );

  if (referencePlayers?.length) record({
    type: "replace_players",
    players: referencePlayers,
    ownerId: referencePlayers.find((player) => player.accountUserId === context.profile?.userId)?.id ?? referencePlayers[0].id,
    source: "round_history",
    confidence: 0.94,
    evidence: "Jugadores recuperados de memoria",
  });

  for (const parsed of interpretation.actions) {
    if (parsed.type === "replace_players") {
      const pool = candidatePool(preview, context);
      const players: Player[] = [];
      let complete = true;
      for (const name of parsed.playerNames) {
        const matches = playerMatches(name, pool);
        const explicitHandicap = explicitPlayerHandicaps.get(normalizeMexicanSpanish(name));
        if (matches.length === 0) {
          players.push({ id: idFactory(), name: cleanLabel(name), handicap: explicitHandicap ?? null });
          continue;
        }
        if (matches.length !== 1) {
          questions.push(questionForPlayer(name, matches));
          complete = false;
          continue;
        }
        players.push(runtimePlayer(matches[0], preview, idFactory));
      }
      const unique = new Map(players.map((player) => [playerIdentity(player), player]));
      if (unique.size !== players.length) {
        questions.push({ code: "invalid_action", field: "players", prompt: "La instrucción repite al mismo jugador. ¿Quiénes juegan?" });
        complete = false;
      }
      if (complete && players.length) {
        const ownerId = players.find((player) => player.accountUserId === context.profile?.userId)?.id ?? players[0].id;
        record({ type: "replace_players", players, ownerId, source: "explicit", confidence: parsed.confidence, evidence: parsed.evidence });
      }
      continue;
    }
    if (parsed.type === "select_course") {
      const matches = matchingCourses(parsed.courseName, context);
      const shared = sharedCatalogCourse(matches);
      if (matches.length === 1) record({ type: "select_course", course: matches[0], source: "explicit", confidence: parsed.confidence, evidence: parsed.evidence });
      else if (shared) {
        record({ type: "identify_course", courseName: shared.name, catalogCourseId: shared.catalogCourseId, candidateCourseIds: shared.candidateCourseIds, source: "explicit", confidence: parsed.confidence, evidence: parsed.evidence });
        questions.push(questionForTee(shared.name, matches));
      } else questions.push(questionForCourse(parsed.courseName, matches));
      continue;
    }
    if (parsed.type === "select_tee") {
      const pendingCourseName = preview.courseIdentity?.name;
      const sameCourseQuery = preview.course?.name || pendingCourseName ? `${preview.course?.name ?? pendingCourseName} ${parsed.teeName}` : parsed.teeName;
      const matches = matchingCourses(sameCourseQuery, context);
      if (matches.length !== 1) questions.push(questionForCourse(sameCourseQuery, matches));
      else record({ type: "select_course", course: matches[0], source: "explicit", confidence: parsed.confidence, evidence: parsed.evidence });
      continue;
    }
    if (parsed.type === "set_start_hole" || parsed.type === "set_round_holes" || parsed.type === "set_handicap_basis") {
      record({ ...parsed, source: "explicit" });
      continue;
    }

    const resolveNames = (names: string[] | undefined) => {
      const ids: string[] = [];
      let complete = true;
      for (const name of names ?? []) {
        const matches = playerMatches(name, candidatePool(preview, context))
          .filter((candidate) => preview.players.some((player) => playerIdentity(player) === playerIdentity(candidate.player)));
        if (matches.length !== 1) {
          questions.push(questionForPlayer(name, matches));
          complete = false;
          continue;
        }
        const player = preview.players.find((candidate) => playerIdentity(candidate) === playerIdentity(matches[0].player));
        if (player) ids.push(player.id);
      }
      return { ids: [...new Set(ids)], complete };
    };

    if (parsed.type === "set_player_handicap") {
      const player = resolveNames([parsed.playerName]);
      if (player.complete && player.ids.length === 1) record({
        type: "set_player_handicap",
        playerId: player.ids[0],
        handicap: parsed.handicap,
        source: "explicit",
        confidence: parsed.confidence,
        evidence: parsed.evidence,
      });
      continue;
    }

    if (parsed.type === "configure_core_bet") {
      const excluded = resolveNames(parsed.excludedPlayerNames);
      if (!excluded.complete) continue;
      if (parsed.bet === "monkey" && parsed.enabled && !parsed.excludedPlayerNames?.length && preview.players.length !== 3) {
        questions.push({ code: "invalid_action", field: "bets.monkey.participantIds", prompt: "Monkey necesita exactamente tres jugadores. ¿Quiénes participan?" });
        continue;
      }
      const mayUseExistingDomainDefault = parsed.bet === "vipers";
      if (parsed.enabled && parsed.value === undefined && !hasCoreAmount(parsed.bet) && !isCoreEnabled(preview, parsed.bet) && !mayUseExistingDomainDefault) {
        questions.push(amountQuestion(`bets.${parsed.bet}.value`, parsed.bet === "skins" ? "Skins" : parsed.evidence));
        continue;
      }
      const allPlayerIds = preview.players.map((player) => player.id);
      const currentParticipantIds = (preview.bets[parsed.bet]?.participantIds ?? allPlayerIds)
        .filter((id) => allPlayerIds.includes(id));
      const participantIds = parsed.excludedPlayerNames?.length
        ? (parsed.allPlayers ? allPlayerIds : currentParticipantIds).filter((id) => !excluded.ids.includes(id))
        : parsed.allPlayers ? preview.players.map((player) => player.id) : undefined;
      record({
        type: "configure_core_bet",
        bet: parsed.bet,
        enabled: parsed.enabled,
        ...(parsed.value !== undefined ? { value: parsed.value } : {}),
        ...(participantIds ? { participantIds } : {}),
        ...(parsed.skinsMode ? { skinsMode: parsed.skinsMode } : {}),
        ...(parsed.secondNinePressed !== undefined ? { secondNinePressed: parsed.secondNinePressed } : {}),
        ...(parsed.secondNineMultiplier !== undefined ? { secondNineMultiplier: parsed.secondNineMultiplier } : {}),
        source: "explicit",
        confidence: parsed.confidence,
        evidence: parsed.evidence,
      });
      continue;
    }
    if (parsed.type === "configure_group_nassau") {
      const groupNassauComponents = (["first9", "second9", "total18"] as const)
        .filter((component) => preview.bets.polla[component].enabled);
      const currentEnabled = groupNassauComponents.length > 0;
      if (parsed.modificationOnly && !currentEnabled) {
        const playerName = (id: string) => preview.players.find((player) => player.id === id)?.name ?? "Jugador";
        const candidates = new Map<string, { id: string; playerAId?: string; playerBId?: string; label: string }>();
        for (const bet of preview.personalBets.filter((candidate) => candidate.enabled !== false)) {
          if (bet.rivalMode === "group" && bet.rivalPlayerId) {
            const pair = [preview.ownerId, bet.rivalPlayerId].sort();
            candidates.set(pair.join(":"), {
              id: bet.id,
              playerAId: preview.ownerId,
              playerBId: bet.rivalPlayerId,
              label: `${playerName(preview.ownerId)} vs ${playerName(bet.rivalPlayerId)}`,
            });
          } else {
            candidates.set(`external:${bet.id}`, { id: bet.id, label: `${playerName(preview.ownerId)} vs ${bet.rivalName}` });
          }
        }
        for (const bet of preview.supplementalBets.filter((candidate): candidate is Extract<SupplementalBet, { type: "individual_nassau" }> => candidate.type === "individual_nassau" && candidate.enabled)) {
          const pair = [bet.playerAId, bet.playerBId].sort();
          if (!candidates.has(pair.join(":"))) candidates.set(pair.join(":"), {
            id: bet.id,
            playerAId: bet.playerAId,
            playerBId: bet.playerBId,
            label: `${playerName(bet.playerAId)} vs ${playerName(bet.playerBId)}`,
          });
        }
        const available = [...candidates.values()];
        const only = available.length === 1 ? available[0] : undefined;
        if (only?.playerAId && only.playerBId) {
          record({
            type: "configure_individual_nassau",
            id: only.id,
            enabled: parsed.enabled,
            playerAId: only.playerAId,
            playerBId: only.playerBId,
            ...(parsed.value !== undefined ? { value: parsed.value } : {}),
            source: "explicit",
            confidence: parsed.confidence,
            evidence: parsed.evidence,
          });
        } else {
          questions.push({
            code: "ambiguous_bet",
            field: "supplementalBets.individual_nassau.instance",
            prompt: available.length
              ? "¿Qué Nassau individual quieres cambiar? Indica la pareja exacta."
              : "No hay un Nassau grupal activo para cambiar. ¿Quieres crear uno grupal o cuál pareja juega Nassau individual?",
            ...(available.length ? { candidates: available.map((candidate) => ({ id: candidate.id, label: candidate.label })) } : {}),
          });
        }
        continue;
      }
      if (!parsed.enabled) {
        record({ type: "remove_nassau", source: "explicit", confidence: parsed.confidence, evidence: parsed.evidence });
        continue;
      }
      const excluded = resolveNames(parsed.excludedPlayerNames);
      if (!excluded.complete) continue;
      if (parsed.value === undefined && !hasGroupNassauAmount() && !currentEnabled) {
        questions.push(amountQuestion("bets.polla", "Nassau grupal"));
        continue;
      }
      const allPlayerIds = preview.players.map((player) => player.id);
      const participantIdsByComponent = parsed.excludedPlayerNames?.length ? {
        first9: (parsed.allPlayers ? allPlayerIds : preview.bets.polla.first9.participantIds).filter((id) => !excluded.ids.includes(id)),
        second9: (parsed.allPlayers ? allPlayerIds : preview.bets.polla.second9.participantIds).filter((id) => !excluded.ids.includes(id)),
        total18: (parsed.allPlayers ? allPlayerIds : preview.bets.polla.total18.participantIds).filter((id) => !excluded.ids.includes(id)),
      } : undefined;
      const participantIds = !parsed.excludedPlayerNames?.length && parsed.allPlayers ? allPlayerIds : undefined;
      const participationOnly = Boolean(parsed.excludedPlayerNames?.length && parsed.value === undefined && currentEnabled);
      record({
        type: "configure_group_nassau",
        enabled: participationOnly || parsed.modificationOnly ? undefined : true,
        ...(parsed.modificationOnly ? { componentScope: groupNassauComponents } : {}),
        ...(parsed.value !== undefined ? { value: parsed.value } : {}),
        ...(participantIds ? { participantIds } : {}),
        ...(participantIdsByComponent ? { participantIdsByComponent } : {}),
        ...(parsed.hcpPct !== undefined ? { hcpPct: parsed.hcpPct } : {}),
        ...(parsed.decimals ? { decimals: parsed.decimals } : {}),
        source: "explicit",
        confidence: parsed.confidence,
        evidence: parsed.evidence,
      });
      continue;
    }
    if (parsed.type === "configure_polla_component") {
      const excluded = resolveNames(parsed.excludedPlayerNames);
      if (!excluded.complete) continue;
      const current = preview.bets.polla[parsed.component];
      if (parsed.enabled && parsed.value === undefined && !hasPollaAmount(parsed.component) && !current.enabled) {
        const label = parsed.component === "first9" ? "Polla de la primera vuelta" : parsed.component === "second9" ? "Polla de la segunda vuelta" : "Polla total de 18 hoyos";
        questions.push(amountQuestion(`bets.polla.${parsed.component}.value`, label));
        continue;
            }
      const allPlayerIds = preview.players.map((player) => player.id);
      const participantIds = parsed.excludedPlayerNames?.length
        ? (parsed.allPlayers ? allPlayerIds : current.participantIds).filter((id) => !excluded.ids.includes(id))
        : parsed.allPlayers ? preview.players.map((player) => player.id) : undefined;
      record({
        type: "configure_polla_component",
        component: parsed.component,
        enabled: parsed.enabled,
        ...(parsed.value !== undefined ? { value: parsed.value } : {}),
        ...(participantIds ? { participantIds } : {}),
        ...(parsed.hcpPct !== undefined ? { hcpPct: parsed.hcpPct } : {}),
        ...(parsed.decimals ? { decimals: parsed.decimals } : {}),
        source: "explicit",
        confidence: parsed.confidence,
        evidence: parsed.evidence,
      });
      continue;
    }
    if (parsed.type === "configure_individual_nassau") {
      const a = resolveNames([parsed.playerAName]);
      const b = resolveNames([parsed.playerBName]);
      if (!a.complete || !b.complete || a.ids.length !== 1 || b.ids.length !== 1) continue;
      const existing = preview.supplementalBets.find((bet): bet is Extract<SupplementalBet, { type: "individual_nassau" }> => bet.type === "individual_nassau"
        && [bet.playerAId, bet.playerBId].includes(a.ids[0])
        && [bet.playerAId, bet.playerBId].includes(b.ids[0]));
      const pairIncludesOwner = a.ids[0] === preview.ownerId || b.ids[0] === preview.ownerId;
      const rivalId = a.ids[0] === preview.ownerId ? b.ids[0] : a.ids[0];
      const existingPersonal = pairIncludesOwner
        ? preview.personalBets.find((bet) => bet.rivalMode === "group" && bet.rivalPlayerId === rivalId)
        : undefined;
      const hasExistingValue = Boolean(
        (existing?.enabled && Number.isFinite(existing.value) && existing.value > 0)
        || (existingPersonal?.enabled !== false && Number.isFinite(existingPersonal?.baseValue) && (existingPersonal?.baseValue ?? 0) > 0),
      );
      if (parsed.enabled && parsed.value === undefined && !hasIndividualNassauAmount(parsed.playerAName, parsed.playerBName) && !hasExistingValue) {
        questions.push(amountQuestion("supplementalBets.individual_nassau.value", "Nassau individual"));
        continue;
      }
      record({
        type: "configure_individual_nassau",
        id: existingPersonal?.id ?? existing?.id ?? idFactory(),
        enabled: parsed.enabled,
        playerAId: a.ids[0],
        playerBId: b.ids[0],
        ...(parsed.value !== undefined ? { value: parsed.value } : {}),
        source: "explicit",
        confidence: parsed.confidence,
        evidence: parsed.evidence,
      });
      continue;
    }
    if (parsed.type === "configure_ball_friend") {
      const excluded = resolveNames(parsed.excludedPlayerNames);
      const teamA = resolveNames(parsed.teamAPlayerNames);
      const teamB = resolveNames(parsed.teamBPlayerNames);
      if (!excluded.complete || !teamA.complete || !teamB.complete) continue;
      const hasTeams = Boolean(parsed.teamAPlayerNames?.length || parsed.teamBPlayerNames?.length);
      if (hasTeams && (teamA.ids.length !== 2 || teamB.ids.length !== 2 || new Set([...teamA.ids, ...teamB.ids]).size !== 4)) {
        questions.push({ code: "invalid_action", field: "bets.ballFriend.teams", prompt: "Bola Amiga necesita dos parejas distintas de dos jugadores." });
        continue;
      }
      // Bola Amiga already has a complete catalog-backed new-round value. A
      // bare activation keeps that visible domain default instead of inventing
      // a value or blocking the rest of the setup.
      const allPlayerIds = preview.players.map((player) => player.id);
      const participantIds = hasTeams
        ? [...teamA.ids, ...teamB.ids]
        : parsed.excludedPlayerNames?.length
          ? (parsed.allPlayers ? allPlayerIds : preview.bets.ballFriend.participantIds).filter((id) => !excluded.ids.includes(id))
          : parsed.allPlayers ? preview.players.map((player) => player.id) : undefined;
      record({
        type: "configure_ball_friend",
        enabled: parsed.enabled,
        ...(parsed.value !== undefined ? { value: parsed.value } : {}),
        ...(participantIds ? { participantIds } : {}),
        ...(teamA.ids.length === 2 ? { teamA: [teamA.ids[0], teamA.ids[1]] } : {}),
        source: "explicit",
        confidence: parsed.confidence,
        evidence: parsed.evidence,
      });
      continue;
    }
    if (parsed.type === "configure_supplemental_bet") {
      const existing = preview.supplementalBets.filter((bet) => bet.type === parsed.betType);
      const namedParticipants = resolveNames(parsed.participantNames);
      const excluded = resolveNames(parsed.excludedPlayerNames);
      const playerA = resolveNames(parsed.playerAName ? [parsed.playerAName] : undefined);
      const playerB = resolveNames(parsed.playerBName ? [parsed.playerBName] : undefined);
      const advantageReceiver = resolveNames(parsed.advantageReceiverName ? [parsed.advantageReceiverName] : undefined);
      const teamA = resolveNames(parsed.teamAPlayerNames);
      const teamB = resolveNames(parsed.teamBPlayerNames);
      if (!namedParticipants.complete || !excluded.complete || !playerA.complete || !playerB.complete || !advantageReceiver.complete || !teamA.complete || !teamB.complete) continue;

      const allIds = preview.players.map((player) => player.id);
      const explicitlySelectedParticipantIds = parsed.participantNames?.length
        ? namedParticipants.ids
        : parsed.allPlayers
          ? allIds.filter((id) => !excluded.ids.includes(id))
          : undefined;
      const pairIds = playerA.ids.length === 1 && playerB.ids.length === 1 ? [playerA.ids[0], playerB.ids[0]] : [];
      const explicitPair = Boolean(parsed.playerAName || parsed.playerBName);
      const explicitTeams = Boolean(parsed.teamAPlayerNames?.length || parsed.teamBPlayerNames?.length);
      const explicitParticipants = explicitlySelectedParticipantIds !== undefined;
      const sameIds = (left: readonly string[], right: readonly string[]) => left.length === right.length
        && new Set(left).size === left.length
        && new Set(right).size === right.length
        && left.every((id) => right.includes(id));

      if (explicitPair && (pairIds.length !== 2 || pairIds[0] === pairIds[1])) {
        questions.push({ code: "missing_players", field: "supplementalBets.dollar_stroke.players", prompt: "Dollar a Stroke necesita dos jugadores distintos. ¿Quiénes juegan?" });
        continue;
      }
      const teamIds = explicitTeams ? [...teamA.ids, ...teamB.ids] : explicitlySelectedParticipantIds ?? [];
      if (explicitTeams && (teamA.ids.length !== 2 || teamB.ids.length !== 2 || new Set(teamIds).size !== 4)) {
        questions.push({ code: "invalid_action", field: `supplementalBets.${parsed.betType}.teams`, prompt: `${parsed.betType === "vegas" ? "Vegas" : "Presiones por parejas"} necesita dos parejas distintas de dos jugadores.` });
        continue;
      }

      const matching = existing.filter((bet) => {
        if (explicitPair) return bet.type === "dollar_stroke" && sameIds([bet.playerAId, bet.playerBId], pairIds);
        if (explicitTeams) {
          if (bet.type !== "team_pressures" && bet.type !== "vegas") return false;
          if (!sameIds(bet.participantIds, teamIds)) return false;
          return sameIds(bet.teamA, teamA.ids) || sameIds(bet.teamA, teamB.ids);
        }
        if (explicitParticipants) return "participantIds" in bet && sameIds(bet.participantIds, explicitlySelectedParticipantIds);
        return true;
      });
      const hasSelector = explicitPair || explicitTeams || explicitParticipants;
      if (matching.length > 1 || (!hasSelector && existing.length > 1)) {
        questions.push({
          code: "ambiguous_bet",
          field: `supplementalBets.${parsed.betType}.instance`,
          prompt: `Hay más de una configuración de ${parsed.evidence}. ¿Qué jugadores o parejas quieres cambiar?`,
        });
        continue;
      }
      const selected = matching.length === 1 ? matching[0] : undefined;

      if (!parsed.enabled) {
        const targets = hasSelector ? (selected ? [selected] : []) : existing;
        if (hasSelector && !selected) {
          questions.push({ code: "invalid_action", field: `supplementalBets.${parsed.betType}.instance`, prompt: `No encontré esa configuración de ${parsed.evidence}. Indica los jugadores o parejas exactos.` });
          continue;
        }
        targets.forEach((bet) => record({ type: "upsert_supplemental_bet", bet: { ...structuredClone(bet), enabled: false }, source: "explicit", confidence: parsed.confidence, evidence: parsed.evidence }));
        continue;
      }

      if (parsed.value === undefined && (!selected || !selected.enabled)) {
        const labels: Record<typeof parsed.betType, string> = {
          dollar_stroke: "Dollar a Stroke",
          individual_pressures: "Presiones individuales",
          team_pressures: "Presiones por parejas",
          chicago: "Chicago por punto",
          vegas: "Vegas por unidad",
          minimum_putts: "Mínimo de Putts",
        };
        questions.push(amountQuestion(`supplementalBets.${parsed.betType}.value`, labels[parsed.betType]));
        continue;
      }

      if (parsed.betType === "dollar_stroke" && !selected && pairIds.length !== 2) {
        questions.push({ code: "missing_players", field: "supplementalBets.dollar_stroke.players", prompt: "¿Qué dos jugadores juegan Dollar a Stroke?" });
        continue;
      }
      if ((parsed.betType === "team_pressures" || parsed.betType === "vegas") && !selected && !explicitTeams) {
        questions.push({ code: "invalid_action", field: `supplementalBets.${parsed.betType}.teams`, prompt: `${parsed.betType === "vegas" ? "Vegas" : "Presiones por parejas"} necesita dos parejas distintas de dos jugadores.` });
        continue;
      }

      const base = selected ? structuredClone(selected) : createSupplementalBet(parsed.betType, preview.players, idFactory(), preview.roundHoles);
      const baseParticipantIds = "participantIds" in base ? base.participantIds : allIds;
      const participantIds = explicitlySelectedParticipantIds
        ?? (parsed.excludedPlayerNames?.length ? baseParticipantIds.filter((id) => !excluded.ids.includes(id)) : baseParticipantIds);
      let configured: SupplementalBet;
      if (base.type === "dollar_stroke") {
        const configuredPair = pairIds.length === 2 ? pairIds : [base.playerAId, base.playerBId];
        const receiverId = advantageReceiver.ids.length === 1 ? advantageReceiver.ids[0] : undefined;
        const incompleteAdvantage = !parsed.clearAdvantage
          && ((parsed.advantageStrokes !== undefined) !== (parsed.advantageReceiverName !== undefined));
        if (incompleteAdvantage || (parsed.advantageStrokes !== undefined && parsed.advantageStrokes > 0 && !receiverId)) {
          questions.push({ code: "invalid_action", field: "supplementalBets.dollar_stroke.advantage", prompt: "Dollar a Stroke necesita el número de golpes y el jugador que recibe la ventaja." });
          continue;
        }
        if (receiverId && !configuredPair.includes(receiverId)) {
          questions.push({ code: "invalid_action", field: "supplementalBets.dollar_stroke.advantageReceiverId", prompt: "La ventaja de Dollar a Stroke sólo puede recibirla uno de los dos jugadores de esa apuesta." });
          continue;
        }
        const dollar = {
          ...base,
          enabled: true,
          ...(pairIds.length === 2 ? { playerAId: pairIds[0], playerBId: pairIds[1] } : {}),
          ...(parsed.value !== undefined ? { valuePerStroke: parsed.value } : {}),
          ...(parsed.advantageStrokes !== undefined ? { advantageStrokes: parsed.advantageStrokes } : {}),
          ...(receiverId ? { advantageReceiverId: receiverId } : {}),
        };
        if (parsed.clearAdvantage || parsed.advantageStrokes === 0) {
          dollar.advantageStrokes = 0;
          delete dollar.advantageReceiverId;
        }
        configured = dollar;
      }
      else if (base.type === "individual_pressures") configured = {
        ...base,
        enabled: true,
        participantIds,
        ...(parsed.value !== undefined ? { value: parsed.value } : {}),
        ...(parsed.carryEnabled !== undefined ? { carryEnabled: parsed.carryEnabled } : {}),
        ...(parsed.hcpPct !== undefined ? { hcpPct: parsed.hcpPct } : {}),
        ...(parsed.decimals ? { decimals: parsed.decimals } : {}),
        ...(parsed.matchPlayEnabled !== undefined ? { matchPlayEnabled: parsed.matchPlayEnabled } : {}),
      };
      else if (base.type === "team_pressures") configured = {
        ...base,
        enabled: true,
        participantIds: explicitTeams ? teamIds : base.participantIds,
        teamA: explicitTeams ? teamA.ids : base.teamA,
        ...(parsed.value !== undefined ? { value: parsed.value } : {}),
        ...(parsed.carryEnabled !== undefined ? { carryEnabled: parsed.carryEnabled } : {}),
        ...(parsed.hcpPct !== undefined ? { hcpPct: parsed.hcpPct } : {}),
        ...(parsed.decimals ? { decimals: parsed.decimals } : {}),
      };
      else if (base.type === "chicago") configured = {
        ...base,
        enabled: true,
        participantIds,
        ...(parsed.value !== undefined ? { valuePerPoint: parsed.value } : {}),
        ...(parsed.hcpPct !== undefined ? { hcpPct: parsed.hcpPct } : {}),
        ...(parsed.quotaBase !== undefined ? { quotaBase: parsed.quotaBase } : {}),
        ...(parsed.chicagoPoints ? { points: { ...base.points, ...parsed.chicagoPoints } } : {}),
      };
      else if (base.type === "vegas") configured = {
        ...base,
        enabled: true,
        participantIds: explicitTeams ? teamIds : base.participantIds,
        teamA: explicitTeams ? teamA.ids : base.teamA,
        ...(parsed.value !== undefined ? { valuePerUnit: parsed.value } : {}),
        ...(parsed.hcpPct !== undefined ? { hcpPct: parsed.hcpPct } : {}),
        ...(parsed.decimals ? { decimals: parsed.decimals } : {}),
        ...(parsed.rotation ? { rotation: parsed.rotation } : {}),
        ...(parsed.blockSize ? { blockSize: parsed.blockSize } : {}),
        ...(parsed.birdiePenalty !== undefined ? { birdiePenalty: parsed.birdiePenalty } : {}),
      };
      else if (base.type === "minimum_putts") configured = {
        ...base,
        enabled: true,
        participantIds,
        holes: parsed.holes ?? base.holes,
        ...(parsed.value !== undefined ? { ante: parsed.value } : {}),
      };
      else continue;
      record({ type: "upsert_supplemental_bet", bet: configured, source: "explicit", confidence: parsed.confidence, evidence: parsed.evidence });
    }
  }

  const explicitParticipationGames = new Set(interpretation.actions.flatMap((action) => {
    if (!("excludedPlayerNames" in action) || (!action.excludedPlayerNames?.length && !("allPlayers" in action && action.allPlayers))) return [];
    if (action.type === "configure_core_bet") return [normalizeMexicanSpanish(action.bet)];
    if (action.type === "configure_group_nassau") return ["nassau"];
    if (action.type === "configure_ball_friend") return ["ballfriend"];
    return [];
  }));
  const preferenceByPlayerAndGame = new Map<string, { preference: UserPreference | GroupPreference; source: "personal_memory" | "group_memory" }>();
  const rememberPreferences = (preferences: readonly (UserPreference | GroupPreference)[] | undefined, source: "personal_memory" | "group_memory") => {
    for (const preference of preferences ?? []) {
      if (preference.status !== "CONFIRMED" || preference.key !== "bet.participation" || !preference.context?.gameKey) continue;
      if (!preference.value || typeof preference.value !== "object" || Array.isArray(preference.value)) continue;
      const value = preference.value as Record<string, unknown>;
      if (typeof value.playerName !== "string" || typeof value.participates !== "boolean") continue;
      const gameKey = normalizeMexicanSpanish(preference.context.gameKey).replace(/\s+/g, "");
      preferenceByPlayerAndGame.set(`${gameKey}:${normalizeMexicanSpanish(value.playerName)}`, { preference, source });
    }
  };
  rememberPreferences(context.userPreferences, "personal_memory");
  rememberPreferences(context.groupPreferences?.filter((preference) => preference.groupId === preview.templateOrigin?.groupId), "group_memory");

  const participationFor = (gameKey: string, currentIds: string[]) => {
    const normalizedGame = normalizeMexicanSpanish(gameKey).replace(/\s+/g, "");
    if (explicitParticipationGames.has(normalizedGame)) return null;
    const ids = new Set(currentIds.length ? currentIds : preview.players.map((player) => player.id));
    const used: Array<{ preference: UserPreference | GroupPreference; source: "personal_memory" | "group_memory" }> = [];
    for (const player of preview.players) {
      const remembered = preferenceByPlayerAndGame.get(`${normalizedGame}:${normalizeMexicanSpanish(player.name)}`);
      if (!remembered) continue;
      const value = remembered.preference.value as { participates: boolean };
      if (value.participates) ids.add(player.id); else ids.delete(player.id);
      used.push(remembered);
    }
    return used.length ? { participantIds: [...ids], used } : null;
  };

  const coreGames: Array<{ key: Extract<ParsedRoundSetupAction, { type: "configure_core_bet" }>["bet"]; enabled: boolean; participantIds: string[] }> = [
    { key: "monkey", enabled: Boolean(preview.bets.monkey?.enabled), participantIds: preview.bets.monkey?.participantIds ?? [] },
    { key: "rabbits", enabled: preview.bets.rabbits.enabled, participantIds: preview.bets.rabbits.participantIds },
    { key: "skins", enabled: preview.bets.skins.enabled, participantIds: preview.bets.skins.participantIds },
    { key: "units", enabled: preview.bets.units.enabled, participantIds: preview.bets.units.participantIds },
    { key: "foursome", enabled: preview.bets.foursome.enabled, participantIds: preview.bets.foursome.participantIds },
    { key: "miniPolla", enabled: preview.bets.miniPolla.enabled, participantIds: preview.bets.miniPolla.participantIds },
    { key: "vipers", enabled: preview.bets.vipers.enabled, participantIds: preview.bets.vipers.participantIds },
    { key: "camels", enabled: preview.bets.camels.enabled, participantIds: preview.bets.camels.participantIds },
    { key: "fish", enabled: preview.bets.fish.enabled, participantIds: preview.bets.fish.participantIds },
    { key: "loba", enabled: preview.bets.loba.enabled, participantIds: preview.bets.loba.participantIds },
  ];
  for (const game of coreGames) {
    if (!game.enabled) continue;
    const remembered = participationFor(game.key, game.participantIds);
    if (!remembered) continue;
    const source = remembered.used.some((entry) => entry.source === "group_memory") ? "group_memory" : "personal_memory";
    const confidence = Math.min(...remembered.used.map((entry) => entry.preference.confidence));
    record({ type: "configure_core_bet", bet: game.key, participantIds: remembered.participantIds, source, confidence, evidence: "Participantes recuperados de una preferencia confirmada" });
    remembered.used.forEach((entry) => memory.push({ source: entry.source === "group_memory" ? "group_preference" : "user_preference", id: entry.preference.id, label: `Preferencia de ${game.key}`, confidence: entry.preference.confidence }));
  }
  const nassauEnabled = preview.bets.polla.first9.enabled || preview.bets.polla.second9.enabled || preview.bets.polla.total18.enabled;
  const nassauPreference = nassauEnabled ? participationFor("nassau", preview.bets.polla.first9.participantIds) : null;
  if (nassauPreference) {
    const source = nassauPreference.used.some((entry) => entry.source === "group_memory") ? "group_memory" : "personal_memory";
    record({ type: "configure_group_nassau", participantIds: nassauPreference.participantIds, source, confidence: Math.min(...nassauPreference.used.map((entry) => entry.preference.confidence)), evidence: "Participantes de Nassau recuperados de una preferencia confirmada" });
  }
  const ballFriendPreference = preview.bets.ballFriend.enabled ? participationFor("ballFriend", preview.bets.ballFriend.participantIds) : null;
  if (ballFriendPreference) {
    const source = ballFriendPreference.used.some((entry) => entry.source === "group_memory") ? "group_memory" : "personal_memory";
    record({ type: "configure_ball_friend", participantIds: ballFriendPreference.participantIds, source, confidence: Math.min(...ballFriendPreference.used.map((entry) => entry.preference.confidence)), evidence: "Participantes de Bola Amiga recuperados de una preferencia confirmada" });
  }

  if (!preview.courseSelected && !preview.courseIdentity) {
    const homeCourse = context.profile?.homeClub ? matchingCourses(context.profile.homeClub, context) : [];
    if (homeCourse.length === 1) {
      if (record({ type: "select_course", course: homeCourse[0], source: "personal_memory", confidence: 0.88, evidence: "Campo local del perfil" })) {
        memory.push({ source: "profile", id: homeCourse[0].id, label: homeCourse[0].name, confidence: 0.88 });
      }
    } else {
      const recent = sortedHistory(context).find((round) => round.courseSnapshot)?.courseSnapshot;
      if (recent) {
        if (record({ type: "select_course", course: recent, source: "round_history", confidence: 0.82, evidence: "Campo de la ronda más reciente" })) {
          memory.push({ source: "round_history", id: recent.id, label: recent.name, confidence: 0.82 });
        }
      } else questions.push({ code: "missing_course", field: "course", prompt: "¿En qué campo y tee juegan hoy?" });
    }
  }
  if (!preview.players.length) questions.push({ code: "missing_players", field: "players", prompt: "¿Quiénes juegan hoy?" });
  const missingHandicaps = missingHandicapsForActiveBets(preview.players, preview.bets, preview.supplementalBets);
  if (missingHandicaps.length) questions.push({
    code: "missing_player_handicaps",
    field: "players.handicaps",
    prompt: `Me faltan los HCP de ${missingHandicaps.map((player) => player.name).join(", ")}.`,
    playerTargets: missingHandicaps.map((player) => ({ id: player.id, label: player.name })),
  });

  const currentQuestions = questions.filter((question) => !(question.field === "course.tee" && preview.courseSelected));
  return { baseDraft, actions: resolvedActions, questions: uniqueQuestions(currentQuestions), memory };
}

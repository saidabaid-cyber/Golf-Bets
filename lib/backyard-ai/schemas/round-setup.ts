import { collectBetConfigurationIssues, type BetConfigurationIssue, type RoundBetConfiguration } from "../../bet-config-validation";
import { normalizeFoursomeSegments, playOrder, segmentDefinitions } from "../../engine";
import type { RoundTemplateOrigin } from "../../group-game-template";
import { restoreBetConfig } from "../../new-round-bets";
import { normalizeSupplementalBets } from "../../supplemental-bets";
import type {
  BallFriendHole,
  BetConfig,
  Course,
  FoursomeSegment,
  ManualBet,
  PersonalBet,
  Player,
  RoundHandicapBasis,
  RoundSnapshot,
  SupplementalBet,
} from "../../types";

export const ROUND_SETUP_DRAFT_VERSION = 1 as const;

export type RoundSetupDraft = {
  version: typeof ROUND_SETUP_DRAFT_VERSION;
  locale: string;
  date: string;
  course: Course | null;
  courseSelected: boolean;
  players: Player[];
  ownerId: string;
  startHole: 1 | 10;
  roundHoles: 9 | 18;
  handicapBasis: RoundHandicapBasis;
  bets: BetConfig;
  segments: FoursomeSegment[];
  personalBets: PersonalBet[];
  supplementalBets: SupplementalBet[];
  manualBets: ManualBet[];
  ballFriendSetup: Record<number, BallFriendHole>;
  templateOrigin?: RoundTemplateOrigin;
  /** Kept only as provenance; runtime score/result fields never enter this draft. */
  basedOnRoundId?: RoundSnapshot["id"];
};

export type CreateRoundSetupDraftInput = {
  locale?: string;
  date: string;
  course?: Course | null;
  courseSelected?: boolean;
  players?: Player[];
  ownerId?: string;
  startHole?: 1 | 10;
  roundHoles?: 9 | 18;
  handicapBasis?: RoundHandicapBasis;
  bets?: Partial<BetConfig> | null;
  segments?: FoursomeSegment[];
  personalBets?: PersonalBet[];
  supplementalBets?: SupplementalBet[];
  manualBets?: ManualBet[];
  ballFriendSetup?: Record<number, BallFriendHole>;
  templateOrigin?: RoundTemplateOrigin;
  basedOnRoundId?: string;
};

export type RoundSetupDraftIssue = BetConfigurationIssue | {
  code: "round-course" | "round-players" | "round-owner";
  sectionId: "round-course" | "round-players";
  message: string;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validCourse(course: Course | null | undefined) {
  if (!course || typeof course.id !== "string" || !course.id.trim() || typeof course.name !== "string" || !course.name.trim()) return false;
  if (!Array.isArray(course.holes) || course.holes.length !== 18) return false;
  return course.holes.every((hole) => Number.isInteger(hole.number) && hole.number >= 1 && hole.number <= 18
    && Number.isFinite(hole.par) && Number.isInteger(hole.strokeIndex) && hole.strokeIndex >= 1 && hole.strokeIndex <= 18);
}

export function createRoundSetupDraft(input: CreateRoundSetupDraftInput): RoundSetupDraft {
  const players = clone(input.players ?? []);
  const startHole = input.startHole === 10 ? 10 : 1;
  const roundHoles = input.roundHoles === 9 ? 9 : 18;
  const handicapBasis = input.handicapBasis === "course" ? "course" : "relative";
  const playerIds = players.map((player) => player.id);
  const bets = restoreBetConfig(input.bets, playerIds, { startHole, roundHoles });
  const order = playOrder(startHole).slice(0, roundHoles);
  const segments = input.segments
    ? normalizeFoursomeSegments(clone(input.segments), order, bets.foursome.segmentSize)
    : segmentDefinitions(order, bets.foursome.segmentSize);
  const course = input.course && validCourse(input.course) ? clone(input.course) : null;
  const selected = input.courseSelected === undefined ? Boolean(course) : Boolean(input.courseSelected && course);
  const ownerId = players.some((player) => player.id === input.ownerId)
    ? input.ownerId!
    : players[0]?.id ?? "";

  return {
    version: ROUND_SETUP_DRAFT_VERSION,
    locale: input.locale || "es-MX",
    date: input.date,
    course,
    courseSelected: selected,
    players,
    ownerId,
    startHole,
    roundHoles,
    handicapBasis,
    bets,
    segments,
    personalBets: clone(input.personalBets ?? []),
    supplementalBets: normalizeSupplementalBets(clone(input.supplementalBets ?? []), roundHoles),
    manualBets: clone(input.manualBets ?? []),
    ballFriendSetup: clone(input.ballFriendSetup ?? {}),
    ...(input.templateOrigin ? { templateOrigin: clone(input.templateOrigin) } : {}),
    ...(input.basedOnRoundId ? { basedOnRoundId: input.basedOnRoundId } : {}),
  };
}

export function cloneRoundSetupDraft(draft: RoundSetupDraft) {
  return clone(draft);
}

export function roundBetConfigurationFromDraft(draft: RoundSetupDraft): RoundBetConfiguration {
  return {
    players: draft.players,
    ownerId: draft.ownerId,
    bets: draft.bets,
    segments: draft.segments,
    personalBets: draft.personalBets,
    supplementalBets: draft.supplementalBets,
    manualBets: draft.manualBets,
    roundHoles: draft.roundHoles,
    startHole: draft.startHole,
    handicapBasis: draft.handicapBasis,
  };
}

export function validateRoundSetupDraft(draft: RoundSetupDraft): RoundSetupDraftIssue[] {
  const issues: RoundSetupDraftIssue[] = [];
  if (!draft.courseSelected || !validCourse(draft.course)) {
    issues.push({ code: "round-course", sectionId: "round-course", message: "Selecciona un campo y tee reales antes de iniciar." });
  }
  if (!draft.players.length) {
    issues.push({ code: "round-players", sectionId: "round-players", message: "Agrega al menos un jugador a la ronda." });
  }
  if (draft.players.length && !draft.players.some((player) => player.id === draft.ownerId)) {
    issues.push({ code: "round-owner", sectionId: "round-players", message: "Selecciona al jugador principal de la ronda." });
  }
  issues.push(...collectBetConfigurationIssues(roundBetConfigurationFromDraft(draft)));
  return issues;
}

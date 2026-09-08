import type { HoleScore } from "../../types";

export const SCORECARD_EXTRACTION_VERSION = 1 as const;

export type ScorecardSourceRegion = {
  /** Normalized coordinates in the source image, from 0 to 1. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScorecardObservationSource = {
  /** Stable local/cloud photo identifier. Never a public URL. */
  photoId: string;
  /** Optional crop used by the extractor, useful when reviewing a correction. */
  region?: ScorecardSourceRegion;
  /** Short OCR fragment for audit/debugging. It must not contain a whole image. */
  rawText?: string;
};

export type ScorecardTextObservation = {
  value: string;
  confidence: number;
  source: ScorecardObservationSource;
};

export type ScorecardPlayerObservation = {
  playerName: string;
  confidence: number;
  source: ScorecardObservationSource;
};

/** A provider observation. Null means the cell was located but was unreadable. */
export type ScorecardCellObservation = {
  playerName: string;
  hole: number;
  value: number | null;
  confidence: number;
  source: ScorecardObservationSource;
};

export type ScorecardParObservation = {
  hole: number;
  value: number | null;
  confidence: number;
  source: ScorecardObservationSource;
};

export type ScorecardTotalKind = "out" | "in" | "total";

export type ScorecardTotalObservation = {
  playerName: string;
  kind: ScorecardTotalKind;
  value: number | null;
  confidence: number;
  source: ScorecardObservationSource;
};

/**
 * Provider-neutral, multi-photo extraction. This is evidence only: it is never
 * an official scorecard and it is never passed to the betting engine directly.
 */
export type ScorecardExtraction = {
  version: typeof SCORECARD_EXTRACTION_VERSION;
  sourceIds: string[];
  course: ScorecardTextObservation | null;
  /** Every visible course label across photos; `course` is only the strongest convenience candidate. */
  courses?: ScorecardTextObservation[];
  players: ScorecardPlayerObservation[];
  cells: ScorecardCellObservation[];
  pars: ScorecardParObservation[];
  totals: ScorecardTotalObservation[];
};

export type ScorecardNormalizationIssue = {
  path: string;
  message: string;
};

export type ScorecardNormalizationResult =
  | { ok: true; extraction: ScorecardExtraction; issues: [] }
  | { ok: false; extraction: null; issues: ScorecardNormalizationIssue[] };

export type ScorecardPhotoExtractionInput = {
  photoId: string;
  payload: unknown;
};

export type ActiveScorecardPlayer = {
  id: string;
  name: string;
  aliases?: string[];
};

export type ActiveScorecardCourse = {
  id: string;
  name: string;
  aliases?: string[];
  holes: Array<{ number: number; par: number }>;
};

export type ActiveScorecardRound = {
  roundId: string;
  players: ActiveScorecardPlayer[];
  course: ActiveScorecardCourse;
  startHole: 1 | 10;
  roundHoles: 9 | 18;
  /** Already-confirmed digital scores, if the group captured any while playing. */
  digitalScores?: Record<number, HoleScore>;
};

export type ScorecardPlayerMappingOverride = {
  extractedName: string;
  playerId: string;
};

export type ScorecardCellOverride = {
  playerId: string;
  hole: number;
  value: number;
};

export type ScorecardValidationOverrides = {
  playerMappings?: ScorecardPlayerMappingOverride[];
  cells?: ScorecardCellOverride[];
  /** Explicit confirmation that a printed course label belongs to the active round. */
  acceptCourseMismatch?: boolean;
  /** Confirms that the active course definition wins over a printed Par value. */
  acceptParMismatches?: number[];
  /** Confirms that the written aggregate is wrong and the accepted hole cells win. */
  acceptTotalMismatches?: Array<{ playerId: string; kind: ScorecardTotalKind }>;
};

export type ScorecardConfidencePolicy = {
  cellAutoAccept: number;
  playerAutoMatch: number;
  courseAutoMatch: number;
  totalCheck: number;
  parCheck: number;
};

export type ScorecardPlayerMatchMethod = "override" | "exact" | "alias" | "unique-name-part" | "fuzzy";

export type ScorecardPlayerMatch = {
  extractedName: string;
  status: "matched" | "ambiguous" | "unknown";
  playerId?: string;
  playerName?: string;
  confidence: number;
  method?: ScorecardPlayerMatchMethod;
  candidatePlayerIds: string[];
};

export type ScorecardCourseMatch = {
  status: "absent" | "matched" | "doubtful" | "mismatch" | "overridden";
  extractedName?: string;
  confidence: number;
};

export type AcceptedScoreSource = "extraction" | "digital" | "digital_and_extraction" | "user_override";

export type AcceptedScorecardCell = {
  playerId: string;
  playerName: string;
  hole: number;
  value: number;
  confidence: number;
  acceptedFrom: AcceptedScoreSource;
  source?: ScorecardObservationSource;
};

export type ScorecardIssueSeverity = "doubtful" | "blocking";
export type ScorecardIssueResolution = "cell_value" | "player_mapping" | "course_confirmation" | "total_confirmation" | "new_photo" | "round_setup";

export type ScorecardValidationIssueCode =
  | "invalid_round"
  | "invalid_override"
  | "no_scorecard_evidence"
  | "course_low_confidence"
  | "course_mismatch"
  | "conflicting_course_observations"
  | "unknown_player"
  | "ambiguous_player"
  | "player_match_low_confidence"
  | "unreadable_score"
  | "missing_score"
  | "low_confidence_score"
  | "conflicting_score_observations"
  | "score_out_of_range"
  | "score_implausible_for_par"
  | "digital_score_mismatch"
  | "par_mismatch"
  | "total_mismatch"
  | "conflicting_total_observations";

export type ScorecardValidationIssue = {
  id: string;
  code: ScorecardValidationIssueCode;
  severity: ScorecardIssueSeverity;
  resolution: ScorecardIssueResolution;
  message: string;
  playerId?: string;
  playerName?: string;
  extractedPlayerName?: string;
  hole?: number;
  holes?: number[];
  totalKind?: ScorecardTotalKind;
  candidateValue?: number | null;
  expectedValue?: number;
  confidence?: number;
  source?: ScorecardObservationSource;
  candidatePlayerIds?: string[];
};

export type ScorecardValidationResult = {
  ready: boolean;
  expectedHoles: number[];
  /** Only deterministic, accepted values. Safe to merge into the live score draft. */
  acceptedScores: Record<number, Record<string, number>>;
  acceptedCells: AcceptedScorecardCell[];
  /** Contains only unresolved doubtful/blocking items; accepted cells are reviewed read-only. */
  issues: ScorecardValidationIssue[];
  playerMatches: ScorecardPlayerMatch[];
  courseMatch: ScorecardCourseMatch;
  evidence: {
    detectedCellCount: number;
    numericCellCount: number;
    averageCellConfidence: number;
    sourcePhotoCount: number;
  };
};

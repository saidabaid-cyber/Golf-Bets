import type {
  ChicagoBet,
  Course,
  DecimalMode,
  HandicapMode,
  Player,
  RoundHandicapBasis,
  SkinsMode,
  SupplementalBet,
  VegasBet,
} from "../../types";

export type ActionSource = "explicit" | "personal_memory" | "group_memory" | "round_history" | "inferred";

export type ActionEvidence = {
  source: ActionSource;
  confidence: number;
  /** Short, non-sensitive explanation suitable for an audit log. */
  evidence: string;
};

export type CoreRoundBetKey =
  | "monkey"
  | "rabbits"
  | "skins"
  | "units"
  | "foursome"
  | "miniPolla"
  | "vipers"
  | "camels"
  | "fish"
  | "loba";

export type RoundSetupAction =
  | ({ type: "replace_players"; players: Player[]; ownerId: string } & ActionEvidence)
  | ({ type: "set_player_handicap"; playerId: string; handicap: number } & ActionEvidence)
  | ({ type: "identify_course"; courseName: string; catalogCourseId?: string; candidateCourseIds: string[] } & ActionEvidence)
  | ({ type: "select_course"; course: Course } & ActionEvidence)
  | ({ type: "set_start_hole"; startHole: 1 | 10 } & ActionEvidence)
  | ({ type: "set_round_holes"; roundHoles: 9 | 18 } & ActionEvidence)
  | ({ type: "set_handicap_basis"; handicapBasis: RoundHandicapBasis } & ActionEvidence)
  | ({
      type: "configure_core_bet";
      bet: CoreRoundBetKey;
      enabled?: boolean;
      value?: number;
      participantIds?: string[];
      skinsMode?: SkinsMode;
      /** Second played half pressure used only by Viboritas, Camellos and Peces. */
      secondNinePressed?: boolean;
      secondNineMultiplier?: number;
    } & ActionEvidence)
  | ({
      type: "configure_group_nassau";
      enabled?: boolean;
      value?: number;
      participantIds?: string[];
      /** Limits an incremental edit to existing components without creating the other Nassau legs. */
      componentScope?: Array<"first9" | "second9" | "total18">;
      /** Preserves intentionally different rosters across front/back/total. */
      participantIdsByComponent?: Partial<Record<"first9" | "second9" | "total18", string[]>>;
      hcpPct?: number;
      decimals?: DecimalMode;
    } & ActionEvidence)
  | ({
      type: "configure_polla_component";
      component: "first9" | "second9" | "total18";
      enabled?: boolean;
      value?: number;
      participantIds?: string[];
      hcpPct?: number;
      decimals?: DecimalMode;
    } & ActionEvidence)
  | ({
      type: "configure_individual_nassau";
      id: string;
      enabled?: boolean;
      playerAId: string;
      playerBId: string;
      value?: number;
    } & ActionEvidence)
  | ({
      type: "configure_ball_friend";
      enabled?: boolean;
      value?: number;
      participantIds?: string[];
      /** A fixed pair explicitly requested for every played hole. */
      teamA?: [string, string];
    } & ActionEvidence)
  | ({ type: "upsert_supplemental_bet"; bet: SupplementalBet } & ActionEvidence)
  | ({ type: "remove_nassau" } & ActionEvidence);

export type RoundSetupQuestionCode =
  | "missing_context"
  | "missing_players"
  | "missing_player_handicaps"
  | "unknown_player"
  | "ambiguous_player"
  | "missing_course"
  | "missing_tee"
  | "unknown_course"
  | "ambiguous_course"
  | "missing_amount"
  | "unknown_bet"
  | "ambiguous_bet"
  | "invalid_action";

export type RoundSetupQuestion = {
  code: RoundSetupQuestionCode;
  field: string;
  prompt: string;
  candidates?: Array<{ id: string; label: string }>;
  playerTargets?: Array<{ id: string; label: string }>;
};

export type RoundMemoryReference =
  | { type: "same_players_last_sunday" }
  | { type: "same_usual_group"; playerCount?: number }
  | { type: "same_as_last_week" }
  | { type: "same_as_previous" }
  | { type: "frequent_group"; groupName: string }
  | { type: "last_round_at_course"; courseName: string };

export type ParsedRoundSetupAction =
  | { type: "replace_players"; playerNames: string[]; confidence: number; evidence: string }
  | { type: "set_player_handicap"; playerName: string; handicap: number; confidence: number; evidence: string }
  | { type: "select_course"; courseName: string; confidence: number; evidence: string }
  | { type: "select_tee"; teeName: string; confidence: number; evidence: string }
  | { type: "set_start_hole"; startHole: 1 | 10; confidence: number; evidence: string }
  | { type: "set_round_holes"; roundHoles: 9 | 18; confidence: number; evidence: string }
  | { type: "set_handicap_basis"; handicapBasis: RoundHandicapBasis; confidence: number; evidence: string }
  | {
      type: "configure_core_bet";
      bet: CoreRoundBetKey;
      enabled: boolean;
      value?: number;
      excludedPlayerNames?: string[];
      allPlayers?: boolean;
      skinsMode?: SkinsMode;
      /** Parsed only for the catalog-backed counter bets. */
      secondNinePressed?: boolean;
      secondNineMultiplier?: number;
      confidence: number;
      evidence: string;
    }
  | {
      type: "configure_group_nassau";
      enabled: boolean;
      value?: number;
      excludedPlayerNames?: string[];
      allPlayers?: boolean;
      hcpPct?: number;
      decimals?: DecimalMode;
      /** A contextual edit such as "Mejor Nassau" must not create a new category. */
      modificationOnly?: boolean;
      confidence: number;
      evidence: string;
    }
  | {
      type: "configure_polla_component";
      component: "first9" | "second9" | "total18";
      enabled: boolean;
      value?: number;
      excludedPlayerNames?: string[];
      allPlayers?: boolean;
      hcpPct?: number;
      decimals?: DecimalMode;
      confidence: number;
      evidence: string;
    }
  | {
      type: "configure_individual_nassau";
      enabled: boolean;
      playerAName: string;
      playerBName: string;
      value?: number;
      confidence: number;
      evidence: string;
    }
  | {
      type: "configure_ball_friend";
      enabled: boolean;
      value?: number;
      teamAPlayerNames?: string[];
      teamBPlayerNames?: string[];
      excludedPlayerNames?: string[];
      allPlayers?: boolean;
      confidence: number;
      evidence: string;
    }
  | {
      type: "configure_supplemental_bet";
      betType: Exclude<SupplementalBet["type"], "individual_nassau">;
      enabled: boolean;
      value?: number;
      playerAName?: string;
      playerBName?: string;
      participantNames?: string[];
      excludedPlayerNames?: string[];
      allPlayers?: boolean;
      teamAPlayerNames?: string[];
      teamBPlayerNames?: string[];
      carryEnabled?: boolean;
      hcpPct?: number;
      decimals?: HandicapMode;
      matchPlayEnabled?: boolean;
      advantageReceiverName?: string;
      advantageStrokes?: number;
      clearAdvantage?: boolean;
      quotaBase?: number;
      chicagoPoints?: Partial<ChicagoBet["points"]>;
      rotation?: VegasBet["rotation"];
      blockSize?: VegasBet["blockSize"];
      birdiePenalty?: boolean;
      holes?: 9 | 18;
      confidence: number;
      evidence: string;
    };

export type RoundSetupInterpretation = {
  input: string;
  normalizedInput: string;
  locale: "es-MX";
  confidence: number;
  reference?: RoundMemoryReference;
  actions: ParsedRoundSetupAction[];
  questions: RoundSetupQuestion[];
};

export type DecimalMode = "partial" | "round";
// `partial` and `round` remain valid so drafts saved before V2.4 keep loading.
export type HandicapMode = DecimalMode | "decimal" | "half_up" | "half_down" | "six_up" | "four_down";
/** How original round handicaps are converted into the base consumed by bets. */
export type RoundHandicapBasis = "relative" | "course";
export type FoursomeMode = "fixed" | "fixed_points" | "points" | "match";
export type PhysicalNine = "holes_1_9" | "holes_10_18";
export type RoundHalf = "first_half" | "second_half";
export type PressureMultiplier = 1 | 2 | 3 | 4 | 5;
export type FoursomeMatchPressScope = "first" | "second" | "total";
export type FoursomeMatchPress = {
  /** Stable identifier so multiple independent presses can coexist and persist. */
  id: string;
  /** The parent Match leg whose final hole closes this independent press. */
  scope: FoursomeMatchPressScope;
  /** Physical hole where this press begins; interpreted using the saved play order. */
  startHole: number;
  /** Stake multiplier applied only to this independent press. */
  multiplier: Exclude<PressureMultiplier, 1>;
};
export type RabbitMode = "continuous" | "three_hole_blocks";
export type SkinsMode = "carry" | "no_carry";
export type RoundLifecycleState = "draft" | "live" | "completed" | "cancelled";
/** Physical hole where play begins. Runtime validation keeps this in 1..18. */
export type RoundStartHole = number;

/** Presentation-only terminology for engine-backed round concepts. */
export type RoundPresentation = {
  version?: 1;
  groupNassauTerm?: "nassau" | "polla";
  /** Score-only UI; all betting configurations remain disabled. */
  playMode?: "score_only";
};
export type ScoreCaptureMode = "quick" | "advanced";

export type Player = {
  id: string;
  name: string;
  /** Handicap applied by the deterministic round engine. */
  handicap: number | null;
  /** Stable account link for the signed-in user's principal player. */
  accountUserId?: string;
  /** Profile/provider Index kept separate from the Playing Handicap. */
  handicapIndex?: number | null;
  handicapSource?: "profile_index" | "manual";
  handicapIndexSource?: "BACKYARD_MANUAL" | "BACKYARD_INDEX" | "BACKYARD_WHS_FUTURE" | "GHIN_OFFICIAL_FUTURE";
  /** Immutable inputs and result used to calculate this round's Playing Handicap. */
  courseHandicapSnapshot?: PlayerCourseHandicapSnapshot;
};

export type PlayerCourseHandicapSnapshot = {
  index: number;
  indexSource: "BACKYARD_MANUAL" | "BACKYARD_INDEX" | "BACKYARD_WHS_FUTURE" | "GHIN_OFFICIAL_FUTURE";
  teeId: string;
  teeName: string;
  slope: number;
  courseRating: number;
  par: number;
  courseHandicap: number;
  appliedHandicap: number;
  formulaVersion: "WHS-2024-COURSE-HANDICAP-V1";
  effectiveAt: string;
  calculatedAt: string;
};

export type Hole = {
  number: number;
  /** Player-facing label for temporary layouts such as 4A/4B. Engines use number. */
  displayLabel?: string;
  par: number;
  strokeIndex: number;
  yards?: number;
  /** Optional provider-owned GPS targets. Missing values must never be invented. */
  teeLatitude?: number;
  teeLongitude?: number;
  greenFrontLatitude?: number;
  greenFrontLongitude?: number;
  greenCenterLatitude?: number;
  greenCenterLongitude?: number;
  greenBackLatitude?: number;
  greenBackLongitude?: number;
};

export type LocalRule = {
  id: string;
  title: string;
  text: string;
  enabled: boolean;
  hole: number | null;
};

// Legacy tee metadata is retained only to open V2.x drafts; V3 treats each entry
// as one field definition driven by per-hole Par and stroke index.
export type Course = {
  /** Round-only frozen cards. Absent on legacy rounds; never changes formulas. */
  playerHoleCards?: Record<string, Hole[]>;
  catalogReview?: {
    /** Versioned evidence remains separate from the physical tee and from runtime handicap selection. */
    ratingEvidence?: import('./course-rating-evidence').CourseRatingEvidenceBundleV1;
    ratingCategory: string | null;
    categoryVerified: boolean;
    reuseStatus: string;
    qaStatus: string;
    issues: string[];
    limitation: string | null;
    reportedRating: number | null;
    reportedSlope: number | null;
    nineRatings: import('./review-course-catalog').ReviewedNineRating[];
    sourceObservedAt: string;
  };
  id: string;
  name: string;
  /** @deprecated Kept only so V2.x saved rounds can still be opened. */
  teeName: string;
  /** @deprecated Kept only so V2.x saved rounds can still be opened. */
  rating?: number;
  /** @deprecated Kept only so V2.x saved rounds can still be opened. */
  slope?: number;
  /** @deprecated Kept only so V2.x saved rounds can still be opened. */
  totalYards?: number;
  holes: Hole[];
  builtIn?: boolean;
  updatedAt?: string;
  /** Optional normalized-catalog references. Legacy drafts remain valid without them. */
  catalogClubId?: string;
  catalogCourseId?: string;
  catalogTeeId?: string;
  clubName?: string;
  city?: string;
  stateRegion?: string;
  country?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  provider?: string;
  providerExternalId?: string;
  sourceName?: string;
  sourceUrl?: string;
  sourceAuthority?: string;
  verifiedAt?: string;
  dataVersion?: string;
  /** Local source evidence is distinct from an official GHIN/WHS rating. */
  indexRatingEvidence?: BackyardIndexRatedTeeEvidence;
  localRules?: LocalRule[];
  localRulesUpdatedAt?: string;
  /** Frozen Admin resolution captured once when this round starts. */
  operationsSnapshot?: {
    baseCourseId: string;
    baseCourseVersion: number;
    configurationIds: string[];
    configurationVersions: number[];
    configurationHashes: string[];
    competitionId: string | null;
    competitionRuleSetId?: string | null;
    competitionRuleVersion?: number | null;
    effectiveAt: string;
    warnings: string[];
  };
};

export type ParticipantConfig = {
  participantIds: string[];
};

export type CounterBetKind = "vipers" | "camels" | "fish";
export type CounterBetSettlementMode = "halves" | "round" | "legacy_halves";
export type CounterBetDeterminationMode = "last_event" | "most_events";
export type CounterBetTieRule = "tied_players_pay" | "latest_tied_event";

export type CounterBetConfig = ParticipantConfig & {
  enabled: boolean;
  value: number;
  /** Current rounds settle each played half independently. Older values remain readable. */
  settlementMode?: CounterBetSettlementMode;
  /** Explicit pressure state. Missing derives from a saved multiplier for compatibility. */
  secondNinePressed?: boolean;
  /** Second played half pressure multiplier. Missing/non-pressed is effectively 1x. */
  secondNineMultiplier?: number;
  /** How the owner/payer of the animal is determined inside each configured bag. */
  determinationMode?: CounterBetDeterminationMode;
  /** Required by the UI when determinationMode is most_events. */
  mostEventsTieRule?: CounterBetTieRule;
};

export type CounterBetEvent = {
  id: string;
  kind: CounterBetKind;
  hole: number;
  playerId: string;
  quantity: number;
  /** True when the player explicitly confirmed this capture, including zero. */
  captureConfirmed?: boolean;
  /** Centimetres from the hole; requested only for a same-hole Viper tie. */
  distanceToHole?: number;
  /** Monotonic capture order used to resolve same-hole chronology without guessing. */
  captureOrder?: number;
  /** Audit timestamp for the latest positive capture of this player/hole event. */
  capturedAt?: string;
  /** Derived audit fields persisted in finalized snapshots; calculation remains config-driven. */
  effectiveUnitValue?: number;
  effectiveTotalValue?: number;
};

export type CounterBetPeriod = PhysicalNine | RoundHalf | "round";
export type CounterBetKeepers = Record<CounterBetKind, Partial<Record<CounterBetPeriod, string>>>;

export type LobaMode = "partner" | "solo" | "solo_anticipated";
export type LobaWinner = "loba_team" | "opponents" | "tie";

export type LobaHole = {
  lobaPlayerId?: string;
  mode?: LobaMode;
  partnerId?: string;
  fireMultiplier: number;
  /** @deprecated Legacy drafts may contain this value; the result is now score-derived. */
  winner?: LobaWinner;
  /** Manual/special unit captures remain per player; natural units are score-derived. */
  unitCounts: Record<string, number>;
};

export type MedalPollaConfig = ParticipantConfig & {
  enabled: boolean;
  value: number;
  hcpPct: number;
  decimals: DecimalMode;
  /** Identifies component keys that already describe played halves. */
  playedHalfVersion?: 1;
};

export type HandicapBaseConfig = {
  /** Missing preserves the calculation of previously saved rounds. */
  baseMode?: "fixed" | "moving";
  /** HCP reference frozen when fixed-base configuration is first confirmed. */
  fixedBaseHandicap?: number;
};

export type BetConfig = {
  /** Original workbook Monkey: exactly three participants, disabled for legacy rounds. */
  monkey?: ParticipantConfig & {
    enabled: boolean;
    value: number;
    /** Missing in historical rounds preserves the original 100% calculation. */
    hcpPct?: number;
  };
  rabbits: ParticipantConfig & {
    enabled: boolean;
    /** Missing in historical rounds preserves the original continuous mode. */
    mode?: RabbitMode;
    value: number;
    hcpPct: number;
    decimals: HandicapMode;
    accumulate: boolean;
  };
  skins: ParticipantConfig & {
    enabled: boolean;
    /** Missing in historical rounds preserves the original carry mode. */
    mode?: SkinsMode;
    value: number;
    hcpPct: number;
    decimals: HandicapMode;
    accumulate: boolean;
  };
  units: ParticipantConfig & {
    enabled: boolean;
    value: number;
    /** Missing keeps the legacy unit value. Excel Copas may have a different stake. */
    copaValue?: number;
  };
  foursome: ParticipantConfig & HandicapBaseConfig & {
    enabled: boolean;
    /** Missing preserves saved pre-Excel calculations. Excel uses raw rebased HCP,
     * rounded to one decimal, with SI/SI+18 thresholds (not fractional strokes). */
    handicapMethod?: "excel" | "configured";
    hcpPct: number;
    decimals: DecimalMode;
    segmentSize: 3 | 6 | 9 | 18;
    mode: FoursomeMode;
    fixedValue: number;
    pointValue: number;
    /** @deprecated V2.5 compatibility. New rounds use pressureMultiplier/pressureNine. */
    pressSecond9?: boolean;
    pressureMultiplier?: PressureMultiplier;
    pressureNine?: PhysicalNine;
    /** Independent Match presses. Missing preserves the legacy second-nine multiplier. */
    matchPresses?: FoursomeMatchPress[];
  };
  ballFriend: ParticipantConfig & HandicapBaseConfig & {
    enabled: boolean;
    value: number;
    hcpPct: number;
    decimals: DecimalMode;
    maxScore: number;
  };
  polla: {
    first9: MedalPollaConfig;
    second9: MedalPollaConfig;
    total18: MedalPollaConfig;
  };
  miniPolla: ParticipantConfig & {
    enabled: boolean;
    value: number;
    hcpPct: number;
    decimals: DecimalMode;
  };
  vipers: CounterBetConfig;
  camels: CounterBetConfig;
  fish: CounterBetConfig;
  loba: ParticipantConfig & {
    enabled: boolean;
    value: number;
    /** Missing in older drafts is interpreted as 100%. */
    hcpPct?: number;
    unitsEnabled: boolean;
    unitValue: number;
    duplicateUnitsByMode: boolean;
  };
};

export type HoleScore = Record<string, number | null>;

export type UnitEvent = {
  id: string;
  hole: number;
  playerId: string;
  amount: number;
  label?: string;
};

export type FoursomeSegment = {
  id: string;
  startIndex: number;
  endIndex: number;
  basePair: string[];
  /** Configuration provenance only; the deterministic engine ignores it. */
  generatedByBackyard?: boolean;
};

export type PlayerTeeAssignmentSnapshot = {
  manualRatingDeclaration?: { category: string; source: string; declaredAt: string; holes: 18 };
  /** Exact tee card and independent ratings, frozen when selected. */
  holes?: Hole[];
  catalogReview?: Course['catalogReview'];
  playerId: string;
  courseId: string;
  layoutId?: string;
  teeId: string;
  teeName: string;
  rating?: number;
  slope?: number;
  yards?: number;
  par?: number;
  source: "catalog" | "manual" | "preference" | "legacy";
  capturedAt: string;
  sourceAuthority?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  dataVersion?: string;
  /** Frozen at tee selection; never resolved against a mutable catalog at round close. */
  indexRatingEvidence?: BackyardIndexRatedTeeEvidence;
};

/** Source evidence for a locally rated tee. CURATED is not GHIN/WHS certification. */
export type BackyardIndexRatedTeeEvidence = {
  kind: "OFFICIAL_RATED_TEE" | "CURATED_RATED_TEE";
  authority: string;
  sourceUrl: string;
  verifiedAt: string;
  dataVersion?: string;
  courseId: string;
  teeId: string;
  courseRating: number;
  slopeRating: number;
};

/** An unknown PCC is not silently converted to zero. The second variant is an explicit local-only assumption. */
export type BackyardIndexPccEvidence =
  | { kind: "PUBLISHED_PCC"; value: -1 | 0 | 1 | 2 | 3; appliesToDate: string; authority: string; verifiedAt: string }
  | { kind: "DECLARED_LOCAL_ZERO"; value: 0; declaredAt: string; declaredByAccountUserId: string };

export type BackyardIndexIneligibilityReason =
  | "INDEX_NOT_ENABLED"
  | "MISSING_INDEX_SNAPSHOT"
  | "INVALID_INDEX_SNAPSHOT"
  | "ROUND_NOT_COMPLETED"
  | "INVALID_PLAYED_DATE"
  | "PLAYER_NOT_LINKED"
  | "NOT_COMPLETE_18_HOLES"
  | "MISSING_COURSE_SNAPSHOT"
  | "MISSING_HOLE_DEFINITIONS"
  | "MISSING_HOLE_SCORES"
  | "INVALID_HOLE_SCORES"
  | "MISSING_TEE_ASSIGNMENT"
  | "MISSING_OFFICIAL_TEE_RATING"
  | "INVALID_OFFICIAL_TEE_RATING"
  | "TEE_RATING_MISMATCH"
  | "MISSING_COURSE_HANDICAP_FOR_ADJUSTMENT"
  | "COURSE_HANDICAP_TEE_MISMATCH"
  | "MISSING_ADJUSTED_GROSS_SCORE"
  | "MISSING_PCC_EVIDENCE"
  | "INVALID_PCC_EVIDENCE";

export type BackyardIndexHoleAdjustment = {
  hole: number;
  par: number;
  strokeIndex: number;
  gross: number;
  maximum: number;
  adjusted: number;
};

/** Immutable scoring evidence; a Backyard Index is local and never a WHS/GHIN Handicap Index. */
export type BackyardIndexRoundSnapshot = {
  version: 1;
  roundId: string;
  accountUserId: string;
  playerId: string;
  playedAt: string;
  capturedAt: string;
  eligible: boolean;
  reasons: BackyardIndexIneligibilityReason[];
  grossScore?: number;
  adjustedGrossScore?: number;
  adjustmentMethod?: "INITIAL_PAR_PLUS_FIVE" | "NET_DOUBLE_BOGEY";
  unrestrictedCourseHandicap?: number;
  holeAdjustments?: BackyardIndexHoleAdjustment[];
  ratedTeeEvidence?: BackyardIndexRatedTeeEvidence;
  pccEvidence?: BackyardIndexPccEvidence;
  scoreDifferential?: number;
  /** Frozen local preference at close; not a GHIN/official eligibility claim. */
  activation?: { enabled: boolean; preferenceUpdatedAt: string; localPccZeroDeclaredAt: string | null };
};

export type PersonalAdvantageMode = "manual" | "current_index" | "sliding";
export type PersonalIndexSource = "GHIN_OFFICIAL" | "BACKYARD_WHS" | "PROFILE_FALLBACK";

export type PersonalIndexSnapshot = {
  indexValue: number;
  indexSource: PersonalIndexSource;
  effectiveAt: string;
  verifiedAt?: string;
  provisional?: boolean;
};

export type PersonalSlidingAdjustment = {
  betId: string;
  rivalKey: string;
  previousAdvantage: number;
  result: "owner_win" | "rival_win" | "tie";
  newAdvantage: number;
  roundId: string;
  updatedAt: string;
};

export type BallFriendHole = {
  restPlayerId?: string;
  teamA: string[];
};

export type PersonalBetComponents = {
  match1: boolean;
  medal1: boolean;
  match2: boolean;
  medal2: boolean;
  match18: boolean;
  medal18: boolean;
};

export type SavedPersonalRival = {
  id: string;
  name: string;
  handicap?: number | null;
  baseValue?: number;
  advantageReceiver?: "owner" | "rival";
  advantageStrokes?: number;
  pressureMultiplier?: PressureMultiplier;
  pressureNine?: PhysicalNine;
  carryEnabled?: boolean;
  mode?: PersonalAdvantageMode;
  /** Signed value: positive means the rival receives; negative means the owner receives. */
  slidingAdvantage?: number;
  components?: PersonalBetComponents;
  updatedAt?: string;
};

export type PersonalBet = {
  id: string;
  /** Missing in saved rounds means active for backward compatibility. */
  enabled?: boolean;
  enabledBeforeCategoryOff?: boolean;
  rivalMode: "group" | "external";
  rivalPlayerId?: string;
  externalRivalId?: string;
  rivalName: string;
  /** Snapshot of the external rival's HCP; never read a mutable template for history. */
  rivalHandicap?: number | null;
  externalScores: Record<number, number | null>;
  baseValue: number;
  // `none` remains accepted only to migrate old drafts. New UI never offers Scratch.
  advantageReceiver: "none" | "owner" | "rival";
  advantageStrokes: number;
  advantageMode?: PersonalAdvantageMode;
  ownerIndexSnapshot?: PersonalIndexSnapshot;
  rivalIndexSnapshot?: PersonalIndexSnapshot;
  /** Frozen signed advantage for this round. Positive means the rival receives. */
  slidingAdvantage?: number;
  /** @deprecated V2.5 compatibility. New rounds use pressureMultiplier/pressureNine. */
  back9Multiplier: number;
  pressureMultiplier?: PressureMultiplier;
  pressureNine?: PhysicalNine;
  /** Nassau2 keys 1/2 represent the first/second nine PLAYED, not physical halves. */
  nassauVersion?: 2;
  /** Missing in legacy data means false; historical payouts remain immutable. */
  carryEnabled?: boolean;
  components: PersonalBetComponents;
};

export type ManualBet = {
  id: string;
  /** Missing in saved rounds means active for backward compatibility. */
  enabled?: boolean;
  enabledBeforeCategoryOff?: boolean;
  name: string;
  amounts: Record<string, number>;
};

export type SupplementalBetBase = {
  id: string;
  enabled: boolean;
  /** Remembers the per-instance state while a whole category is off. */
  enabledBeforeCategoryOff?: boolean;
};

export type IndividualNassauBet = SupplementalBetBase & {
  type: "individual_nassau";
  playerAId: string;
  playerBId: string;
  value: number;
  advantageReceiverId?: string;
  advantageStrokes: number;
  carryEnabled: boolean;
  components: PersonalBetComponents;
};

export type DollarStrokeBet = SupplementalBetBase & {
  type: "dollar_stroke";
  playerAId: string;
  playerBId: string;
  valuePerStroke: number;
  advantageReceiverId?: string;
  advantageStrokes: number;
};

export type IndividualPressuresBet = SupplementalBetBase & {
  type: "individual_pressures";
  participantIds: string[];
  value: number;
  hcpPct: number;
  decimals: HandicapMode;
  carryEnabled: boolean;
  matchPlayEnabled: boolean;
};

export type TeamPressureMetric = "low" | "high" | "low_high";
export type TeamPressureVirtualMode = "standard" | "mudo" | "yoyo";

export type TeamPressuresBet = SupplementalBetBase & {
  type: "team_pressures";
  participantIds: string[];
  /** Missing scores for these players use abandonedMaxScore in this wager only.
   * They never populate the canonical scorecard or imply round-level DNF support. */
  abandonedPlayerIds?: string[];
  teamA: string[];
  metric: TeamPressureMetric;
  virtualMode: TeamPressureVirtualMode;
  value: number;
  hcpPct: number;
  decimals: HandicapMode;
  carryEnabled: boolean;
  abandonedMaxScore: number;
};

export type ChicagoBet = SupplementalBetBase & {
  type: "chicago";
  participantIds: string[];
  quotaBase: number;
  /** Missing in historical rounds preserves the original 100% quota handicap. */
  hcpPct?: number;
  valuePerPoint: number;
  points: {
    birdieOrBetter: number;
    par: number;
    bogey: number;
    doubleBogeyOrWorse: number;
  };
};

export type VegasBet = SupplementalBetBase & {
  type: "vegas";
  participantIds: string[];
  teamA: string[];
  valuePerUnit: number;
  rotation: "fixed" | "each_hole" | "blocks";
  blockSize: 3 | 6 | 9;
  hcpPct: number;
  decimals: HandicapMode;
  birdiePenalty: boolean;
};

export type MinimumPuttsBet = SupplementalBetBase & {
  type: "minimum_putts";
  participantIds: string[];
  ante: number;
  holes: 9 | 18;
};

export type SupplementalBet =
  | IndividualNassauBet
  | DollarStrokeBet
  | IndividualPressuresBet
  | TeamPressuresBet
  | ChicagoBet
  | VegasBet
  | MinimumPuttsBet;

export type PuttsByHole = Record<number, Record<string, number | null>>;

export type AdvancedHoleStat = {
  /** Missing means not captured; false is an explicit miss. */
  fairwayHit?: boolean;
  /** Missing means not captured; false is an explicit missed green. */
  greenInRegulation?: boolean;
  /** Missing means not captured; zero is an explicit no-penalty result. */
  penaltyStrokes?: number;
  /** Optional direction of the tee shot; never required for settlement. */
  teeDirection?: "far_left" | "left" | "center" | "right" | "far_right";
  /** Optional landing area selected by the golfer. */
  landingLie?: "fairway" | "rough" | "bunker" | "water_ob";
  /** Free-form club label because My Bag catalogs can evolve independently. */
  teeClub?: string;
  /** Optional distance in yards. */
  teeDistance?: number;
  /** Optional distance of the first putt, in feet. */
  firstPuttDistanceFeet?: number;
  /** Golf fact captured independently from the Camellos settlement event. */
  bunkerCount?: number;
  /** Greenside bunker entries. New capture derives legacy bunkerCount from both bunker facts. */
  greenSideBunkerCount?: number;
  /** Fairway bunker entries. */
  fairwayBunkerCount?: number;
  /** Penalty-area / water entries, independent from the Peces settlement event. */
  penaltyAreaCount?: number;
  /** Explicit out-of-bounds observation; missing means not captured. */
  outOfBounds?: boolean;
  /** New capture uses a counter while retaining outOfBounds for old snapshots. */
  outOfBoundsCount?: number;
  /** Optional private note for this player/hole. */
  notes?: string;
};

export type AdvancedStatsByHole = Record<number, Record<string, AdvancedHoleStat>>;

export type RoundShotSnapshot = {
  id: string;
  roundId: string;
  playerId: string;
  hole: number;
  sequence: number;
  clubId?: string;
  clubLabel: string;
  /** Frozen at capture time; later bag edits never rewrite this value. */
  clubSnapshot: {
    id?: string;
    label: string;
    category?: string;
    model?: string;
    /** Frozen independently from the live equipment catalog. */
    shaft?: {
      id?: string;
      brand?: string;
      model?: string;
      flex?: string;
      weightGrams?: number;
      source?: "CATALOG" | "USER_ENTERED";
    };
  };
  startLocation?: { latitude: number; longitude: number; accuracyMeters?: number };
  endLocation?: { latitude: number; longitude: number; accuracyMeters?: number };
  distanceYards?: number;
  startedAt: string;
  endedAt?: string;
  source: "MANUAL" | "GPS" | "WATCH" | "RANGEFINDER" | "IMPORT";
};

export type Expense = {
  caddie: number;
  food: number;
  drinks: number;
  greenFee: number;
  cartRental: number;
  other: number;
};

export type PersonalHistoryResult = {
  rivalKey: string;
  rivalName: string;
  totalMoney: number;
  componentMoney: Record<string, number>;
  betId?: string;
  rivalTemplateId?: string;
  rivalHandicap?: number | null;
  betSnapshot?: PersonalBet;
  grossOwner?: number;
  grossRival?: number;
};

export type PersonalOpponentResult = {
  betId: string;
  mode: "nassau_individual" | "dollar_stroke" | "individual_pressures";
  modeLabel: string;
  opponentId: string;
  opponentName: string;
  amount: number;
  status?: "partial" | "final" | "pending";
  detailLines?: string[];
  components?: Array<{
    key: string;
    label: string;
    amount: number;
    status: "partial" | "final" | "pending";
    lines: string[];
  }>;
};

export type RoundSnapshot = {
  /** In-progress rounds can be parked in history without entering statistics. */
  pausedAt?: string;
  resumeHoleIndex?: number;
  resumeCourseSelected?: boolean;
  id: string;
  /** A declared gross total is not a per-hole card or adjusted gross score. */
  totalScoreCapture?: { version: 1; grossTotal: number; enteredAt: string; holesCompletedAt?: string };
  /** Read-only participant history view, never an owned/importable round.
   * id is namespaced by the canonical DB UUID to avoid cross-owner local-ID collisions. */
  cloudReadOnly?: true;
  cloudRoundId?: string;
  cloudSourceLocalId?: string;
  /** Read-side proof from the authenticated cloud reader, never accepted from a snapshot write. */
  cloudParticipant?: { accountUserId: string; playerId: string };
  /** Missing in legacy history is normalized to completed without rewriting storage. */
  lifecycleState?: RoundLifecycleState;
  /** Durable instant when the organizer explicitly started the round. */
  startedAt?: string;
  /** Missing in legacy rounds preserves the former score-only capture. */
  scoreCaptureMode?: ScoreCaptureMode;
  date: string;
  courseName: string;
  teeName: string;
  ownerName: string;
  ownerId?: string;
  snapshotVersion?: 2;
  roundHoles?: 9 | 18;
  startHole?: RoundStartHole;
  /** Missing on legacy snapshots preserves the previous player-relative behavior. */
  handicapBasis?: RoundHandicapBasis;
  /** Never consumed by the betting engine; preserves the user's terminology. */
  presentation?: RoundPresentation;
  betResult: number;
  expenses: Expense;
  expenseTotal: number;
  netResult: number;
  categoryResults: Record<string, number>;
  personalResults?: PersonalHistoryResult[];
  /** Immutable owner-perspective breakdown used by the Personales history. */
  personalOpponentResults?: PersonalOpponentResult[];
  players?: Player[];
  scores?: Record<number, HoleScore>;
  courseSnapshot?: Course;
  /** Immutable tee metadata used when the round was played. */
  playerTeeAssignments?: PlayerTeeAssignmentSnapshot[];
  /** Optional, account-linked local scoring evidence. Never interpreted as official WHS/GHIN. */
  backyardIndexSnapshots?: BackyardIndexRoundSnapshot[];
  /** Labels of the principal player's active bag when the round closed. */
  ownerBagSnapshot?: string[];
  order?: number[];
  completedAt?: string;
  updatedAt?: string;
  photoId?: string;
  /** Card AI supports several private originals while photoId remains the legacy primary image. */
  scorecardPhotoIds?: string[];
  betConfig?: BetConfig;
  unitEvents?: UnitEvent[];
  counterBetEvents?: CounterBetEvent[];
  counterBetKeepers?: CounterBetKeepers;
  lobaHoles?: Record<number, LobaHole>;
  personalBets?: PersonalBet[];
  personalSlidingAdjustments?: PersonalSlidingAdjustment[];
  manualBets?: ManualBet[];
  supplementalBets?: SupplementalBet[];
  putts?: PuttsByHole;
  advancedStats?: AdvancedStatsByHole;
  /** Optional principal-player shots with immutable club snapshots. */
  shots?: RoundShotSnapshot[];
  ballFriendSetup?: Record<number, BallFriendHole>;
  segments?: FoursomeSegment[];
  playerBalances?: Record<string, number>;
  categoryBalances?: Record<string, Record<string, number>>;
  resultDetails?: Record<string, unknown>;
  /** Immutable provenance only. Players, bets and teams above remain the playable snapshot. */
  groupOrigin?: {
    groupId: string;
    groupName: string;
    basedOnUpdatedAt: string;
    selectedMembers: Array<{ memberId: string; roundPlayerId: string; name: string }>;
  };
};

export type FrequentPlayer = {
  id: string;
  name: string;
  handicap: number | null;
  /** Present only for the account owner's principal player template. */
  accountUserId?: string;
  uses: number;
  updatedAt: string;
};

export type FrequentGroupMember = Pick<Player, "name" | "handicap" | "accountUserId"> & {
  /** Stable identity inside the group template. New groups always include it. */
  memberId?: string;
  kind?: "account" | "friend" | "invited" | "guest";
  username?: string;
  email?: string;
};

export type GroupGameTemplate = {
  version: 1;
  ownerMemberId: string;
  roundDefaults: {
    startHole: RoundStartHole;
    roundHoles: 9 | 18;
    handicapBasis: RoundHandicapBasis;
  };
  betConfig: BetConfig;
  foursomeSegments: FoursomeSegment[];
  personalBets: PersonalBet[];
  supplementalBets: SupplementalBet[];
  /** Explicit template defaults, distinct from captured round settlement results. */
  manualBets: (ManualBet & { initialAmounts?: Record<string, number> })[];
};

export type FrequentGroup = {
  id: string;
  name: string;
  imageUrl?: string;
  privacy?: "private" | "invite_only";
  players: FrequentGroupMember[];
  /** Missing means a legacy roster-only group and remains fully supported. */
  gameTemplate?: GroupGameTemplate;
  uses: number;
  updatedAt: string;
};

export type Transfer = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: number;
  betType?: string;
  hole?: number;
  metadata?: Record<string, string | number | boolean | null>;
};

export type DecimalMode = "partial" | "round";
// `partial` and `round` remain valid so drafts saved before V2.4 keep loading.
export type HandicapMode = DecimalMode | "decimal" | "half_up" | "half_down" | "six_up" | "four_down";
export type FoursomeMode = "fixed" | "fixed_points" | "points";
export type PhysicalNine = "holes_1_9" | "holes_10_18";
export type PressureMultiplier = 1 | 2 | 3 | 4 | 5;

export type Player = {
  id: string;
  name: string;
  handicap: number | null;
};

export type Hole = {
  number: number;
  par: number;
  strokeIndex: number;
  yards?: number;
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
  localRules?: LocalRule[];
  localRulesUpdatedAt?: string;
};

export type ParticipantConfig = {
  participantIds: string[];
};

export type CounterBetKind = "vipers" | "camels" | "fish";

export type CounterBetConfig = ParticipantConfig & {
  enabled: boolean;
  value: number;
  /** Multiplier for physical holes H10-H18. */
  secondNineMultiplier: number;
};

export type CounterBetEvent = {
  id: string;
  kind: CounterBetKind;
  hole: number;
  playerId: string;
  quantity: number;
};

export type CounterBetKeepers = Record<CounterBetKind, Partial<Record<PhysicalNine, string>>>;

export type LobaMode = "partner" | "solo" | "solo_anticipated";
export type LobaWinner = "loba_team" | "opponents" | "tie";

export type LobaHole = {
  lobaPlayerId?: string;
  mode?: LobaMode;
  partnerId?: string;
  fireMultiplier: number;
  /** @deprecated Legacy drafts may contain this value; the result is now score-derived. */
  winner?: LobaWinner;
  /** Unit captures remain per player, but settlement belongs to each team. */
  unitCounts: Record<string, number>;
};

export type MedalPollaConfig = ParticipantConfig & {
  enabled: boolean;
  value: number;
  hcpPct: number;
  decimals: DecimalMode;
};

export type HandicapBaseConfig = {
  /** Missing preserves the calculation of previously saved rounds. */
  baseMode?: "fixed" | "moving";
  /** HCP reference frozen when fixed-base configuration is first confirmed. */
  fixedBaseHandicap?: number;
};

export type BetConfig = {
  /** Original workbook Monkey: exactly three participants, disabled for legacy rounds. */
  monkey?: ParticipantConfig & { enabled: boolean; value: number };
  rabbits: ParticipantConfig & {
    enabled: boolean;
    value: number;
    hcpPct: number;
    decimals: HandicapMode;
    accumulate: boolean;
  };
  skins: ParticipantConfig & {
    enabled: boolean;
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
  updatedAt?: string;
};

export type PersonalBet = {
  id: string;
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
  name: string;
  amounts: Record<string, number>;
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

export type RoundSnapshot = {
  id: string;
  date: string;
  courseName: string;
  teeName: string;
  ownerName: string;
  ownerId?: string;
  snapshotVersion?: 2;
  roundHoles?: 9 | 18;
  startHole?: 1 | 10;
  betResult: number;
  expenses: Expense;
  expenseTotal: number;
  netResult: number;
  categoryResults: Record<string, number>;
  personalResults?: PersonalHistoryResult[];
  players?: Player[];
  scores?: Record<number, HoleScore>;
  courseSnapshot?: Course;
  order?: number[];
  completedAt?: string;
  updatedAt?: string;
  photoId?: string;
  betConfig?: BetConfig;
  unitEvents?: UnitEvent[];
  counterBetEvents?: CounterBetEvent[];
  counterBetKeepers?: CounterBetKeepers;
  lobaHoles?: Record<number, LobaHole>;
  personalBets?: PersonalBet[];
  manualBets?: ManualBet[];
  ballFriendSetup?: Record<number, BallFriendHole>;
  segments?: FoursomeSegment[];
  playerBalances?: Record<string, number>;
  categoryBalances?: Record<string, Record<string, number>>;
  resultDetails?: Record<string, unknown>;
};

export type FrequentPlayer = {
  id: string;
  name: string;
  handicap: number | null;
  uses: number;
  updatedAt: string;
};

export type FrequentGroup = {
  id: string;
  name: string;
  players: Array<Pick<Player, "name" | "handicap">>;
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

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

export type MedalPollaConfig = ParticipantConfig & {
  enabled: boolean;
  value: number;
  hcpPct: number;
  decimals: DecimalMode;
};

export type BetConfig = {
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
  };
  foursome: ParticipantConfig & {
    enabled: boolean;
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
  ballFriend: ParticipantConfig & {
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
  updatedAt?: string;
};

export type PersonalBet = {
  id: string;
  rivalMode: "group" | "external";
  rivalPlayerId?: string;
  externalRivalId?: string;
  rivalName: string;
  externalScores: Record<number, number | null>;
  baseValue: number;
  // `none` remains accepted only to migrate old drafts. New UI never offers Scratch.
  advantageReceiver: "none" | "owner" | "rival";
  advantageStrokes: number;
  /** @deprecated V2.5 compatibility. New rounds use pressureMultiplier/pressureNine. */
  back9Multiplier: number;
  pressureMultiplier?: PressureMultiplier;
  pressureNine?: PhysicalNine;
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
};

export type RoundSnapshot = {
  id: string;
  date: string;
  courseName: string;
  teeName: string;
  ownerName: string;
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
  photoId?: string;
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
};

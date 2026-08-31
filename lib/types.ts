export type DecimalMode = "partial" | "round";
// `partial` and `round` remain valid so drafts saved before V2.4 keep loading.
export type HandicapMode = DecimalMode | "decimal" | "half_up" | "half_down" | "six_up" | "four_down";
export type FoursomeMode = "fixed" | "fixed_points" | "points";

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

// Internally each Course entry represents one tee. The UI groups entries by name,
// so one course can expose multiple tees without duplicating the course to the user.
export type Course = {
  id: string;
  name: string;
  teeName: string;
  rating?: number;
  slope?: number;
  totalYards?: number;
  holes: Hole[];
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
    pressSecond9: boolean;
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
  back9Multiplier: number;
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
};

export type Transfer = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: number;
};

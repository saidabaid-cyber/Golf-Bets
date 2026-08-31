export type DecimalMode = "partial" | "round";
export type FoursomeMode = "fixed" | "fixed_points" | "points";

export type Player = {
  id: string;
  name: string;
  handicap: number;
};

export type Hole = {
  number: number;
  par: number;
  strokeIndex: number;
};

export type Course = {
  id: string;
  name: string;
  teeName: string;
  rating?: number;
  slope?: number;
  holes: Hole[];
};

export type ParticipantConfig = {
  participantIds: string[];
};

export type BetConfig = {
  rabbits: ParticipantConfig & {
    enabled: boolean;
    value: number;
    hcpPct: number;
    decimals: DecimalMode;
    accumulate: boolean;
  };
  skins: ParticipantConfig & {
    enabled: boolean;
    value: number;
    hcpPct: number;
    decimals: DecimalMode;
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
  };
  ballFriend: ParticipantConfig & {
    enabled: boolean;
    value: number;
    hcpPct: number;
    decimals: DecimalMode;
    maxScore: number;
  };
};

export type HoleScore = Record<string, number | null>;

export type UnitEvent = {
  id: string;
  hole: number;
  playerId: string;
  amount: number;
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

export type PersonalBet = {
  id: string;
  rivalPlayerId: string;
  baseValue: number;
  advantageReceiverId?: string;
  advantageStrokes: number;
  back9Multiplier: number;
  components: PersonalBetComponents;
};

export type Expense = {
  caddie: number;
  breakfast: number;
  lunch: number;
  drinks: number;
  other: number;
};

export type RoundSnapshot = {
  id: string;
  date: string;
  courseName: string;
  teeName: string;
  ownerName: string;
  betResult: number;
  expenses: Expense;
  expenseTotal: number;
  netResult: number;
  categoryResults: Record<string, number>;
};

export type Transfer = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: number;
};

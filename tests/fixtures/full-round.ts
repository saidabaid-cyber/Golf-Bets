import type { BallFriendHole, BetConfig, Course, FoursomeSegment, HoleScore, PersonalBet, Player } from "../../lib/types";

export const fullRoundPlayers: Player[] = [
  { id: "said", name: "Said", handicap: 0 },
  { id: "cuau", name: "Cuau", handicap: 8 },
  { id: "armando", name: "Armando", handicap: 12 },
  { id: "jesus", name: "Jesús", handicap: 4 },
];

export const fullRoundCourse: Course = {
  id: "full-round",
  name: "Fixture 18 hoyos",
  teeName: "General",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

export const fullRoundOrder = Array.from({ length: 18 }, (_, index) => index + 1);

export const fullRoundScores: Record<number, HoleScore> = Object.fromEntries(fullRoundOrder.map((hole) => [hole, {
  said: hole % 5 === 0 ? 3 : 4,
  cuau: hole % 4 === 0 ? 5 : 4,
  armando: hole % 7 === 0 ? 3 : 4,
  jesus: hole % 3 === 0 ? 5 : 4,
}]));

const allIds = fullRoundPlayers.map((player) => player.id);

export const fullRoundBets: BetConfig = {
  rabbits: { enabled: true, value: 100, hcpPct: 100, decimals: "round", accumulate: true, participantIds: allIds },
  skins: { enabled: true, value: 50, hcpPct: 100, decimals: "round", accumulate: true, participantIds: allIds },
  units: { enabled: true, value: 100, participantIds: allIds },
  foursome: { enabled: true, hcpPct: 100, decimals: "round", segmentSize: 6, mode: "fixed_points", fixedValue: 200, pointValue: 100, pressureMultiplier: 1, pressureNine: "holes_10_18", participantIds: allIds },
  ballFriend: { enabled: true, value: 20, hcpPct: 100, decimals: "round", maxScore: 9, participantIds: allIds },
  polla: {
    first9: { enabled: true, value: 100, hcpPct: 100, decimals: "round", participantIds: allIds },
    second9: { enabled: true, value: 100, hcpPct: 100, decimals: "round", participantIds: allIds },
    total18: { enabled: true, value: 200, hcpPct: 100, decimals: "round", participantIds: allIds },
  },
  miniPolla: { enabled: true, value: 100, hcpPct: 100, decimals: "round", participantIds: allIds },
};

export const fullRoundSegments: FoursomeSegment[] = [
  { id: "seg-0", startIndex: 0, endIndex: 5, basePair: ["said", "cuau"] },
  { id: "seg-6", startIndex: 6, endIndex: 11, basePair: ["armando", "jesus"] },
  { id: "seg-12", startIndex: 12, endIndex: 17, basePair: ["said", "jesus"] },
];

export const fullRoundBallFriend: Record<number, BallFriendHole> = Object.fromEntries(fullRoundOrder.map((hole) => [hole, { teamA: ["said", "cuau"] }]));

export const fullRoundPersonal: PersonalBet = {
  id: "personal-full-round",
  rivalMode: "group",
  rivalPlayerId: "cuau",
  rivalName: "Cuau",
  externalScores: {},
  baseValue: 100,
  advantageReceiver: "rival",
  advantageStrokes: 0,
  back9Multiplier: 1,
  pressureMultiplier: 1,
  pressureNine: "holes_10_18",
  components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
};

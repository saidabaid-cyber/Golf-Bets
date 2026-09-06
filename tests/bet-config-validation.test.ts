import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { collectBetConfigurationIssues, type RoundBetConfiguration } from "../lib/bet-config-validation";
import { calculateFoursomes, calculateManualBets, normalizeFoursomeSegments, segmentDefinitions } from "../lib/engine";
import { initialBets, restoreBetConfig } from "../lib/new-round-bets";
import { calculateCounterBet, calculateLoba, emptyCounterBetKeepers, validateLobaHoleErrors } from "../lib/side-bets";
import { calculateSupplementalBets, createSupplementalBet } from "../lib/supplemental-bets";
import { buildPersonalOpponentResults } from "../lib/personal-opponents";
import type { Course, PersonalBet, Player, SupplementalBet } from "../lib/types";

const players: Player[] = [
  { id: "a", name: "Ana", handicap: 0 },
  { id: "b", name: "Beto", handicap: 8 },
  { id: "c", name: "Carla", handicap: 12 },
  { id: "d", name: "Diego", handicap: 16 },
  { id: "e", name: "Elena", handicap: 20 },
  { id: "f", name: "Fabián", handicap: 24 },
];

const order = Array.from({ length: 18 }, (_, index) => index + 1);
const course: Course = {
  id: "course",
  name: "Campo",
  teeName: "General",
  holes: order.map((number) => ({ number, par: 4, strokeIndex: number })),
};

function configuration(patch: Partial<RoundBetConfiguration> = {}): RoundBetConfiguration {
  const selectedPlayers = patch.players ?? players.slice(0, 4);
  return {
    players: selectedPlayers,
    ownerId: selectedPlayers[0]?.id ?? "",
    bets: initialBets(selectedPlayers.map((player) => player.id)),
    segments: segmentDefinitions(order, 6),
    personalBets: [],
    supplementalBets: [],
    manualBets: [],
    roundHoles: 18,
    startHole: 1,
    ...patch,
  };
}

function codes(input: RoundBetConfiguration) {
  return collectBetConfigurationIssues(input).map((issue) => issue.code);
}

function personalBet(patch: Partial<PersonalBet> = {}): PersonalBet {
  return {
    id: "personal-1",
    enabled: true,
    rivalMode: "group",
    rivalPlayerId: "b",
    rivalName: "",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "owner",
    advantageStrokes: 0,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: "holes_10_18",
    carryEnabled: false,
    components: { match1: true, medal1: false, match2: false, medal2: false, match18: false, medal18: false },
    ...patch,
  };
}

test("disabled configurations never block a score-only round", () => {
  const input = configuration();
  input.bets.rabbits.participantIds = [];
  input.bets.rabbits.value = -100;
  input.supplementalBets = [{ ...createSupplementalBet("vegas", input.players, "disabled-vegas"), enabled: false, participantIds: [] } as SupplementalBet];
  assert.deepEqual(collectBetConfigurationIssues(input), []);
});

test("group modes require at least two current participants and accept HCP 0", () => {
  const input = configuration();
  input.bets.rabbits = { ...input.bets.rabbits, enabled: true, participantIds: ["a"] };
  assert.ok(codes(input).includes("rabbits-participants"));

  input.bets.rabbits.participantIds = ["a", "b"];
  assert.equal(codes(input).includes("rabbits-participants"), false);
  assert.equal(codes(input).includes("active-bet-handicaps"), false);
});

test("active handicap bets identify missing HCP instead of treating it as zero", () => {
  const input = configuration({ players: [{ ...players[0], handicap: null }, players[1]] });
  input.bets.skins = { ...input.bets.skins, enabled: true, participantIds: ["a", "b"] };
  const issue = collectBetConfigurationIssues(input).find((item) => item.code === "active-bet-handicaps");
  assert.match(issue?.message ?? "", /Ana/);
});

test("Monkey requires exactly three distinct current players", () => {
  const input = configuration();
  input.bets.monkey = { enabled: true, value: 20, hcpPct: 100, participantIds: ["a", "b"] };
  assert.ok(codes(input).includes("monkey-participants"));

  input.bets.monkey.participantIds = ["a", "b", "c", "c"];
  assert.equal(codes(input).includes("monkey-participants"), false);
  assert.ok(codes(input).includes("monkey-participants-selection"));

  input.bets.monkey.participantIds = ["a", "b", "c"];
  assert.equal(codes(input).includes("monkey-participants-selection"), false);
});

test("Foursome requires playable participants and a base pair in every segment", () => {
  const input = configuration();
  input.bets.foursome = { ...input.bets.foursome, enabled: true, participantIds: ["a", "b", "c"] };
  assert.ok(codes(input).includes("foursome-pairs"));

  input.segments = input.segments.map((segment) => ({ ...segment, basePair: ["a", "b"] }));
  assert.equal(codes(input).includes("foursome-pairs"), false);
  assert.equal(codes(input).includes("foursome-participants"), false);

  input.segments[0].basePair = ["a", "b", "b"];
  assert.ok(codes(input).includes("foursome-pairs"));

  input.segments[0].basePair = undefined as unknown as string[];
  assert.doesNotThrow(() => collectBetConfigurationIssues(input));
  assert.ok(codes(input).includes("foursome-pairs"));

  input.segments = [null as unknown as (typeof input.segments)[number]];
  assert.doesNotThrow(() => collectBetConfigurationIssues(input));
  assert.ok(codes(input).includes("foursome-pairs"));
});

test("Bola Amiga accepts four or five participants but rejects an impossible larger group", () => {
  const input = configuration({ players });
  input.bets.ballFriend = { ...input.bets.ballFriend, enabled: true, participantIds: players.slice(0, 5).map((player) => player.id) };
  assert.equal(codes(input).includes("ball-friend-participants"), false);

  input.bets.ballFriend.participantIds = players.map((player) => player.id);
  assert.ok(codes(input).includes("ball-friend-participants"));
});

test("Polla validates first and second played halves for a nine-hole round", () => {
  const input = configuration({ roundHoles: 9, startHole: 1 });
  input.bets.polla.first9 = { ...input.bets.polla.first9, enabled: true, participantIds: ["a", "b"] };
  input.bets.polla.second9 = { ...input.bets.polla.second9, enabled: true, participantIds: ["a", "b"] };
  input.bets.polla.total18 = { ...input.bets.polla.total18, enabled: true, participantIds: ["a", "b"] };
  const firstNineCodes = codes(input);
  assert.equal(firstNineCodes.includes("polla-first-availability"), false);
  assert.ok(firstNineCodes.includes("polla-second-availability"));
  assert.ok(firstNineCodes.includes("polla-total-availability"));

  input.startHole = 10;
  const secondNineCodes = codes(input);
  assert.equal(secondNineCodes.includes("polla-first-availability"), false);
  assert.ok(secondNineCodes.includes("polla-second-availability"));
});

test("Vegas and team pressures validate their exact team shapes", () => {
  const input = configuration();
  const vegas = createSupplementalBet("vegas", input.players, "vegas") as Extract<SupplementalBet, { type: "vegas" }>;
  vegas.participantIds = ["a", "b", "c"];
  const team = createSupplementalBet("team_pressures", input.players, "team") as Extract<SupplementalBet, { type: "team_pressures" }>;
  team.participantIds = ["a", "b", "c", "d"];
  team.teamA = ["a"];
  input.supplementalBets = [vegas, team];
  let currentCodes = codes(input);
  assert.ok(currentCodes.includes("supplemental-vegas-participants"));
  assert.ok(currentCodes.includes("supplemental-team-team"));

  vegas.participantIds = ["a", "b", "c", "d"];
  vegas.teamA = ["a", "b"];
  team.teamA = ["a", "b"];
  currentCodes = codes(input);
  assert.equal(currentCodes.includes("supplemental-vegas-participants"), false);
  assert.equal(currentCodes.includes("supplemental-vegas-team"), false);
  assert.equal(currentCodes.includes("supplemental-team-team"), false);

  team.virtualMode = "mudo";
  team.participantIds = ["a", "b", "c"];
  assert.equal(codes(input).includes("supplemental-team-participants"), false);
});

test("head-to-head and Minimum Putts cannot start with unusable participants or duration", () => {
  const input = configuration({ roundHoles: 9 });
  const stroke = createSupplementalBet("dollar_stroke", input.players, "stroke") as Extract<SupplementalBet, { type: "dollar_stroke" }>;
  stroke.playerBId = stroke.playerAId;
  const putts = createSupplementalBet("minimum_putts", input.players, "putts", 18) as Extract<SupplementalBet, { type: "minimum_putts" }>;
  putts.holes = 18;
  putts.participantIds = ["a"];
  input.supplementalBets = [stroke, putts];
  const currentCodes = codes(input);
  assert.ok(currentCodes.includes("supplemental-stroke-players"));
  assert.ok(currentCodes.includes("supplemental-putts-participants"));
  assert.ok(currentCodes.includes("supplemental-putts-holes"));
});

test("personal and manual wagers must resolve a rival, an active component and a zero-sum ledger", () => {
  const input = configuration();
  input.personalBets = [personalBet({ rivalPlayerId: "a", components: { match1: false, medal1: false, match2: false, medal2: false, match18: false, medal18: false } })];
  input.manualBets = [{ id: "manual", enabled: true, name: "Apuesta directa", amounts: { a: 100, b: -50 } }];
  const currentCodes = codes(input);
  assert.ok(currentCodes.includes("personal-personal-1-rival"));
  assert.ok(currentCodes.includes("personal-personal-1-components"));
  assert.ok(currentCodes.includes("manual-manual-balance"));

  input.manualBets = [{ id: "manual", enabled: true, name: "   ", amounts: { a: 100, b: -100 } }];
  assert.ok(codes(input).includes("manual-manual-name"));

  input.personalBets = [personalBet()];
  input.manualBets[0].name = "Apuesta directa";
  input.manualBets[0].amounts = { a: 100, b: -100 };
  assert.equal(collectBetConfigurationIssues(input).length, 0);

  input.manualBets[0].amounts = { a: 100, b: -99.99995 };
  assert.ok(codes(input).includes("manual-manual-balance"));
});

test("18-hole Personal and individual Nassau ignore unsupported component-map keys", () => {
  const disabledKnownComponents = {
    match1: false,
    medal1: false,
    match2: false,
    medal2: false,
    match18: false,
    medal18: false,
  };
  const unsupportedOnly = { ...disabledKnownComponents, legacyBonus: true } as PersonalBet["components"] & { legacyBonus: boolean };
  const input = configuration({ roundHoles: 18 });
  input.personalBets = [personalBet({ components: unsupportedOnly })];
  const nassau = createSupplementalBet("individual_nassau", input.players, "nassau-extra-component") as Extract<SupplementalBet, { type: "individual_nassau" }>;
  nassau.components = unsupportedOnly;
  input.supplementalBets = [nassau];

  let currentCodes = codes(input);
  assert.ok(currentCodes.includes("personal-personal-1-components"));
  assert.ok(currentCodes.includes("supplemental-nassau-extra-component-components"));

  input.personalBets[0].components = { ...unsupportedOnly, match18: true };
  nassau.components = { ...unsupportedOnly, medal2: true };
  currentCodes = codes(input);
  assert.equal(currentCodes.includes("personal-personal-1-components"), false);
  assert.equal(currentCodes.includes("supplemental-nassau-extra-component-components"), false);
});

test("serialized negative ordinary stakes are rejected before the round starts", () => {
  const input = configuration();
  input.bets.units = { ...input.bets.units, enabled: true, participantIds: ["a", "b"], value: -1 };
  const issue = collectBetConfigurationIssues(input).find((item) => item.code === "units-stake");
  assert.match(issue?.message ?? "", /no puede ser negativo/);
});

test("Polla and Mini Polla reject a zero value because their engines cannot complete it", () => {
  const input = configuration();
  input.bets.polla.first9 = { ...input.bets.polla.first9, enabled: true, participantIds: ["a", "b"], value: 0 };
  input.bets.miniPolla = { ...input.bets.miniPolla, enabled: true, participantIds: ["a", "b"], value: 0 };
  const currentCodes = codes(input);
  assert.ok(currentCodes.includes("polla-first-stake"));
  assert.ok(currentCodes.includes("mini-polla-positive-stake"));
});

test("corrupt percentages and duplicated team members cannot reach deterministic engines", () => {
  const input = configuration();
  input.bets.skins = { ...input.bets.skins, enabled: true, participantIds: ["a", "b"], hcpPct: 101 };
  const vegas = createSupplementalBet("vegas", input.players, "vegas-team") as Extract<SupplementalBet, { type: "vegas" }>;
  vegas.teamA = ["a", "a"];
  input.supplementalBets = [vegas];
  const currentCodes = codes(input);
  assert.ok(currentCodes.includes("skins-hcp"));
  assert.ok(currentCodes.includes("supplemental-vegas-team-team"));
});

test("Foursome Excel ignores an unused HCP percentage while configured mode validates it", () => {
  const input = configuration();
  input.bets.foursome = {
    ...input.bets.foursome,
    enabled: true,
    participantIds: ["a", "b", "c"],
    handicapMethod: "excel",
    hcpPct: Number.NaN,
  };
  input.segments = input.segments.map((segment) => ({ ...segment, basePair: ["a", "b"] }));
  assert.equal(codes(input).includes("foursome-hcp"), false);
  input.bets.foursome.handicapMethod = "configured";
  assert.ok(codes(input).includes("foursome-hcp"));
});

test("Chicago requires every scoring key in a persisted points object", () => {
  const keys = ["birdieOrBetter", "par", "bogey", "doubleBogeyOrWorse"] as const;
  for (const key of keys) {
    const input = configuration();
    const chicago = createSupplementalBet("chicago", input.players, `chicago-${key}`) as Extract<SupplementalBet, { type: "chicago" }>;
    delete (chicago.points as Partial<typeof chicago.points>)[key];
    input.supplementalBets = [chicago];
    assert.ok(codes(input).includes(`supplemental-chicago-${key}-points`));
  }
});

test("Foursome pressure and supplemental Nassau reject configurations that would settle as NaN or zero", () => {
  const input = configuration();
  input.bets.foursome = { ...input.bets.foursome, enabled: true, participantIds: ["a", "b", "c"], pressureMultiplier: Number.NaN as unknown as NonNullable<typeof input.bets.foursome.pressureMultiplier> };
  input.segments = input.segments.map((segment) => ({ ...segment, basePair: ["a", "b"] }));
  const nassau = createSupplementalBet("individual_nassau", input.players, "nassau-empty") as Extract<SupplementalBet, { type: "individual_nassau" }>;
  nassau.components = { match1: false, medal1: false, match2: false, medal2: false, match18: false, medal18: false };
  input.supplementalBets = [nassau];
  const currentCodes = codes(input);
  assert.ok(currentCodes.includes("foursome-pressure-multiplier"));
  assert.ok(currentCodes.includes("supplemental-nassau-empty-components"));
});

test("Loba with only two players cannot choose a partner and leave no opponent", () => {
  const errors = validateLobaHoleErrors({ lobaPlayerId: "a", mode: "partner", partnerId: "b", fireMultiplier: 1, unitCounts: {} }, ["a", "b"]);
  assert.match(errors.join(" "), /debe jugar sola/);
  assert.equal(validateLobaHoleErrors({ lobaPlayerId: "a", mode: "solo", fireMultiplier: 1, unitCounts: {} }, ["a", "b"]).length, 0);
});

test("partial persisted selections and mandatory HCP percentages fail closed without throwing", () => {
  const input = configuration();
  input.bets.skins = { ...input.bets.skins, enabled: true, participantIds: ["a", "b"] };
  input.bets.skins.hcpPct = undefined as unknown as number;
  input.bets.units = { ...input.bets.units, enabled: true, participantIds: undefined as unknown as string[] };
  assert.doesNotThrow(() => collectBetConfigurationIssues(input));
  const currentCodes = codes(input);
  assert.ok(currentCodes.includes("skins-hcp"));
  assert.ok(currentCodes.includes("units-participants-selection"));
  assert.ok(currentCodes.includes("units-participants"));

  const vegas = createSupplementalBet("vegas", input.players, "vegas-partial") as Extract<SupplementalBet, { type: "vegas" }>;
  vegas.teamA = undefined as unknown as string[];
  input.supplementalBets = [vegas];
  assert.doesNotThrow(() => collectBetConfigurationIssues(input));
  assert.ok(codes(input).includes("supplemental-vegas-partial-team"));

  vegas.participantIds = undefined as unknown as string[];
  assert.doesNotThrow(() => collectBetConfigurationIssues(input));
  assert.ok(codes(input).includes("supplemental-vegas-partial-participants-selection"));
});

test("legacy percentage fallbacks remain valid for Monkey, Loba and Chicago", () => {
  const input = configuration();
  input.bets.monkey = { enabled: true, value: 20, participantIds: ["a", "b", "c"] };
  input.bets.loba = { ...input.bets.loba, enabled: true, participantIds: ["a", "b"], hcpPct: undefined };
  const chicago = createSupplementalBet("chicago", input.players, "chicago-legacy") as Extract<SupplementalBet, { type: "chicago" }>;
  chicago.hcpPct = undefined;
  input.supplementalBets = [chicago];
  const currentCodes = codes(input);
  assert.equal(currentCodes.includes("monkey-hcp"), false);
  assert.equal(currentCodes.includes("loba-hcp"), false);
  assert.equal(currentCodes.includes("supplemental-chicago-legacy-hcp"), false);
});

test("fixed handicap bases reject corrupted snapshots but allow the legacy missing fallback", () => {
  const input = configuration();
  input.bets.foursome = { ...input.bets.foursome, enabled: true, participantIds: ["a", "b", "c"], baseMode: "fixed", fixedBaseHandicap: Number.NaN };
  input.segments = input.segments.map((segment) => ({ ...segment, basePair: ["a", "b"] }));
  input.bets.ballFriend = { ...input.bets.ballFriend, enabled: true, participantIds: ["a", "b", "c", "d"], baseMode: "fixed", fixedBaseHandicap: Number.NaN };
  let currentCodes = codes(input);
  assert.ok(currentCodes.includes("foursome-fixed-base"));
  assert.ok(currentCodes.includes("ball-friend-fixed-base"));

  input.bets.foursome.fixedBaseHandicap = undefined;
  input.bets.ballFriend.fixedBaseHandicap = undefined;
  currentCodes = codes(input);
  assert.equal(currentCodes.includes("foursome-fixed-base"), false);
  assert.equal(currentCodes.includes("ball-friend-fixed-base"), false);

  input.bets.foursome.fixedBaseHandicap = 54.1;
  input.bets.ballFriend.fixedBaseHandicap = -15.1;
  currentCodes = codes(input);
  assert.ok(currentCodes.includes("foursome-fixed-base"));
  assert.ok(currentCodes.includes("ball-friend-fixed-base"));

  input.bets.foursome.fixedBaseHandicap = 54;
  input.bets.ballFriend.fixedBaseHandicap = -15;
  currentCodes = codes(input);
  assert.equal(currentCodes.includes("foursome-fixed-base"), false);
  assert.equal(currentCodes.includes("ball-friend-fixed-base"), false);

  input.bets.foursome.fixedBaseHandicap = Number.NaN;
  input.bets.ballFriend.fixedBaseHandicap = Number.NaN;
  input.handicapBasis = "course";
  currentCodes = codes(input);
  assert.equal(currentCodes.includes("foursome-fixed-base"), false);
  assert.equal(currentCodes.includes("ball-friend-fixed-base"), false);
});

test("duplicate or blank round player identities fail before an engine receives them", () => {
  const duplicate = configuration({ players: [players[0], { ...players[1], id: "a" }, players[2], players[3]] });
  assert.ok(codes(duplicate).includes("round-player-identities"));
  const blank = configuration({ players: [{ ...players[0], id: "" }, players[1]] });
  assert.ok(codes(blank).includes("round-player-identities"));
});

test("active wager instance identities are nonblank and unique within each collection", () => {
  const personal = configuration({ personalBets: [personalBet({ id: "same" }), personalBet({ id: "same", rivalPlayerId: "c" })] });
  assert.ok(codes(personal).includes("personal-identities"));

  const supplementalBet = createSupplementalBet("dollar_stroke", players, "same");
  const supplemental = configuration({ supplementalBets: [supplementalBet, { ...supplementalBet }] });
  assert.ok(codes(supplemental).includes("supplemental-identities"));

  const amounts = Object.fromEntries(players.slice(0, 4).map((player) => [player.id, 0]));
  const manual = configuration({ manualBets: [{ id: "", enabled: true, name: "Manual", amounts }] });
  assert.ok(codes(manual).includes("manual-identities"));

  const disabled = configuration({ personalBets: [personalBet({ id: "same", enabled: false }), personalBet({ id: "same", enabled: false })] });
  assert.equal(codes(disabled).includes("personal-identities"), false);
});

test("active wager identities cannot collide across collections", () => {
  const supplemental = createSupplementalBet("individual_nassau", players, "shared-id");
  const input = configuration({
    personalBets: [personalBet({ id: "shared-id" })],
    supplementalBets: [supplemental],
  });
  assert.ok(codes(input).includes("wager-identities"));

  input.supplementalBets = [createSupplementalBet("dollar_stroke", players, "shared-id")];
  assert.equal(codes(input).includes("wager-identities"), false);
});

test("legacy nested bet containers restore safely without changing legacy HCP base semantics", () => {
  const defaults = initialBets(["a", "b"]);
  const restored = restoreBetConfig({
    units: null,
    ballFriend: { ...defaults.ballFriend, baseMode: undefined },
    foursome: { ...defaults.foursome, baseMode: undefined },
  } as unknown as Partial<typeof defaults>, ["a", "b"], { startHole: 1, roundHoles: 18 });
  assert.ok(restored.units && restored.ballFriend && restored.foursome);
  assert.equal(restored.ballFriend.baseMode, undefined);
  assert.equal(restored.foursome.baseMode, undefined);

  const corrupt = restoreBetConfig({ units: null, ballFriend: null } as unknown as Partial<typeof defaults>, ["a", "b"], { startHole: 1, roundHoles: 18 });
  assert.deepEqual(corrupt.units, defaults.units);
  assert.deepEqual(corrupt.ballFriend, defaults.ballFriend);
});

test("restoring an active partial mode never invents participants, stakes or HCP terms", () => {
  const restored = restoreBetConfig({
    units: { enabled: true },
    rabbits: { enabled: true },
    skins: { enabled: true },
  } as unknown as Partial<ReturnType<typeof initialBets>>, ["a", "b"], { startHole: 1, roundHoles: 18 });
  assert.deepEqual(restored.units.participantIds, []);
  assert.equal(restored.units.value, undefined);
  assert.deepEqual(restored.rabbits.participantIds, []);
  assert.equal(restored.rabbits.value, undefined);
  assert.equal(restored.rabbits.hcpPct, undefined);
  assert.equal(restored.rabbits.decimals, undefined);
  assert.equal(restored.rabbits.accumulate, undefined);
  assert.deepEqual(restored.skins.participantIds, []);
  assert.equal(restored.skins.value, undefined);
  assert.equal(restored.skins.hcpPct, undefined);
  assert.equal(restored.skins.decimals, undefined);
  assert.equal(restored.skins.accumulate, undefined);

  const currentCodes = codes(configuration({ players: players.slice(0, 2), bets: restored }));
  assert.ok(currentCodes.includes("units-participants"));
  assert.ok(currentCodes.includes("units-stake"));
  assert.ok(currentCodes.includes("rabbits-participants"));
  assert.ok(currentCodes.includes("rabbits-stake"));
  assert.ok(currentCodes.includes("rabbits-hcp"));
  assert.ok(currentCodes.includes("rabbits-decimals"));
  assert.ok(currentCodes.includes("skins-participants"));
  assert.ok(currentCodes.includes("skins-stake"));
  assert.ok(currentCodes.includes("skins-hcp"));
  assert.ok(currentCodes.includes("skins-decimals"));
});

test("legacy Polla from H10 migrates physical nines to played halves exactly once", () => {
  const legacy = initialBets(["a", "b"]);
  legacy.polla.first9 = { ...legacy.polla.first9, enabled: true, value: 111, participantIds: ["a", "b"] };
  legacy.polla.second9 = { ...legacy.polla.second9, enabled: true, value: 222, participantIds: ["b", "a"] };
  delete legacy.polla.first9.playedHalfVersion;
  const original = structuredClone(legacy);

  const restored = restoreBetConfig(legacy, ["a", "b"], { startHole: 10, roundHoles: 18 });
  assert.equal(restored.polla.first9.value, 222);
  assert.deepEqual(restored.polla.first9.participantIds, ["b", "a"]);
  assert.equal(restored.polla.second9.value, 111);
  assert.deepEqual(restored.polla.second9.participantIds, ["a", "b"]);
  assert.equal(restored.polla.first9.playedHalfVersion, 1);
  assert.deepEqual(legacy, original);

  const restoredAgain = restoreBetConfig(restored, ["a", "b"], { startHole: 10, roundHoles: 18 });
  assert.equal(restoredAgain.polla.first9.value, 222);
  assert.equal(restoredAgain.polla.second9.value, 111);
});

test("legacy nine-hole Polla from H10 activates only the played first half", () => {
  const legacy = initialBets(["a", "b"]);
  legacy.polla.first9 = { ...legacy.polla.first9, enabled: false, value: 111 };
  legacy.polla.second9 = { ...legacy.polla.second9, enabled: true, value: 222 };
  delete legacy.polla.first9.playedHalfVersion;

  const restored = restoreBetConfig(legacy, ["a", "b"], { startHole: 10, roundHoles: 9 });
  assert.equal(restored.polla.first9.enabled, true);
  assert.equal(restored.polla.first9.value, 222);
  assert.equal(restored.polla.second9.enabled, false);
  assert.equal(restored.polla.second9.value, 111);
  assert.equal(codes(configuration({ bets: restored, startHole: 10, roundHoles: 9 })).includes("polla-first-availability"), false);
  assert.equal(codes(configuration({ bets: restored, startHole: 10, roundHoles: 9 })).includes("polla-second-availability"), false);
});

test("legacy H10 Polla preserves active invalid components so settlement fails closed", () => {
  const defaults = initialBets(["a", "b"]);
  const legacy = {
    ...defaults,
    polla: {
      first9: { ...defaults.polla.first9, enabled: true, value: 111 },
      second9: { enabled: true },
      total18: defaults.polla.total18,
    },
  } as unknown as ReturnType<typeof initialBets>;
  delete legacy.polla.first9.playedHalfVersion;

  const restored = restoreBetConfig(legacy, ["a", "b"], { startHole: 10, roundHoles: 9 });
  assert.deepEqual(restored.polla.first9.participantIds, []);
  assert.equal(restored.polla.first9.value, undefined);
  assert.equal(restored.polla.first9.hcpPct, undefined);
  assert.equal(restored.polla.first9.decimals, undefined);
  const currentCodes = codes(configuration({ players: players.slice(0, 2), bets: restored, startHole: 10, roundHoles: 9 }));
  assert.ok(currentCodes.includes("polla-first-participants"));
  assert.ok(currentCodes.includes("polla-first-invalid-stake"));
  assert.ok(currentCodes.includes("polla-first-hcp"));
  assert.ok(currentCodes.includes("polla-first-decimals"));
  assert.ok(currentCodes.includes("polla-second-availability"));
});

test("flat legacy Polla maps H10 values by play order and disables unavailable categories", () => {
  const flat = {
    enabled: true,
    first9Value: 111,
    second9Value: 222,
    total18Value: 333,
    hcpPct: 80,
    decimals: "partial",
    participantIds: ["a", "b"],
  };
  const eighteen = restoreBetConfig({ polla: flat } as unknown as Partial<ReturnType<typeof initialBets>>, ["a", "b"], { startHole: 10, roundHoles: 18 });
  assert.deepEqual([eighteen.polla.first9.value, eighteen.polla.second9.value, eighteen.polla.total18.value], [222, 111, 333]);
  assert.deepEqual([eighteen.polla.first9.enabled, eighteen.polla.second9.enabled, eighteen.polla.total18.enabled], [true, true, true]);

  const nine = restoreBetConfig({ polla: flat } as unknown as Partial<ReturnType<typeof initialBets>>, ["a", "b"], { startHole: 10, roundHoles: 9 });
  assert.deepEqual([nine.polla.first9.value, nine.polla.second9.value], [222, 111]);
  assert.deepEqual([nine.polla.first9.enabled, nine.polla.second9.enabled, nine.polla.total18.enabled], [true, false, false]);

  const invalid = restoreBetConfig({ polla: { ...flat, second9Value: null } } as unknown as Partial<ReturnType<typeof initialBets>>, ["a", "b"], { startHole: 10, roundHoles: 9 });
  assert.equal((invalid.polla.first9 as unknown as { value: unknown }).value, null);
  assert.ok(codes(configuration({ players: players.slice(0, 2), bets: invalid, startHole: 10, roundHoles: 9 })).includes("polla-first-invalid-stake"));
});

test("Personal rejects an unknown rival mode and advantage strokes without a receiver", () => {
  const input = configuration({ personalBets: [personalBet({ rivalMode: "corrupt" as PersonalBet["rivalMode"] })] });
  assert.ok(codes(input).includes("personal-personal-1-rival-mode"));

  input.personalBets = [personalBet({ advantageStrokes: 3, advantageReceiver: "none" })];
  assert.ok(codes(input).includes("personal-personal-1-advantage-receiver"));

  input.personalBets = [personalBet({ advantageStrokes: 2.5 })];
  assert.ok(codes(input).includes("personal-personal-1-advantage"));
});

test("Personal externo rechaza una identidad de rival vacía o corrupta", () => {
  for (const externalRivalId of ["", "   ", " padded", "internal id", "trailing ", 42]) {
    const input = configuration({
      personalBets: [personalBet({
        rivalMode: "external",
        rivalPlayerId: undefined,
        rivalName: "Rival externo",
        externalRivalId: externalRivalId as string,
      })],
    });
    assert.ok(codes(input).includes("personal-personal-1-external-rival-id"), String(externalRivalId));
  }

  const legacyWithoutTemplate = configuration({
    personalBets: [personalBet({ rivalMode: "external", rivalPlayerId: undefined, rivalName: "Rival externo", externalRivalId: undefined })],
  });
  assert.equal(codes(legacyWithoutTemplate).includes("personal-personal-1-external-rival-id"), false);
});

test("stroke advantages and score caps must use whole strokes", () => {
  const input = configuration();
  input.bets.ballFriend = { ...input.bets.ballFriend, enabled: true, participantIds: ["a", "b", "c", "d"], maxScore: 8.5 };
  assert.ok(codes(input).includes("ball-friend-max-score"));

  const nassau = createSupplementalBet("individual_nassau", input.players, "fractional-nassau") as Extract<SupplementalBet, { type: "individual_nassau" }>;
  nassau.advantageStrokes = 2.5;
  const dollar = createSupplementalBet("dollar_stroke", input.players, "fractional-dollar") as Extract<SupplementalBet, { type: "dollar_stroke" }>;
  dollar.advantageStrokes = 1.5;
  const currentCodes = codes(configuration({ supplementalBets: [nassau, dollar] }));
  assert.ok(currentCodes.includes("supplemental-fractional-nassau-advantage"));
  assert.ok(currentCodes.includes("supplemental-fractional-dollar-advantage"));
});

test("personal Nassau rejects malformed pressure settings but preserves the legacy 1x fallback", () => {
  const input = configuration();
  input.personalBets = [personalBet({
    pressureMultiplier: Number.NaN as unknown as 1,
    pressureNine: "invalid" as unknown as PersonalBet["pressureNine"],
    components: { match1: true, medal1: false, match2: true, medal2: false, match18: false, medal18: false },
  })];
  let currentCodes = codes(input);
  assert.ok(currentCodes.includes("personal-personal-1-pressure-multiplier"));

  input.personalBets = [personalBet({ pressureMultiplier: Number.NaN as unknown as 1 })];
  currentCodes = codes(input);
  assert.equal(currentCodes.includes("personal-personal-1-pressure-multiplier"), false);

  input.personalBets = [personalBet({
    pressureMultiplier: undefined,
    back9Multiplier: undefined as unknown as number,
    pressureNine: undefined,
    components: { match1: true, medal1: false, match2: true, medal2: false, match18: false, medal18: false },
  })];
  currentCodes = codes(input);
  assert.equal(currentCodes.includes("personal-personal-1-pressure-multiplier"), false);
});

test("supplemental bets with a missing legacy enabled flag remain active for validation", () => {
  const bet = createSupplementalBet("individual_pressures", players, "legacy-enabled") as Extract<SupplementalBet, { type: "individual_pressures" }>;
  delete (bet as Partial<typeof bet>).enabled;
  bet.participantIds = ["a"];
  const currentCodes = codes(configuration({ supplementalBets: [bet] }));
  assert.ok(currentCodes.includes("supplemental-legacy-enabled-participants"));
});

test("hidden pressure settings never trap a nine-hole round or a 1x Foursome", () => {
  const input = configuration({ roundHoles: 9 });
  input.bets.foursome = { ...input.bets.foursome, enabled: true, participantIds: ["a", "b", "c"], pressureMultiplier: Number.NaN as unknown as 1, pressureNine: "invalid" as unknown as PersonalBet["pressureNine"] };
  input.segments = segmentDefinitions(order.slice(0, 9), 6).map((segment) => ({ ...segment, basePair: ["a", "b"] }));
  input.personalBets = [personalBet({ pressureMultiplier: Number.NaN as unknown as 1 })];
  let currentCodes = codes(input);
  assert.equal(currentCodes.includes("foursome-pressure-multiplier"), false);
  assert.equal(currentCodes.includes("foursome-pressure-nine"), false);
  assert.equal(currentCodes.includes("personal-personal-1-pressure-multiplier"), false);

  input.roundHoles = 18;
  input.bets.foursome.pressureMultiplier = 1;
  input.segments = segmentDefinitions(order, 6).map((segment) => ({ ...segment, basePair: ["a", "b"] }));
  currentCodes = codes(input);
  assert.equal(currentCodes.includes("foursome-pressure-nine"), false);
  input.bets.foursome.pressureMultiplier = 2;
  assert.ok(codes(input).includes("foursome-pressure-nine"));
});

test("team pressure abandonment data is safe and only requires a max when used", () => {
  const input = configuration();
  const team = createSupplementalBet("team_pressures", input.players, "team-abandoned") as Extract<SupplementalBet, { type: "team_pressures" }>;
  team.abandonedPlayerIds = {} as unknown as string[];
  input.supplementalBets = [team];
  assert.ok(codes(input).includes("supplemental-team-abandoned-abandoned"));

  const completeScores = Object.fromEntries(order.map((hole) => [hole, Object.fromEntries(input.players.map((player) => [player.id, 4]))]));
  assert.doesNotThrow(() => calculateSupplementalBets([team], input.players, course, completeScores, {}, order));

  team.abandonedPlayerIds = [];
  team.abandonedMaxScore = Number.NaN;
  assert.equal(codes(input).includes("supplemental-team-abandoned-max-score"), false);
  team.abandonedPlayerIds = ["a"];
  assert.ok(codes(input).includes("supplemental-team-abandoned-max-score"));
  team.abandonedMaxScore = 8.5;
  assert.ok(codes(input).includes("supplemental-team-abandoned-max-score"));
});

test("runtime calculators fail closed for malformed persisted nested shapes", () => {
  const input = configuration();
  input.bets.foursome = { ...input.bets.foursome, enabled: true, participantIds: ["a", "b", "c"] };
  const malformedSegments = [{ ...segmentDefinitions(order, 18)[0], basePair: undefined as unknown as string[] }];
  assert.doesNotThrow(() => calculateFoursomes(course, {}, input.players, input.bets.foursome, malformedSegments, order));
  assert.deepEqual(normalizeFoursomeSegments([null], order, 6).map((segment) => segment.basePair), [[], [], []]);

  const team = createSupplementalBet("team_pressures", input.players, "team-runtime") as Extract<SupplementalBet, { type: "team_pressures" }>;
  team.teamA = undefined as unknown as string[];
  const vegas = createSupplementalBet("vegas", input.players, "vegas-runtime") as Extract<SupplementalBet, { type: "vegas" }>;
  vegas.teamA = undefined as unknown as string[];
  const individual = createSupplementalBet("individual_pressures", input.players, "individual-runtime") as Extract<SupplementalBet, { type: "individual_pressures" }>;
  individual.participantIds = undefined as unknown as string[];
  const chicago = createSupplementalBet("chicago", input.players, "chicago-runtime") as Extract<SupplementalBet, { type: "chicago" }>;
  delete (chicago.points as Partial<typeof chicago.points>).birdieOrBetter;
  const malformedSupplemental = [team, vegas, individual, chicago];
  assert.doesNotThrow(() => calculateSupplementalBets(malformedSupplemental, input.players, course, {}, {}, order));
  const supplementalResult = calculateSupplementalBets(malformedSupplemental, input.players, course, {}, {}, order);
  assert.ok(Object.values(supplementalResult.balances).every(Number.isFinite));
  const completeScores = Object.fromEntries(order.map((hole) => [hole, Object.fromEntries(input.players.map((player) => [player.id, 4]))]));
  const malformedChicago = calculateSupplementalBets([chicago], input.players, course, completeScores, {}, order).results[0];
  assert.equal(malformedChicago.complete, false);
  assert.ok(Object.values(malformedChicago.balances).every(Number.isFinite));
  assert.doesNotThrow(() => buildPersonalOpponentResults({ ownerId: "a", players: input.players, course, scores: {}, putts: {}, order, canonicalResults: [], personalBets: [], supplementalBets: [individual] }));

  const manual = { id: "manual-runtime", enabled: true, name: undefined as unknown as string, amounts: undefined as unknown as Record<string, number> };
  assert.doesNotThrow(() => calculateManualBets(input.players, [manual]));
  assert.ok(codes(configuration({ manualBets: [manual] })).includes("manual-manual-runtime-amount"));

  const counter = { ...input.bets.vipers, enabled: true, participantIds: undefined as unknown as string[] };
  const loba = { ...input.bets.loba, enabled: true, participantIds: undefined as unknown as string[] };
  assert.doesNotThrow(() => calculateCounterBet("vipers", input.players, counter, [], emptyCounterBetKeepers(), order));
  assert.doesNotThrow(() => calculateLoba(course, {}, input.players, loba, {}, order));
});

test("Foursome segment repair preserves valid pairs without sharing mutable arrays", () => {
  const pair = ["a", "b"];
  const existing = segmentDefinitions(order, 6).map((segment, index) => ({
    ...segment,
    basePair: index === 0 ? pair : ["b", "c"],
  }));
  const repaired = normalizeFoursomeSegments([...existing, { id: "stale", basePair: ["c", "d"] }], order.slice(0, 9), 3);

  assert.equal(repaired.length, 3);
  assert.deepEqual(repaired.map((segment) => segment.basePair), [["a", "b"], ["b", "c"], ["b", "c"]]);
  assert.notEqual(repaired[0].basePair, pair);
  repaired[0].basePair[0] = "d";
  assert.deepEqual(pair, ["a", "b"]);

  const expanded = normalizeFoursomeSegments(repaired.slice(0, 1), order, 6);
  assert.equal(expanded.length, 3);
  assert.deepEqual(expanded.map((segment) => segment.basePair), [["d", "b"], [], []]);
});

test("the setup gate renders every issue before consent, HCP freezing or round navigation", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /collectBetConfigurationIssues\(\{/);
  assert.match(page, /id="round-bet-validation" className="notice bad" role="alert"/);
  const setupGateRegion = page.indexOf('id="round-bet-validation"');
  const gate = page.indexOf("if (betConfigurationIssues.length)", setupGateRegion);
  const blockedReturn = page.indexOf("return;", gate);
  const start = page.indexOf("const start = () =>", gate);
  const consent = page.indexOf("runAfterBettingConsent(start)", gate);
  const navigation = page.indexOf('setTab("round")', gate);
  assert.ok(gate > setupGateRegion && blockedReturn > gate && start > blockedReturn && consent > start && navigation > start);
  assert.match(page, /extraErrors:\s*\[[\s\S]*betConfigurationIssues\.map\(\(issue\) => issue\.message\)/);
  assert.match(page, /function saveRound\(\) \{\s*if \(betConfigurationIssues\.length\)[\s\S]*?setTab\("setup"\);[\s\S]*?return;/);
  assert.match(page, /activeBetSafeDestination\(next, draftAvailable && !roundClosed && betConfigurationIssues\.length > 0\)/);
  assert.match(page, /activeBetSafeDestination\(tab, draftAvailable && !roundClosed && betConfigurationIssues\.length > 0\)/);
  assert.match(page, /handicapBasis: roundHandicapBasis/);
  assert.match(page, /function manualBetIsValid\(bet: ManualBet\) \{\s*return typeof bet\.name === "string"[\s\S]*?&& isFiniteZeroSum/);
  assert.match(page, /Escribe un nombre para la apuesta/);
  assert.match(page, /types=\{\["individual_nassau"\]\}[\s\S]*allowAdd=\{false\}/);
  assert.match(page, /onClick=\{handlePageBack\}/);

  const navigationHook = readFileSync("app/components/use-screen-navigation.ts", "utf8");
  assert.match(navigationHook, /const target = guard\.current\(requested\)/);
  assert.match(navigationHook, /const target = guard\.current\(next\)/);
});

test("supplemental calculators fail closed for malformed required numeric fields", () => {
  const completeScores = Object.fromEntries(order.map((hole) => [hole, Object.fromEntries(players.slice(0, 4).map((player) => [player.id, 4]))]));
  const completePutts = Object.fromEntries(order.map((hole) => [hole, Object.fromEntries(players.slice(0, 4).map((player) => [player.id, 2]))]));
  const calculateAll = (bet: SupplementalBet) => calculateSupplementalBets([bet], players.slice(0, 4), course, completeScores, completePutts, order);
  const calculate = (bet: SupplementalBet) => calculateAll(bet).results[0];
  const assertFailsClosed = (bet: SupplementalBet) => {
    const calculation = calculateAll(bet);
    const result = calculation.results[0];
    assert.equal(result.complete, false);
    assert.ok(Object.values(result.balances).every(Number.isFinite));
    assert.ok(Object.values(calculation.balances).every(Number.isFinite));
  };

  const dollarStroke = createSupplementalBet("dollar_stroke", players, "numeric-dollar") as Extract<SupplementalBet, { type: "dollar_stroke" }>;
  dollarStroke.valuePerStroke = Number.NaN;
  assertFailsClosed(dollarStroke);
  const dollarAdvantage = createSupplementalBet("dollar_stroke", players, "numeric-dollar-advantage") as Extract<SupplementalBet, { type: "dollar_stroke" }>;
  dollarAdvantage.advantageStrokes = 1.5;
  assertFailsClosed(dollarAdvantage);
  const dollarReceiver = { ...dollarAdvantage, id: "numeric-dollar-receiver", advantageStrokes: 1, advantageReceiverId: "missing" };
  assertFailsClosed(dollarReceiver);

  const nassauValue = createSupplementalBet("individual_nassau", players, "numeric-nassau-value") as Extract<SupplementalBet, { type: "individual_nassau" }>;
  nassauValue.value = Number.POSITIVE_INFINITY;
  assertFailsClosed(nassauValue);
  const nassauAdvantage = createSupplementalBet("individual_nassau", players, "numeric-nassau-advantage") as Extract<SupplementalBet, { type: "individual_nassau" }>;
  nassauAdvantage.advantageStrokes = Number.NaN;
  assertFailsClosed(nassauAdvantage);
  const nassauReceiver = { ...nassauAdvantage, id: "numeric-nassau-receiver", advantageStrokes: 1, advantageReceiverId: "missing" };
  assertFailsClosed(nassauReceiver);
  const nassauComponents = createSupplementalBet("individual_nassau", players, "numeric-nassau-components") as Extract<SupplementalBet, { type: "individual_nassau" }>;
  nassauComponents.components = {} as typeof nassauComponents.components;
  assertFailsClosed(nassauComponents);

  for (const [field, value] of [["value", Number.POSITIVE_INFINITY], ["hcpPct", Number.NaN]] as const) {
    const pressures = createSupplementalBet("individual_pressures", players, `numeric-individual-${field}`) as Extract<SupplementalBet, { type: "individual_pressures" }>;
    pressures[field] = value;
    assertFailsClosed(pressures);
  }

  for (const [field, value] of [["value", Number.NaN], ["hcpPct", Number.NEGATIVE_INFINITY]] as const) {
    const team = createSupplementalBet("team_pressures", players, `numeric-team-${field}`) as Extract<SupplementalBet, { type: "team_pressures" }>;
    team[field] = value;
    assertFailsClosed(team);
  }
  const unusedAbandonedScore = createSupplementalBet("team_pressures", players, "numeric-team-unused-abandoned") as Extract<SupplementalBet, { type: "team_pressures" }>;
  unusedAbandonedScore.abandonedMaxScore = Number.NaN;
  const decisiveTeamScores = Object.fromEntries(order.map((hole) => [hole, { a: 3, b: 4, c: 5, d: 6 }]));
  assert.equal(calculateSupplementalBets([unusedAbandonedScore], players.slice(0, 4), course, decisiveTeamScores, completePutts, order).results[0].complete, true);
  const usedAbandonedScore = { ...unusedAbandonedScore, id: "numeric-team-used-abandoned", abandonedPlayerIds: ["a"] };
  assertFailsClosed(usedAbandonedScore);
  const fractionalAbandonedScore = { ...unusedAbandonedScore, id: "numeric-team-fractional-abandoned", abandonedPlayerIds: ["a"], abandonedMaxScore: 7.5 };
  assertFailsClosed(fractionalAbandonedScore);

  const chicagoFields = ["valuePerPoint", "quotaBase", "birdieOrBetter", "par", "bogey", "doubleBogeyOrWorse"] as const;
  for (const field of chicagoFields) {
    const chicago = createSupplementalBet("chicago", players, `numeric-chicago-${field}`) as Extract<SupplementalBet, { type: "chicago" }>;
    if (field === "valuePerPoint" || field === "quotaBase") chicago[field] = Number.NaN;
    else chicago.points[field] = Number.NaN;
    assertFailsClosed(chicago);
  }

  for (const [field, value] of [["valuePerUnit", Number.POSITIVE_INFINITY], ["hcpPct", Number.NaN]] as const) {
    const vegas = createSupplementalBet("vegas", players, `numeric-vegas-${field}`) as Extract<SupplementalBet, { type: "vegas" }>;
    vegas[field] = value;
    assertFailsClosed(vegas);
  }

  for (const ante of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const minimumPutts = createSupplementalBet("minimum_putts", players, `numeric-putts-${String(ante)}`) as Extract<SupplementalBet, { type: "minimum_putts" }>;
    minimumPutts.ante = ante;
    assertFailsClosed(minimumPutts);
  }
  const minimumPuttsHoles = createSupplementalBet("minimum_putts", players, "numeric-putts-holes") as Extract<SupplementalBet, { type: "minimum_putts" }>;
  minimumPuttsHoles.holes = 12 as typeof minimumPuttsHoles.holes;
  assertFailsClosed(minimumPuttsHoles);

  const legacyEnabled = createSupplementalBet("dollar_stroke", players, "numeric-legacy-enabled") as Extract<SupplementalBet, { type: "dollar_stroke" }>;
  delete (legacyEnabled as Partial<typeof legacyEnabled>).enabled;
  assert.equal(calculate(legacyEnabled).complete, true);
});

test("hidden persisted main-bet fields follow the runtime fail-closed contract", () => {
  const cases: Array<{ code: string; mutate: (input: RoundBetConfiguration) => void }> = [
    {
      code: "rabbits-mode",
      mutate: (input) => { input.bets.rabbits = { ...input.bets.rabbits, enabled: true, mode: "unknown" as typeof input.bets.rabbits.mode }; },
    },
    {
      code: "rabbits-accumulate",
      mutate: (input) => { input.bets.rabbits = { ...input.bets.rabbits, enabled: true, mode: "continuous", accumulate: "yes" as unknown as boolean }; },
    },
    {
      code: "skins-mode",
      mutate: (input) => { input.bets.skins = { ...input.bets.skins, enabled: true, mode: "unknown" as typeof input.bets.skins.mode }; },
    },
    {
      code: "skins-accumulate",
      mutate: (input) => { input.bets.skins = { ...input.bets.skins, enabled: true, mode: undefined, accumulate: 1 as unknown as boolean }; },
    },
    {
      code: "foursome-base-mode",
      mutate: (input) => { input.bets.foursome = { ...input.bets.foursome, enabled: true, baseMode: "unknown" as typeof input.bets.foursome.baseMode }; },
    },
    {
      code: "foursome-press-second-nine",
      mutate: (input) => {
        input.bets.foursome = { ...input.bets.foursome, enabled: true, pressSecond9: "yes" as unknown as boolean };
        delete input.bets.foursome.pressureMultiplier;
      },
    },
    {
      code: "ball-friend-base-mode",
      mutate: (input) => { input.bets.ballFriend = { ...input.bets.ballFriend, enabled: true, baseMode: "unknown" as typeof input.bets.ballFriend.baseMode }; },
    },
  ];

  for (const { code, mutate } of cases) {
    const input = configuration();
    mutate(input);
    assert.ok(codes(input).includes(code), code);
  }

  const courseBasis = configuration();
  courseBasis.handicapBasis = "course";
  courseBasis.bets.foursome = { ...courseBasis.bets.foursome, enabled: true, baseMode: "unknown" as typeof courseBasis.bets.foursome.baseMode };
  courseBasis.bets.ballFriend = { ...courseBasis.bets.ballFriend, enabled: true, baseMode: "unknown" as typeof courseBasis.bets.ballFriend.baseMode };
  assert.equal(codes(courseBasis).includes("foursome-base-mode"), false);
  assert.equal(codes(courseBasis).includes("ball-friend-base-mode"), false);

  for (const kind of ["vipers", "camels", "fish"] as const) {
    const invalidPressed = configuration();
    invalidPressed.bets[kind] = { ...invalidPressed.bets[kind], enabled: true, secondNinePressed: "yes" as unknown as boolean };
    assert.ok(codes(invalidPressed).includes(`${kind}-second-nine-pressed`), `${kind} pressed`);

    for (const multiplier of [0, 1.5, 6, Number.NaN]) {
      const invalidMultiplier = configuration();
      invalidMultiplier.bets[kind] = { ...invalidMultiplier.bets[kind], enabled: true, secondNinePressed: true, secondNineMultiplier: multiplier };
      assert.ok(codes(invalidMultiplier).includes(`${kind}-second-nine-multiplier`), `${kind} ${String(multiplier)}`);
    }

    const ignoredMultiplier = configuration();
    ignoredMultiplier.bets[kind] = { ...ignoredMultiplier.bets[kind], enabled: true, secondNinePressed: false, secondNineMultiplier: Number.NaN };
    assert.equal(codes(ignoredMultiplier).includes(`${kind}-second-nine-multiplier`), false, `${kind} multiplier off`);
  }

  const ignoredRabbitFlag = configuration();
  ignoredRabbitFlag.bets.rabbits = { ...ignoredRabbitFlag.bets.rabbits, enabled: true, mode: "three_hole_blocks", accumulate: "legacy" as unknown as boolean };
  assert.equal(codes(ignoredRabbitFlag).includes("rabbits-accumulate"), false);

  for (const mode of ["carry", "no_carry"] as const) {
    const explicitSkinsMode = configuration();
    explicitSkinsMode.bets.skins = { ...explicitSkinsMode.bets.skins, enabled: true, mode, accumulate: "legacy" as unknown as boolean };
    assert.equal(codes(explicitSkinsMode).includes("skins-accumulate"), false, mode);
  }

  const legacyModes = configuration();
  legacyModes.bets.rabbits = { ...legacyModes.bets.rabbits, enabled: true, mode: undefined, accumulate: true };
  legacyModes.bets.skins = { ...legacyModes.bets.skins, enabled: true, mode: undefined, accumulate: true };
  assert.equal(codes(legacyModes).includes("rabbits-mode"), false);
  assert.equal(codes(legacyModes).includes("skins-mode"), false);
  assert.equal(codes(legacyModes).includes("rabbits-accumulate"), false);
  assert.equal(codes(legacyModes).includes("skins-accumulate"), false);

  const legacyCounterMultiplier = configuration();
  legacyCounterMultiplier.bets.vipers = { ...legacyCounterMultiplier.bets.vipers, enabled: true, secondNinePressed: undefined, secondNineMultiplier: 1 };
  assert.equal(codes(legacyCounterMultiplier).includes("vipers-second-nine-pressed"), false);
  assert.equal(codes(legacyCounterMultiplier).includes("vipers-second-nine-multiplier"), false);

  const nineHoleLegacyPressure = configuration({ roundHoles: 9 });
  nineHoleLegacyPressure.bets.foursome = { ...nineHoleLegacyPressure.bets.foursome, enabled: true, pressSecond9: "ignored" as unknown as boolean };
  delete nineHoleLegacyPressure.bets.foursome.pressureMultiplier;
  assert.equal(codes(nineHoleLegacyPressure).includes("foursome-press-second-nine"), false);

  const explicitPressure = configuration();
  explicitPressure.bets.foursome = { ...explicitPressure.bets.foursome, enabled: true, pressureMultiplier: 2, pressSecond9: "ignored" as unknown as boolean };
  assert.equal(codes(explicitPressure).includes("foursome-press-second-nine"), false);
});

test("round player identities reject blank, padded and internal whitespace", () => {
  for (const id of ["   ", " a", "a ", "a b", "\ta"]) {
    const input = configuration({ players: [{ ...players[0], id }, players[1]] });
    assert.ok(codes(input).includes("round-player-identities"), JSON.stringify(id));
  }
});

test("malformed enabled flags never bypass the configuration gate", () => {
  const mainCases = [
    ["rabbits", "rabbits-enabled"], ["skins", "skins-enabled"], ["units", "units-enabled"],
    ["foursome", "foursome-enabled"], ["ballFriend", "ball-friend-enabled"], ["miniPolla", "mini-polla-enabled"],
    ["vipers", "vipers-enabled"], ["camels", "camels-enabled"], ["fish", "fish-enabled"], ["loba", "loba-enabled"],
  ] as const;
  for (const [key, code] of mainCases) {
    const input = configuration();
    (input.bets as unknown as Record<string, { enabled: unknown }>)[key].enabled = "false";
    assert.ok(codes(input).includes(code), key);
  }

  for (const [key, code] of [["first9", "polla-first-enabled"], ["second9", "polla-second-enabled"], ["total18", "polla-total-enabled"]] as const) {
    const input = configuration();
    (input.bets.polla[key] as unknown as { enabled: unknown }).enabled = 1;
    assert.ok(codes(input).includes(code), key);
  }

  const monkey = configuration();
  (monkey.bets.monkey as unknown as { enabled: unknown }).enabled = "true";
  assert.ok(codes(monkey).includes("monkey-enabled"));

  const personal = personalBet();
  (personal as unknown as { enabled: unknown }).enabled = "false";
  assert.ok(codes(configuration({ personalBets: [personal] })).includes(`personal-${personal.id}-enabled`));

  const supplemental = createSupplementalBet("dollar_stroke", players, "bad-enabled");
  (supplemental as unknown as { enabled: unknown }).enabled = "false";
  assert.ok(codes(configuration({ supplementalBets: [supplemental] })).includes("supplemental-bad-enabled-enabled"));

  const manual = { id: "manual-enabled", enabled: 1 as unknown as boolean, name: "Manual", amounts: { a: 10, b: -10 } };
  assert.ok(codes(configuration({ manualBets: [manual] })).includes("manual-manual-enabled-enabled"));

  const legacy = configuration({
    personalBets: [personalBet({ enabled: undefined })],
    supplementalBets: [{ ...createSupplementalBet("dollar_stroke", players, "legacy-enabled"), enabled: undefined as unknown as boolean }],
    manualBets: [{ id: "legacy-manual", enabled: undefined, name: "Legacy", amounts: { a: 10, b: -10 } }],
  });
  assert.equal(codes(legacy).some((code) => code.endsWith("-enabled")), false);
});

test("money-changing boolean and handicap modes require exact persisted types", () => {
  const invalidUnitsFlag = configuration();
  invalidUnitsFlag.bets.loba = { ...invalidUnitsFlag.bets.loba, enabled: true, unitsEnabled: "false" as unknown as boolean };
  assert.ok(codes(invalidUnitsFlag).includes("loba-units-enabled"));

  const invalidDuplicateFlag = configuration();
  invalidDuplicateFlag.bets.loba = { ...invalidDuplicateFlag.bets.loba, enabled: true, unitsEnabled: true, duplicateUnitsByMode: "false" as unknown as boolean };
  assert.ok(codes(invalidDuplicateFlag).includes("loba-duplicate-units"));

  const ignoredDuplicateFlag = configuration();
  ignoredDuplicateFlag.bets.loba = { ...ignoredDuplicateFlag.bets.loba, enabled: true, unitsEnabled: false, duplicateUnitsByMode: "ignored" as unknown as boolean };
  assert.equal(codes(ignoredDuplicateFlag).includes("loba-duplicate-units"), false);

  for (const [key, code] of [["rabbits", "rabbits-decimals"], ["skins", "skins-decimals"]] as const) {
    const input = configuration();
    (input.bets[key] as unknown as { enabled: boolean; decimals: unknown }).enabled = true;
    (input.bets[key] as unknown as { enabled: boolean; decimals: unknown }).decimals = "unknown";
    assert.ok(codes(input).includes(code), key);
  }

  const supplementalCases: Array<{ type: SupplementalBet["type"]; field: string; code: string; value: unknown }> = [
    { type: "individual_nassau", field: "carryEnabled", code: "supplemental-bool-individual_nassau-carry", value: "false" },
    { type: "individual_pressures", field: "carryEnabled", code: "supplemental-bool-individual_pressures-carry", value: "false" },
    { type: "individual_pressures", field: "matchPlayEnabled", code: "supplemental-bool-individual_pressures-match-play", value: "false" },
    { type: "team_pressures", field: "carryEnabled", code: "supplemental-bool-team_pressures-carry", value: 1 },
    { type: "vegas", field: "birdiePenalty", code: "supplemental-bool-vegas-birdie-penalty", value: "false" },
  ];
  for (const entry of supplementalCases) {
    const bet = createSupplementalBet(entry.type, players, `bool-${entry.type}`);
    (bet as unknown as Record<string, unknown>)[entry.field] = entry.value;
    assert.ok(codes(configuration({ supplementalBets: [bet] })).includes(entry.code), `${entry.type}.${entry.field}`);
  }

  for (const type of ["individual_pressures", "team_pressures", "vegas"] as const) {
    const bet = createSupplementalBet(type, players, `mode-${type}`);
    (bet as unknown as { decimals: unknown }).decimals = "unknown";
    assert.ok(codes(configuration({ supplementalBets: [bet] })).includes(`supplemental-mode-${type}-decimals`), type);
  }

  const nassau = createSupplementalBet("individual_nassau", players, "boolean-components") as Extract<SupplementalBet, { type: "individual_nassau" }>;
  (nassau.components as unknown as Record<string, unknown>).match1 = "false";
  assert.ok(codes(configuration({ supplementalBets: [nassau] })).includes("supplemental-boolean-components-components"));
});

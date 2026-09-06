import assert from "node:assert/strict";
import test from "node:test";

import { collectBetConfigurationIssues, type RoundBetConfiguration } from "../lib/bet-config-validation";
import { segmentDefinitions } from "../lib/engine";
import { initialBets } from "../lib/new-round-bets";
import { migratePersonalNassau } from "../lib/personal-nassau";
import { normalizeRoundDraft } from "../lib/round-utils";
import type { PersonalBet, Player } from "../lib/types";

const players: Player[] = [
  { id: "owner", name: "Owner", handicap: 0 },
  { id: "rival", name: "Rival", handicap: 8 },
];

const validComponents = {
  match1: true,
  medal1: false,
  match2: true,
  medal2: false,
  match18: false,
  medal18: false,
};

function configuration(personalBets: PersonalBet[]): RoundBetConfiguration {
  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  return {
    players,
    ownerId: "owner",
    bets: initialBets(players.map((player) => player.id)),
    segments: segmentDefinitions(order, 6),
    personalBets,
    supplementalBets: [],
    manualBets: [],
    roundHoles: 18,
    startHole: 1,
  };
}

function issueCodes(personalBets: PersonalBet[]) {
  return collectBetConfigurationIssues(configuration(personalBets)).map((issue) => issue.code);
}

test("JSON V2 conserva campos Personal corruptos para que el collector los haga reparables", () => {
  const badMode = {
    id: "bad-mode",
    enabled: true,
    nassauVersion: 2,
    rivalMode: "invented-mode",
    rivalPlayerId: "rival",
    rivalName: "Rival",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "owner",
    advantageStrokes: 0,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: "holes_10_18",
    carryEnabled: false,
    components: validComponents,
  };
  const badGroupId = {
    ...badMode,
    id: "bad-group-id",
    rivalMode: "group",
    rivalPlayerId: 42,
  };
  const badExternalName = {
    ...badMode,
    id: "bad-external-name",
    rivalMode: "external",
    rivalName: 42,
  };
  const badComponents = {
    ...badMode,
    id: "bad-components",
    rivalMode: "group",
    components: null,
  };
  const badTerms = {
    ...badMode,
    id: "bad-terms",
    rivalMode: "group",
    baseValue: null,
    pressureMultiplier: null,
    carryEnabled: "yes",
  };
  const badPressureNine = {
    ...badMode,
    id: "bad-pressure-nine",
    rivalMode: "group",
    pressureMultiplier: 2,
    pressureNine: "third-nine",
  };
  const serialized = JSON.parse(JSON.stringify({
    version: 5,
    ownerId: "owner",
    players,
    roundHoles: 18,
    personalBets: [badMode, badGroupId, badExternalName, badComponents, badTerms, badPressureNine],
  }));

  const normalized = normalizeRoundDraft(serialized);
  const restored = normalized?.personalBets as PersonalBet[];

  assert.deepEqual(restored, serialized.personalBets);
  assert.deepEqual(migratePersonalNassau(restored[0], 1, 18), restored[0]);
  const codes = issueCodes(restored);
  assert.ok(codes.includes("personal-bad-mode-rival-mode"));
  assert.ok(codes.includes("personal-bad-group-id-rival"));
  assert.ok(codes.includes("personal-bad-external-name-rival"));
  assert.ok(codes.includes("personal-bad-components-components"));
  assert.ok(codes.includes("personal-bad-terms-stake"));
  assert.ok(codes.includes("personal-bad-terms-pressure-multiplier"));
  assert.ok(codes.includes("personal-bad-terms-carry"));
  assert.ok(codes.includes("personal-bad-pressure-nine-pressure-nine"));
});

test("JSON legacy conserva sus defaults históricos antes de llegar al collector", () => {
  const legacy = {
    id: "legacy",
    enabled: true,
    rivalPlayerId: "rival",
    rivalName: "Rival",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "owner",
    advantageStrokes: 0,
    back9Multiplier: 1,
  };
  const serialized = JSON.parse(JSON.stringify({
    version: 1,
    ownerId: "owner",
    players,
    roundHoles: 18,
    personalBets: [legacy],
  }));

  const normalized = normalizeRoundDraft(serialized);
  const restored = normalized?.personalBets[0] as PersonalBet;

  assert.equal(restored.nassauVersion, 2);
  assert.equal(restored.rivalMode, "group");
  assert.equal(restored.carryEnabled, false);
  assert.equal(restored.pressureMultiplier, 1);
  assert.equal(restored.pressureNine, "holes_10_18");
  assert.deepEqual(restored.components, {
    match1: true,
    medal1: true,
    match2: true,
    medal2: true,
    match18: true,
    medal18: true,
  });
  assert.deepEqual(issueCodes([restored]), []);
});

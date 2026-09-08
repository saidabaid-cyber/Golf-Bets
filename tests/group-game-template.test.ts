import assert from "node:assert/strict";
import test from "node:test";

import { accountPrimaryPlayerId } from "../lib/account-primary-player";
import {
  addFrequentGroupMember,
  parseFrequentGroups,
  serializeFrequentGroups,
  updateFrequentGroupMember,
} from "../lib/frequent-templates";
import {
  createGroupGameTemplate,
  instantiateGroupGameTemplate,
  updateGroupTemplateFromRound,
  type GroupTemplateDraftSource,
} from "../lib/group-game-template";
import { playOrder, segmentDefinitions } from "../lib/engine";
import { initialBets } from "../lib/new-round-bets";
import { createSupplementalBet } from "../lib/supplemental-bets";
import type { FrequentGroup, ManualBet, PersonalBet, Player } from "../lib/types";

const roundPlayers: Player[] = [
  { id: "round-owner", name: "Said", handicap: 8, accountUserId: "account-said" },
  { id: "round-pedro", name: "Pedro", handicap: 12 },
  { id: "round-juan", name: "Juan", handicap: 18 },
  { id: "round-carlos", name: "Carlos", handicap: 20 },
];

function configuredSource(): GroupTemplateDraftSource {
  const ids = roundPlayers.map((player) => player.id);
  const bets = initialBets(ids);
  bets.rabbits = { ...bets.rabbits, enabled: true, value: 175 };
  bets.foursome = { ...bets.foursome, enabled: true, fixedBaseHandicap: 8, participantIds: ids };
  bets.vipers = { ...bets.vipers, enabled: true, value: 75 };
  const segments = segmentDefinitions(playOrder(1), 6).map((segment) => ({ ...segment, basePair: ids.slice(0, 2) }));
  const personalBets: PersonalBet[] = [{
    id: "personal-round",
    enabled: true,
    enabledBeforeCategoryOff: true,
    rivalMode: "group",
    rivalPlayerId: "round-pedro",
    rivalName: "Pedro",
    externalScores: { 1: 4 },
    baseValue: 100,
    advantageReceiver: "rival",
    advantageStrokes: 1,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: "holes_10_18",
    nassauVersion: 2,
    carryEnabled: false,
    components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
  }];
  const teamPressure = createSupplementalBet("team_pressures", roundPlayers, "pressure-round", 18);
  const dollarStroke = createSupplementalBet("dollar_stroke", roundPlayers, "dollar-round", 18);
  const manualBets: ManualBet[] = [{
    id: "manual-round",
    enabled: true,
    enabledBeforeCategoryOff: true,
    name: "Greenies",
    amounts: { "round-owner": 100, "round-pedro": -100 },
  }];
  return {
    ownerId: "round-owner",
    players: structuredClone(roundPlayers),
    startHole: 1,
    roundHoles: 18,
    roundHandicapBasis: "relative",
    bets,
    segments,
    personalBets,
    supplementalBets: [teamPressure, dollarStroke],
    manualBets,
  };
}

const memberIdByPlayerId = {
  "round-owner": "member-owner",
  "round-pedro": "member-pedro",
  "round-juan": "member-juan",
  "round-carlos": "member-carlos",
};

function configuredGroup(): FrequentGroup {
  const source = configuredSource();
  return {
    id: "group-domingos",
    name: "Domingos",
    privacy: "invite_only",
    imageUrl: "https://example.com/domingo.jpg",
    players: [
      { memberId: "member-owner", kind: "account", name: "Said", handicap: 8, accountUserId: "account-said" },
      { memberId: "member-pedro", kind: "guest", name: "Pedro", handicap: 12 },
      { memberId: "member-juan", kind: "invited", name: "Juan", handicap: 18, email: "juan@example.com" },
      { memberId: "member-carlos", kind: "friend", name: "Carlos", handicap: 20, username: "carlosgolf" },
    ],
    gameTemplate: createGroupGameTemplate(source, memberIdByPlayerId),
    uses: 0,
    updatedAt: "2026-09-07T12:00:00.000Z",
  };
}

test("la plantilla guarda parámetros habituales y elimina resultados de la ronda", () => {
  const template = createGroupGameTemplate(configuredSource(), memberIdByPlayerId);
  assert.equal(template.ownerMemberId, "member-owner");
  assert.deepEqual(template.betConfig.rabbits.participantIds, Object.values(memberIdByPlayerId));
  assert.equal(template.betConfig.rabbits.value, 175);
  assert.equal(template.betConfig.foursome.fixedBaseHandicap, undefined);
  assert.deepEqual(template.foursomeSegments[0].basePair, ["member-owner", "member-pedro"]);
  assert.equal(template.personalBets[0].rivalPlayerId, "member-pedro");
  assert.deepEqual(template.personalBets[0].externalScores, {});
  assert.equal(template.personalBets[0].enabledBeforeCategoryOff, undefined);
  assert.deepEqual(template.manualBets[0].amounts, {
    "member-owner": 0,
    "member-pedro": 0,
    "member-juan": 0,
    "member-carlos": 0,
  });
  assert.equal(template.supplementalBets[0].type, "team_pressures");
  if (template.supplementalBets[0].type === "team_pressures") {
    assert.deepEqual(template.supplementalBets[0].abandonedPlayerIds, []);
    assert.deepEqual(template.supplementalBets[0].teamA, ["member-owner", "member-pedro"]);
  }
});

test("crear, guardar y recargar Domingos conserva roster, vínculos y apuestas", () => {
  const group = configuredGroup();
  const [restored] = parseFrequentGroups(serializeFrequentGroups([group]));
  assert.equal(restored.name, "Domingos");
  assert.equal(restored.players[0].accountUserId, "account-said");
  assert.equal(restored.players[2].email, "juan@example.com");
  assert.equal(restored.gameTemplate?.betConfig.vipers.value, 75);
  assert.equal(restored.gameTemplate?.personalBets[0].rivalPlayerId, "member-pedro");
});

test("instanciar el grupo remapea linked player, guests, parejas y apuestas a IDs de ronda", () => {
  let sequence = 0;
  const draft = instantiateGroupGameTemplate(configuredGroup(), () => `instance-${++sequence}`);
  assert.equal(draft.players[0].id, accountPrimaryPlayerId("account-said"));
  assert.notEqual(draft.players[1].id, "member-pedro");
  assert.equal(draft.origin.roundPlayerIdByMemberId["member-pedro"], draft.players[1].id);
  assert.deepEqual(draft.bets.rabbits.participantIds, draft.players.map((player) => player.id));
  assert.deepEqual(draft.segments[0].basePair, draft.players.slice(0, 2).map((player) => player.id));
  assert.equal(draft.personalBets[0].rivalPlayerId, draft.players[1].id);
  assert.notEqual(draft.personalBets[0].id, "personal-round");
  assert.deepEqual(draft.manualBets[0].amounts, Object.fromEntries(draft.players.map((player) => [player.id, 0])));
});

test("editar HCP y apuestas para una ronda no cambia silenciosamente la plantilla", () => {
  const group = configuredGroup();
  const before = JSON.stringify(group);
  let sequence = 0;
  const draft = instantiateGroupGameTemplate(group, () => `round-${++sequence}`);
  draft.players[1].handicap = 10;
  draft.bets.rabbits.value = 500;
  draft.personalBets[0].baseValue = 250;
  assert.equal(JSON.stringify(group), before);
  assert.equal(group.players[1].handicap, 12);
  assert.equal(group.gameTemplate?.betConfig.rabbits.value, 175);

  const saved = updateGroupTemplateFromRound(group, draft.origin, draft, "2026-09-07T13:00:00.000Z");
  assert.equal(saved.status, "updated");
  assert.equal(saved.group.gameTemplate?.betConfig.rabbits.value, 500);
  assert.equal(group.gameTemplate?.betConfig.rabbits.value, 175);
  const stale = updateGroupTemplateFromRound(saved.group, draft.origin, draft, "2026-09-07T14:00:00.000Z");
  assert.equal(stale.status, "stale");
});

test("grupo legacy sin apuestas abre con los defaults actuales", () => {
  const legacy: FrequentGroup = {
    id: "legacy",
    name: "Miércoles",
    players: [{ name: "Said", handicap: 8 }, { name: "Pedro", handicap: 12 }],
    uses: 4,
    updatedAt: "old",
  };
  let sequence = 0;
  const draft = instantiateGroupGameTemplate(legacy, () => `legacy-player-${++sequence}`);
  assert.equal(draft.bets.rabbits.enabled, false);
  assert.deepEqual(draft.bets.rabbits.participantIds, draft.players.map((player) => player.id));
  assert.deepEqual(draft.personalBets, []);
  assert.deepEqual(parseFrequentGroups(serializeFrequentGroups([legacy])), [legacy]);
});

test("guest, invitación y cuenta vinculada previenen duplicados y permiten revisar HCP", () => {
  let group = configuredGroup();
  const unchangedByEmail = addFrequentGroupMember(group, {
    memberId: "another-id",
    kind: "invited",
    name: "Juan alterno",
    handicap: 22,
    email: "JUAN@example.com",
  });
  assert.equal(unchangedByEmail, group);
  const unchangedByAccount = addFrequentGroupMember(group, {
    memberId: "another-account",
    kind: "account",
    name: "Said alterno",
    handicap: 9,
    accountUserId: "account-said",
  });
  assert.equal(unchangedByAccount, group);
  group = updateFrequentGroupMember(group, 1, { handicap: 10 });
  assert.equal(group.players[1].handicap, 10);
});

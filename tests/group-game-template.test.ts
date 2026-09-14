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
  createRoundGroupSnapshot,
  defaultGroupRoundSelection,
  createGroupGameTemplate,
  frequentGroupTemplateDetails,
  instantiateGroupGameTemplate,
  normalizeGroupGameTemplate,
  updateGroupTemplateFromRound,
  validateGroupRoundSelection,
  type GroupTemplateDraftSource,
} from "../lib/group-game-template";
import { collectBetConfigurationIssues } from "../lib/bet-config-validation";
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

test("quitar un integrante de la plantilla elimina sus participantes y parejas sin tocar rondas previas", () => {
  const original = configuredGroup();
  const edited = { ...original, players: original.players.filter((member) => member.memberId !== "member-carlos") };
  const normalized = normalizeGroupGameTemplate(edited.gameTemplate, edited.players);
  assert.ok(normalized);
  assert.equal(normalized.betConfig.foursome.participantIds.includes("member-carlos"), false);
  assert.equal(normalized.foursomeSegments.some((segment) => segment.basePair.includes("member-carlos")), false);
  assert.equal(original.gameTemplate?.betConfig.foursome.participantIds.includes("member-carlos"), true);
});

test("un grupo de ocho conserva su roster y crea una ronda sólo con los cuatro seleccionados", () => {
  const group: FrequentGroup = {
    ...configuredGroup(),
    players: [
      ...configuredGroup().players,
      { memberId: "member-javier", kind: "guest", name: "Javier", handicap: 14 },
      { memberId: "member-roberto", kind: "guest", name: "Roberto", handicap: 16 },
      { memberId: "member-miguel", kind: "guest", name: "Miguel", handicap: 19 },
      { memberId: "member-andres", kind: "guest", name: "Andrés", handicap: 21 },
    ],
  };
  const selected = defaultGroupRoundSelection(group);
  assert.deepEqual(selected, ["member-owner", "member-pedro", "member-juan", "member-carlos"]);
  let sequence = 0;
  const draft = instantiateGroupGameTemplate(group, () => `selected-${++sequence}`, selected);
  assert.equal(group.players.length, 8);
  assert.equal(draft.players.length, 4);
  assert.deepEqual(draft.players.map((player) => player.name), ["Said", "Pedro", "Juan", "Carlos"]);
  assert.equal(Object.keys(draft.origin.roundPlayerIdByMemberId).length, 4);
});

test("un grupo grande permite seleccionar exactamente cinco sin alterar el roster", () => {
  const group: FrequentGroup = {
    ...configuredGroup(),
    players: [...configuredGroup().players,
      { memberId: "member-five", kind: "guest", name: "Cinco", handicap: 5 },
      { memberId: "member-six", kind: "guest", name: "Seis", handicap: 6 },
      { memberId: "member-seven", kind: "guest", name: "Siete", handicap: 7 },
      { memberId: "member-eight", kind: "guest", name: "Ocho", handicap: 8 }],
  };
  const selected = group.players.slice(0, 5).map((member) => member.memberId!);
  const validation = validateGroupRoundSelection(group, selected);
  assert.equal(validation.ok, true);
  let sequence = 0;
  const draft = instantiateGroupGameTemplate(group, () => `five-${++sequence}`, selected);
  assert.equal(group.players.length, 8);
  assert.equal(draft.players.length, 5);
});

test("un grupo social de veinte conserva a todos sus miembros y sigue creando salidas de máximo cinco", () => {
  const group: FrequentGroup = {
    ...configuredGroup(),
    players: Array.from({ length: 20 }, (_, index) => ({
      memberId: `member-${index + 1}`,
      kind: "guest" as const,
      name: `Jugador ${index + 1}`,
      handicap: index,
    })),
  };
  const [restored] = parseFrequentGroups(serializeFrequentGroups([group]));
  assert.equal(restored.players.length, 20);
  const selected = restored.players.slice(0, 5).map((member) => member.memberId!);
  let sequence = 0;
  const draft = instantiateGroupGameTemplate(restored, () => `twenty-${++sequence}`, selected);
  assert.equal(draft.players.length, 5);
  assert.equal(restored.players.length, 20);
});

test("el sexto jugador se bloquea y una identidad ajena nunca entra a la ronda", () => {
  const group: FrequentGroup = {
    ...configuredGroup(),
    players: [...configuredGroup().players,
      { memberId: "member-five", name: "Cinco", handicap: 5 },
      { memberId: "member-six", name: "Seis", handicap: 6 }],
  };
  const tooMany = validateGroupRoundSelection(group, group.players.map((member) => member.memberId!));
  assert.deepEqual(tooMany, { ok: false, code: "too_many", message: "MÁXIMO 5 JUGADORES POR GRUPO DE SALIDA" });
  const unknown = validateGroupRoundSelection(group, ["member-owner", "not-in-group"]);
  assert.equal(unknown.ok, false);
  assert.throws(() => instantiateGroupGameTemplate(group, () => "x", group.players.map((member) => member.memberId!)), /MÁXIMO 5/);
});

test("participantes ausentes dejan la apuesta inválida para que Preflight obligue a revisarla", () => {
  const source = configuredSource();
  source.bets.foursome.mode = "match";
  source.bets.foursome.segmentSize = 18;
  source.bets.foursome.fixedValue = 500;
  source.segments = segmentDefinitions(playOrder(1), 18).map((segment) => ({ ...segment, basePair: ["round-owner", "round-pedro"] }));
  const group = { ...configuredGroup(), gameTemplate: createGroupGameTemplate(source, memberIdByPlayerId) };
  let sequence = 0;
  const draft = instantiateGroupGameTemplate(group, () => `missing-${++sequence}`, ["member-owner", "member-pedro", "member-juan"]);
  const issues = collectBetConfigurationIssues(draft);
  assert.ok(issues.some((issue) => issue.code === "foursome-match-participants"));
  assert.match(issues.map((issue) => issue.message).join("\n"), /exactamente 4 jugadores|pareja base válida/i);
});

test("la ronda filtra participantes presentes y precarga Foursome Match y reglas de animales", () => {
  const source = configuredSource();
  source.bets.foursome = {
    ...source.bets.foursome,
    enabled: true,
    mode: "match",
    fixedValue: 500,
    participantIds: roundPlayers.map((player) => player.id),
  };
  source.bets.vipers = { ...source.bets.vipers, enabled: true, value: 100, determinationMode: "most_events", mostEventsTieRule: "latest_tied_event" };
  source.bets.camels = { ...source.bets.camels, enabled: true, value: 125, determinationMode: "last_event" };
  source.bets.fish = { ...source.bets.fish, enabled: true, value: 150, determinationMode: "most_events", mostEventsTieRule: "tied_players_pay" };
  source.segments = segmentDefinitions(playOrder(1), 18).map((segment) => ({ ...segment, basePair: ["round-owner", "round-pedro"] }));
  const group = { ...configuredGroup(), gameTemplate: createGroupGameTemplate(source, memberIdByPlayerId) };
  let sequence = 0;
  const draft = instantiateGroupGameTemplate(group, () => `autoload-${++sequence}`, ["member-owner", "member-pedro", "member-juan", "member-carlos"]);

  assert.equal(draft.bets.foursome.enabled, true);
  assert.equal(draft.bets.foursome.mode, "match");
  assert.equal(draft.bets.foursome.fixedValue, 500);
  assert.deepEqual(draft.segments[0].basePair, draft.players.slice(0, 2).map((player) => player.id));
  assert.deepEqual([draft.bets.vipers.value, draft.bets.camels.value, draft.bets.fish.value], [100, 125, 150]);
  assert.equal(draft.bets.vipers.determinationMode, "most_events");
  assert.equal(draft.bets.vipers.mostEventsTieRule, "latest_tied_event");
  assert.equal(draft.bets.camels.determinationMode, "last_event");
  assert.equal(draft.bets.fish.mostEventsTieRule, "tied_players_pay");
  assert.deepEqual(draft.bets.skins.participantIds, draft.players.map((player) => player.id));
});

test("agregar un jugador sólo a la ronda no muta el grupo y agregarlo explícitamente sí", () => {
  const group = configuredGroup();
  let sequence = 0;
  const draft = instantiateGroupGameTemplate(group, () => `guest-${++sequence}`);
  draft.players.push({ id: "round-new", name: "Nuevo", handicap: 17 });
  assert.equal(group.players.some((member) => member.name === "Nuevo"), false);

  const updated = addFrequentGroupMember(group, { memberId: "member-new", kind: "guest", name: "Nuevo", handicap: 17 });
  assert.notEqual(updated, group);
  assert.equal(updated.players.some((member) => member.name === "Nuevo"), true);
  assert.equal(group.players.some((member) => member.name === "Nuevo"), false);
});

test("el resumen de la tarjeta enumera apuestas, modalidades y precios reales", () => {
  const source = configuredSource();
  source.bets.foursome = { ...source.bets.foursome, enabled: true, mode: "match", fixedValue: 500 };
  source.bets.camels = { ...source.bets.camels, enabled: true, value: 100 };
  source.bets.fish = { ...source.bets.fish, enabled: true, value: 125 };
  const group = { ...configuredGroup(), gameTemplate: createGroupGameTemplate(source, memberIdByPlayerId) };
  const details = frequentGroupTemplateDetails(group);
  assert.ok(details.includes("Foursome Match $500"));
  assert.ok(details.includes("Víboras $75"));
  assert.ok(details.includes("Camellos $100"));
  assert.ok(details.includes("Peces $125"));
});

test("el snapshot de origen conserva nombre y selección aunque la plantilla se edite después", () => {
  let sequence = 0;
  const group = configuredGroup();
  const draft = instantiateGroupGameTemplate(group, () => `snapshot-${++sequence}`, ["member-owner", "member-pedro", "member-juan", "member-carlos"]);
  const snapshot = structuredClone(createRoundGroupSnapshot(draft.origin, draft.players));
  const edited = { ...group, name: "Domingos editado", players: group.players.slice(0, 2), updatedAt: "2026-09-08T12:00:00.000Z" };
  assert.equal(edited.name, "Domingos editado");
  assert.equal(snapshot?.groupName, "Domingos");
  assert.equal(snapshot?.selectedMembers.length, 4);
});

test("el snapshot histórico contiene una copia profunda de jugadores y apuestas de la ronda", () => {
  let sequence = 0;
  const group = configuredGroup();
  const draft = instantiateGroupGameTemplate(group, () => `history-${++sequence}`, ["member-owner", "member-pedro", "member-juan", "member-carlos"]);
  const snapshot = structuredClone({
    groupOrigin: createRoundGroupSnapshot(draft.origin, draft.players),
    players: draft.players,
    betConfig: draft.bets,
    segments: draft.segments,
  });

  group.name = "Grupo renombrado";
  group.players[0].name = "Nombre nuevo";
  if (group.gameTemplate) group.gameTemplate.betConfig.rabbits.value = 999;

  assert.equal(snapshot.groupOrigin?.groupName, "Domingos");
  assert.equal(snapshot.players[0].name, "Said");
  assert.equal(snapshot.betConfig.rabbits.value, 175);
  assert.deepEqual(snapshot.segments[0].basePair, draft.segments[0].basePair);
});

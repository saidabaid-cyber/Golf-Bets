import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeSocialDirectoryQuery } from "../features/social/domain";
import { groupTemplateSelectionSections } from "../lib/bets/registry";
import { playOrder, segmentDefinitions } from "../lib/engine";
import {
  createGroupGameTemplate,
  instantiateGroupGameTemplate,
  templateWithoutPlayerAssignments,
  type GroupTemplateDraftSource,
} from "../lib/group-game-template";
import { initialBets } from "../lib/new-round-bets";
import { parseFrequentGroups, serializeFrequentGroups } from "../lib/frequent-templates";
import { createSupplementalBet } from "../lib/supplemental-bets";
import type { FrequentGroup, PersonalBet, Player } from "../lib/types";

const players: Player[] = [
  { id: "round-a", name: "Ana", handicap: 5 },
  { id: "round-b", name: "Beto", handicap: 9 },
  { id: "round-c", name: "Carla", handicap: 13 },
  { id: "round-d", name: "Diego", handicap: 18 },
];

function playerBoundSource(): GroupTemplateDraftSource {
  const ids = players.map((player) => player.id);
  const bets = initialBets(ids);
  bets.rabbits.enabled = true;
  bets.units.enabled = true;
  bets.foursome.enabled = true;
  const personalBets: PersonalBet[] = [{
    id: "personal",
    enabled: true,
    rivalMode: "group",
    rivalPlayerId: ids[1],
    rivalName: "Beto",
    externalScores: { 1: 4 },
    baseValue: 100,
    advantageReceiver: "rival",
    advantageStrokes: 2,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: "holes_10_18",
    nassauVersion: 2,
    carryEnabled: true,
    components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
  }];
  return {
    ownerId: ids[0],
    players,
    startHole: 1,
    roundHoles: 18,
    roundHandicapBasis: "relative",
    bets,
    segments: segmentDefinitions(playOrder(1), 6).map((segment) => ({ ...segment, basePair: ids.slice(0, 2) })),
    personalBets,
    supplementalBets: [
      createSupplementalBet("team_pressures", players, "team", 18),
      createSupplementalBet("dollar_stroke", players, "duel", 18),
    ],
    manualBets: [{ id: "manual", name: "Manual", amounts: { "round-a": 50, "round-b": -50 } }],
  };
}

test("habitual template retains rules but strips every concrete player assignment", () => {
  const memberByPlayer = Object.fromEntries(players.map((player, index) => [player.id, `member-${index + 1}`]));
  const bound = createGroupGameTemplate(playerBoundSource(), memberByPlayer);
  bound.manualBets[0].initialAmounts = { "member-1": 25, "member-2": -25 };
  const stripped = templateWithoutPlayerAssignments(bound);
  assert.equal(stripped.ownerMemberId, "");
  for (const config of [
    stripped.betConfig.rabbits, stripped.betConfig.units, stripped.betConfig.foursome,
    stripped.betConfig.ballFriend, stripped.betConfig.polla.first9, stripped.betConfig.loba,
  ]) assert.deepEqual(config.participantIds, []);
  assert.ok(stripped.foursomeSegments.every((segment) => segment.basePair.length === 0));
  assert.equal(stripped.personalBets[0].rivalPlayerId, undefined);
  assert.equal(stripped.personalBets[0].rivalName, "Jugador pendiente");
  assert.deepEqual(stripped.personalBets[0].externalScores, {});
  const team = stripped.supplementalBets.find((bet) => bet.type === "team_pressures");
  assert.ok(team?.type === "team_pressures");
  assert.deepEqual(team.participantIds, []);
  assert.deepEqual(team.teamA, []);
  const duel = stripped.supplementalBets.find((bet) => bet.type === "dollar_stroke");
  assert.ok(duel?.type === "dollar_stroke");
  assert.equal(duel.playerAId, "");
  assert.equal(duel.playerBId, "");
  assert.deepEqual(stripped.manualBets[0].amounts, {});
  assert.equal(stripped.manualBets[0].initialAmounts, undefined);

  const group: FrequentGroup = {
    id: "habitual",
    name: "Habitual",
    players: players.map((player, index) => ({ memberId: `member-${index + 1}`, name: player.name, handicap: player.handicap })),
    gameTemplate: stripped,
    uses: 0,
    updatedAt: "2026-09-22T00:00:00Z",
  };
  const reloaded = parseFrequentGroups(serializeFrequentGroups([group]))[0];
  assert.equal(reloaded.gameTemplate?.ownerMemberId, "");
  assert.deepEqual(reloaded.gameTemplate?.betConfig.rabbits.participantIds, []);
  assert.deepEqual(reloaded.gameTemplate?.foursomeSegments[0].basePair, []);
  assert.equal(reloaded.gameTemplate?.personalBets[0].rivalPlayerId, undefined);
  let sequence = 0;
  const round = instantiateGroupGameTemplate(reloaded, () => `runtime-${++sequence}`);
  assert.deepEqual(round.bets.rabbits.participantIds, round.players.map((player) => player.id));
  assert.deepEqual(round.bets.units.participantIds, round.players.map((player) => player.id));
  assert.deepEqual(round.segments[0].basePair, []);
  assert.equal(round.personalBets[0].rivalPlayerId, undefined);
  const roundTeam = round.supplementalBets.find((bet) => bet.type === "team_pressures");
  assert.ok(roundTeam?.type === "team_pressures");
  assert.deepEqual(roundTeam.participantIds, round.players.map((player) => player.id));
  assert.deepEqual(roundTeam.teamA, []);
});

test("habitual bet selection has disjoint general and personal sections", () => {
  const sections = groupTemplateSelectionSections();
  const general = sections.general.map((bet) => bet.id);
  const personal = sections.personal.map((bet) => bet.id);
  assert.ok(general.includes("rabbits"));
  assert.ok(general.includes("team_pressures"));
  assert.deepEqual(personal, ["personals", "dollar_stroke", "individual_pressures"]);
  assert.equal(general.some((id) => personal.includes(id)), false);
});

test("directory normalization supports name, username, @username, case, spaces and exact email", () => {
  assert.equal(normalizeSocialDirectoryQuery("  Said   Abaid  "), "said abaid");
  assert.equal(normalizeSocialDirectoryQuery(" SAIDABAID "), "saidabaid");
  assert.equal(normalizeSocialDirectoryQuery(" @SaidAbaid "), "saidabaid");
  assert.equal(normalizeSocialDirectoryQuery(" QA.User@Example.Invalid "), "qa.user@example.invalid");
  assert.equal(normalizeSocialDirectoryQuery(" @Sáíd_Aba "), "said_aba");
});

test("owner social and round lifecycle copy exposes real actions without dead CTAs", () => {
  const invitations = readFileSync("app/components/group-invitations.tsx", "utf8");
  assert.match(invitations, />Escanear QR</);
  assert.match(invitations, /<SocialQrScanner/);
  assert.match(invitations, /Perfil encontrado\. Confirma antes de invitarlo/);
  assert.match(invitations, /Invitaciones por correo — Próximamente/);
  assert.doesNotMatch(invitations, /Invitaciones por correo temporalmente no disponibles/);
  assert.match(invitations, /autoCorrect="off" autoCapitalize="none" spellCheck=\{false\} inputMode="search"/);
  const handicap = readFileSync("app/components/player-handicap-control.tsx", "utf8");
  assert.doesNotMatch(handicap, /Revisar Información de golf/);
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /La ronda anterior no se borrará\. Quedará guardada/);
  assert.match(page, /Continuar ronda actual/);
  assert.match(page, /Iniciar nueva ronda/);
  assert.match(page, />Cancelar</);
});

test("Copas remains a legacy engine alias while current presentation uses signed units", () => {
  for (const file of [
    "lib/bet-help.ts", "lib/bet-config-validation.ts", "lib/round-setup-wizard.ts",
    "app/components/backyard-ai/ai-round-review.tsx", "app/components/group-bet-template-editor.tsx",
    "lib/backyard-ai/runtime/intent-parser.ts",
  ]) assert.doesNotMatch(readFileSync(file, "utf8"), /\bCopas?\b/);
  assert.match(readFileSync("lib/bets/registry.ts", "utf8"), /aiAliases: \["unidades", "copas", "copa"\]/);
  assert.match(readFileSync("lib/engine.ts", "utf8"), /e\.label === "Copa"/);
});

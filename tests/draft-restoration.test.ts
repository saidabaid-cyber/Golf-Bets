import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveRoundDraftCore, resolvedOwnerIdForRoundDraft } from "../app/draft-restoration";
import { accountPrimaryPlayerId } from "../lib/account-primary-player";
import { normalizeRoundDraft } from "../lib/round-utils";
import type { Player } from "../lib/types";

const previousRound = { startHole: 10 as const, roundHoles: 9 as const, ownerId: "previous-owner" };
const players: Player[] = [
  { id: "friend", name: "Amigo", handicap: 8 },
  { id: accountPrimaryPlayerId("user-1"), accountUserId: "user-1", name: "Principal", handicap: 0 },
];

test("a partial draft replaces populated round identity with safe defaults", () => {
  const restored = resolveRoundDraftCore({ players }, "user-1");
  const nextRound = { ...previousRound, ...restored };

  assert.equal(nextRound.startHole, 1);
  assert.equal(nextRound.roundHoles, 18);
  assert.equal(nextRound.ownerId, accountPrimaryPlayerId("user-1"));
  assert.notEqual(nextRound.ownerId, previousRound.ownerId);
});

test("valid legacy round identity is preserved and invalid owners fall back deterministically", () => {
  assert.deepEqual(
    resolveRoundDraftCore({ startHole: 10, roundHoles: 9, ownerId: "friend", players }, "user-1"),
    { startHole: 10, roundHoles: 9, ownerId: "friend", players },
  );

  const directLegacyAccount: Player[] = [
    { id: "user-legacy", name: "Cuenta legacy", handicap: 4 },
    { id: "friend", name: "Amigo", handicap: 8 },
  ];
  assert.equal(resolveRoundDraftCore({ ownerId: "missing", players: directLegacyAccount }, "user-legacy").ownerId, "user-legacy");
  assert.equal(resolveRoundDraftCore({ ownerId: "missing", players: [players[0]] }, "unlinked").ownerId, "friend");
  assert.equal(resolveRoundDraftCore({ ownerId: "missing", players: [] }, "user-1").ownerId, "");
});

test("draft application wires resolved values through unconditional setters", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /const draftCore = draft \? resolveRoundDraftCore\(draft, identity\.userId\) : null/);
  assert.match(page, /setStartHole\(draftCore\.startHole\);\s+setRoundHoles\(draftCore\.roundHoles\)/);
  assert.match(page, /setPlayers\(draftCore\.players\)/);
  assert.match(page, /setPlayerTeeAssignments\(reconcilePlayerTeeAssignments\(draft\.playerTeeAssignments, draftCore\.players/);
  assert.match(page, /setOwnerId\(draftCore\.ownerId\)/);
  assert.doesNotMatch(page, /if \(draft\.startHole\) setStartHole/);
  assert.doesNotMatch(page, /if \(draft\.ownerId\) setOwnerId/);
  assert.match(page, /Math\.min\(draftRoundHoles - 1, draft\.currentIndex\)/);
  assert.match(page, /setCourse\(draft\.course \? withDefaultLaVistaRules\(draft\.course\) : laVista\)/);
  assert.match(page, /setExpenses\(draft\.expenses \? normalizeExpenses\(draft\.expenses\) : emptyExpenses\)/);
  assert.match(page, /setRoundId\(typeof draft\.roundId === "string" && draft\.roundId\.trim\(\) \? draft\.roundId : makeId\(\)\)/);
  assert.match(page, /setRoundDate\(typeof draft\.roundDate === "string" && draft\.roundDate\.trim\(\) \? draft\.roundDate : localDateMexico\(\)\)/);
  assert.doesNotMatch(page, /if \(draft\.expenses\) setExpenses/);
  assert.match(page, /id: b\.id,\s+enabled: b\.enabled/);
  assert.match(page, /advantageReceiver: b\.nassauVersion === 2\s+\? b\.advantageReceiver/);
});

test("legacy Nassau migration resolves the authenticated owner before becoming Personal", () => {
  const accountId = accountPrimaryPlayerId("user-1");
  const roster: Player[] = [
    { id: "first", name: "Primero", handicap: 4 },
    { id: accountId, accountUserId: "user-1", name: "Cuenta", handicap: 8 },
    { id: "rival", name: "Rival", handicap: 10 },
  ];
  const legacyNassau = {
    id: "legacy-owner-sensitive",
    type: "individual_nassau",
    enabled: true,
    playerAId: "first",
    playerBId: "rival",
    value: 100,
    advantageStrokes: 0,
    carryEnabled: false,
    components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
  };
  const source = { players: roster, supplementalBets: [legacyNassau] };
  const ownerId = resolvedOwnerIdForRoundDraft(source, "user-1");
  const normalized = normalizeRoundDraft(source, ownerId)!;

  assert.equal(ownerId, accountId);
  assert.deepEqual(normalized.personalBets, []);
  assert.deepEqual(normalized.supplementalBets, [legacyNassau]);

  const accountNassau = { ...legacyNassau, id: "legacy-account", playerAId: accountId };
  const accountSource = { players: roster, supplementalBets: [accountNassau] };
  const migrated = normalizeRoundDraft(accountSource, resolvedOwnerIdForRoundDraft(accountSource, "user-1"))!;
  assert.equal(migrated.personalBets[0].rivalPlayerId, "rival");
  assert.equal(migrated.supplementalBets.length, 0);
});

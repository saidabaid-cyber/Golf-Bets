import assert from "node:assert/strict";
import test from "node:test";

import {
  accountPrimaryPlayerId,
  accountPrimaryRoundPlayer,
  syncAccountPrimaryFrequentPlayer,
  syncLinkedRoundPlayerName,
} from "../lib/account-primary-player";
import { upsertFrequentPlayers } from "../lib/round-utils";
import { parseFrequentGroups, playersFromFrequentGroup, serializeFrequentGroups } from "../lib/frequent-templates";
import { guestBackyardProfile } from "../lib/account-state";

const profile = {
  userId: "user-123",
  displayName: "Said Abaid",
  email: "said@example.test",
  avatarUrl: "",
  defaultHandicap: 7.4,
};

test("la cuenta autenticada crea un jugador principal estable y el invitado no crea identidad", () => {
  assert.deepEqual(accountPrimaryRoundPlayer(profile), {
    id: accountPrimaryPlayerId(profile.userId),
    accountUserId: profile.userId,
    name: "Said Abaid",
    handicap: 7.4,
  });
  assert.equal(accountPrimaryRoundPlayer({ ...profile, userId: "guest", displayName: "" }), null);
});

test("el modo invitado ignora nombres, correo y avatar heredados", () => {
  assert.deepEqual(guestBackyardProfile({ displayName: "Invitado", email: "guest@example.test", avatarUrl: "fake", defaultHandicap: 8 }), {
    userId: "guest",
    displayName: "",
    email: "",
    avatarUrl: "",
    defaultHandicap: 8,
  });
});

test("el jugador principal adopta una plantilla local única y no se duplica al cambiar de nombre", () => {
  const legacy = [{ id: "legacy", name: "Said Abaid", handicap: 9, uses: 4, updatedAt: "old" }];
  const linked = syncAccountPrimaryFrequentPlayer(legacy, profile, "created");
  assert.equal(linked.length, 1);
  assert.deepEqual(linked[0], {
    id: "legacy",
    accountUserId: profile.userId,
    name: "Said Abaid",
    handicap: 7.4,
    uses: 4,
    updatedAt: "created",
  });

  const renamed = syncAccountPrimaryFrequentPlayer(linked, { ...profile, displayName: "Said A." }, "renamed");
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].name, "Said A.");
  assert.equal(renamed[0].accountUserId, profile.userId);
});

test("la ronda actualiza solo el nombre vinculado y conserva su HCP original", () => {
  const players = [
    { id: accountPrimaryPlayerId(profile.userId), accountUserId: profile.userId, name: "Nombre anterior", handicap: 12 },
    { id: "rival", name: "Said Abaid", handicap: 5 },
  ];
  const updated = syncLinkedRoundPlayerName(players, profile);
  assert.equal(updated[0].name, "Said Abaid");
  assert.equal(updated[0].handicap, 12);
  assert.deepEqual(updated[1], players[1]);
});

test("guardar una ronda vuelve a usar la identidad estable aunque cambie el nombre", () => {
  const current = syncAccountPrimaryFrequentPlayer([], profile, "created");
  const updated = upsertFrequentPlayers(current, [{
    id: accountPrimaryPlayerId(profile.userId),
    accountUserId: profile.userId,
    name: "Said A.",
    handicap: 8,
  }], "saved");
  assert.equal(updated.length, 1);
  assert.equal(updated[0].name, "Said A.");
  assert.equal(updated[0].uses, 1);
  assert.equal(updated[0].accountUserId, profile.userId);
});

test("grupos guardados conservan el vínculo del principal y lo recuperan con el ID estable", () => {
  const group = {
    id: "group-1",
    name: "Viernes",
    players: [{ name: profile.displayName, handicap: profile.defaultHandicap, accountUserId: profile.userId }],
    uses: 0,
    updatedAt: "saved",
  };
  const restored = parseFrequentGroups(serializeFrequentGroups([group]));
  const players = playersFromFrequentGroup(restored[0], () => "random-id");
  assert.equal(players[0].id, accountPrimaryPlayerId(profile.userId));
  assert.equal(players[0].accountUserId, profile.userId);
});

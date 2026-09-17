import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeAcceptedGroupMembers, saveExplicitGroupSnapshot } from "../lib/group-invitation-sync";
import { addFrequentGroupMember, parseFrequentGroups, serializeFrequentGroups } from "../lib/frequent-templates";
import { createEmptyGroupGameTemplate } from "../lib/group-game-template";
import type { FrequentGroup, FrequentGroupMember } from "../lib/types";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const canonicalId = "33333333-3333-4333-8333-333333333333";
const owner: FrequentGroupMember = { memberId: "owner-member", accountUserId: a, name: "Said", handicap: 8, kind: "account" };
const accepted: FrequentGroupMember = { memberId: `account-${b}`, accountUserId: b, name: "Pedro", handicap: null, kind: "account" };
function group(): FrequentGroup {
  const group: FrequentGroup = { id: "local-group", name: "Viernes", players: [owner], uses: 0, updatedAt: "2026-09-17" };
  group.gameTemplate = createEmptyGroupGameTemplate(group);
  group.gameTemplate.betConfig.skins = { ...group.gameTemplate.betConfig.skins, enabled: true, value: 175, mode: "no_carry" };
  return group;
}

test("explicit save posts latest template once and reads back newly accepted members without editing bets", async () => {
  const draft = group();
  const untouched = structuredClone(draft);
  let requests = 0;
  const saved = await saveExplicitGroupSnapshot({ group: draft, authenticated: true, accessToken: "test-token", online: true, fetcher: async (url, options) => {
    requests += 1;
    assert.equal(url, "/api/groups/invitations");
    assert.equal(options?.method, "POST");
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer test-token");
    const body = JSON.parse(options?.body as string);
    assert.equal(body.action, "ensure");
    assert.equal(body.group.gameTemplate.betConfig.skins.value, 175);
    return Response.json({ groupId: canonicalId, groupSnapshot: { ...draft, players: [owner, accepted] } });
  } });
  assert.equal(requests, 1);
  assert.equal(saved.mode, "cloud");
  assert.deepEqual(saved.group.players.map((member) => member.accountUserId), [a, b]);
  assert.deepEqual(saved.group.gameTemplate, draft.gameTemplate);
  assert.deepEqual(draft, untouched);
  assert.equal(saved.group.id, draft.id);
  assert.doesNotMatch(saved.notice, /enviado/i);
});

test("offline or unregistered local save never creates/sends an invitation or claims cloud success", async () => {
  for (const [authenticated, online] of [[false, true], [true, false]]) {
    const draft = group();
    const saved = await saveExplicitGroupSnapshot({ group: draft, authenticated, online, accessToken: "unused", fetcher: async () => { throw new Error("must not request"); } });
    assert.equal(saved.mode, "local");
    assert.equal(saved.group, draft);
    assert.match(saved.notice, /este dispositivo/);
    assert.match(saved.notice, /No se enviaron invitaciones/);
  }
});

test("authenticated missing session cannot silently downgrade to local success", async () => {
  await assert.rejects(saveExplicitGroupSnapshot({ group: group(), authenticated: true, online: true }), /verificar tu sesión/);
});

test("failure/invalid response preserves draft; retry uses the same group id and current template", async () => {
  const draft = group();
  let requests = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    requests += 1;
    assert.equal(JSON.parse(options?.body as string).group.id, draft.id);
    return requests === 1 ? Response.json({ error: "internal details must not leak" }, { status: 503 })
      : Response.json({ groupId: canonicalId, groupSnapshot: draft });
  };
  await assert.rejects(saveExplicitGroupSnapshot({ group: draft, authenticated: true, online: true, accessToken: "test", fetcher }), /Conservamos el borrador/);
  const saved = await saveExplicitGroupSnapshot({ group: draft, authenticated: true, online: true, accessToken: "test", fetcher });
  assert.equal(saved.group.id, draft.id);
  assert.equal(requests, 2);
  await assert.rejects(saveExplicitGroupSnapshot({ group: draft, authenticated: true, online: true, accessToken: "test", fetcher: async () => Response.json({ groupId: canonicalId, groupSnapshot: { ...draft, id: "different-group" } }) }), /verificar el grupo/);
});

test("accepted member merge is stable, deduplicates identity and preserves all current preferences", () => {
  const current = [owner];
  assert.equal(mergeAcceptedGroupMembers(current, []), current);
  assert.equal(mergeAcceptedGroupMembers(current, [{ ...owner, name: "Remote renamed", handicap: null }]), current);
  const merged = mergeAcceptedGroupMembers(current, [accepted, accepted, { ...accepted, accountUserId: "not-verified-id" }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0], owner);
  assert.equal(mergeAcceptedGroupMembers(merged, [accepted]), merged);
});

test("two registered accounts with the same display name survive add, serialization and reload", () => {
  const initial = group();
  const next = addFrequentGroupMember(initial, { ...accepted, name: owner.name });
  assert.equal(next.players.length, 2);
  const loaded = parseFrequentGroups(serializeFrequentGroups([next]))[0];
  assert.deepEqual(loaded.players.map((member) => member.accountUserId), [a, b]);
  assert.equal(addFrequentGroupMember(next, { ...accepted, name: "Pedro renamed" }), next, "same verified identity cannot duplicate");
  assert.equal(addFrequentGroupMember(initial, { memberId: "guest", name: owner.name, handicap: 12 }), initial, "unlinked same-name guest still requires explicit identity resolution");
});

test("group save handlers own an in-flight latch and show loading; accepted callbacks do not reset templates", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const beta = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  assert.match(page, /if \(frequentGroupSaveInFlight.current\) return/);
  assert.match(page, /await saveExplicitGroupSnapshot/);
  assert.match(page, /disabled=\{frequentGroupSaving\}/);
  assert.match(beta, /if \(groupSaveInFlight.current\) return/);
  assert.match(beta, /await saveExplicitGroupSnapshot/);
  assert.match(beta, /disabled=\{groupSaving\}/);
  assert.match(page, /onAcceptedMembers=\{/);
  assert.equal((beta.match(/onAcceptedMembers=\{acceptGroupMembers\}/g) || []).length, 2);
  assert.match(beta, /nextMembers === current.group.members \? current : \{ \.\.\.current, group: \{ \.\.\.current.group, members: nextMembers \} \}/);
});

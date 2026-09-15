import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
type Link = { round_id: string; user_id: string; player_key: string; verified_by: string };
type Status = { canAttest: boolean; requiresParticipantConfirmation: boolean; participantPlayerKey: string | null };

// Execute the real server helper; replace only its database boundary. No
// separate implementation of eligibility that could drift from the service.
function harness(links: Link[]) {
  const moduleExports: Record<string, unknown> = {};
  const source = readFileSync("lib/social-activity.server.ts", "utf8") + "\nexport { participantStatus };";
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  runInNewContext(compiled, {
    exports: moduleExports,
    require: (id: string) => {
      if (["server-only", "./round-achievements", "./social-round-card", "./social-author-profile"].includes(id)) return {};
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  const admin = { from(table: string) {
    assert.equal(table, "social_round_account_links_v3");
    const filters: Array<[keyof Link, string]> = [];
    const query = {
      select: () => query,
      eq: (key: keyof Link, value: string) => { filters.push([key, value]); return query; },
      maybeSingle: async () => ({ data: links.find(link => filters.every(([key, value]) => link[key] === value)) ?? null, error: null }),
    };
    return query;
  } };
  return async (viewer: string, target = PEER, attested = false, players = [
    { id: "owner-player", accountUserId: OWNER }, { id: "peer-player", accountUserId: PEER },
  ]) => {
    const helper = moduleExports.participantStatus as (...args: unknown[]) => Promise<Status>;
    return helper({ admin, userId: viewer }, { event_kind: "ROUND_COMPLETED", author_id: target }, {
      id: "round-1", owner_id: OWNER, local_round_id: "local-1",
      snapshot: { id: "local-1", ownerId: "owner-player", lifecycleState: "completed", completedAt: "2026-09-15T15:00:00Z", players },
    }, attested);
  };
}

test("organizador participante con ROUND_OWNER puede atestar un compañero sin self-confirm imposible", async () => {
  const status = await harness([{ round_id: "round-1", user_id: OWNER, player_key: "owner-player", verified_by: "ROUND_OWNER" }])(OWNER);
  assert.equal(status.canAttest, true);
  assert.equal(status.requiresParticipantConfirmation, false);
  assert.equal(status.participantPlayerKey, "owner-player");
});

test("compañero sólo puede atestar después de confirmar su identidad canónica", async () => {
  const pending = await harness([])(PEER, OWNER);
  assert.equal(pending.canAttest, false);
  assert.equal(pending.requiresParticipantConfirmation, true);
  const confirmed = await harness([{ round_id: "round-1", user_id: PEER, player_key: "peer-player", verified_by: "SELF_CONFIRMED" }])(PEER, OWNER);
  assert.equal(confirmed.canAttest, true);
  const forgedOwner = await harness([{ round_id: "round-1", user_id: PEER, player_key: "peer-player", verified_by: "ROUND_OWNER" }])(PEER, OWNER);
  assert.equal(forgedOwner.canAttest, false);
});

test("status bloquea self, no participante, duplicado y vínculo de player equivocado", async () => {
  const linked = harness([{ round_id: "round-1", user_id: OWNER, player_key: "owner-player", verified_by: "ROUND_OWNER" }]);
  assert.equal((await linked(OWNER, OWNER)).canAttest, false);
  assert.equal((await linked("unrelated-user")).canAttest, false);
  assert.equal((await linked(OWNER, PEER, true)).canAttest, false);
  assert.equal((await linked(OWNER, PEER, false, [
    { id: "owner-player", accountUserId: OWNER }, { id: "duplicate", accountUserId: OWNER },
  ])).canAttest, false);
  assert.equal((await harness([{ round_id: "round-1", user_id: OWNER, player_key: "wrong", verified_by: "ROUND_OWNER" }])(OWNER)).canAttest, false);
});

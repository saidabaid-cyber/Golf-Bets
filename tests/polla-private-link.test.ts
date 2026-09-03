import assert from "node:assert/strict";
import test from "node:test";

import { createPrivatePollaLink, parsePrivatePollaLink, privatePollaScoreChanges } from "../lib/polla-private-link";

test("vinculación privada exige coincidencias únicas y nunca incluye apuestas", () => {
  const session = { tournament_id: "t1", group_id: "g1", access_token: "secret" };
  const result = createPrivatePollaLink(
    [{ id: "local-1", name: "Said", handicap: 7 }, { id: "local-2", name: "Cuau", handicap: 9 }],
    [{ id: "cloud-1", name: "said" }, { id: "cloud-2", name: "Cuau" }],
    session,
    "2026-09-02T12:00:00Z",
  );
  assert.ok(result.link);
  const changes = privatePollaScoreChanges(result.link!, 4, { "local-1": 3, "local-2": 5 });
  assert.deepEqual(changes.map((item) => [item.playerId, item.score]), [["cloud-1", 3], ["cloud-2", 5]]);
  assert.equal("bets" in changes[0], false);
  assert.equal("balances" in changes[0], false);
  assert.equal(parsePrivatePollaLink(JSON.stringify(result.link))?.tournamentId, "t1");
});

test("vinculación rechaza nombre faltante o ambiguo", () => {
  const session = { tournament_id: "t1", group_id: "g1", access_token: "token" };
  const ambiguous = createPrivatePollaLink([{ id: "p1", name: "Said", handicap: 7 }], [{ id: "a", name: "Said" }, { id: "b", name: "said" }], session);
  assert.deepEqual(ambiguous.ambiguous, ["Said"]);
  assert.equal(ambiguous.link, undefined);
  const missing = createPrivatePollaLink([{ id: "p1", name: "Otro", handicap: 7 }], [{ id: "a", name: "Said" }], session);
  assert.deepEqual(missing.unmatched, ["Otro"]);
});

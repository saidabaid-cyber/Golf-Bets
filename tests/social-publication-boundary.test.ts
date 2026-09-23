import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hasCompletedRoundPublicationCandidate } from "../lib/social-publication-policy";

const completed = {
  id: "round-completed",
  lifecycleState: "completed",
  completedAt: "2026-09-23T12:00:00.000Z",
};

test("only a valid completed round schedules immediate Social reconciliation", () => {
  assert.equal(hasCompletedRoundPublicationCandidate([completed]), true);
  for (const value of [
    null,
    [],
    [{ ...completed, lifecycleState: "live" }],
    [{ ...completed, lifecycleState: "cancelled" }],
    [{ ...completed, completedAt: undefined }],
    [{ ...completed, completedAt: "not-a-date" }],
    [{ ...completed, id: "" }],
  ]) assert.equal(hasCompletedRoundPublicationCandidate(value), false);
});

test("cloud writes commit before optional Social work and active drafts do not schedule it", () => {
  const sync = readFileSync("app/api/cloud/sync/route.ts", "utf8");
  const rounds = readFileSync("app/api/cloud/rounds/route.ts", "utf8");
  const syncWrite = sync.indexOf("await writeCloudBundle");
  const syncSchedule = sync.indexOf('scheduleSocialPublication(account.userId, "round")');
  const roundInsert = rounds.indexOf('.from("rounds_cloud").insert');
  const roundSchedule = rounds.indexOf('scheduleSocialPublication(userId, "round")');
  assert.ok(syncWrite >= 0 && syncSchedule > syncWrite);
  assert.ok(roundInsert >= 0 && roundSchedule > roundInsert);
  assert.match(sync, /if \(hasCompletedRoundPublicationCandidate\(body\.data\.history\)\) scheduleSocialPublication/);
  assert.match(rounds, /if \(hasCompletedRoundPublicationCandidate\(\[body\.round\]\)\) scheduleSocialPublication/);
});

test("secondary Social failure stays observable without exposing user data", () => {
  const publication = readFileSync("lib/social-publication.server.ts", "utf8");
  assert.match(publication, /backyard_social_publication_pending/);
  assert.match(publication, /publicationFailureCode\(error\)/);
  assert.doesNotMatch(publication, /console\.error\([^\n]*(userId|snapshot|email)/);
});

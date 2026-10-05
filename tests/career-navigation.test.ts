import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildGolfInsights } from "../lib/golf-insights";
import { deriveRoundAchievements } from "../lib/round-achievements";

test("empty career evidence does not create statistics or achievements", () => {
  const insights = buildGolfInsights([]);
  assert.equal(insights.averageScore, undefined);
  assert.equal(insights.averagePutts, undefined);
  assert.equal(insights.greenAttempts, 0);
  assert.equal(insights.scoreCohorts[18], undefined);
  assert.equal(deriveRoundAchievements({} as never, [], "guest"), null);
});
test("Carrera reuses authoritative statistics and existing achievement/round handlers", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const career = readFileSync("app/components/career-hub.tsx", "utf8");
  assert.match(page, /<CareerHub[^>]*insights=\{betaGolfInsights\} rounds=\{statisticsHistory\} ready=\{statisticsReady\}/);
  assert.match(page, /<CareerHub[\s\S]*?onOpenRound=\{openHistoricalRound\}/);
  assert.match(career, /CareerHeader/);
  assert.match(career, /CareerTabs/);
  assert.match(career, /CareerSkeleton/);
  assert.match(career, /CareerErrorState/);
  assert.match(page, /tab === "friends" && <FriendsHub/);
  assert.doesNotMatch(career, /#12|245|Birdie Master|82\.5|77%/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { CloudConflictResolutionBuffer } from "../lib/cloud-conflict-resolution";
import {
  CLOUD_SYNC_VERSION,
  findAmbiguousCloudConflicts,
  resolveAmbiguousCloudConflicts,
  type CloudDataBundle,
} from "../lib/cloud-sync";

function bundle(score: number, deviceId: string, baseScore = 4): CloudDataBundle {
  const baseDraft = { roundId: "round-1", scores: { 1: { said: baseScore } } };
  return {
    version: CLOUD_SYNC_VERSION,
    deviceId,
    history: [], frequentPlayers: [], frequentGroups: [], rivals: [], courses: [], tombstones: [],
    preferences: { highContrast: false, language: "es-MX", notificationsEnabled: false, defaultHandicap: null },
    activeDraft: { roundId: "round-1", scores: { 1: { said: score } } },
    activeDraftUpdatedAt: "2026-09-10T12:00:00.000Z",
    baseDraft,
    baseDraftUpdatedAt: "2026-09-10T11:00:00.000Z",
    baseDraftFingerprint: JSON.stringify(baseDraft),
  };
}

test("una resolución cloud sigue siendo autoritativa durante el siguiente sync", () => {
  const staleRender = bundle(5, "iphone");
  const cloud = bundle(6, "ipad");
  const [conflict] = findAmbiguousCloudConflicts(staleRender, cloud);
  assert.ok(conflict);

  const resolved = resolveAmbiguousCloudConflicts(staleRender, cloud, [conflict], "cloud", "2026-09-10T12:01:00.000Z");
  const buffer = new CloudConflictResolutionBuffer();
  buffer.stage(resolved);

  const nextRead = buffer.read(() => staleRender);
  assert.equal((nextRead.activeDraft as { scores: Record<number, { said: number }> }).scores[1].said, 6);
  assert.equal(findAmbiguousCloudConflicts(nextRead, cloud).length, 0);

  buffer.clear();
  assert.equal(buffer.pending, false);
  assert.equal(buffer.read(() => resolved), resolved);
});

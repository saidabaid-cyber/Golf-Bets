import test from "node:test";
import assert from "node:assert/strict";
import { CloudDb } from "./helpers/cloud-db";
import { readCloudBundle, writeCloudBundle } from "../lib/cloud-sync-service";
import type { RoundSnapshot } from "../lib/types";

const oldAt = "2026-10-05T12:00:00.000Z";
const closeAt = "2026-10-05T12:10:00.000Z";

for (const sameDevice of [true, false]) test(`closeout ${sameDevice ? "converges on the same device" : "protects a different device's equal-clock history"}`, async () => {
  const db = new CloudDb();
  const original = { id: "saved", date: "2026-10-05", updatedAt: oldAt,
    lifecycleState: "completed", players: [], scores: {}, courseSnapshot: { holes: [] } } as unknown as RoundSnapshot;
  db.rows("rounds_cloud").push({ id: "canonical-saved", owner_id: "qa", local_id: "saved", snapshot: original, updated_at: oldAt });
  db.rows("user_cloud_state").push({ user_id: "qa", active_draft: null, updated_at: oldAt, updated_by_device: "iphone-a" });
  const canonical = await readCloudBundle(db.client, "qa", true);
  const completed = { ...original, id: "just-closed", updatedAt: closeAt, completedAt: closeAt };
  const incoming = { ...canonical, deviceId: sameDevice ? "iphone-a" : "iphone-b",
    history: [{ ...original, expenses: { greenFee: 0, cartRental: 0, food: 0, drinks: 0, caddie: 0, other: 0 } }, completed] };
  const write = () => writeCloudBundle(db.client, "qa", { data: incoming, fingerprint: "closeout" });
  if (!sameDevice) {
    await assert.rejects(write(), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "CLOUD_FIELD_CONFLICT"));
    assert.equal(db.rows("rounds_cloud").length, 1);
  } else {
    await write();
    await write();
    const saved = await readCloudBundle(db.client, "qa", true);
    assert.equal(saved.history.length, 2);
    assert.equal(saved.history.find(round => round.id === "just-closed")?.lifecycleState, "completed");
    assert.deepEqual(saved.history.find(round => round.id === "saved"), original, "CAS preserves the existing equal-clock canonical card");
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BACKYARD_INDEX_METADATA_KEY, chooseIndexPreference, indexPreferenceKey, parseIndexPreference, persistIndexPreference, readCloudIndexPreference, readIndexPreference, saveCloudIndexPreference, type BackyardIndexPreference } from "../lib/backyard-index-preferences";

const preference: BackyardIndexPreference = { version: 1, userId: "owner-a", enabled: true, localPccZeroDeclaredAt: "2026-09-15T10:00:00.000Z", updatedAt: "2026-09-15T10:00:00.000Z" };
function store() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
}
function authClient(userId = preference.userId, initial: unknown = undefined) {
  let metadata: Record<string, unknown> = { unrelated: "preserved", [BACKYARD_INDEX_METADATA_KEY]: initial };
  let writes = 0;
  return { get writes() { return writes; }, get metadata() { return metadata; }, client: { auth: {
    getUser: async () => ({ data: { user: { id: userId, user_metadata: metadata } }, error: null }),
    updateUser: async ({ data }: { data: Record<string, unknown> }) => { writes += 1; metadata = { ...metadata, ...data }; return { data: { user: { id: userId, user_metadata: metadata } }, error: null }; },
  } } as unknown as SupabaseClient };
}

test("persist/reload opt-in y PCC declaración propietario; legacy no inventa declaración", () => {
  const storage = store();
  persistIndexPreference(storage, { preference, pending: true });
  assert.deepEqual(readIndexPreference(storage, preference.userId), { preference, pending: true });
  assert.equal(readIndexPreference(storage, "owner-b"), null);
  assert.equal(parseIndexPreference(preference, "owner-b"), null);
  assert.equal(parseIndexPreference(preference, "guest"), null);
  storage.setItem(indexPreferenceKey(preference.userId), "corrupt");
  storage.setItem(`backyard-index-enabled-v1:${preference.userId}`, "true");
  assert.equal(readIndexPreference(storage, preference.userId)?.preference.enabled, true);
  assert.equal(readIndexPreference(storage, preference.userId)?.preference.localPccZeroDeclaredAt, null);
});

test("cloud Auth preference verifies session + write readback, reload new device keeps opt-in; other metadata unchanged", async () => {
  const fake = authClient();
  await saveCloudIndexPreference(fake.client, preference);
  const remote = await readCloudIndexPreference(fake.client, preference.userId);
  const fresh = store();
  persistIndexPreference(fresh, chooseIndexPreference(null, remote)!);
  assert.deepEqual(readIndexPreference(fresh, preference.userId)?.preference, preference);
  assert.equal(fake.metadata.unrelated, "preserved");
  await saveCloudIndexPreference(fake.client, preference);
  assert.equal(fake.writes, 1); // Retry is idempotent.
  const other = authClient("owner-b");
  await assert.rejects(saveCloudIndexPreference(other.client, preference), /propietario/);
  assert.equal(other.writes, 0);
});

test("stale device cannot overwrite observed newer metadata; newer durable local repairs LWW race next sync", async () => {
  const newer = { ...preference, enabled: false, updatedAt: "2026-09-16T10:00:00.000Z" };
  const fake = authClient(preference.userId, newer);
  await assert.rejects(saveCloudIndexPreference(fake.client, preference), /Otro dispositivo/);
  assert.equal(fake.writes, 0);
  assert.deepEqual(chooseIndexPreference({ preference, pending: true }, newer), { preference: newer, pending: false });
  assert.deepEqual(chooseIndexPreference({ preference: newer, pending: false }, preference), { preference: newer, pending: true });
});

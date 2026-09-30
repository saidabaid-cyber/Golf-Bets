import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as equipmentOfflineStore from "../lib/equipment-offline-store";
import * as equipmentSync from "../lib/equipment-sync";
import * as golfEquipment from "../lib/golf-equipment";

const USER_ID = "equipment-hook-reconnect-user";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

async function eventually(assertion: () => void) {
  let failure: unknown = new Error("condition_not_met");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      failure = error;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  throw failure;
}

test("window online uploads the durable offline equipment edit and acknowledges its outbox", async () => {
  const storage = new MemoryStorage();
  const navigatorState = { onLine: false };
  const listeners = new Map<string, Set<(event: { type: string }) => void>>();
  const browser = {
    addEventListener(type: string, listener: (event: { type: string }) => void) {
      const registered = listeners.get(type) || new Set<(event: { type: string }) => void>();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removeEventListener(type: string, listener: (event: { type: string }) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: { type: string }) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
  };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const published: golfEquipment.EquipmentProfile[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/features") return Response.json({ equipmentCloudEnabled: true });
    if (url === "/api/equipment" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as {
        profile: golfEquipment.EquipmentProfile;
        mutationId: string;
      };
      return Response.json({
        data: {
          profile: body.profile,
          version: 1,
          lastMutationId: body.mutationId,
          updatedAt: "2026-09-28T18:05:00.000Z",
        },
      });
    }
    if (url === "/api/equipment") return Response.json({ data: null });
    throw new Error(`unexpected_fetch:${url}`);
  };

  const slots: unknown[] = [];
  const pendingEffects: Array<() => void | (() => void)> = [];
  let cursor = 0;
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[index], (next: unknown) => {
        slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback: (...args: unknown[]) => unknown) {
      cursor += 1;
      return callback;
    },
    useEffect(effect: () => void | (() => void)) {
      cursor += 1;
      pendingEffects.push(effect);
    },
  };
  const source = ts.transpileModule(readFileSync("app/components/use-equipment-profile.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const hookExports: Record<string, unknown> = {};
  runInNewContext(source, {
    exports: hookExports,
    crypto: { randomUUID: () => "offline-equipment-mutation" },
    fetch: fetcher,
    localStorage: storage,
    navigator: navigatorState,
    window: browser,
    require(name: string) {
      if (name === "react") return react;
      if (name.endsWith("/golf-equipment")) return golfEquipment;
      if (name.endsWith("/equipment-offline-store")) return equipmentOfflineStore;
      if (name.endsWith("/equipment-sync")) return {
        ...equipmentSync,
        downloadEquipmentProfile: (accessToken: string, userId: string) => (
          equipmentSync.downloadEquipmentProfile(accessToken, userId, fetcher)
        ),
        uploadEquipmentProfile: (
          profile: golfEquipment.EquipmentProfile,
          accessToken: string,
          options: Parameters<typeof equipmentSync.uploadEquipmentProfile>[2],
        ) => equipmentSync.uploadEquipmentProfile(profile, accessToken, options, fetcher),
      };
      if (name.endsWith("/equipment-profile-events")) return {
        publishEquipmentProfileUpdated(profile: golfEquipment.EquipmentProfile) {
          published.push(profile);
        },
      };
      throw new Error(`unexpected_require:${name}`);
    },
  });

  type EquipmentHook = {
    update(updater: (current: golfEquipment.EquipmentProfile) => golfEquipment.EquipmentProfile | null): boolean;
  };
  const useEquipmentProfile = hookExports.useEquipmentProfile as (userId: string, accessToken: string) => EquipmentHook;
  assert.equal(typeof useEquipmentProfile, "function");
  cursor = 0;
  const hook = useEquipmentProfile(USER_ID, "equipment-access-token");
  pendingEffects.splice(0).forEach((effect) => effect());
  await eventually(() => assert.equal(slots[1], "offline"));

  assert.equal(hook.update((current) => ({
    ...current,
    equipmentOnboarding: "COMPLETED",
    updatedAt: "2026-09-28T18:04:00.000Z",
  })), true);
  const queued = equipmentOfflineStore.readEquipmentSyncState(storage, USER_ID).outbox;
  assert.ok(queued, "the offline edit is durable before reconnection");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls.some((call) => call.init?.method === "PUT"), false);

  navigatorState.onLine = true;
  browser.dispatchEvent({ type: "online" });
  await eventually(() => {
    assert.equal(calls.filter((call) => call.url === "/api/equipment" && call.init?.method === "PUT").length, 1);
    assert.equal(equipmentOfflineStore.readEquipmentSyncState(storage, USER_ID).outbox, null);
  });

  const put = calls.find((call) => call.url === "/api/equipment" && call.init?.method === "PUT");
  assert.ok(put);
  const uploaded = JSON.parse(String(put.init?.body)) as { mutationId: string; profile: golfEquipment.EquipmentProfile };
  assert.equal(uploaded.mutationId, queued.mutationId);
  assert.equal(uploaded.profile.equipmentOnboarding, "COMPLETED");
  assert.ok(published.some((profile) => profile.equipmentOnboarding === "COMPLETED"));
  const acknowledged = equipmentOfflineStore.readEquipmentSyncState(storage, USER_ID);
  assert.equal(acknowledged.base?.lastMutationId, queued.mutationId);
  assert.equal(acknowledged.base?.version, 1);
  assert.equal(slots[1], "synced");
});

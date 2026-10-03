import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as offline from "../lib/equipment-offline-store";
import * as sync from "../lib/equipment-sync";
import * as equipment from "../lib/golf-equipment";

const USER_ID = "qa-equipment-storage-echo";
const NOW = "2026-10-02T23:00:00.000Z";

test("two equipment clients do not rewrite an unchanged cloud profile on storage notifications", async () => {
  const profile = equipment.createEmptyEquipmentProfile(USER_ID, NOW)!;
  const profileKey = equipment.equipmentProfileStorageKey(USER_ID)!;
  const values = new Map<string, string>();
  const writes: string[] = [];
  const clients: Array<Map<string, (event: { key: string; newValue: string }) => void>> = [];
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) { values.set(key, value); writes.push(key); },
    removeItem: (key: string) => { values.delete(key); },
  };
  assert.equal(equipment.saveEquipmentProfile(storage, profile, NOW).ok, true);
  writes.length = 0;
  const before = values.get(profileKey);
  const record = { profile, version: 2, lastMutationId: "qa-mutation", updatedAt: NOW };
  let downloads = 0;
  let uploads = 0;
  const source = ts.transpileModule(readFileSync("app/components/use-equipment-profile.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  for (let client = 0; client < 2; client += 1) {
    const listeners = new Map<string, (event: { key: string; newValue: string }) => void>();
    clients.push(listeners);
    const effects: Array<() => unknown> = [];
    const react = {
      useState: (value: unknown) => [value, () => undefined],
      useRef: (value: unknown) => ({ current: value }),
      useCallback: (callback: unknown) => callback,
      useEffect: (effect: () => unknown) => { effects.push(effect); },
    };
    const exports: Record<string, unknown> = {};
    runInNewContext(source, {
      exports, localStorage: storage, navigator: { onLine: true },
      crypto: { randomUUID: () => "qa-mutation" },
      fetch: async () => Response.json({ equipmentCloudEnabled: true }),
      window: {
        addEventListener: (type: string, listener: (event: { key: string; newValue: string }) => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      },
      require(name: string) {
        if (name === "react") return react;
        if (name.endsWith("/golf-equipment")) return equipment;
        if (name.endsWith("/equipment-offline-store")) return offline;
        if (name.endsWith("/equipment-sync")) return {
          ...sync,
          downloadEquipmentProfile: async () => { downloads += 1; return record; },
          uploadEquipmentProfile: async () => { uploads += 1; return record; },
        };
        if (name.endsWith("/equipment-profile-events")) return { publishEquipmentProfileUpdated: () => undefined };
        throw new Error(`unexpected_require:${name}`);
      },
    });
    (exports.useEquipmentProfile as (userId: string, accessToken: string) => unknown)(USER_ID, "qa-token");
    effects.forEach(effect => effect());
  }
  for (let tick = 0; tick < 5; tick += 1) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(downloads, 2);
  assert.equal(uploads, 0);
  assert.equal(writes.filter(key => key === profileKey).length, 0,
    "unchanged profile writes change the envelope savedAt and echo into the other tab");
  assert.equal(values.get(profileKey), before);

  for (const listeners of clients) listeners.get("storage")?.({ key: profileKey, newValue: before! });
  for (let tick = 0; tick < 5; tick += 1) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(downloads, 4, "each client handles the actual external notification once");
  assert.equal(writes.filter(key => key === profileKey).length, 0);
  assert.equal(uploads, 0);
  assert.equal(values.get(profileKey), before);
});

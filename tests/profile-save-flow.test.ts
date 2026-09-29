import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { waitForProfilePrimarySave } from "../lib/profile-save-flow";

test("el guardado canónico confirma sin esperar proyecciones secundarias", async () => {
  assert.deepEqual(await waitForProfilePrimarySave(Promise.resolve(), 50), { status: "saved" });
});

test("timeout desbloquea el CTA aunque el trabajo de fondo siga pendiente", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const started = Date.now();
  assert.deepEqual(await waitForProfilePrimarySave(pending, 5), { status: "timeout" });
  assert.ok(Date.now() - started < 100);
  finish();
  await pending;
});

test("error primario queda recuperable y conserva la causa", async () => {
  const error = new Error("cloud_unavailable");
  const outcome = await waitForProfilePrimarySave(Promise.reject(error), 50);
  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") assert.equal(outcome.error, error);
});

test("perfil evita doble submit y no espera metadata/Auth para liberar", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const panel = readFileSync("app/components/profile-account-panel.tsx", "utf8");
  assert.match(provider, /saveInFlight\.current/);
  assert.match(panel, /profileSaveInFlight\.current/);
  assert.match(provider, /waitForProfilePrimarySave\(primarySave\)/);
  assert.match(provider, /Perfil guardado · sincronizando avatar…/);
  assert.match(panel, /No se confirmó el guardado\. Conservamos lo que escribiste; reintenta\./);
  assert.doesNotMatch(panel, /onSaveAvatar=/);
});

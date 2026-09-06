import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isExplicitFeatureEnabled } from "../lib/feature-flags";

test("Polla Live falla cerrada sin una activación explícita reconocida", () => {
  for (const value of [undefined, "", "0", "false", "off", "no", "enabled", "banana"]) {
    assert.equal(isExplicitFeatureEnabled(value), false, String(value));
  }

  for (const value of ["1", "true", "TRUE", " on ", "yes"]) {
    assert.equal(isExplicitFeatureEnabled(value), true, value);
  }
});

test("los clientes privilegiado y de usuario de Polla comparten el bloqueo server-side", () => {
  const flags = readFileSync("lib/feature-flags.ts", "utf8");
  const server = readFileSync("lib/supabase/server.ts", "utf8");

  assert.match(flags, /pollaLiveServerEnabled = isExplicitFeatureEnabled\(process\.env\.POLLA_LIVE_ENABLED\)/);
  assert.equal((server.match(/feature === "polla" && !pollaLiveServerEnabled/g) || []).length, 2);
  assert.ok(server.indexOf("!pollaLiveServerEnabled") < server.indexOf("SUPABASE_SERVICE_ROLE_KEY"));
});

import assert from "node:assert/strict";
import test from "node:test";

import { OFFICIAL_RULES_VIDEOS_URL, golfRulesCatalog, searchGolfRules } from "../lib/rules-catalog";

test("rules search handles Spanish aliases and returns only curated rule numbers", () => {
  assert.equal(searchGolfRules("cart path")[0].rule, "16.1");
  assert.equal(searchGolfRules("estaca roja")[0].rule, "17");
  assert.equal(searchGolfRules("bola perdida")[0].rule, "18");
  assert.ok(golfRulesCatalog.every((entry) => /^\d+(\.\d+)?$/.test(entry.rule) && entry.sourceUrl.startsWith("https://www.randa.org/")));
});

test("unknown search terms do not invent a result", () => {
  assert.deepEqual(searchGolfRules("situacion completamente inexistente xyz"), []);
});

test("rules videos use the approved playlist", () => {
  assert.equal(OFFICIAL_RULES_VIDEOS_URL, "https://youtube.com/playlist?list=PLnU5qUEfww3dYQwcnZ5qoGAlwzGRtghdA&si=QuhRbedq6dIFrouW");
});

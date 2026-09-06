import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync("app/page.tsx", "utf8");

test("el editor de grupos no se cierra ni agrega frecuentes cuando detecta un duplicado", () => {
  const addStart = page.indexOf("function addNewPlayerToFrequentGroup()");
  const addEnd = page.indexOf("function editFrequentGroupMember", addStart);
  const addMember = page.slice(addStart, addEnd);
  assert.match(page, /if \(next === frequentGroupDraft\) \{\s*setFrequentGroupEditError\("Esta cuenta o jugador ya forma parte del grupo\."\);\s*return;/);
  assert.match(page, /if \(frequentGroupHasDuplicateMembers\(frequentGroupDraft\)\) \{[\s\S]{0,220}return;/);
  assert.match(page, /frequentGroupEditError && <div className="notice bad" role="alert">/);
  assert.ok(addMember.indexOf("setPendingGroupFrequentPlayers") > addMember.indexOf("if (next === frequentGroupDraft)"));
});

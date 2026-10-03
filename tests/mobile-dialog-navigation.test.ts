import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function stackingLevel(css: string, selector: string) {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].trim() === selector);
  const levels = rules.flatMap((match) => [...match[2].matchAll(/z-index:\s*(\d+)/g)].map((level) => Number(level[1])));
  assert.ok(levels.length, `${selector} must define its stacking level`);
  return levels[levels.length - 1];
}

test("modal actions remain above fixed player navigation rather than sending taps to Play", () => {
  const dialogs = readFileSync("app/globals.css", "utf8");
  const navigation = readFileSync("app/components/app-bottom-nav.module.css", "utf8");
  assert.ok(stackingLevel(dialogs, ".modalBackdrop") > stackingLevel(navigation, ".nav"));
});

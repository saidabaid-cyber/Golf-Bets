import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BOTTOM_NAV_TARGETS, screenHref, screenFromSearch, type AppTab } from "../lib/app-navigation";

test("canonical view URLs round-trip without discarding incoming social invitation parameters", () => {
  for (const tab of [...Object.values(BOTTOM_NAV_TARGETS), "profile", "account", "social", "setup", "round"] as AppTab[]) {
    const href = screenHref(tab, "?socialQr=invite&screen=stats");
    assert.equal(screenFromSearch(href.slice(1)), tab);
    assert.equal(new URL(href, "https://dev.thebackyard.com.mx").searchParams.get("socialQr"), "invite");
  }
  assert.equal(screenHref("welcome"), "/");
  assert.equal(screenFromSearch("?screen=more"), "welcome");
  assert.equal(screenFromSearch("?screen=unknown"), "welcome");
});

test("Play asset matches the exact approved reference bytes", () => {
  const digest = createHash("sha256").update(readFileSync("public/brand/play-symbol-official.jpg")).digest("hex");
  assert.equal(digest, "3a308a68bfdcb005742d216903100a0a986d0f4b9db6c11c1311ed9313bdf9e6");
});

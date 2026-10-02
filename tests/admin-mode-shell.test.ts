import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { previewDatabaseFeaturesAvailable } from "../lib/preview-database";
test("Admin V2 branch never falls back to the frozen DEV database for player writes", () => {
  assert.equal(previewDatabaseFeaturesAvailable({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/admin-mode-v2", PREVIEW_DB_REF: "bymeopxkxapfizeeqeyb", NEXT_PUBLIC_SUPABASE_URL: "https://bymeopxkxapfizeeqeyb.supabase.co" }), false);
});
test("normal player retains navigation and mode selector requires persisted admin access", () => {
  const menu = fs.readFileSync("app/components/admin-mode-menu.tsx", "utf8");
  assert.match(menu, /if \(!adminAccess.hasAccess\) return null/);
  assert.match(menu, /href="\/manage"/);
  assert.match(menu, /logout\(\)/);
  assert.match(fs.readFileSync("app/manage/page.tsx", "utf8"), /AccountProvider/);
  assert.match(fs.readFileSync("app/admin/page.tsx", "utf8"), /AdminControlCenter/);
});

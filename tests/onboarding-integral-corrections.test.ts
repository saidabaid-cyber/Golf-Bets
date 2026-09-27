import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { linkGhinReadOnly } from "../lib/ghin/profile-link";
import type { GhinReadOnlyProfileController } from "../app/components/use-ghin-read-only-profile";
import type { GhinProfileProjection } from "../lib/ghin/profile";

const linkedProfile: GhinProfileProjection = {
  ghinNumber: "11103349",
  playerName: "Said Abaid Taja",
  clubName: "LA Vista Country Club",
  homeClubName: "LA Vista Country Club",
  handicapIndex: 7.9,
  status: "Active",
  revisionDate: "2026-09-27T00:00:00.000Z",
  lastSyncedAt: "2026-09-27T12:00:00.000Z",
  lastAttemptedAt: "2026-09-27T12:00:00.000Z",
  syncStatus: "SUCCESS",
  lastErrorCode: null,
  associationStatus: "SELF_ATTESTED",
};

function ghinControl(refresh: () => Promise<GhinProfileProjection | null>): GhinReadOnlyProfileController {
  return {
    enabled: true,
    ready: true,
    refreshing: false,
    scoresLoading: false,
    profile: null,
    scores: null,
    error: "",
    refresh,
    loadScores: async () => {},
    retry: async () => {},
  };
}

test("GHIN link selects the source only after a real persisted profile is returned", async () => {
  let selected = 0;
  const success = await linkGhinReadOnly(ghinControl(async () => linkedProfile), async () => { selected += 1; });
  assert.equal(success, true);
  assert.equal(selected, 1);

  const failed = await linkGhinReadOnly(ghinControl(async () => null), async () => { selected += 1; });
  assert.equal(failed, false);
  assert.equal(selected, 1, "a failed lookup must not create a GHIN source link");
});

test("all active GHIN surfaces use the real controller and contain no future or disabled CTA", () => {
  const onboarding = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const selector = readFileSync("app/components/handicap-source-selector.tsx", "utf8");
  const panel = readFileSync("app/components/ghin-read-only-panel.tsx", "utf8");
  const more = readFileSync("app/components/more-hub.tsx", "utf8");
  const account = readFileSync("lib/account-state.ts", "utf8");
  const combined = [onboarding, selector, panel, more].join("\n");

  assert.match(provider, /ghinAuthorized=\{adminAccess\.hasAccess\}/);
  assert.match(onboarding, /useGhinReadOnlyProfile\(accessToken, ghinAuthorized\)/);
  assert.match(onboarding, /ghinControl=\{ghinControl\}/);
  assert.match(selector, /<GhinReadOnlyPanel control=\{ghinControl\}/);
  assert.match(panel, /VINCULAR GHIN/);
  assert.match(panel, /control\.refresh\(\)/);
  assert.match(panel, /control\.loadScores\(\)/);
  assert.match(panel, /✓ GHIN VINCULADO/);
  assert.match(account, /"LINKED"/);
  assert.doesNotMatch(combined, /GHIN[^\n<]{0,80}(?:PRÓXIMAMENTE|próximamente|estará disponible)/i);
  assert.doesNotMatch(combined, /disabled GHIN/i);
});

test("GHIN remains Preview/admin/read-only and does not expose score posting", () => {
  const access = readFileSync("lib/ghin/qa-access.server.ts", "utf8");
  const profileRoute = readFileSync("app/api/profile/ghin/route.ts", "utf8");
  const scoreRoute = readFileSync("app/api/profile/ghin/scores/route.ts", "utf8");
  assert.match(access, /capabilities\.previewOnly/);
  assert.match(access, /admin_memberships/);
  assert.match(profileRoute, /safety: \{ readOnly: true, scorePostingCalls: 0 \}/);
  assert.match(scoreRoute, /safety: \{ readOnly: true, scorePostingCalls: 0 \}/);
  assert.doesNotMatch(`${profileRoute}\n${scoreRoute}`, /postScore|submitScore|publishScore/);
});

test("Home Club selection collapses only after persistence and reopens without changing identity logic", () => {
  const picker = readFileSync("app/components/catalog-course-picker.tsx", "utf8");
  const persisted = picker.indexOf("await onSelectHomeCourse(homeCourseSelection(selected))");
  const collapsed = picker.indexOf("setChoosingHomeCourse(false)", persisted);
  assert.ok(persisted >= 0 && collapsed > persisted);
  assert.match(picker, /purpose==='home-club'&&!choosingHomeCourse&&selectionLabel&&club&&chosen/);
  assert.match(picker, /setChoosingHomeCourse\(true\)/);
  assert.match(picker, /nearby\.map\(c=>/);
  assert.match(picker, /<AnchoredSearch inlineResults label="Buscar otro campo"/);
  assert.match(picker, /onSelectHomeCourse\(homeCourseSelection\(selected\)\)/);
  assert.doesNotMatch(picker, /slice\(0,\s*3\)/);
});

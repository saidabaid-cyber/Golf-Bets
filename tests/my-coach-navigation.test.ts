import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { COACH_CAPABILITIES } from "../lib/coach-capabilities";
test("My Coach opens the same fitting and launch monitor through the existing equipment profile", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const profile = readFileSync("app/components/profile-account-panel.tsx", "utf8");
  const equipment = readFileSync("app/components/equipment-profile-panel.tsx", "utf8");
  const fit = readFileSync("app/components/ball-fit-wizard.tsx", "utf8");
  assert.match(page, /onBallFit=\{\(\) => openCoachFitting\(false\)\}/);
  assert.match(page, /onLaunchMonitor=\{\(\) => openCoachFitting\(true\)\}/);
  assert.match(page, /<ProfileAccountPanel initialLaunchMonitor=\{launchMonitorEntry\}/);
  assert.match(profile, /<EquipmentProfilePanel initialLaunchMonitor=\{initialLaunchMonitor\}/);
  assert.match(equipment, /<BallFitWizard initialLaunchMonitor=\{initialLaunchMonitor\}/);
  assert.match(fit, /value=\{input.launchMonitorSession\}/);
  assert.match(equipment, /useEquipmentProfile\(userId, accessToken\)/);
  assert.match(equipment, /profile\?\.lastBallFit/);
  assert.equal((readFileSync("app/components/my-coach.tsx", "utf8").match(/useEquipmentProfile|createEmptyEquipmentProfile|localStorage/g) || []).length, 0);
});
test("unimplemented coaching engines stay disabled and admin remains accessible from Profile settings", () => {
  assert.deepEqual(COACH_CAPABILITIES, { swingAnalysis: false, drills: false, trainingRecommendations: false });
  assert.match(readFileSync("app/components/profile-account-panel.tsx", "utf8"), /adminAccess.hasAccess && <a[^>]*href="\/admin"/);
});

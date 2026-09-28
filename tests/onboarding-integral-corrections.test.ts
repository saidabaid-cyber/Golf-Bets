import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("GHIN UI authenticates, asks for identity confirmation, then selects the source", () => {
  const panel = readFileSync("app/components/ghin-read-only-panel.tsx", "utf8");
  const hook = readFileSync("app/components/use-ghin-read-only-profile.ts", "utf8");
  assert.match(panel, /Email o número GHIN/);
  assert.match(panel, /Contraseña GHIN/);
  assert.match(panel, /The Backyard no guardará tu contraseña/);
  assert.match(panel, /Encontramos tu cuenta GHIN/);
  assert.match(panel, /¿Este eres tú\?/);
  assert.match(panel, /control\.confirm\(\)/);
  assert.match(panel, /await onUseGhin\(\)/);
  assert.ok(panel.indexOf("control.confirm()") < panel.indexOf("await onUseGhin()"));
  assert.match(hook, /operation: "authorize"/);
  assert.match(hook, /operation: "confirm"/);
  assert.match(readFileSync("lib/ghin/user-session.server.ts", "utf8"), /lookupGolferByEmail\(loginEmail\)/);
  assert.match(panel, /setPassword\(""\)/);
  assert.doesNotMatch(hook, /localStorage|sessionStorage|document\.cookie/);
});

test("all active GHIN surfaces use the real controller and contain no future or disabled CTA", () => {
  const onboarding = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const selector = readFileSync("app/components/handicap-source-selector.tsx", "utf8");
  const panel = readFileSync("app/components/ghin-read-only-panel.tsx", "utf8");
  const more = readFileSync("app/components/more-hub.tsx", "utf8");
  const account = readFileSync("lib/account-state.ts", "utf8");
  const combined = [onboarding, selector, panel, more].join("\n");

  assert.doesNotMatch(provider, /ghinAuthorized=\{adminAccess\.hasAccess\}/);
  assert.match(onboarding, /useGhinReadOnlyProfile\(accessToken\)/);
  assert.match(onboarding, /ghinControl=\{ghinControl\}/);
  assert.match(selector, /<GhinReadOnlyPanel control=\{ghinControl\}/);
  assert.match(panel, /VINCULAR GHIN/);
  assert.match(panel, /control\.refresh\(\)/);
  assert.match(panel, /control\.loadScores\(\)/);
  assert.match(panel, /control\.unlink\(\)/);
  assert.match(panel, /control\.reauthorize\(/);
  assert.match(panel, /✓ GHIN VINCULADO/);
  assert.match(account, /"LINKED"/);
  assert.doesNotMatch(combined, /GHIN[^\n<]{0,80}(?:PRÓXIMAMENTE|próximamente|estará disponible)/i);
  assert.doesNotMatch(combined, /disabled GHIN/i);
});

test("GHIN remains Preview/user/read-only and does not expose score posting", () => {
  const access = readFileSync("lib/ghin/user-access.server.ts", "utf8");
  const hook = readFileSync("app/components/use-ghin-read-only-profile.ts", "utf8");
  const profileRoute = readFileSync("app/api/profile/ghin/route.ts", "utf8");
  const scoreRoute = readFileSync("app/api/profile/ghin/scores/route.ts", "utf8");
  assert.match(access, /capabilities\.previewOnly/);
  assert.match(access, /authenticatedRequest/);
  assert.doesNotMatch(access, /admin_memberships/);
  assert.match(access, /scorePostingEnabled/);
  assert.match(hook, /failure\.code === "FEATURE_DISABLED"/);
  assert.doesNotMatch(hook, /process\.env\.NEXT_PUBLIC_BACKYARD_GHIN_INTEGRATION/);
  assert.match(profileRoute, /safety: \{ readOnly: true, scorePostingCalls: 0 \}/);
  assert.match(scoreRoute, /ROUTE_MOVED/);
  assert.doesNotMatch(`${profileRoute}\n${scoreRoute}`, /postScore|submitScore|publishScore/);
});

test("Handicap onboarding has no course catalog while Play keeps Course → Layout → Tee", () => {
  const onboarding = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  const play = readFileSync("app/page.tsx", "utf8");
  const selector = readFileSync("app/components/handicap-source-selector.tsx", "utf8");
  assert.doesNotMatch(onboarding, /CatalogCoursePicker/);
  assert.doesNotMatch(onboarding, /purpose="home-club"/);
  assert.match(onboarding, /onContinue=\{\(\) => advance\("ghin"\)\}/);
  assert.match(selector, /CONTINUAR SIN ÍNDICE/);
  assert.match(play, /1\. Campo → Layout → Tee/);
  assert.match(play, /<CatalogCoursePicker/);
  assert.match(play, /<RoundTeePicker/);
});

test("Home Club selection collapses only after persistence and reopens without changing identity logic", () => {
  const picker = readFileSync("app/components/catalog-course-picker.tsx", "utf8");
  const persisted = picker.indexOf("await onSelectHomeCourse(homeCourseSelection(selected))");
  const collapsed = picker.indexOf("setChoosingHomeCourse(false)", persisted);
  assert.ok(persisted >= 0 && collapsed > persisted);
  assert.match(picker, /purpose==='home-club'&&!choosingHomeCourse&&selectionLabel&&club&&chosen/);
  assert.match(picker, /setChoosingHomeCourse\(true\)/);
  assert.match(picker, /const visibleNearby=nearby\.slice\(0,nearbyLimit\)/);
  assert.match(picker, /visibleNearby\.map\(c=>/);
  assert.match(picker, /Ver más campos cercanos/);
  assert.match(picker, /<AnchoredSearch inlineResults label="Buscar otro campo"/);
  assert.match(picker, /onSelectHomeCourse\(homeCourseSelection\(selected\)\)/);
  assert.doesNotMatch(picker, /nearby\.slice\(0,\s*3\)/);
});

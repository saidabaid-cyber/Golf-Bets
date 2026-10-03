import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { pendingOnboardingDevicePermissions, PRIVACY_GROUPS } from "../lib/onboarding-privacy";
import { emptyDevicePermissionPreferences } from "../lib/device-permissions";

test("device camera/photo choices are distinct from image processing and keep every existing group", () => {
  const device=PRIVACY_GROUPS[0].choices.map(([key])=>key);
  assert.deepEqual(device,["location","camera","photos","notifications","push","email","rounds","reminders"]);
  assert.deepEqual(PRIVACY_GROUPS[2].choices.map(([key])=>key),["ai","images","practice"]);
  assert.deepEqual(PRIVACY_GROUPS.map(group=>group.title),["Funciones del dispositivo","Experiencia The Backyard","IA y datos de práctica","Apuestas y resultados","Marketing"]);
});

test("actual QR camera request is enclosed in the explicit camera action and never a mount effect", () => {
  const source=readFileSync("app/components/social-qr.tsx","utf8");
  const file=ts.createSourceFile("social-qr.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const requests: ts.CallExpression[]=[];
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==="navigator.mediaDevices.getUserMedia")requests.push(node);ts.forEachChild(node,visit);};visit(file);
  assert.equal(requests.length,1);
  let ancestor: ts.Node | undefined=requests[0].parent;
  while(ancestor&&!ts.isFunctionDeclaration(ancestor))ancestor=ancestor.parent;
  assert.ok(ancestor&&ts.isFunctionDeclaration(ancestor)&&ancestor.name?.text==="camera");
  assert.match(source,/onClick=\{\(\)=>void camera\(\)\}>Usar cámara/);
  assert.doesNotMatch(source,/useEffect\([^;]*getUserMedia/);
});

test("avatar and practice file pickers remain contextual and never request whole-library access", () => {
  const avatar=readFileSync("app/components/profile-image-picker.tsx","utf8");
  const practice=readFileSync("app/components/launch-monitor-camera.tsx","utf8");
  assert.match(avatar,/onClick=\{\(\) => cameraInputRef\.current\?\.click\(\)\}>TOMAR FOTO/);
  assert.match(avatar,/onClick=\{\(\) => galleryInputRef\.current\?\.click\(\)\}>ELEGIR DE GALERÍA/);
  assert.match(avatar,/type="file"[^\n]*capture="user"[^\n]*event\.target\.files\?\.\[0\]/);
  assert.match(practice,/Elegir de galería<input type="file"[^\n]*multiple[^\n]*event\.target\.files/);
  assert.doesNotMatch(avatar+practice,/showDirectoryPicker|webkitdirectory|requestPhotoLibraryPermission|requestFullLibraryAccess/);
});

test("device handoff only offers enabled preferences with unresolved available OS permissions", () => {
  const device={...emptyDevicePermissionPreferences("owner"),locationPreference:"enabled" as const,notificationPreference:"enabled" as const,location:"prompt" as const,notifications:"prompt" as const};
  const choices={location:true,notifications:true},availability={location:true,notifications:true};
  assert.deepEqual(pendingOnboardingDevicePermissions(choices,device,availability),{location:true,notifications:true});
  for(const status of ["granted","denied"] as const)assert.deepEqual(pendingOnboardingDevicePermissions(choices,{...device,location:status,notifications:status},availability),{location:false,notifications:false});
  assert.deepEqual(pendingOnboardingDevicePermissions({location:false,notifications:false},device,availability),{location:false,notifications:false});
  assert.deepEqual(pendingOnboardingDevicePermissions(choices,device,{location:false,notifications:false}),{location:false,notifications:false});
  assert.deepEqual(pendingOnboardingDevicePermissions(choices,{...device,locationPreference:"disabled",notificationPreference:"disabled"},availability),{location:false,notifications:false});
});

test("Step 2 hides unhydrated counts, keeps accordions closed, and uses only the actual bundle receipt for copy", () => {
  const source=readFileSync("app/components/onboarding-privacy-choices.tsx","utf8");
  assert.ok(source.indexOf('if (!loaded) return') < source.indexOf('PRIVACY_GROUPS.map'));
  assert.match(source,/setPreviousAuthorization\(result.state.receipt\?\.action === "authorize_all"\)/);
  assert.doesNotMatch(source,/Object.values\(result.choices\).some|<details[^>]*\bopen[=> ]/);
  assert.match(source,/edited.current = true/);
  assert.match(source,/group.choices.filter\(\(\[key\]\) => choices\[key\]\).length/);
});

test("notification request stays in the explicit gesture before any cloud await", () => {
  const source=readFileSync("app/components/device-permission-settings.tsx","utf8");
  const action=source.slice(source.indexOf('async function notifications()'),source.indexOf('async function skipNotifications()'));
  assert.ok(action.indexOf('requestInitialNotifications(') < action.indexOf('await persistPreference('));
  assert.doesNotMatch(source,/getUserMedia|type="file"|requestPhotoLibraryPermission/);
});

test("home-club location retries use the existing helper; catalogue loading does not depend on location", () => {
  const source=readFileSync("app/components/catalog-course-picker.tsx","utf8");
  assert.match(source,/await requestInitialLocation\(localStorage,permissionOwnerId,navigator.geolocation/);
  assert.match(source,/purpose==='home-club'&&homeLocationEnabled/);
  assert.match(source,/REINTENTAR UBICACIÓN/);
  assert.match(source,/No pudimos usar tu ubicación. Puedes buscar tu campo manualmente./);
  const catalogue=source.slice(source.indexOf('fetch(`/api/courses/catalog'),source.indexOf('const matches='));
  assert.doesNotMatch(catalogue,/locationEnabled|locationPreference|geolocation/);
  assert.match(source,/useState\(3\)/);
  assert.match(source,/Ver más campos cercanos/);
});

test("permission repair is opted into only by onboarding, leaving shared Profile and round pickers unchanged", () => {
  const flow=readFileSync("app/components/beta-onboarding-flow.tsx","utf8");
  const profile=readFileSync("app/components/profile-account-panel.tsx","utf8");
  const provider=readFileSync("app/components/account-provider.tsx","utf8");
  const picker=readFileSync("app/components/catalog-course-picker.tsx","utf8");
  const choices=readFileSync("app/components/onboarding-privacy-choices.tsx","utf8");
  assert.match(flow,/<CatalogCoursePicker onboardingLocation/);
  assert.match(flow,/<OnboardingPrivacyChoices resolveDevicePermissions/);
  assert.doesNotMatch(profile,/onboardingLocation/);
  assert.doesNotMatch(provider,/resolveDevicePermissions/);
  assert.match(picker,/onboardingLocation=false/);
  assert.match(picker,/if\(!onboardingLocation\|\|purpose!=='home-club'\)/);
  assert.match(choices,/resolveDevicePermissions = false/);
  assert.match(choices,/if \(resolveDevicePermissions\) setDeviceChoices/);
});

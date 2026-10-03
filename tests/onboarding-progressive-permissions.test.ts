import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { PRIVACY_GROUPS } from "../lib/onboarding-privacy";

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

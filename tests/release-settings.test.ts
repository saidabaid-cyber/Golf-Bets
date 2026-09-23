import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { ACCOUNT_SETTINGS } from "../lib/account-settings";
import { DEFAULT_ACCOUNT_UI_PREFERENCES, displayDistanceFromStoredYards, readAccountUiPreferences, writeAccountUiPreferences } from "../lib/account-ui-preferences";

type Element = { type: unknown; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children);
  return typeof value === "string" ? value : "";
}
function panel(initialAccountSection = "account", view = "account") {
  const slots: unknown[] = []; let cursor = 0;
  const state = (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], (next: unknown) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const opened: string[] = [];
  const dependencies: Record<string, unknown> = {
    react: { useState: state, useRef: (initial: unknown) => state({ current: initial })[0], useEffect: () => {}, useLayoutEffect: () => {} },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "../../lib/account-settings": { ACCOUNT_SETTINGS },
    "../../lib/account-ui-preferences": { DEFAULT_ACCOUNT_UI_PREFERENCES, displayDistanceFromStoredYards, readAccountUiPreferences, writeAccountUiPreferences },
    "../../lib/legal-config": { LEGAL_DOCUMENT_VERSIONS: {}, legalConfig: {} },
    "../../lib/handicap-source": { selectedHandicapIndex: () => ({ source: "BACKYARD" }) },
    "./account-provider": { useBackyardAccount: () => ({ identity: { userId: "synthetic", mode: "authenticated", displayName: "QA", accessToken: "synthetic-not-a-token", providers: ["email"] }, acceptances: [], cloudIssues: [] }) },
  };
  const exports: Record<string, (props: unknown) => unknown> = {};
  const source = ts.transpileModule(readFileSync("app/components/profile-account-panel.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(source, { exports, require: (id: string) => dependencies[id] || new Proxy({}, { get: (_object, name) => name === "__esModule" ? true : () => undefined }) });
  return { render: () => { cursor = 0; return exports.ProfileAccountPanel({ view, initialAccountSection, indexControl: {}, onOpenAccountSection: (section: string) => opened.push(section) }); }, opened };
}
for (const section of ACCOUNT_SETTINGS) test(`settings ${section.id} renders only its own controls`, () => {
  const h = panel(section.id);
  const tree = h.render();
  assert.deepEqual(elements(tree).filter(e => e.props["data-settings-section"]).map(e => e.props["data-settings-section"]), [section.id]);
  assert.equal(elements(tree).filter(e => e.props["aria-current"] === "page").length, 1);
  const danger = elements(tree).some(e => e.type === "button" && text(e) === "Eliminar cuenta");
  assert.equal(danger, section.id === "account");
});
test("settings navigation changes the existing panel without duplicating controls", () => {
  const h = panel();
  for (const section of [...ACCOUNT_SETTINGS, ...ACCOUNT_SETTINGS].reverse()) {
    const button = elements(h.render()).find(e => e.type === "button" && text(e) === section.label)!;
    (button.props.onClick as () => void)();
    assert.deepEqual(elements(h.render()).filter(e => e.props["data-settings-section"]).map(e => e.props["data-settings-section"]), [section.id]);
  }
});

test('account edits reuse the existing profile editor instead of another profile',()=>{
 const h=panel();const edit=elements(h.render()).find(e=>e.type==='button'&&text(e)==='Editar nombre y usuario')!;
 assert.ok(edit);(edit.props.onClick as ()=>void)();
 assert.ok(text(h.render()).includes('Guardar perfil'));
});

test('account notification and privacy destinations wire different scopes of the same server controls',()=>{
 for(const [section,scope]of [['notifications','notifications'],['privacy','sharing']] as const){
  const tree=elements(panel(section).render());
  assert.equal(tree.filter(e=>e.props.section===scope&&e.props.accessToken==='synthetic-not-a-token').length,1);
  assert.equal(tree.filter(e=>e.props.section===(scope==='sharing'?'notifications':'sharing')).length,0);
 }
});

test('scoped social controls hide unrelated settings without changing the persisted API contract',()=>{
 const source=ts.transpileModule(readFileSync('app/components/cloud-social-activity.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const section of ['sharing','notifications','all']){
  let slot=0;const exports:Record<string,(props:unknown)=>unknown>={};
  const jsx=(type:unknown,props:Record<string,unknown>)=>({type,props});
  runInNewContext(source,{exports,require:(id:string)=>id==='react'?{useState:(initial:unknown)=>[slot++===0?{}:initial,()=>{}],useRef:()=>({current:false}),useEffect:()=>{}}:id==='react/jsx-runtime'?{jsx,jsxs:jsx}:new Proxy({},{get:()=>()=>{}})});
  const tree=exports.SocialSharingPreferences({accessToken:'synthetic',section});
  const labels=elements(tree).filter(e=>e.type==='label').map(e=>text(e));
  assert.equal(labels.length,section==='all'?10:5);
  assert.equal(labels.includes('Compartir rondas terminadas'),section!=='notifications');
  assert.equal(labels.includes('Avisarme de likes'),section!=='sharing');
 }
});
test("profile has one configuration destination and its panel retains all sections", () => {
  const h = panel("account", "profile");
  const button = elements(h.render()).find(e => e.type === "button" && text(e).startsWith("Configuración"))!;
  (button.props.onClick as () => void)();
  assert.deepEqual(h.opened, ["preferences"]);
  assert.deepEqual(ACCOUNT_SETTINGS.map((section) => section.label), ["Preferencias", "Notificaciones", "Cuenta y privacidad", "Privacidad y permisos"]);
});
test("account destination remounts independently of retained profile component state", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /key=\{\`\$\{identity\.userId\}:account:\$\{accountSection\}\`\}/);
});
test("QR keeps sharing and clipboard but no longer renders a technical Preview URL", () => {
  const source = readFileSync("app/components/social-qr.tsx", "utf8");
  assert.doesNotMatch(source, /<input[^>]*value=\{link\}/);
  assert.match(source, /navigator\.clipboard\.writeText\(link\)/);
  assert.match(source, /Compartir enlace/);
  assert.match(source, /Guardar \/ compartir imagen/);
});

test("membership return uses the shared touch control and safe-area instead of an unstyled legal link", () => {
  const page = readFileSync("app/membership/page.tsx", "utf8");
  assert.match(page, /className="membershipTopbar"/);
  assert.match(page, /className="secondary" href="\/\?view=account"/);
  assert.doesNotMatch(page, /legalTopbar/);
  const css = readFileSync("app/design-system.css", "utf8");
  assert.match(css, /\.membershipTopbar \{[^}]*env\(safe-area-inset-top\)/);
});

test("community cards use their text-only layout while retaining all existing destinations", () => {
  const source = ts.transpileModule(readFileSync("app/components/more-hub.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, (props: unknown) => unknown> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  runInNewContext(source, { exports, require: (id: string) => id === "react/jsx-runtime" ? { jsx, jsxs: jsx } : id.endsWith(".css") ? { default: new Proxy({}, { get: (_target, key) => key }) } : {} });
  const destinations: string[] = [];
  const tree = elements(exports.MoreHub({ onOpenSocial: (view: string) => destinations.push(view), onOpenPrivacy: () => destinations.push("privacy") }));
  const community = tree.find(e => e.type === "div" && e.props.className === "grid communityGrid");
  assert.ok(community);
  const buttons = elements(community).filter(e => e.type === "button");
  assert.deepEqual(buttons.map(text), ["Amigos y solicitudes›", "Agregar amigos›", "Mi QR›", "Escanear QR›", "Preferencias de notificaciones›", "Privacidad›"]);
  buttons.forEach(button => (button.props.onClick as () => void)());
  assert.deepEqual(destinations, ["friends", "friends", "qr", "scan", "preferences", "privacy"]);
  assert.equal(tree.filter(e => e.type === "div" && e.props.className === "grid").length, 1);
});

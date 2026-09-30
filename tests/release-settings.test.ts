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
function panel(initialAccountSection = "account", view = "account", focusSection: "profile" | "equipment" = "profile") {
  const slots: unknown[] = []; let cursor = 0;
  const state = (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], (next: unknown) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const opened: string[] = [];
  let pageBackCalls = 0;
  const confirmations: string[] = [];
  let confirmResult = false;
  const dependencies: Record<string, unknown> = {
    react: { useState: state, useRef: (initial: unknown) => state({ current: initial })[0], useEffect: () => {}, useLayoutEffect: () => {} },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "../../lib/account-settings": { ACCOUNT_SETTINGS },
    "../../lib/account-ui-preferences": { DEFAULT_ACCOUNT_UI_PREFERENCES, displayDistanceFromStoredYards, readAccountUiPreferences, writeAccountUiPreferences },
    "../../lib/legal-config": { LEGAL_DOCUMENT_VERSIONS: {}, legalConfig: {} },
    "../../lib/handicap-source": { selectedHandicapIndex: () => ({ source: "BACKYARD" }) },
    "./account-provider": { useBackyardAccount: () => ({ identity: { userId: "synthetic", mode: "authenticated", displayName: "QA", accessToken: "synthetic-not-a-token", providers: ["email"] }, acceptances: [], cloudIssues: [] }) },
    "./bottom-back-action": { BottomBackAction: "bottom-back-action" },
  };
  const exports: Record<string, (props: unknown) => unknown> = {};
  const source = ts.transpileModule(readFileSync("app/components/profile-account-panel.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(source, {
    exports,
    window: { confirm: (message: string) => { confirmations.push(message); return confirmResult; }, requestAnimationFrame: (callback: () => void) => callback() },
    document: { getElementById: () => null },
    require: (id: string) => dependencies[id] || new Proxy({}, { get: (_object, name) => name === "__esModule" ? true : () => undefined }),
  });
  return {
    render: () => {
      cursor = 0;
      return exports.ProfileAccountPanel({
        view,
        focusSection,
        initialAccountSection,
        indexControl: {},
        highContrast: false,
        onHighContrastChange() {},
        notificationsEnabled: false,
        onNotificationsEnabledChange() {},
        onOpenAccountSection: (section: string) => opened.push(section),
        onOpenEquipment() {},
        onBackToProfile() {},
        onPageBack: () => { pageBackCalls += 1; },
      });
    },
    opened,
    confirmations,
    allowExit: () => { confirmResult = true; },
    pageBackCalls: () => pageBackCalls,
  };
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

test("Profile stays a root while Account owns one matching top and bottom page exit", () => {
  const profile = panel("account", "profile");
  assert.equal(elements(profile.render()).filter((element) => element.type === "bottom-back-action").length, 0);

  const account = panel();
  const tree = elements(account.render());
  const top = tree.find((element) => element.type === "button" && text(element) === "← Regresar");
  const bottoms = tree.filter((element) => element.type === "bottom-back-action");
  assert.ok(top);
  assert.equal(bottoms.length, 1);
  assert.equal(bottoms[0].props.label, "← Regresar");
  assert.equal(top.props.onClick, bottoms[0].props.onBack);
  (top.props.onClick as () => void)();
  (bottoms[0].props.onBack as () => void)();
  assert.equal(account.pageBackCalls(), 2);
});

test("nested Account screens do not inherit the generic Regresar pair", () => {
  const h = panel("privacy");
  let tree = h.render();
  const openAi = elements(tree).find((element) => element.type === "button" && text(element).includes("Autorizaciones de IA"));
  assert.ok(openAi);
  (openAi.props.onClick as () => void)();
  tree = h.render();
  const nested = elements(tree);
  assert.equal(nested.filter((element) => element.type === "button" && text(element) === "← Regresar").length, 0);
  const top = nested.find((element) => element.type === "button" && text(element) === "← Cuenta y privacidad");
  const bottoms = nested.filter((element) => element.type === "bottom-back-action");
  assert.ok(top);
  assert.equal(bottoms.length, 1);
  assert.equal(bottoms[0].props.label, "← Cuenta y privacidad");
  assert.equal(top.props.onClick, bottoms[0].props.onBack);

  (bottoms[0].props.onBack as () => void)();
  tree = h.render();
  assert.ok(elements(tree).some((element) => element.type === "button" && text(element).includes("Autorizaciones de IA")));
  assert.ok(elements(tree).some((element) => element.type === "button" && text(element) === "← Regresar"));
});

test("nested Equipment hides both parent Mi Perfil exits until the child reports root depth", () => {
  const h = panel("account", "profile", "equipment");
  let tree = elements(h.render());
  const parentTop = tree.find((element) => element.type === "button" && text(element) === "← Mi Perfil");
  const parentBottom = tree.find((element) => element.type === "bottom-back-action");
  const equipment = tree.find((element) => typeof element.props.onFlowDepthChange === "function");
  assert.ok(parentTop); assert.ok(parentBottom); assert.ok(equipment);
  assert.equal(parentTop.props.onClick, parentBottom.props.onBack);

  (equipment.props.onFlowDepthChange as (nested: boolean) => void)(true);
  tree = elements(h.render());
  assert.equal(tree.filter((element) => element.type === "button" && text(element) === "← Mi Perfil").length, 0);
  assert.equal(tree.filter((element) => element.type === "bottom-back-action").length, 0);

  const nestedEquipment = tree.find((element) => typeof element.props.onFlowDepthChange === "function");
  assert.ok(nestedEquipment);
  (nestedEquipment.props.onFlowDepthChange as (nested: boolean) => void)(false);
  tree = elements(h.render());
  const restoredTop = tree.find((element) => element.type === "button" && text(element) === "← Mi Perfil");
  const restoredBottom = tree.find((element) => element.type === "bottom-back-action");
  assert.ok(restoredTop); assert.ok(restoredBottom);
  assert.equal(restoredTop.props.onClick, restoredBottom.props.onBack);
});

test("profile editor top, cancel and bottom exits share one unsaved-change guard", () => {
  const h = panel();
  let tree = h.render();
  const edit = elements(tree).find((element) => element.type === "button" && text(element) === "Editar nombre y usuario");
  assert.ok(edit);
  (edit.props.onClick as () => void)();

  tree = h.render();
  let editor = elements(tree);
  const top = editor.find((element) => element.type === "button" && text(element) === "← Cuenta");
  const cancel = editor.find((element) => element.type === "button" && text(element) === "Cancelar");
  const bottom = editor.find((element) => element.type === "bottom-back-action");
  assert.ok(top); assert.ok(cancel); assert.ok(bottom);
  assert.equal(top.props.onClick, cancel.props.onClick);
  assert.equal(top.props.onClick, bottom.props.onBack);

  const displayName = editor.find((element) => element.type === "input" && element.props.placeholder === "Tu nombre");
  assert.ok(displayName);
  (displayName.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "QA editado" } });

  tree = h.render();
  editor = elements(tree);
  const guardedTop = editor.find((element) => element.type === "button" && text(element) === "← Cuenta");
  assert.ok(guardedTop);
  (guardedTop.props.onClick as () => void)();
  assert.equal(h.confirmations.length, 1);
  assert.match(h.confirmations[0], /cambios sin guardar/i);
  assert.ok(text(h.render()).includes("Guardar perfil"), "rejecting the prompt keeps the editor open");

  h.allowExit();
  tree = h.render();
  const guardedBottom = elements(tree).find((element) => element.type === "bottom-back-action");
  assert.ok(guardedBottom);
  (guardedBottom.props.onBack as () => void)();
  assert.equal(h.confirmations.length, 2);
  assert.ok(!text(h.render()).includes("Guardar perfil"), "accepting the prompt returns to Account");
});

test("a clean profile editor exit does not ask for confirmation", () => {
  const h = panel();
  let tree = h.render();
  const edit = elements(tree).find((element) => element.type === "button" && text(element) === "Editar nombre y usuario");
  assert.ok(edit);
  (edit.props.onClick as () => void)();
  tree = h.render();
  const bottom = elements(tree).find((element) => element.type === "bottom-back-action");
  assert.ok(bottom);
  (bottom.props.onBack as () => void)();
  assert.equal(h.confirmations.length, 0);
  assert.ok(!text(h.render()).includes("Guardar perfil"));
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
  assert.equal(labels.length,section==='all'?11:section==='notifications'?6:5);
  assert.equal(labels.includes('Compartir rondas terminadas'),section!=='notifications');
  assert.equal(labels.includes('Avisarme de likes'),section!=='sharing');
  assert.equal(labels.includes('Solicitudes de amistad'),section!=='sharing');
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
test("Account owns its Regresar pair instead of inheriting the generic app-shell button", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /\["welcome", "more", "play", "groups", "social", "profile", "account", "round"\]/);
  assert.match(page, /view="account"[\s\S]{0,1800}onPageBack=\{handlePageBack\}/);
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

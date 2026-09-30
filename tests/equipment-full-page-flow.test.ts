import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const panel = readFileSync("app/components/equipment-profile-panel.tsx", "utf8");
const editors = readFileSync("app/components/equipment-editors.tsx", "utf8");
const styles = readFileSync("app/components/equipment.module.css", "utf8");
const persistence = readFileSync("app/components/use-equipment-profile.ts", "utf8");

type TestNode = { type: unknown; props: Record<string, unknown> };

function testNodes(value: unknown): TestNode[] {
  if (Array.isArray(value)) return value.flatMap(testNodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as TestNode;
  return [node, ...testNodes(node.props.children)];
}

function distanceEditorHarness() {
  const slots: unknown[] = [];
  let cursor = 0;
  let confirmResult = false;
  let cancelCalls = 0;
  const confirmations: string[] = [];
  const exports: Record<string, (props: Record<string, unknown>) => TestNode> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => typeof type === "function" ? type(props) : { type, props };
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next; }];
    },
    useMemo(fn: () => unknown) { return fn(); },
    useLayoutEffect(fn: () => void) { fn(); },
  };
  const compiled = ts.transpileModule(editors, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(compiled, {
    exports,
    window: {
      scrollTo() {},
      confirm(message: string) { confirmations.push(message); return confirmResult; },
    },
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "./use-modal-dialog") return { useModalDialog: () => ({}), useWizardStepNavigation() {} };
      if (name === "./bottom-back-action") return { BottomBackAction: (props: Record<string, unknown>) => ({ type: "bottom-back-action", props }) };
      if (name.endsWith("/equipment-bag-management")) return {
        BAG_CATEGORY_SECTIONS: [
          { label: "Driver", categories: ["DRIVER"] },
          { label: "Mini Driver", categories: ["MINI_DRIVER"] },
          { label: "Maderas", categories: ["FAIRWAY_WOOD"] },
          { label: "Híbridos", categories: ["HYBRID"] },
          { label: "Utility", categories: ["UTILITY_IRON"] },
          { label: "Hierros", categories: ["IRON_SET"] },
          { label: "Wedges", categories: ["WEDGE"] },
          { label: "Putter", categories: ["PUTTER"] },
        ],
      };
      if (name.endsWith("/equipment-editor-selection")) return {
        catalogClubGenerationOptions: () => [], catalogClubLofts: () => [], clubHandednessFromProfile: () => "RH",
        groupCatalogClubModels: () => [], isClubHandednessAllowed: () => true, parseUniversalWedgeLoft: () => null,
        resolveCatalogShaftSelection: () => null, UNIVERSAL_WEDGE_LOFTS: [], verifiedClubHandedness: () => ["RH", "LH"],
      };
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => String(key) }) };
      return new Proxy({}, { get: (_target, key) => key === "__esModule" ? true : () => undefined });
    },
  });
  let tree: TestNode;
  function render() {
    cursor = 0;
    tree = exports.ClubDistanceEditor({
      userId: "owner", clubId: "club-driver", clubLabel: "Driver", existing: null, presentation: "page",
      onCancel: () => { cancelCalls += 1; }, onSave: () => true,
    });
    return tree;
  }
  render();
  return {
    render,
    nodes: () => testNodes(tree),
    confirmations,
    cancelCalls: () => cancelCalls,
    allowExit: () => { confirmResult = true; },
  };
}

test("Mi Bolsa opens full-page club, ball and distance editors, not add/edit bottom sheets", () => {
  for (const screen of ["club-editor", "ball-editor", "distance-editor"]) {
    assert.match(panel, new RegExp(`data-equipment-screen="${screen}"`));
  }
  assert.equal((panel.match(/presentation="page"/g) || []).length, 3);
  assert.match(editors, /presentation === "page" \? styles\.editorPageShell : styles\.editorBackdrop/);
  assert.match(editors, /presentation === "sheet" \? "dialog" : undefined/);
  assert.match(editors, /useModalDialog\(presentation === "sheet", handleExit\)/);
  assert.match(styles, /\.editorPageShell \{[^}]*min-height: calc\(100dvh - 160px\)/);
  assert.match(styles, /\.editorPage,/);
});

test("full-page equipment editors repeat the exact cancel handler only at the bottom of page presentation", () => {
  const club = editors.slice(editors.indexOf("export function ClubEditor"), editors.indexOf("export function BallEditor"));
  const ball = editors.slice(editors.indexOf("export function BallEditor"), editors.indexOf("export function ClubDistanceEditor"));
  const distance = editors.slice(editors.indexOf("export function ClubDistanceEditor"));

  for (const [name, source] of [["club", club], ["ball", ball], ["distance", distance]] as const) {
    assert.match(source, /className=\{styles\.pageBack\} onClick=\{handleExit\}/, `${name} top exit`);
    assert.match(source, /\{presentation === "page" && <BottomBackAction label="\u2190 Volver a Mi Bolsa" onBack=\{handleExit\} \/>\}/, `${name} bottom exit`);
    assert.match(source, /function handleExit\(\) \{[\s\S]*window\.confirm\(UNSAVED_EQUIPMENT_MESSAGE\)[\s\S]*onCancel\(\)/, `${name} guarded exit`);
  }
  assert.equal((editors.match(/<BottomBackAction label="← Volver a Mi Bolsa" onBack=\{handleExit\}/g) || []).length, 3);
});

test("equipment bottom exit shares the top handler and protects dirty changes", () => {
  const clean = distanceEditorHarness();
  const cleanNodes = clean.nodes();
  const cleanTop = cleanNodes.find((node) => node.type === "button" && node.props.className === "pageBack");
  const cleanBottom = cleanNodes.find((node) => node.type === "bottom-back-action");
  assert.ok(cleanTop); assert.ok(cleanBottom);
  assert.equal(cleanTop.props.onClick, cleanBottom.props.onBack);
  (cleanBottom.props.onBack as () => void)();
  assert.equal(clean.confirmations.length, 0);
  assert.equal(clean.cancelCalls(), 1);

  const dirty = distanceEditorHarness();
  const carry = dirty.nodes().find((node) => node.type === "input" && node.props.placeholder === "Ej. 155");
  assert.ok(carry);
  (carry.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "155" } });
  dirty.render();

  let dirtyNodes = dirty.nodes();
  const guardedBottom = dirtyNodes.find((node) => node.type === "bottom-back-action");
  assert.ok(guardedBottom);
  (guardedBottom.props.onBack as () => void)();
  assert.equal(dirty.confirmations.length, 1);
  assert.equal(dirty.cancelCalls(), 0);

  dirty.allowExit();
  dirtyNodes = dirty.nodes();
  const guardedTop = dirtyNodes.find((node) => node.type === "button" && node.props.className === "pageBack");
  assert.ok(guardedTop);
  (guardedTop.props.onClick as () => void)();
  assert.equal(dirty.confirmations.length, 2);
  assert.equal(dirty.cancelCalls(), 1);
});

test("category-to-form flow keeps distinct equipment inputs and a manual shaft fallback", () => {
  assert.match(editors, /step === "category"/);
  assert.match(editors, /const category = section\.categories\[0\]/);
  assert.match(editors, /onClick=\{\(\) => chooseCategory\(category\)\}/);
  assert.match(editors, /onSelectBall && <button type="button" aria-label="Bola" onClick=\{onSelectBall\}>/);
  assert.match(editors, /<GolfBallVisual \/><\/span><b>Bola<\/b><strong aria-hidden="true">›<\/strong>/);
  assert.match(panel, /onSelectBall=\{\(\) => \{ setClubEditor\(null\); setNewClubCategory\(null\); setBallEditor\("new"\); \}\}/);
  assert.match(editors, /CLUB_CATEGORY_LABELS\[category\]\} · especificaciones/);
  assert.match(editors, /category === "IRON_SET"/);
  assert.match(editors, /category === "WEDGE"/);
  assert.match(editors, /category === "PUTTER"/);
  assert.match(editors, /Mi bastón no aparece/);
  assert.match(editors, /Mi varilla no aparece/);
  assert.match(editors, /customShaftBrand: savedShaftBrand \|\| null/);
  assert.match(editors, /customShaftModel: savedShaftModel \|\| null/);
  assert.match(editors, /Sin varilla \/ No sé/);
});

test("successful local save leads to add-another, bag and profile destinations; failed save stays editable", () => {
  assert.match(panel, /if \(saved\) \{\s*setClubEditor\(null\);\s*setNewClubCategory\(null\);\s*setClubDetailId\(club\.id\);\s*setFlowSuccess/);
  assert.match(panel, /if \(saved\) \{\s*setBallEditor\(null\);\s*setFlowSuccess/);
  assert.match(panel, /data-equipment-screen="success"/);
  assert.match(panel, /setFlowSuccess\(null\); setClubDetailId\(null\); setNewClubCategory\(null\); setClubEditor\("new"\); \}\}>Agregar otro/);
  assert.match(panel, /Volver a Mi Bolsa/);
  assert.match(panel, /onBackToProfile && <button[^>]*onClick=\{onBackToProfile\}>Volver a Perfil/);
  assert.match(editors, /if \(saved === false\) setMessage\("No se confirmó el guardado en este dispositivo/);
  assert.match(persistence, /saveEquipmentProfile\(localStorage, normalized\)/);
  assert.match(persistence, /queueEquipmentSyncOutbox\(localStorage, userId, result\.profile, mutationId\(\)\)/);
  assert.match(persistence, /if \(cloudEnabledRef\.current\) enqueueSync\(activeScopeRef\.current\)/);
  assert.match(panel, /className=\{styles\.profileClubButton\} onClick=\{onOpen\} aria-label=\{`Editar \$\{clubName\(club, catalogItems\)\}`\}/);
  assert.match(panel, /data-equipment-screen="club-detail"/);
});

test("club, ball and manual-distance removal require an in-app confirmation and preserve round snapshots", () => {
  assert.match(panel, /type EquipmentDeleteIntent/);
  assert.match(panel, /data-equipment-screen="delete-confirm"/);
  assert.match(panel, /removePlayerClub\(current, deleteIntent\.club\.id\)/);
  assert.match(panel, /removePlayerBall\(current, deleteIntent\.ball\.id\)/);
  assert.match(panel, /removePlayerClubDistance\(current, deleteIntent\.distance\.id\)/);
  assert.match(panel, /Las rondas históricas conservan sus propios snapshots y no cambian/);
  assert.match(panel, /onClick=\{confirmDelete\}>Eliminar de Mi Bolsa/);
  assert.doesNotMatch(panel, /window\.confirm\(`¿Eliminar \$\{clubName/);
});

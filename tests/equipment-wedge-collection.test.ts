import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

import { sortCurrentWedges, wedgeLoftSummary } from "../lib/equipment-bag-management";
import { reconcileEquipmentProfiles } from "../lib/equipment-sync";
import {
  createEmptyEquipmentProfile,
  decodeEquipmentProfile,
  encodeEquipmentProfile,
  removePlayerClub,
  upsertPlayerClub,
  type EquipmentProfile,
  type PlayerClub,
} from "../lib/golf-equipment";

const USER_ID = "wedge-collection-owner";
const CREATED_AT = "2026-09-30T12:00:00.000Z";

function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value as T;
}

function wedge(input: {
  id: string;
  brand: string;
  model: string;
  loft: number;
  catalogClubId?: string;
  updatedAt?: string;
}): PlayerClub {
  const updatedAt = input.updatedAt || CREATED_AT;
  return {
    id: input.id,
    userId: USER_ID,
    category: "WEDGE",
    catalogClubId: input.catalogClubId || `catalog-${input.id}`,
    customBrand: input.brand,
    customModel: input.model,
    generation: "2026",
    year: 2026,
    loft: input.loft,
    handedness: "RH",
    shaftId: null,
    customShaftBrand: null,
    customShaftModel: null,
    customShaft: null,
    flex: null,
    shaftFlexLabel: null,
    shaftWeightGrams: null,
    lengthInches: null,
    lieDegrees: null,
    grip: null,
    notes: null,
    setComposition: [],
    isCurrent: true,
    startedUsingAt: CREATED_AT,
    stoppedUsingAt: null,
    createdAt: CREATED_AT,
    updatedAt,
  };
}

const TITLEIST_50 = wedge({ id: "wedge-titleist-50", brand: "Titleist", model: "Vokey SM10", loft: 50 });
const CLEVELAND_54 = wedge({ id: "wedge-cleveland-54", brand: "Cleveland", model: "RTX ZipCore", loft: 54 });
const CALLAWAY_58 = wedge({ id: "wedge-callaway-58", brand: "Callaway", model: "Opus", loft: 58 });

type RenderNode = { type: unknown; props: Record<string, unknown> };

function renderNodes(value: unknown): RenderNode[] {
  if (Array.isArray(value)) return value.flatMap(renderNodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as RenderNode;
  return [node, ...renderNodes(node.props.children)];
}

function renderedText(value: unknown): string {
  if (Array.isArray(value)) return value.map(renderedText).join(" ");
  if (value && typeof value === "object") return renderedText((value as RenderNode).props?.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function wedgeManagerHarness(initialWedges: PlayerClub[]) {
  const slots: unknown[] = [];
  let cursor = 0;
  let wedges = [...initialWedges];
  let tree: RenderNode;
  const deleteCalls: PlayerClub[] = [];
  const saveCalls: PlayerClub[] = [];
  const distanceCalls: PlayerClub[] = [];
  const componentExports: Record<string, (props: Record<string, unknown>) => RenderNode> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => (
    typeof type === "function" ? type(props) : { type, props }
  );
  const react = {
    useId() {
      const index = cursor++;
      if (!(index in slots)) slots[index] = `wedge-test-${index}`;
      return slots[index];
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[index], (next: unknown) => {
        slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(factory: () => unknown) {
      cursor += 1;
      return factory();
    },
    useLayoutEffect(effect: () => void) {
      cursor += 1;
      effect();
    },
  };
  const source = ts.transpileModule(readFileSync("app/components/wedge-collection-editor.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(source, {
    exports: componentExports,
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "next/image") return { default: (props: Record<string, unknown>) => ({ type: "image", props }) };
      if (name === "./catalog-product-media") return {
        CatalogProductMedia: (props: Record<string, unknown>) => ({ type: "catalog-product-media", props }),
      };
      if (name === "./equipment-category-assets") return {
        EQUIPMENT_CATEGORY_ASSETS: { WEDGE: { src: "/approved/wedge.png", width: 1006, height: 412 } },
      };
      if (name === "./equipment-editors") return {
        ClubEditor: (props: Record<string, unknown>) => ({ type: "club-editor", props }),
      };
      if (name.endsWith("/equipment-bag-management")) return { sortCurrentWedges };
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => String(key) }) };
      throw new Error(`unexpected_require:${name}`);
    },
  });

  function render() {
    cursor = 0;
    tree = componentExports.WedgeCollectionEditor({
      userId: USER_ID,
      catalog: [],
      shafts: [],
      wedges,
      defaultHandedness: "right",
      onBack() {},
      onSave(club: PlayerClub) {
        saveCalls.push(club);
        wedges = [...wedges.filter((candidate) => candidate.id !== club.id), club];
        return true;
      },
      onDelete(club: PlayerClub) {
        deleteCalls.push(club);
        wedges = wedges.filter((candidate) => candidate.id !== club.id);
        return true;
      },
      onManageDistance(club: PlayerClub) {
        distanceCalls.push(club);
      },
    });
    return tree;
  }

  function clickButton(predicate: (node: RenderNode) => boolean) {
    const button = renderNodes(tree).find((node) => node.type === "button" && predicate(node));
    assert.ok(button, "expected wedge manager button");
    (button.props.onClick as (event: { currentTarget: { isConnected: boolean; focus(): void } }) => void)({
      currentTarget: { isConnected: true, focus() {} },
    });
    return render();
  }

  render();
  return {
    render,
    clickButton,
    nodes: () => renderNodes(tree),
    saveCalls,
    deleteCalls,
    distanceCalls,
    wedges: () => wedges,
  };
}

function emptyProfile() {
  return required(createEmptyEquipmentProfile(USER_ID, CREATED_AT));
}

function addClub(profile: EquipmentProfile, club: PlayerClub, now = club.updatedAt) {
  return required(upsertPlayerClub(profile, club, now));
}

function threeWedgeProfile() {
  let profile = emptyProfile();
  profile = addClub(profile, TITLEIST_50, "2026-09-30T12:01:00.000Z");
  profile = addClub(profile, { ...CLEVELAND_54, updatedAt: "2026-09-30T12:02:00.000Z" });
  profile = addClub(profile, { ...CALLAWAY_58, updatedAt: "2026-09-30T12:03:00.000Z" });
  return profile;
}

test("three current wedges persist independently with different lofts and brands", () => {
  const wedges = sortCurrentWedges(threeWedgeProfile().clubs);

  assert.deepEqual(wedges.map((club) => club.id), [TITLEIST_50.id, CLEVELAND_54.id, CALLAWAY_58.id]);
  assert.deepEqual(wedges.map((club) => club.loft), [50, 54, 58]);
  assert.deepEqual(wedges.map((club) => club.customBrand), ["Titleist", "Cleveland", "Callaway"]);
  assert.ok(wedges.every((club) => club.category === "WEDGE" && club.isCurrent));
});

test("the same catalog wedge remains two physical clubs when its ids and lofts differ", () => {
  const sharedCatalogId = "catalog-titleist-vokey-sm10";
  let profile = emptyProfile();
  profile = addClub(profile, wedge({
    id: "vokey-54",
    brand: "Titleist",
    model: "Vokey SM10",
    catalogClubId: sharedCatalogId,
    loft: 54,
  }));
  profile = addClub(profile, wedge({
    id: "vokey-58",
    brand: "Titleist",
    model: "Vokey SM10",
    catalogClubId: sharedCatalogId,
    loft: 58,
    updatedAt: "2026-09-30T12:01:00.000Z",
  }));

  const wedges = sortCurrentWedges(profile.clubs);
  assert.equal(wedges.length, 2);
  assert.deepEqual(wedges.map((club) => club.id), ["vokey-54", "vokey-58"]);
  assert.deepEqual(wedges.map((club) => club.loft), [54, 58]);
  assert.ok(wedges.every((club) => club.catalogClubId === sharedCatalogId));
});

test("upserting another wedge never archives or replaces the current collection", () => {
  const before = threeWedgeProfile();
  const mizuno = wedge({
    id: "wedge-mizuno-60",
    brand: "Mizuno",
    model: "T24",
    loft: 60,
    updatedAt: "2026-09-30T12:04:00.000Z",
  });
  const after = addClub(before, mizuno);

  assert.deepEqual(sortCurrentWedges(after.clubs).map((club) => club.id), [
    TITLEIST_50.id,
    CLEVELAND_54.id,
    CALLAWAY_58.id,
    mizuno.id,
  ]);
  assert.ok([TITLEIST_50.id, CLEVELAND_54.id, CALLAWAY_58.id].every((id) => (
    after.clubs.find((club) => club.id === id)?.isCurrent === true
  )));
  assert.equal(after.clubs.filter((club) => club.category === "WEDGE").length, 4);
});

test("editing by the same id changes only the selected wedge", () => {
  const before = threeWedgeProfile();
  const untouchedBefore = before.clubs
    .filter((club) => club.id !== CLEVELAND_54.id)
    .map((club) => structuredClone(club));
  const target = required(before.clubs.find((club) => club.id === CLEVELAND_54.id));
  const after = addClub(before, {
    ...target,
    loft: 56,
    updatedAt: "2026-09-30T12:05:00.000Z",
  });

  assert.equal(after.clubs.length, before.clubs.length);
  assert.equal(after.clubs.find((club) => club.id === CLEVELAND_54.id)?.loft, 56);
  assert.deepEqual(
    untouchedBefore,
    before.clubs
      .filter((club) => club.id !== CLEVELAND_54.id)
      .map((club) => structuredClone(after.clubs.find((saved) => saved.id === club.id))),
  );
});

test("removing one wedge by id leaves the other physical wedges untouched", () => {
  const before = threeWedgeProfile();
  const after = required(removePlayerClub(before, TITLEIST_50.id, "2026-09-30T12:06:00.000Z"));

  assert.deepEqual(sortCurrentWedges(after.clubs).map((club) => club.id), [CLEVELAND_54.id, CALLAWAY_58.id]);
  assert.equal(after.clubs.some((club) => club.id === TITLEIST_50.id), false);
});

test("the versioned EquipmentProfile roundtrip preserves every wedge", () => {
  const original = threeWedgeProfile();
  const encoded = required(encodeEquipmentProfile(original, "2026-09-30T12:07:00.000Z"));
  const restored = required(decodeEquipmentProfile(encoded, USER_ID));

  assert.deepEqual(
    sortCurrentWedges(restored.clubs).map((club) => [club.id, club.catalogClubId, club.customBrand, club.customModel, club.loft]),
    sortCurrentWedges(original.clubs).map((club) => [club.id, club.catalogClubId, club.customBrand, club.customModel, club.loft]),
  );
});

test("the grouped wedge summary is ordered, uses middle dots and preserves duplicate lofts", () => {
  const profile = threeWedgeProfile();
  assert.equal(wedgeLoftSummary(profile.clubs), "50° · 54° · 58°");
  assert.doesNotMatch(wedgeLoftSummary(profile.clubs), /50°[–-]58°/);

  const duplicateLoft = wedge({
    id: "wedge-ping-54",
    brand: "PING",
    model: "s159",
    loft: 54,
    updatedAt: "2026-09-30T12:08:00.000Z",
  });
  const withDuplicate = addClub(profile, duplicateLoft);
  assert.equal(wedgeLoftSummary(withDuplicate.clubs), "50° · 54° · 54° · 58°");
  assert.deepEqual(sortCurrentWedges(withDuplicate.clubs).map((club) => club.id), [
    TITLEIST_50.id,
    CLEVELAND_54.id,
    duplicateLoft.id,
    CALLAWAY_58.id,
  ]);
});

test("the real WedgeCollectionEditor orders three cards and edits the exact second wedge", () => {
  const view = wedgeManagerHarness([CALLAWAY_58, TITLEIST_50, CLEVELAND_54]);
  const cardLabels = view.nodes()
    .filter((node) => node.type === "button" && String(node.props["aria-label"] || "").startsWith("Editar wedge "))
    .map((node) => String(node.props["aria-label"]));

  assert.deepEqual(cardLabels, [
    "Editar wedge 1, 50 grados, Titleist Vokey SM10",
    "Editar wedge 2, 54 grados, Cleveland RTX ZipCore",
    "Editar wedge 3, 58 grados, Callaway Opus",
  ]);

  view.clickButton((node) => String(node.props["aria-label"] || "").startsWith("Editar wedge 2,"));
  const editor = view.nodes().find((node) => node.type === "club-editor");
  assert.ok(editor);
  assert.equal((editor.props.existing as PlayerClub).id, CLEVELAND_54.id);
  assert.equal(editor.props.wedgeOrdinal, 2);
});

test("adding another wedge mounts a fourth embedded editor and a successful save returns to the list", () => {
  const view = wedgeManagerHarness([CALLAWAY_58, TITLEIST_50, CLEVELAND_54]);
  view.clickButton((node) => renderedText(node.props.children).includes("Agregar otro wedge"));

  const editor = view.nodes().find((node) => node.type === "club-editor");
  assert.ok(editor);
  assert.equal(editor.props.existing, null);
  assert.equal(editor.props.initialCategory, "WEDGE");
  assert.equal(editor.props.presentation, "embedded");
  assert.equal(editor.props.wedgeOrdinal, 4);

  const mizuno = wedge({ id: "wedge-mizuno-60", brand: "Mizuno", model: "T24", loft: 60 });
  assert.equal((editor.props.onSave as (club: PlayerClub) => boolean)(mizuno), true);
  view.render();

  assert.deepEqual(view.saveCalls.map((club) => club.id), [mizuno.id]);
  assert.equal(view.nodes().some((node) => node.type === "club-editor"), false);
  assert.equal(view.nodes().filter((node) => (
    node.type === "button" && String(node.props["aria-label"] || "").startsWith("Editar wedge ")
  )).length, 4);
  assert.ok(view.wedges().some((club) => club.id === mizuno.id));
});

test("requesting deletion from an edited wedge confirms and deletes that exact id only", () => {
  const view = wedgeManagerHarness([CALLAWAY_58, TITLEIST_50, CLEVELAND_54]);
  view.clickButton((node) => String(node.props["aria-label"] || "").startsWith("Editar wedge 2,"));
  const editor = view.nodes().find((node) => node.type === "club-editor");
  assert.ok(editor);

  (editor.props.onRequestDelete as () => void)();
  view.render();
  const confirmation = view.nodes().find((node) => node.props.role === "alertdialog");
  assert.ok(confirmation);
  assert.match(renderedText(confirmation.props.children), /¿Eliminar\s+Cleveland RTX ZipCore\s*\?/);
  assert.match(renderedText(confirmation.props.children), /Sus distancias manuales también se quitarán/);

  view.clickButton((node) => renderedText(node.props.children).trim() === "Eliminar wedge");
  assert.deepEqual(view.deleteCalls.map((club) => club.id), [CLEVELAND_54.id]);
  assert.deepEqual(sortCurrentWedges(view.wedges()).map((club) => club.id), [TITLEIST_50.id, CALLAWAY_58.id]);
  assert.equal(view.nodes().some((node) => node.props.role === "alertdialog"), false);
});

test("an existing wedge keeps its manual-distance management route", () => {
  const view = wedgeManagerHarness([CALLAWAY_58, TITLEIST_50, CLEVELAND_54]);
  view.clickButton((node) => String(node.props["aria-label"] || "").startsWith("Editar wedge 2,"));
  const editor = view.nodes().find((node) => node.type === "club-editor");
  assert.ok(editor);
  assert.equal(typeof editor.props.onManageDistance, "function");

  (editor.props.onManageDistance as () => void)();
  assert.deepEqual(view.distanceCalls.map((club) => club.id), [CLEVELAND_54.id]);
});

test("concurrent local and remote wedge additions merge by id without losing either collection item", () => {
  const base = addClub(emptyProfile(), TITLEIST_50);
  const local = addClub(base, {
    ...CLEVELAND_54,
    updatedAt: "2026-09-30T12:02:00.000Z",
  });
  const remote = addClub(base, {
    ...CALLAWAY_58,
    updatedAt: "2026-09-30T12:03:00.000Z",
  });

  const result = reconcileEquipmentProfiles(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.needsUpload, true);
  assert.ok(result.profile);
  assert.deepEqual(sortCurrentWedges(result.profile.clubs).map((club) => [club.id, club.customBrand, club.loft]), [
    [TITLEIST_50.id, "Titleist", 50],
    [CLEVELAND_54.id, "Cleveland", 54],
    [CALLAWAY_58.id, "Callaway", 58],
  ]);
});

test("the shared wedge manager exposes collection, exact-item deletion and its embedded ClubEditor", () => {
  const source = readFileSync("app/components/wedge-collection-editor.tsx", "utf8");
  const editor = readFileSync("app/components/equipment-editors.tsx", "utf8");

  assert.match(source, /Tus wedges/i);
  assert.match(source, /Agregar otro wedge/i);
  assert.match(source, /const deleted = onDelete\(deleteTarget\)/);
  assert.match(source, /<ClubEditor\b/);
  assert.match(source, /presentation="embedded"/);
  assert.match(source, /wedgePeers=\{orderedWedges\}/);
  assert.match(source, /onManageDistance=\{selection === "new" \|\| !onManageDistance \? undefined/);
  assert.match(source, /returnFocusRef\.current\?\.isConnected/);
  assert.match(source, /orderedWedges\.map\(\(club/);
  assert.doesNotMatch(source, /replaceCurrentPlayerClub/);
  assert.match(editor, /Ya tienes un wedge muy similar en tu bolsa\./);
  assert.match(editor, /Puedes guardarlo de todos modos; no fusionaremos ni eliminaremos ninguno\./);
  assert.match(editor, /presentation === "embedded"\) dialogRef\.current\?\.scrollIntoView/);
  assert.match(editor, /Gestionar distancia manual/);
});

test("onboarding and Profile use the same WedgeCollectionEditor entry point", () => {
  const onboarding = readFileSync("app/components/equipment-onboarding.tsx", "utf8");
  const profile = readFileSync("app/components/equipment-profile-panel.tsx", "utf8");

  for (const source of [onboarding, profile]) {
    assert.match(source, /import \{ WedgeCollectionEditor \} from "\.\/wedge-collection-editor"/);
    assert.match(source, /<WedgeCollectionEditor\b/);
  }
  assert.match(onboarding, /backLabel="Volver a Construye tu bolsa"/);
  assert.match(profile, /onManageDistance=\{\(club\) => \{ setWedgeCollectionOpen\(false\); setClubDetailId\(club\.id\); \}\}/);
});

test("a new wedge selects its required loft before brand without losing it at model selection", () => {
  const editor = readFileSync("app/components/equipment-editors.tsx", "utf8");

  assert.match(editor, /initialCategory === "WEDGE" \? "wedge-loft" : initialCategory \? "brand" : "category"/);
  assert.match(editor, /step === "wedge-loft"/);
  assert.match(editor, /Selecciona el loft de este wedge/);
  assert.match(editor, /Continuar a marca/);
  assert.match(editor, /if \(category !== "WEDGE"\) setLoft\(modelLofts\.length === 1/);
  assert.match(editor, /if \(category !== "WEDGE"\) setLoft\(""\)/);
});

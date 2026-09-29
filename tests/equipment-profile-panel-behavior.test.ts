import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

type Node = { type: unknown; props: Record<string, unknown> };

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object") return text((value as Node).props?.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const bagSections = [
  { id: "driver", label: "Driver", description: "Máxima distancia para tus tiros de salida.", categories: ["DRIVER"] },
  { id: "mini-driver", label: "Mini Driver", description: "Control desde el tee con una cabeza compacta.", categories: ["MINI_DRIVER"] },
  { id: "woods", label: "Maderas", description: "Versatilidad y distancia desde el fairway.", categories: ["FAIRWAY_WOOD"] },
  { id: "hybrids", label: "Híbridos", description: "Confianza desde cualquier lie.", categories: ["HYBRID"] },
  { id: "utility", label: "Utility / Driving Iron", description: "Trayectoria penetrante y control desde el tee.", categories: ["UTILITY_IRON"] },
  { id: "irons", label: "Hierros", description: "Precisión y control de distancia.", categories: ["IRON_SET"] },
  { id: "wedges", label: "Wedges", description: "Creatividad alrededor del green.", categories: ["WEDGE"] },
  { id: "putter", label: "Putter", description: "Decisión en los últimos golpes.", categories: ["PUTTER"] },
] as const;

const equipmentAssets = Object.fromEntries(bagSections.flatMap((section) => section.categories.map((category) => [category, {
  src: `/approved/${category.toLowerCase()}.png`, width: 1006, height: 412,
}])));

function harness() {
  const slots: unknown[] = [];
  let cursor = 0;
  const currentClub = {
    id: "club-driver", userId: "owner", category: "DRIVER", catalogClubId: "catalog-driver", customBrand: "Ping", customModel: "G430",
    generation: "2025", year: 2025, loft: 10.5, handedness: "RH", shaftId: null, customShaftBrand: null, customShaftModel: null,
    customShaft: null, flex: null, shaftFlexLabel: null, shaftWeightGrams: null, lengthInches: null, lieDegrees: null, grip: null,
    notes: null, setComposition: [], isCurrent: true, createdAt: "2026-09-28T10:00:00.000Z", updatedAt: "2026-09-28T10:00:00.000Z",
  };
  const currentClubs = [
    currentClub,
    { ...currentClub, id: "club-woods", category: "FAIRWAY_WOOD", catalogClubId: "catalog-woods", customBrand: "Cleveland", customModel: "Launcher DST" },
    { ...currentClub, id: "club-hybrid", category: "HYBRID", catalogClubId: "catalog-hybrid", customBrand: "Callaway", customModel: "Quantum Hybrid" },
    { ...currentClub, id: "club-irons", category: "IRON_SET", catalogClubId: "catalog-irons", customBrand: "Takomo", customModel: "Iron 101", setComposition: ["5", "6", "7", "8", "9", "PW"] },
    { ...currentClub, id: "club-wedge", category: "WEDGE", catalogClubId: "catalog-wedge", customBrand: "TaylorMade", customModel: "Hi-Toe 4", loft: 58 },
  ];
  const currentBall = {
    id: "player-ball", userId: "owner", catalogBallId: "ball-current", ballBrand: "Titleist", ballModel: "Pro V1", generation: "2025",
    year: 2025, color: "Blanca", notes: null, isCurrent: true, createdAt: "2026-09-28T10:00:00.000Z", updatedAt: "2026-09-28T10:00:00.000Z",
  };
  const profile = {
    userId: "owner", clubs: currentClubs, balls: [currentBall], distances: [], ballPreference: "FIXED",
    lastBallFit: {
      id: "legacy-fit", completedAt: "2026-09-28T12:00:00.000Z", currentBallId: currentBall.catalogBallId, inputCompleteness: 75,
      algorithmVersion: null, status: null, input: null, warnings: [],
      recommendations: [{
        catalogBallId: "ball-tour", matchScore: 91, brand: "Bridgestone", model: "Tour B X", generation: "2026", dataCoverage: null,
        why: ["Menor spin guardado"], attributes: null, comparisonToCurrent: ["Trayectoria más baja guardada"],
      }],
    },
  };
  const clubCatalog = [
    { id: "catalog-driver", brand: "Ping", model: "G430", generation: "2025" },
    { id: "catalog-woods", brand: "Cleveland", model: "Launcher DST", generation: "2013" },
    { id: "catalog-hybrid", brand: "Callaway", model: "Quantum Hybrid", generation: "2026" },
    { id: "catalog-irons", brand: "Takomo", model: "Iron 101", generation: "Original" },
    { id: "catalog-wedge", brand: "TaylorMade", model: "Hi-Toe 4", generation: "2024" },
  ];
  const ballCatalog = [
    { id: "ball-current", brand: "Titleist", model: "Pro V1", generation: "2025" },
    { id: "ball-tour", brand: "Bridgestone", model: "Tour B X", generation: "2026" },
  ];
  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => typeof type === "function" ? type(props) : { type, props };
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next; }];
    },
    useMemo(fn: () => unknown) { return fn(); },
  };
  const component = ts.transpileModule(readFileSync("app/components/equipment-profile-panel.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(component, {
    exports,
    window: { confirm: () => true },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "next/image") return { default: (props: Record<string, unknown>) => ({ type: "image", props }) };
      if (name === "./use-view-scroll-reset") return { useViewScrollReset() {} };
      if (name.endsWith("/ball-fitting")) return { restoreEquipmentBallFitSummary: () => null, toEquipmentBallFitSummary: () => null };
      if (name.endsWith("/ball-fitting-storage")) return { removeBallFitDraft() {} };
      if (name.endsWith("/ball-fit-handicap")) return { BALL_FIT_HANDICAP_LABELS: { UNKNOWN: "Sin índice" } };
      if (name.endsWith("/golf-equipment")) return new Proxy({}, { get: () => (value: unknown) => value });
      if (name === "./ball-fit-wizard") return {
        BallFitResults: (props: Record<string, unknown>) => ({ type: "ball-fit-results", props }),
        BallFitWizard: (props: Record<string, unknown>) => ({ type: "ball-fit-wizard", props }),
      };
      if (name === "./catalog-product-media") return { CatalogProductMedia: (props: Record<string, unknown>) => ({ type: "catalog-media", props }) };
      if (name === "./equipment-editors") return {
        BallEditor: (props: Record<string, unknown>) => ({ type: "ball-editor", props }),
        ClubDistanceEditor: (props: Record<string, unknown>) => ({ type: "distance-editor", props }),
        ClubEditor: (props: Record<string, unknown>) => ({ type: "club-editor", props }),
        CLUB_CATEGORY_ICONS: { DRIVER: "D" },
        CLUB_CATEGORY_LABELS: { DRIVER: "Driver", MINI_DRIVER: "Mini Driver", FAIRWAY_WOOD: "Maderas", HYBRID: "Híbridos", UTILITY_IRON: "Utility", IRON_SET: "Hierros", WEDGE: "Wedges", PUTTER: "Putter" },
      };
      if (name === "./use-equipment-profile") return {
        equipmentStatusLabel: () => "Guardado",
        useEquipmentProfile: () => ({ profile, status: "ready", message: "", update: () => true, retry() {}, resolveConflict() {}, recoverLocalProfile() {} }),
      };
      if (name === "./use-equipment-catalog-search") return { useEquipmentCatalogSearch: ({ kind }: { kind: string }) => ({ items: kind === "CLUB" ? clubCatalog : kind === "BALL" ? ballCatalog : [] }) };
      if (name === "./equipment-visuals") return {
        GolfBallVisual: (props: Record<string, unknown>) => ({ type: "ball-visual", props }),
      };
      if (name === "./equipment-category-assets") return { EQUIPMENT_CATEGORY_ASSETS: equipmentAssets };
      if (name.endsWith("/equipment-bag-management")) return {
        BAG_CATEGORY_SECTIONS: bagSections,
        bagCategoryManagement: (clubs: Array<{ category: string }>) => {
          const populated = bagSections.flatMap((section) => {
            const sectionClubs = clubs.filter((club) => section.categories.includes(club.category as never));
            return sectionClubs.length ? [{ ...section, clubs: sectionClubs }] : [];
          });
          const populatedIds = new Set(populated.map((section) => section.id));
          return { populated, missing: bagSections.filter((section) => !populatedIds.has(section.id)) };
        },
      };
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => String(key) }) };
      throw new Error(name);
    },
  });
  let tree: Node;
  function render() {
    cursor = 0;
    tree = exports.EquipmentProfilePanel({ userId: "owner", accessToken: "token", defaultHandicap: null });
    return tree;
  }
  function click(label: string, exact = true) {
    const button = nodes(tree).find((node) => node.type === "button" && (exact ? text(node.props.children).trim() === label : text(node.props.children).includes(label)));
    assert.ok(button, `button ${label}`);
    (button.props.onClick as () => void)();
    render();
  }
  render();
  return { render, click, nodes: () => nodes(tree), text: () => text(tree), currentClub, currentBall };
}

test("a compact missing category opens the club editor with that category preselected", () => {
  const view = harness();
  view.click("Utility / Driving Iron", false);
  const editor = view.nodes().find((node) => node.type === "club-editor");
  assert.ok(editor);
  assert.equal(editor.props.initialCategory, "UTILITY_IRON");
  assert.equal(editor.props.existing, null);
});

test("Mi Bolsa has compact canonical current equipment and one non-duplicated missing-category add zone", () => {
  const view = harness();
  const copy = view.text();

  assert.match(copy, /MI BOLSA\s+Equipo actual\s+Sólo los bastones que juegas actualmente\./);
  assert.ok(!view.nodes().some((node) => node.type === "button" && text(node.props.children).trim() === "+ Agregar"));

  const currentRow = view.nodes().find((node) => node.type === "button" && node.props["aria-label"] === "Editar Ping G430");
  assert.ok(currentRow);
  assert.match(text(currentRow.props.children), /Driver\s+Ping\s+G430\s+Driver\s+·\s+RH\s+Editar/);
  assert.ok(nodes(currentRow).some((node) => node.type === "image" && node.props.src === "/approved/driver.png"));

  const currentCategories = ["DRIVER", "FAIRWAY_WOOD", "HYBRID", "IRON_SET", "WEDGE"];
  const currentCards = view.nodes().filter((node) => currentCategories.includes(String(node.props["data-equipment-current-card"])));
  assert.equal(currentCards.length, currentCategories.length);
  for (const category of currentCategories) {
    const card = currentCards.find((node) => node.props["data-equipment-current-card"] === category);
    assert.ok(card, `${category} current card`);
    assert.ok(nodes(card).some((node) => node.type === "image"
      && node.props.src === `/approved/${category.toLowerCase()}.png`
      && node.props.loading === "eager"));
  }

  assert.match(copy, /CATEGORÍAS FALTANTES\s+Agrega el resto de tu bolsa\s+Elige una categoría para completar sus datos\./);
  const missingLabels = view.nodes()
    .filter((node) => node.type === "button" && String(node.props["aria-label"] || "").startsWith("Agregar "))
    .map((node) => node.props["aria-label"]);
  assert.deepEqual(missingLabels, ["Agregar Mini Driver", "Agregar Utility / Driving Iron", "Agregar Putter"]);
  assert.match(copy, /Control desde el tee con una cabeza compacta\./);
  assert.match(copy, /Trayectoria penetrante y control desde el tee\./);
  assert.match(copy, /Decisión en los últimos golpes\./);
});

test("club and ball Edit actions open their real editors", () => {
  const clubView = harness();
  const clubRow = clubView.nodes().find((node) => node.type === "button" && node.props["aria-label"] === "Editar Ping G430");
  assert.ok(clubRow);
  (clubRow.props.onClick as () => void)();
  clubView.render();
  clubView.click("Editar atributos");
  assert.equal(clubView.nodes().find((node) => node.type === "club-editor")?.props.existing, clubView.currentClub);

  const ballView = harness();
  ballView.click("Editar");
  assert.equal(ballView.nodes().find((node) => node.type === "ball-editor")?.props.existing, ballView.currentBall);
});

test("Actualizar fit opens the wizard and a legacy saved fit always has a useful Compare action", () => {
  const updateView = harness();
  updateView.click("Actualizar fit");
  assert.ok(updateView.nodes().some((node) => node.type === "ball-fit-wizard"));

  const compareView = harness();
  compareView.click("Comparar");
  assert.ok(compareView.nodes().some((node) => node.props["data-ball-fit-comparison"] === "saved-facts"));
  assert.ok(!compareView.nodes().some((node) => node.type === "ball-fit-results"));
  assert.match(compareView.text(), /Titleist\s+Pro V1/);
  assert.doesNotMatch(compareView.text(), /2025 · 2025/);
  assert.match(compareView.text(), /Bridgestone Tour B X/);
  assert.match(compareView.text(), /91% coincidencia/);
  assert.match(compareView.text(), /Trayectoria más baja guardada/);
  assert.match(compareView.text(), /Menor spin guardado/);
});

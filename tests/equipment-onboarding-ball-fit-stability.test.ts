import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as ballFitting from "../lib/ball-fitting";
import * as golfEquipment from "../lib/golf-equipment";
import { golfBallCatalog } from "../lib/golf-equipment-catalog";

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

test("Equipment onboarding keeps Ball Fit mounted while pinned-ball catalog refreshes", () => {
  const initial = golfEquipment.createEmptyEquipmentProfile("fit-owner", "2026-09-30T12:00:00.000Z");
  assert.ok(initial);
  let profile: golfEquipment.EquipmentProfile = {
    ...initial,
    equipmentOnboarding: "COMPLETED",
    ballOnboarding: "COMPLETED",
    ballPreference: "NO_FIXED_BALL",
  };
  const selected = golfBallCatalog.find((ball) => ball.active);
  assert.ok(selected);

  const slots: unknown[] = [];
  const effects: Array<() => void> = [];
  const pinnedBallSnapshots: string[][] = [];
  let cursor = 0;
  let ballCatalogItems = golfBallCatalog.slice(0, 8);
  let ballCatalogStatus = "success";

  const react = {
    useState(initialValue: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initialValue === "function" ? (initialValue as () => unknown)() : initialValue;
      return [slots[index], (next: unknown) => {
        slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next;
      }];
    },
    useRef(initialValue: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initialValue };
      return slots[index];
    },
    useMemo(factory: () => unknown) { return factory(); },
    useCallback(callback: unknown) { return callback; },
    useEffect(effect: () => void, dependencies: unknown[]) {
      const index = cursor++;
      const previous = slots[index] as unknown[] | undefined;
      if (!previous || dependencies.length !== previous.length || dependencies.some((value, dependencyIndex) => !Object.is(value, previous[dependencyIndex]))) effects.push(effect);
      slots[index] = dependencies;
    },
  };

  const component = ts.transpileModule(readFileSync("app/components/equipment-onboarding.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => typeof type === "function" ? type(props) : { type, props };

  runInNewContext(component, {
    exports,
    crypto: { randomUUID: () => "selected-player-ball" },
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "next/image") return { default: (props: Record<string, unknown>) => ({ type: "image", props }) };
      if (name === "./use-view-scroll-reset") return { useViewScrollReset() {} };
      if (name.endsWith("/ball-fitting")) return ballFitting;
      if (name.endsWith("/golf-equipment")) return golfEquipment;
      if (name === "./ball-fit-wizard") return {
        BallFitWizard: (props: Record<string, unknown>) => ({ type: "ball-fit-wizard", props }),
      };
      if (name === "./equipment-editors") return {
        BallEditor: (props: Record<string, unknown>) => ({ type: "ball-editor", props }),
        ClubEditor: (props: Record<string, unknown>) => ({ type: "club-editor", props }),
      };
      if (name === "./wedge-collection-editor") return {
        WedgeCollectionEditor: (props: Record<string, unknown>) => ({ type: "wedge-collection-editor", props }),
      };
      if (name === "./brand-lockup") return { BrandLockup: (props: Record<string, unknown>) => ({ type: "brand-lockup", props }) };
      if (name === "./use-equipment-profile") return {
        equipmentStatusLabel: () => "Guardado",
        useEquipmentProfile: () => ({
          profile,
          status: "ready",
          message: "",
          update(mutation: (current: golfEquipment.EquipmentProfile) => golfEquipment.EquipmentProfile | null) {
            const next = mutation(profile);
            if (!next) return false;
            profile = next;
            return true;
          },
          updateConfirmed(mutation: (current: golfEquipment.EquipmentProfile) => golfEquipment.EquipmentProfile | null) {
            const next = mutation(profile);
            if (!next) return null;
            profile = next;
            return profile;
          },
        }),
      };
      if (name === "./use-equipment-catalog-search") return {
        useEquipmentCatalogSearch: ({ kind, pinnedIds = [] }: { kind: string; pinnedIds?: string[] }) => {
          if (kind === "BALL") {
            pinnedBallSnapshots.push([...pinnedIds]);
            return { items: ballCatalogItems, status: ballCatalogStatus, hasMore: false, loadMore: async () => {}, retry() {} };
          }
          return { items: [], status: "success", hasMore: false, loadMore: async () => {}, retry() {} };
        },
      };
      if (name === "./equipment-visuals") return { GolfBallVisual: () => ({ type: "ball-visual", props: {} }) };
      if (name === "./equipment-category-assets") return { EQUIPMENT_CATEGORY_ASSETS: {} };
      if (name.endsWith("/equipment-bag-management")) return {
        BAG_CATEGORY_SECTIONS: [],
        sortCurrentWedges: () => [],
      };
      if (name.endsWith("/ball-fit-handicap")) return {};
      if (name.endsWith("/ball-fit-session")) return {
        mergeBallFitSessionCatalog: (current: golfEquipment.GolfBallCatalog[], incoming: golfEquipment.GolfBallCatalog[]) => [...new Map([...current, ...incoming].map((ball) => [ball.id, ball])).values()],
      };
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => String(key) }) };
      throw new Error(`unexpected_require:${name}`);
    },
  });

  let tree!: Node;
  function render() {
    cursor = 0;
    tree = exports.EquipmentOnboarding({
      userId: "fit-owner",
      accessToken: "token",
      defaultHandicap: null,
      onComplete() {},
      onBack() {},
      onSaveAndExit() {},
    });
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  function click(label: string) {
    const button = nodes(tree).find((node) => node.type === "button" && text(node.props.children).trim() === label);
    assert.ok(button, `button ${label}`);
    (button.props.onClick as () => void)();
    render();
  }

  render();
  render();
  click("Hacer Ball Fit");
  let wizard = nodes(tree).find((node) => node.type === "ball-fit-wizard");
  assert.ok(wizard, "the valid initial catalog mounts Ball Fit");
  const initialCatalog = wizard.props.catalog as golfEquipment.GolfBallCatalog[];
  const initialSessionId = wizard.props.sessionId;
  assert.ok(initialCatalog.length > 0);
  assert.equal(initialSessionId, "selected-player-ball");

  const persisted = (wizard.props.onCurrentBallSelect as (ball: golfEquipment.GolfBallCatalog) => golfEquipment.PlayerBall | null)(selected);
  assert.equal(persisted?.catalogBallId, selected.id);
  assert.equal(profile.balls.find((ball) => ball.isCurrent)?.catalogBallId, selected.id);

  // Saving the current ball changes pinnedIds. Model the old hook behavior's
  // transient empty result while its background request is in flight.
  ballCatalogItems = [];
  ballCatalogStatus = "loading";
  render();

  wizard = nodes(tree).find((node) => node.type === "ball-fit-wizard");
  assert.ok(wizard, "a pinned-id refresh must not unmount the active fitting");
  assert.doesNotMatch(text(tree), /Cargando catálogo de bolas/);
  assert.equal(wizard.props.sessionId, initialSessionId, "the active fitting session remains the same during refresh");
  assert.deepEqual((wizard.props.catalog as golfEquipment.GolfBallCatalog[]).map((ball) => ball.id), initialCatalog.map((ball) => ball.id));
  assert.ok(pinnedBallSnapshots.at(-1)?.includes(selected.id), "the refresh was caused by the newly pinned current ball");

  const refreshedBall = golfBallCatalog.find((ball) => !initialCatalog.some((current) => current.id === ball.id));
  assert.ok(refreshedBall);
  ballCatalogItems = [refreshedBall];
  ballCatalogStatus = "success";
  render(); render();
  wizard = nodes(tree).find((node) => node.type === "ball-fit-wizard");
  const refreshedIds = (wizard?.props.catalog as golfEquipment.GolfBallCatalog[]).map((ball) => ball.id);
  assert.ok(initialCatalog.every((ball) => refreshedIds.includes(ball.id)), "a partial refresh retains every last-successful item");
  assert.ok(refreshedIds.includes(refreshedBall.id), "new catalog rows merge into the active session");
});

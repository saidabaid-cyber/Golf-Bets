import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as equipmentEvents from "../lib/equipment-profile-events";
import * as equipmentOffline from "../lib/equipment-offline-store";
import * as equipment from "../lib/golf-equipment";
import * as completionClient from "../lib/profile-completion-client";
import * as completion from "../lib/profile-completion";

type Node = { type: unknown; props: Record<string, unknown> };
type CloudResult = {
  choices: completion.CompletionChoices;
  progress: completion.ProfileCompletion;
  equipmentRevision: completionClient.CompletionEquipmentRevision;
};

const USER_ID = "ring-equipment-owner";
const CREATED_AT = "2026-09-30T12:00:00.000Z";
const BALL_AT = "2026-09-30T12:01:00.000Z";
const FIT_AT = "2026-09-30T12:02:00.000Z";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

class WindowEvents {
  private readonly listeners = new Map<string, Set<(event: { type: string; detail?: unknown }) => void>>();

  addEventListener(type: string, listener: (event: { type: string; detail?: unknown }) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: { type: string; detail?: unknown }) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: { type: string; detail?: unknown }) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }
}

class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => { this.resolvePromise = resolve; });
  }

  resolve(value: T) { this.resolvePromise(value); }
}

function required<T>(value: T | null): T {
  assert.notEqual(value, null);
  return value as T;
}

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

function equipmentWithoutBall(): equipment.EquipmentProfile {
  const empty = required(equipment.createEmptyEquipmentProfile(USER_ID, CREATED_AT));
  return required(equipment.upsertPlayerClub(empty, {
    id: "driver-current",
    userId: USER_ID,
    category: "DRIVER",
    catalogClubId: null,
    customBrand: "QA",
    customModel: "Driver",
    generation: null,
    year: null,
    loft: 10,
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
    updatedAt: CREATED_AT,
  }, CREATED_AT));
}

function equipmentWithCurrentBall(): equipment.EquipmentProfile {
  return required(equipment.upsertPlayerBall(equipmentWithoutBall(), {
    id: "ball-current",
    userId: USER_ID,
    catalogBallId: "catalog-pro-v1x",
    ballBrand: "Titleist",
    ballModel: "Pro V1x",
    generation: "2025",
    year: 2025,
    color: null,
    notes: null,
    isCurrent: true,
    startedUsingAt: BALL_AT,
    stoppedUsingAt: null,
    createdAt: BALL_AT,
    updatedAt: BALL_AT,
  }, BALL_AT));
}

function equipmentWithFit(): equipment.EquipmentProfile {
  return required(equipment.setLastBallFit(equipmentWithCurrentBall(), {
    id: "fit-complete",
    completedAt: FIT_AT,
    currentBallId: "catalog-pro-v1x",
    inputCompleteness: 100,
    recommendations: [{ catalogBallId: "catalog-pro-v1x", matchScore: 96 }],
  }, FIT_AT));
}

function cloudProgress(profile: equipment.EquipmentProfile, displayName = "QA Golfer") {
  return completion.profileCompletion({
    displayName,
    givenName: displayName ? "QA" : "",
    familyName: displayName ? "Golfer" : "",
    username: "qa-golfer",
    handedness: "RH",
    homeClub: "La Vista Country Club",
    indexEnabled: true,
    indexResolution: "GHIN",
    indexValue: 7.9,
    equipment: profile,
    choices: completion.EMPTY_COMPLETION_CHOICES,
  });
}

function harness(storage: MemoryStorage) {
  type Hook =
    | { kind: "state"; value: unknown }
    | { kind: "ref"; value: { current: unknown } }
    | { kind: "memo"; value: unknown; dependencies: unknown[] }
    | { kind: "effect"; dependencies: unknown[]; cleanup?: () => void };

  const hooks: Hook[] = [];
  const scheduledEffects: Array<() => void> = [];
  const pendingRequests: Array<Deferred<CloudResult>> = [];
  const window = new WindowEvents();
  let cursor = 0;
  let tree: Node;

  function dependenciesChanged(previous: unknown[], next: unknown[]) {
    return previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]));
  }

  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { kind: "state", value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      const hook = hooks[index];
      assert.equal(hook.kind, "state");
      return [hook.value, (next: unknown) => {
        hook.value = typeof next === "function" ? (next as (value: unknown) => unknown)(hook.value) : next;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { kind: "ref", value: { current: initial } };
      const hook = hooks[index];
      assert.equal(hook.kind, "ref");
      return hook.value;
    },
    useCallback(callback: unknown, dependencies: unknown[]) {
      const index = cursor++;
      const prior = hooks[index];
      if (!prior || prior.kind !== "memo" || dependenciesChanged(prior.dependencies, dependencies)) {
        hooks[index] = { kind: "memo", value: callback, dependencies };
      }
      return (hooks[index] as Extract<Hook, { kind: "memo" }>).value;
    },
    useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
      const index = cursor++;
      const prior = hooks[index];
      if (prior?.kind === "effect" && !dependenciesChanged(prior.dependencies, dependencies)) return;
      scheduledEffects.push(() => {
        if (prior?.kind === "effect") prior.cleanup?.();
        const cleanup = effect();
        hooks[index] = { kind: "effect", dependencies, cleanup: typeof cleanup === "function" ? cleanup : undefined };
      });
    },
  };

  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => typeof type === "function" ? type(props) : { type, props };
  const compiled = ts.transpileModule(readFileSync("app/components/profile-completion-ring.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

  runInNewContext(compiled, {
    exports,
    AbortController,
    document: { body: {} },
    localStorage: storage,
    window,
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "react-dom") return { createPortal: (child: unknown) => child };
      if (name.endsWith("/profile-completion")) return completion;
      if (name.endsWith("/profile-completion-client")) return completionClient;
      if (name.endsWith("/equipment-profile-events")) return equipmentEvents;
      if (name.endsWith("/golf-equipment")) return equipment;
      if (name.endsWith("/equipment-offline-store")) return equipmentOffline;
      if (name.endsWith("/social-activity-client")) return {
        socialErrorMessage: (error: unknown) => String(error),
        socialRequest: () => {
          const deferred = new Deferred<CloudResult>();
          pendingRequests.push(deferred);
          return deferred.promise;
        },
      };
      if (name === "./modal-shell") return { ModalShell: (props: Record<string, unknown>) => ({ type: "modal-shell", props }) };
      if (name === "./profile-avatar-media") return { ProfileAvatarMedia: (props: Record<string, unknown>) => ({ type: "avatar", props }) };
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => String(key) }) };
      throw new Error(name);
    },
  });

  function render() {
    cursor = 0;
    tree = exports.ProfileCompletionRing({
      token: "access-token",
      userId: USER_ID,
      avatar: "",
      name: "QA Golfer",
      revision: "identity-revision",
      onOpen() {},
    });
    for (const effect of scheduledEffects.splice(0)) effect();
    return tree;
  }

  async function resolveRequest(index: number, value: CloudResult) {
    const deferred = pendingRequests[index];
    assert.ok(deferred, `request ${index + 1}`);
    deferred.resolve(value);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    render();
  }

  function ringButton() {
    const button = nodes(tree).find((node) => node.type === "button" && String(node.props["aria-label"] || "").startsWith("Perfil "));
    assert.ok(button, "profile completion ring");
    return button;
  }

  render();
  return {
    render,
    resolveRequest,
    requestCount: () => pendingRequests.length,
    percentLabel: () => String(ringButton().props["aria-label"]),
    open() {
      (ringButton().props.onClick as () => void)();
      render();
    },
    dispatchEquipmentUpdate() {
      window.dispatchEvent({
        type: equipmentEvents.EQUIPMENT_PROFILE_UPDATED_EVENT,
        detail: { userId: USER_ID, fingerprint: "local-fit" },
      });
      render();
    },
    sectionStatus(label: string) {
      const row = nodes(tree).find((node) => node.type === "button" && text(node.props.children).includes(label));
      assert.ok(row, `section ${label}`);
      return text(row.props.children).replace(/\s+/g, " ").trim();
    },
  };
}

test("ProfileCompletionRing conserva Equipment local frente a cloud stale y reacciona al evento sin polling", async () => {
  const storage = new MemoryStorage();
  const localBall = equipmentWithCurrentBall();
  assert.equal(equipment.saveEquipmentProfile(storage, localBall, BALL_AT).ok, true);
  equipmentOffline.queueEquipmentSyncOutbox(storage, USER_ID, localBall, "save-current-ball", BALL_AT);

  const h = harness(storage);
  assert.equal(h.requestCount(), 1);

  const staleCloud83: CloudResult = {
    choices: completion.EMPTY_COMPLETION_CHOICES,
    progress: cloudProgress(equipmentWithoutBall()),
    equipmentRevision: { version: 1, updatedAt: CREATED_AT },
  };
  assert.equal(staleCloud83.progress.percent, 83);
  await h.resolveRequest(0, staleCloud83);
  assert.equal(h.percentLabel(), "Perfil 100% completado", "el outbox local convierte la respuesta cloud 83% en 100%");

  h.open();
  assert.equal(h.requestCount(), 2, "abrir inicia una segunda lectura remota");
  assert.match(h.sectionStatus("Fitting"), /Fitting Opcional/);

  const localFit = equipmentWithFit();
  assert.equal(equipment.saveEquipmentProfile(storage, localFit, FIT_AT).ok, true);
  equipmentOffline.queueEquipmentSyncOutbox(storage, USER_ID, localFit, "save-ball-fit", FIT_AT);
  h.dispatchEquipmentUpdate();

  assert.equal(h.requestCount(), 3, "el evento inicia reconciliación determinista, sin polling");
  assert.equal(h.percentLabel(), "Perfil 100% completado");
  assert.match(h.sectionStatus("Bola"), /Bola Completo/);
  assert.match(h.sectionStatus("Fitting"), /Fitting Completo/, "el evento aplica lastBallFit local antes de esperar la nube");

  await h.resolveRequest(2, staleCloud83);
  assert.equal(h.percentLabel(), "Perfil 100% completado");
  assert.match(h.sectionStatus("Fitting"), /Fitting Completo/);

  const olderIncomplete: CloudResult = {
    ...staleCloud83,
    progress: cloudProgress(equipmentWithoutBall(), ""),
  };
  assert.equal(olderIncomplete.progress.percent, 67);
  await h.resolveRequest(1, olderIncomplete);
  assert.equal(h.percentLabel(), "Perfil 100% completado", "una respuesta anterior no puede sobrescribir la generación más nueva");
  assert.match(h.sectionStatus("Datos personales"), /Datos personales Completo/);
  assert.match(h.sectionStatus("Fitting"), /Fitting Completo/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

import ts from "typescript";

import * as equipment from "../lib/golf-equipment";
import { golfBallCatalog } from "../lib/golf-equipment-catalog";

type HookResult = {
  items: equipment.GolfBallCatalog[];
  status: "idle" | "loading" | "success" | "error";
};

type EffectSlot = {
  kind: "effect";
  dependencies: unknown[];
  cleanup?: () => void;
};

type MemoSlot = {
  kind: "memo";
  dependencies: unknown[];
  value: unknown;
};

type PendingRequest = {
  resolve: (response: {
    ok: true;
    json: () => Promise<{ items: equipment.GolfBallCatalog[]; hasMore: false; nextCursor: null }>;
  }) => void;
};

function dependenciesMatch(left: unknown[] | undefined, right: unknown[]) {
  return Boolean(left && left.length === right.length && right.every((value, index) => Object.is(value, left[index])));
}

function catalogSearchHarness() {
  const slots: unknown[] = [];
  const pendingEffects: Array<{ index: number; dependencies: unknown[]; effect: () => void | (() => void) }> = [];
  const timers = new Map<number, () => Promise<void> | void>();
  const requests: PendingRequest[] = [];
  let cursor = 0;
  let timerId = 0;

  const react = {
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
    useMemo(factory: () => unknown, dependencies: unknown[]) {
      const index = cursor++;
      const previous = slots[index] as MemoSlot | undefined;
      if (!previous || previous.kind !== "memo" || !dependenciesMatch(previous.dependencies, dependencies)) {
        slots[index] = { kind: "memo", dependencies, value: factory() } satisfies MemoSlot;
      }
      return (slots[index] as MemoSlot).value;
    },
    useCallback(callback: unknown, dependencies: unknown[]) {
      return react.useMemo(() => callback, dependencies);
    },
    useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
      const index = cursor++;
      const previous = slots[index] as EffectSlot | undefined;
      if (!previous || previous.kind !== "effect" || !dependenciesMatch(previous.dependencies, dependencies)) {
        pendingEffects.push({ index, dependencies, effect });
      }
    },
  };

  const compiled = ts.transpileModule(readFileSync("app/components/use-equipment-catalog-search.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (args: unknown) => HookResult> = {};
  runInNewContext(compiled, {
    AbortController,
    URLSearchParams,
    exports,
    fetch: () => new Promise((resolve) => requests.push({ resolve: resolve as PendingRequest["resolve"] })),
    require: (name: string) => {
      if (name === "react") return react;
      if (name.endsWith("/golf-equipment")) return equipment;
      throw new Error(`Unexpected module: ${name}`);
    },
    window: {
      clearTimeout(id: number) { timers.delete(id); },
      setTimeout(callback: () => Promise<void> | void) {
        const id = ++timerId;
        timers.set(id, callback);
        return id;
      },
    },
  });

  function commitEffects() {
    for (const pending of pendingEffects.splice(0)) {
      const previous = slots[pending.index] as EffectSlot | undefined;
      previous?.cleanup?.();
      const cleanup = pending.effect();
      slots[pending.index] = {
        kind: "effect",
        dependencies: pending.dependencies,
        ...(typeof cleanup === "function" ? { cleanup } : {}),
      } satisfies EffectSlot;
    }
  }

  return {
    render(pinnedIds: string[]) {
      cursor = 0;
      const result = exports.useEquipmentCatalogSearch({ kind: "BALL", query: "", pinnedIds });
      commitEffects();
      return result;
    },
    startRequest() {
      const next = timers.entries().next().value as [number, () => Promise<void> | void] | undefined;
      assert.ok(next, "expected a debounced catalog request");
      timers.delete(next[0]);
      const completion = Promise.resolve(next[1]());
      assert.equal(requests.length, 1, "the request starts when the debounce runs");
      return completion;
    },
    resolveRequest(items: equipment.GolfBallCatalog[]) {
      const request = requests.shift();
      assert.ok(request, "expected a pending catalog request");
      request.resolve({ ok: true, json: async () => ({ items, hasMore: false, nextCursor: null }) });
    },
  };
}

test("catalog search retains and merges its last successful page while pinned ids refresh in the same scope", async () => {
  const initialBall = golfBallCatalog[0];
  const newlyPinnedBall = golfBallCatalog.find((ball) => ball.id !== initialBall.id);
  assert.ok(initialBall && newlyPinnedBall);

  const harness = catalogSearchHarness();
  let result = harness.render([]);
  assert.equal(result.items.length, 0);

  let completion = harness.startRequest();
  harness.resolveRequest([initialBall]);
  await completion;
  result = harness.render([]);
  assert.deepEqual(Array.from(result.items, (ball) => ball.id), [initialBall.id]);

  // Adding a current/pinned ball is a background refresh of the same empty-query
  // catalog. Committing that refresh must not expose an intermediate empty page.
  harness.render([newlyPinnedBall.id]);
  result = harness.render([newlyPinnedBall.id]);
  assert.deepEqual(Array.from(result.items, (ball) => ball.id), [initialBall.id]);

  completion = harness.startRequest();
  harness.resolveRequest([newlyPinnedBall]);
  await completion;
  result = harness.render([newlyPinnedBall.id]);
  assert.deepEqual(Array.from(result.items, (ball) => ball.id), [initialBall.id, newlyPinnedBall.id]);
});

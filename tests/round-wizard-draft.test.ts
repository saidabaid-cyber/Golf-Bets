import assert from "node:assert/strict";
import test from "node:test";
import { canResumeActiveRound } from "../lib/active-round-navigation";
import { collectLocalCloudData, mergeLocalAndCloud } from "../lib/cloud-sync";
import { initialBets } from "../lib/new-round-bets";
import { persistOfflineBundle, readOfflineOutbox, restoreOfflineWorkspace } from "../lib/offline-store";
import { hasRoundProgress, normalizeRoundDraft, STORAGE_KEYS } from "../lib/round-utils";
import { deriveRoundLifecycleState } from "../lib/round-lifecycle";
import type { Course } from "../lib/types";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}

const course: Course = {
  id: "wizard-course-qa", name: "Campo QA", teeName: "General", builtIn: false,
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};
const courseOnlyDraft = () => ({
  version: 11, roundId: "wizard-course-only", roundDate: "2026-09-17", course: structuredClone(course), courseSelected: true,
  players: [], ownerId: "", scores: {}, startHole: 10 as const, roundHoles: 18 as const, currentIndex: 0,
  bets: initialBets([]), personalBets: [], supplementalBets: [], manualBets: [],
});

test("a selected course alone survives local cloud collection and normalized reload", () => {
  const storage = new MemoryStorage();
  const draft = courseOnlyDraft();
  const before = structuredClone(draft);
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft));
  assert.equal(hasRoundProgress(draft), true);
  const collected = collectLocalCloudData(storage);
  assert.ok(collected.activeDraft);
  const restored = normalizeRoundDraft(JSON.parse(JSON.stringify(collected.activeDraft)))!;
  assert.equal(restored.courseSelected, true);
  assert.equal(restored.course?.name, course.name);
  assert.equal(restored.startHole, 10);
  assert.equal(restored.roundId, draft.roundId);
  assert.deepEqual(restored.players, []);
  assert.deepEqual(draft, before);
  assert.equal(deriveRoundLifecycleState(restored), "draft");
});

test("an empty or unselected field never creates draft progress", () => {
  const draft = courseOnlyDraft();
  for (const value of [
    null, {}, { ...draft, courseSelected: false }, { ...draft, courseSelected: undefined },
    { ...draft, courseSelected: "true" }, { ...draft, course: null },
    { ...draft, course: { ...course, name: " " } }, { ...draft, course: { ...course, holes: [] } },
    { ...draft, course: { ...course, holes: course.holes.slice(0, 8) } },
  ]) assert.equal(hasRoundProgress(value), false);
  assert.equal(hasRoundProgress({ ...draft, course: { ...course, holes: course.holes.slice(0, 9) } }), true);
});

test("merging a course-only draft with an empty workspace does not discard its setup", () => {
  const source = new MemoryStorage();
  source.setItem(STORAGE_KEYS.draft, JSON.stringify(courseOnlyDraft()));
  const local = collectLocalCloudData(source);
  const blank = collectLocalCloudData(new MemoryStorage());
  const merged = mergeLocalAndCloud(local, blank);
  const restored = normalizeRoundDraft(merged.activeDraft)!;
  assert.equal(restored.courseSelected, true);
  assert.equal(restored.course?.id, course.id);
  assert.equal(restored.startHole, 10);
});

test("course-only setup persists and restores through existing durable offline fallback", async () => {
  const storage = new MemoryStorage();
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  try {
    storage.setItem(STORAGE_KEYS.draft, JSON.stringify(courseOnlyDraft()));
    const bundle = collectLocalCloudData(storage);
    await persistOfflineBundle("wizard-owner-qa", bundle, true);
    assert.ok((await readOfflineOutbox("wizard-owner-qa"))?.bundle.activeDraft);
    storage.removeItem(STORAGE_KEYS.draft);
    const recovered = await restoreOfflineWorkspace("wizard-owner-qa", storage, null);
    assert.ok(recovered?.activeDraft);
    const restored = normalizeRoundDraft(JSON.parse(storage.getItem(STORAGE_KEYS.draft)!))!;
    assert.equal(restored.roundId, "wizard-course-only");
    assert.equal(restored.courseSelected, true);
    assert.equal(restored.course?.name, "Campo QA");
    assert.equal(restored.startHole, 10);
    assert.deepEqual(restored.players, []);
  } finally {
    if (localStorageDescriptor) Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    if (indexedDbDescriptor) Object.defineProperty(globalThis, "indexedDB", indexedDbDescriptor);
    else delete (globalThis as { indexedDB?: unknown }).indexedDB;
  }
});

test("saving course and players does not expose continue-round until durable start", () => {
  const draft = { ...courseOnlyDraft(), ownerId: "a", players: [{ id: "a", name: "QA", handicap: 7 }] };
  const input = { userId: "user-a", workspaceOwnerId: "user-a", hydrated: true, closed: false, history: [], draftAvailable: hasRoundProgress(draft), draft };
  assert.equal(canResumeActiveRound({ ...input, draft: courseOnlyDraft() }), false);
  assert.equal(canResumeActiveRound(input), false);
  assert.equal(canResumeActiveRound({ ...input, draft: { ...draft, startedAt: "2026-09-17T12:00:00.000Z" } }), true);
  assert.equal(canResumeActiveRound({ ...input, draft: { ...draft, startedAt: "2026-09-17T12:00:00.000Z", lifecycleState: "completed" } }), false);
});

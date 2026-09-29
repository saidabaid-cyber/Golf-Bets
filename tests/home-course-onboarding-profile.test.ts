import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import {
  ACCOUNT_STORAGE_KEYS,
  emptyBackyardProfileDetails,
  mergeBackyardProfile,
  readOfflineAuthenticatedProfile,
  type BackyardProfile,
  type BackyardProfileUpdate,
} from "../lib/account-state";
import * as accountState from "../lib/account-state";
import * as accountUiPreferences from "../lib/account-ui-preferences";
import * as betaOnboarding from "../lib/beta-onboarding";
import * as devicePermissions from "../lib/device-permissions";
import * as profileGeography from "../lib/profile-geography";
import * as reviewedCatalog from "../lib/review-course-catalog";
import * as roundCourseSelection from "../lib/round-course-selection";

type TreeNode = { type: unknown; props: Record<string, unknown> };
type Component = (props: Record<string, unknown>) => TreeNode;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function nodes(value: unknown): TreeNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as TreeNode;
  return [node, ...nodes(node.props.children)];
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object") return text((value as TreeNode).props?.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function hookRuntime() {
  const slots: unknown[] = [];
  const dependencies: Array<readonly unknown[] | undefined> = [];
  let cursor = 0;
  let pendingEffects: Array<() => unknown> = [];
  const changed = (previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) => (
    !previous || !next || previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]))
  );
  const memo = <T>(calculate: () => T, next: readonly unknown[] | undefined): T => {
    const index = cursor++;
    if (changed(dependencies[index], next)) {
      slots[index] = calculate();
      dependencies[index] = next;
    }
    return slots[index] as T;
  };
  const effect = (callback: () => unknown, next: readonly unknown[] | undefined) => {
    const index = cursor++;
    if (!changed(dependencies[index], next)) return;
    dependencies[index] = next;
    pendingEffects.push(callback);
  };
  return {
    react: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
        return [slots[index], (next: unknown) => {
          slots[index] = typeof next === "function" ? (next as (current: unknown) => unknown)(slots[index]) : next;
        }];
      },
      useRef(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useMemo: memo,
      useCallback<T>(callback: T, next: readonly unknown[] | undefined) { return memo(() => callback, next); },
      useEffect: effect,
      useLayoutEffect: effect,
    },
    beginRender() { cursor = 0; },
    runEffects() {
      const current = pendingEffects;
      pendingEffects = [];
      for (const callback of current) callback();
    },
  };
}

function compile(file: string, dependencies: (id: string) => unknown, globals: Record<string, unknown> = {}) {
  const exports: Record<string, Component> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  runInNewContext(source, {
    exports,
    require: (id: string) => id === "react/jsx-runtime"
      ? { jsx, jsxs: jsx, Fragment: "fragment" }
      : dependencies(id),
    ...globals,
  });
  return exports;
}

const COURSE = {
  id: "course-la-vista-principal",
  clubId: "club-la-vista",
  name: "Recorrido Principal",
  clubName: "La Vista Country Club",
  holes: 18,
  country: "México",
  city: "San Andrés Cholula",
  stateRegion: "Puebla",
  aliases: ["La Vista"],
  sourceUrl: "https://example.invalid/la-vista",
  observedAt: "2026-09-28",
  dataVersion: "qa-home-course-v1",
  teeCount: 4,
  completeCards: 4,
};

function baseProfile(userId: string): BackyardProfile {
  return {
    userId,
    displayName: "Said QA",
    email: "said.qa@example.test",
    avatarUrl: "",
    defaultHandicap: 8.4,
    ...emptyBackyardProfileDetails(),
  };
}

function onboardingCourseProps(
  storage: MemoryStorage,
  profile: BackyardProfile,
  mode: "quick" | "complete",
  onUpdateProfile: (patch: BackyardProfileUpdate) => Promise<"local" | "cloud">,
) {
  betaOnboarding.persistBetaOnboardingProgress(storage, {
    ...betaOnboarding.createBetaOnboardingProgress(profile.userId, "2026-09-28T12:00:00.000Z"),
    step: "course",
    mode,
    completedSteps: ["welcome", "permissions"],
  });
  const hooks = hookRuntime();
  const component = compile("app/components/beta-onboarding-flow.tsx", (id) => {
    if (id === "react") return hooks.react;
    if (id === "./catalog-course-picker") return { CatalogCoursePicker: "catalog-course-picker" };
    if (id === "./use-view-scroll-reset") return { useViewScrollReset() {} };
    if (id === "./account-consent-checkpoint") return { InitialOnboardingConsents: "initial-consents" };
    if (id.endsWith("/social-activity-client")) return { socialRequest: async () => ({}) };
    if (id.endsWith("/onboarding-checkpoint")) return { saveOnboardingCheckpoint: async () => undefined };
    if (id.endsWith("/account-state")) return accountState;
    if (id.endsWith("/beta-onboarding")) return betaOnboarding;
    if (id.endsWith("/plans")) return { PLAN_CATALOG: [], selectablePlanId: () => "free" };
    if (id.endsWith("/round-utils")) return { STORAGE_KEYS: { contrast: "qa-contrast" } };
    if (id.endsWith("/ball-fitting")) return { ballFitDefaultsFromProfile: () => ({}) };
    if (id.endsWith("/handicap-source")) return { selectedHandicapIndex: () => ({ source: null, value: null }) };
    if (id === "./use-ghin-read-only-profile") return { useGhinReadOnlyProfile: () => ({ profile: null }) };
    if (id === "./use-backyard-index-preference") return { useBackyardIndexPreference: () => ({ preference: null }) };
    if (id === "./handicap-source-selector") return { HandicapSourceChoices: "handicap-source", ghinIndexHeading: () => "GHIN INDEX" };
    if (id === "./feedback-dialog") return { requestFeedback() {} };
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    return new Proxy({}, { get: (_target, key) => String(key) });
  }, {
    localStorage: storage,
    window: { scrollTo() {} },
  });
  const props = {
    profile,
    accessToken: "account-token",
    onUpdateProfile,
    onComplete() {},
  };
  const render = () => {
    hooks.beginRender();
    return component.BetaOnboardingFlow(props);
  };
  render();
  hooks.runEffects();
  const tree = render();
  hooks.runEffects();
  const picker = nodes(tree).find((node) => node.type === "catalog-course-picker");
  assert.ok(picker, `${mode} onboarding must render the Home Course picker`);
  assert.equal((tree.props.progress as { mode?: string }).mode, mode);
  assert.equal(tree.props.title, "Elige tu campo habitual");
  return picker.props;
}

async function selectCourseThroughPicker(
  storage: MemoryStorage,
  onboardingProps: Record<string, unknown>,
  events: string[],
) {
  const hooks = hookRuntime();
  const ready = onboardingProps.onSelectionReadyChange as (value: boolean) => void;
  const component = compile("app/components/catalog-course-picker.tsx", (id) => {
    if (id === "react") return hooks.react;
    if (id.endsWith("/review-course-catalog")) return reviewedCatalog;
    if (id.endsWith("/device-permissions")) return devicePermissions;
    if (id.endsWith("/round-course-selection")) return roundCourseSelection;
    if (id === "./anchored-search") return { AnchoredSearch: "anchored-search", AnchoredSearchOption: "anchored-search-option" };
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    throw new Error(`Unexpected picker dependency: ${id}`);
  }, {
    AbortController,
    AbortSignal,
    encodeURIComponent,
    fetch: async () => ({ ok: true, json: async () => ({ courses: [COURSE] }) }),
    localStorage: storage,
    navigator: { geolocation: {} },
    window: { setTimeout: () => 1, clearTimeout() {} },
  });
  const props = {
    ...onboardingProps,
    onSelectionReadyChange(value: boolean) {
      events.push(`ready:${value}`);
      ready(value);
    },
  };
  let tree: TreeNode;
  const render = () => {
    hooks.beginRender();
    tree = component.CatalogCoursePicker(props);
    return tree;
  };
  const flush = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  render();
  hooks.runEffects();
  await flush();
  render();
  hooks.runEffects();
  const club = nodes(tree!).find((node) => node.type === "button" && text(node).includes(COURSE.clubName));
  assert.ok(club, "the fetched Home Course must be selectable from the real picker");
  (club.props.onClick as () => void)();
  await flush();
  render();
  hooks.runEffects();
  assert.match(text(tree!), /La Vista Country Club\s*·\s*Recorrido Principal/);
  assert.match(text(tree!), /Cambiar campo/);
}

function profileCourseRow(identity: Record<string, unknown>) {
  const hooks = hookRuntime();
  const account = {
    identity,
    adminAccess: { hasAccess: false, roles: [], scopes: [] },
    updateProfile: async () => "local",
    logout: async () => undefined,
    finishAccountDeletion: async () => true,
    openAccess() {},
    acceptances: [],
    legalEvidenceEvents: [],
    marketingConsentResolved: true,
    bettingConsentGranted: true,
    requestBettingConsent: async () => true,
    recordLegalChoice: async () => undefined,
    cloudLinked: false,
    cloudStatus: "local",
    requestCloudLink() {},
    cloudIssues: [],
    retryCloudSync() {},
  };
  const component = compile("app/components/profile-account-panel.tsx", (id) => {
    if (id === "react") return hooks.react;
    if (id === "next/link") return { __esModule: true, default: "a" };
    if (id.endsWith("/account-state")) return accountState;
    if (id.endsWith("/profile-geography")) return profileGeography;
    if (id.endsWith("/handicap-source")) return { selectedHandicapIndex: () => ({ source: null, value: null }) };
    if (id.endsWith("/account-ui-preferences")) return accountUiPreferences;
    if (id === "./account-provider") return { useBackyardAccount: () => account };
    if (id === "./use-view-scroll-reset") return { useViewScrollReset() {} };
    if (id === "./equipment-profile-panel") return { EquipmentProfilePanel: "equipment-panel", EquipmentProfileSummary: "equipment-summary" };
    if (id === "./profile-avatar-media") return { ProfileAvatarMedia: "profile-avatar" };
    if (id === "./profile-completion-ring") return { ProfileCompletionRing: "profile-completion" };
    if (id === "./backyard-index-card") return { BackyardIndexCard: "backyard-index" };
    if (id === "./handicap-source-selector") return { HandicapSourceChoices: "handicap-source" };
    if (id === "./feedback-dialog") return { requestFeedback() {} };
    return new Proxy({}, { get: (_target, key) => String(key) });
  }, {
    AbortController,
    localStorage: new MemoryStorage(),
  });
  hooks.beginRender();
  const tree = component.ProfileAccountPanel({
    view: "profile",
    indexControl: { preference: null, ready: true, saving: false, error: "", change: async () => undefined, declareLocalZero: async () => undefined },
    highContrast: true,
    onHighContrastChange() {},
    notificationsEnabled: false,
    onNotificationsEnabledChange() {},
    onOpenEquipment() {},
    onBackToProfile() {},
  });
  return nodes(tree).find((node) => {
    if (node.type !== "div" || !Array.isArray(node.props.children)) return false;
    const children = node.props.children as TreeNode[];
    return children.some((child) => child?.type === "span" && text(child) === "Recorrido");
  });
}

for (const mode of ["quick", "complete"] as const) {
  test(`${mode} onboarding selects, persists and exposes Home Course after opening Profile`, async () => {
    const userId = `home-course-${mode}`;
    const storage = new MemoryStorage();
    storage.setItem(ACCOUNT_STORAGE_KEYS.mode, "authenticated");
    let current = baseProfile(userId);
    const events: string[] = [];
    const pickerProps = onboardingCourseProps(storage, current, mode, async (patch) => {
      current = mergeBackyardProfile(current, patch);
      storage.setItem(`backyard-profile-cache-v1:${userId}`, JSON.stringify(current));
      events.push("persisted");
      return "local";
    });

    await selectCourseThroughPicker(storage, pickerProps, events);
    assert.deepEqual(events, ["ready:false", "ready:false", "persisted", "ready:true"]);

    const reloaded = readOfflineAuthenticatedProfile(storage, userId);
    assert.ok(reloaded);
    assert.deepEqual({
      homeClub: reloaded.homeClub,
      homeClubId: reloaded.homeClubId,
      homeCourse: reloaded.homeCourse,
      homeCourseId: reloaded.homeCourseId,
    }, {
      homeClub: COURSE.clubName,
      homeClubId: COURSE.clubId,
      homeCourse: COURSE.name,
      homeCourseId: COURSE.id,
    });

    const row = profileCourseRow({
      ...reloaded,
      mode: "authenticated",
      accessToken: "account-token",
      providers: ["email"],
    });
    assert.ok(row, "opening Profile must render the saved Recorrido field");
    assert.match(text(row), /Recorrido\s+Recorrido Principal/);
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { validateProfileAvatarUrl, validateProfileDraft } from "../lib/account-state";
import * as geo from "../lib/profile-geography";
import { selectedHandicapIndex } from "../lib/handicap-source";
import { accountPrimaryRoundPlayer } from "../lib/account-primary-player";
import { BACKYARD_INDEX_METADATA_KEY, saveCloudIndexPreference, readCloudIndexPreference, type BackyardIndexPreference } from "../lib/backyard-index-preferences";
import type { SupabaseClient } from "@supabase/supabase-js";

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children)]; }
function text(value: unknown): string { if (Array.isArray(value)) return value.map(text).join(" "); if (value && typeof value === "object") return text((value as Node).props?.children); return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function component(file: string, name: string, globals: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const code = ts.transpileModule(`export ${declaration.getText(source).replace(/^export /, "")}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const values: unknown[] = []; let cursor = 0; const exports: Record<string, unknown> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  runInNewContext(code, { exports, require: () => ({ jsx, jsxs: jsx, Fragment: "fragment" }),
    useState: (initial: unknown) => { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    ...globals });
  return (props: unknown) => { cursor = 0; return (exports[name] as (props: unknown) => Node)(props); };
}

function setupHarness(location: geo.ProfileLocationValue) {
  const saved: Record<string, unknown>[] = [];
  const renderComponent = component("app/components/account-provider.tsx", "ProfileSetupScreen", {
    normalizeProfileLocation: geo.normalizeProfileLocation, validateProfileLocation: geo.validateProfileLocation,
    validateProfileDraft, validateProfileAvatarUrl, BrandLockup: "brand", ProfileImagePicker: "avatar", ProfileLocationPicker: "location", HandicapSourceSelector: "source",
  });
  const props = { identity: { ...location, userId: "owner", mode: "authenticated", givenName: "Said", familyName: "Abaid", avatarUrl: "", defaultHandicap: 7 }, onSave: async (value: Record<string, unknown>) => { saved.push(JSON.parse(JSON.stringify(value))); return "cloud"; }, onBack: async () => {} };
  let tree = renderComponent(props);
  return { saved, render: () => tree = renderComponent(props), nodes: () => nodes(tree), text: () => text(tree),
    changeLocation: (next: geo.ProfileLocationValue) => { (nodes(tree).find((node) => node.type === "location")!.props.onChange as (value: geo.ProfileLocationValue) => void)(next); tree = renderComponent(props); },
    submit: async () => { await (nodes(tree).find((node) => node.type === "form")!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} }); tree = renderComponent(props); },
  };
}

test("Puebla bug: invalid typed region then canonical MX-PUE selection clears stale error and submits", async () => {
  const h = setupHarness(geo.selectProfileCountry("MX"));
  h.changeLocation({ countryCode: "MX", country: "México", stateCode: "", state: "Pue" });
  await h.submit(); assert.match(h.text(), /Selecciona un estado o provincia de la lista/); assert.equal(h.saved.length, 0);
  h.changeLocation(geo.selectProfileSubdivision(geo.selectProfileCountry("MX"), "MX-PUE"));
  assert.doesNotMatch(h.text(), /Selecciona un estado o provincia de la lista/);
  await h.submit(); assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].countryCode, "MX"); assert.equal(h.saved[0].stateCode, "MX-PUE"); assert.equal(h.saved[0].state, "Puebla");
});

test("selected Puebla survives profile reload, validates and saves without a manual profile Index", async () => {
  const selected = geo.selectProfileSubdivision(geo.selectProfileCountry("MX"), "MX-PUE");
  const h = setupHarness(JSON.parse(JSON.stringify(selected))); await h.submit();
  assert.equal(h.saved.length, 1); assert.equal(h.saved[0].defaultHandicap, 7, "identity-only setup must not erase an existing golf value");
  assert.equal(h.nodes().some((node) => node.type === "input" && String(node.props.id).includes("hcp")), false);
  assert.equal(h.nodes().some((node) => node.type === "source"), false, "source selection belongs to the next golf step only");
  assert.equal(geo.validateProfileLocation(h.saved[0]).valid, true);
});

test("initial profile has no duplicated GHIN/Backyard selector and the canonical golf step preserves saved values", () => {
  const setup = readFileSync("app/components/account-provider.tsx", "utf8").split("function ProfileSetupScreen")[1].split("export function AccountProvider")[0];
  assert.doesNotMatch(setup, /HandicapSourceSelector|VINCULAR GHIN|ACTIVAR BACKYARD INDEX/);
  const golf = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8").split('if (progress.step === "ghin")')[1].split('if (progress.step === "improvements")')[0];
  assert.match(golf, /<HandicapSourceSelector/);
  assert.match(golf, /defaultHandicap: profile\.defaultHandicap/);
  assert.match(golf, /ghinLinkStatus: profile\.ghinLinkStatus \|\| "SKIPPED"/);
});

test("canonical region selection validates immediately; changing country clears region", () => {
  const mexico = geo.selectProfileSubdivision(geo.selectProfileCountry("MX"), "MX-PUE");
  assert.equal(geo.validateProfileLocation(mexico, { countryRequired: true, stateRequired: true }).valid, true);
  const usa = geo.selectProfileCountry("US"); assert.equal(usa.stateCode, ""); assert.equal(usa.state, "");
  assert.ok(geo.searchProfileSubdivisions("US", "Wash").some((item) => item.code === "US-WA"));
  assert.equal(geo.validateProfileLocation({ ...usa, ...{ stateCode: "MX-PUE", state: "Puebla" } }).valid, false);
});

test("source selector activation handler, no false success after failed/pending cloud save", async () => {
  const changes: boolean[] = [];
  const render = component("app/components/handicap-source-selector.tsx", "HandicapSourceChoices", { GhinPlaceholder: "ghin", styles: {} });
  const control = { ready: true, saving: false, error: "", preference: null, change: async (value: boolean) => changes.push(value), retry: async () => {} };
  const tree = render({ authenticated: true, control });
  assert.match(text(tree), /VINCULAR GHIN/); assert.match(text(tree), /ACTIVAR BACKYARD INDEX/);
  await (nodes(tree).find((node) => node.type === "button")!.props.onClick as () => Promise<unknown>)(); assert.deepEqual(changes, [true]);
  assert.doesNotMatch(text(render({ authenticated: true, control: { ...control, error: "Falló guardado", preference: { enabled: true } } })), /ÍNDICE BACKYARD ACTIVADO/);
  assert.match(text(render({ authenticated: true, control: { ...control, preference: { enabled: true, handicapSource: "BACKYARD" } } })), /ÍNDICE BACKYARD ACTIVADO/);
});

test("BACKYARD activation persists source and enabled server-side and reload/new device sees it", async () => {
  let metadata: Record<string, unknown> = {};
  const client = { auth: { getUser: async () => ({ error: null, data: { user: { id: "owner", user_metadata: metadata } } }), updateUser: async ({ data }: { data: Record<string, unknown> }) => { metadata = { ...metadata, ...data }; return { error: null, data: { user: { id: "owner", user_metadata: metadata } } }; } } } as unknown as SupabaseClient;
  const preference: BackyardIndexPreference = { version: 1, userId: "owner", enabled: true, handicapSource: "BACKYARD", updatedAt: "2026-09-16T12:00:00.000Z", localPccZeroDeclaredAt: "2026-09-16T12:00:00.000Z" };
  await saveCloudIndexPreference(client, preference);
  assert.deepEqual(metadata[BACKYARD_INDEX_METADATA_KEY], preference);
  assert.deepEqual(await readCloudIndexPreference(client, "owner"), preference);
  assert.deepEqual(selectedHandicapIndex(preference, [], "owner"), { source: "BACKYARD", value: null });
});

test("legacy manual Index never becomes current profile Index; unverified GHIN metadata has no value", () => {
  const profile = { userId: "owner", displayName: "Said", email: "", avatarUrl: "", defaultHandicap: 7 };
  assert.equal(accountPrimaryRoundPlayer(profile)?.handicapIndex, null);
  assert.equal(accountPrimaryRoundPlayer(profile, { source: "BACKYARD", value: 9.4 })?.handicapIndex, 9.4);
  assert.equal(accountPrimaryRoundPlayer(profile, { source: "BACKYARD", value: 9.4 })?.handicapIndexSource, "BACKYARD_INDEX");
  const preference: BackyardIndexPreference = { version: 1, userId: "owner", enabled: true, handicapSource: "GHIN", updatedAt: "2026-09-16T12:00:00Z", localPccZeroDeclaredAt: null };
  assert.deepEqual(selectedHandicapIndex(preference, [], "owner"), { source: "GHIN", value: null });
  assert.deepEqual(selectedHandicapIndex(preference, [], "another"), { source: null, value: null });
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.doesNotMatch(provider, /defaultHandicap=\{identity\.defaultHandicap\}/);
  assert.doesNotMatch(readFileSync("app/components/membership-benefits.tsx", "utf8"), /label: "HCP manual"/);
});

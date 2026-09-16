import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as navigation from "../lib/app-navigation";
import * as audience from "../lib/profile-visibility";
import * as security from "../lib/backyard-ai/server/http-security";
import { searchSocialProfiles } from "../features/social/domain";
import { normalizeBackyardProfileCache } from "../lib/account-state";

type Node = { type: unknown; props: Record<string, unknown> };
const jsx = (type: unknown, props: Record<string, unknown>): Node => ({ type, props });
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (!value || typeof value === "boolean") return "";
  if (typeof value === "object") return text((value as Node).props?.children);
  return String(value);
}
function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (props: Record<string, unknown>) => unknown> = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, AbortController, AbortSignal, Request, Response, console, setTimeout, clearTimeout, require: (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency ${id}`);
  } });
  return exports;
}

test("actual Home and Más markup has no settings control; remaining profile/notifications work", () => {
  const visited: string[] = [];
  const home = load("app/components/home-dashboard.tsx", {
    react: { useState: () => [false, () => {}] }, "next/image": { __esModule: true, default: "img" },
    "./modal-shell": { ModalShell: () => null }, "./profile-avatar-media": { ProfileAvatarMedia: () => null },
  });
  const tree = home.HomeDashboard({ displayName: "Golfista", insights: {}, groupCount: 0, onOpenProfile: () => visited.push("profile"), onOpenNotifications: () => visited.push("notifications") });
  const buttons = nodes(tree).filter((node) => node.type === "button");
  assert.ok(buttons.length > 2);
  assert.ok(buttons.every((node) => !/configuraci[oó]n|settings/i.test(String(node.props["aria-label"]) + text(node))));
  for (const label of ["Abrir mi perfil", "Abrir notificaciones"]) (buttons.find((node) => node.props["aria-label"] === label)!.props.onClick as () => void)();
  assert.deepEqual(visited, ["profile", "notifications"]);
  const more = load("app/components/more-hub.tsx", {});
  const tools = nodes(more.MoreHub({ hasActiveRound: false })).filter((node) => node.type === "button");
  assert.equal(tools.length, 7); assert.ok(tools.every((node) => !/Configuración|settings/.test(text(node))));
  const page = readFileSync("app/page.tsx", "utf8");
  assert.doesNotMatch(page, /onOpenSettings/);
  assert.match(readFileSync("app/components/profile-account-panel.tsx", "utf8"), /onClick=\{onOpenAccount\}><span><b>Cuenta y privacidad<\/b>/);
});

test("actual bottom navigation retains Continuar Ronda only with the existing resume callback", () => {
  const nav = load("app/components/app-bottom-nav.tsx", { react: { Fragment: "fragment" }, "../../lib/app-navigation": navigation });
  let resumed = 0;
  const inactive = nodes(nav.AppBottomNav({ activeTab: "profile", onNavigate: () => {} })).filter((node) => node.type === "button");
  assert.equal(inactive.length, 4); assert.ok(inactive.every((node) => !/CONTINUAR/.test(text(node))));
  const active = nodes(nav.AppBottomNav({ activeTab: "profile", onNavigate: () => {}, onResumeRound: () => { resumed++; } })).filter((node) => node.type === "button");
  assert.equal(active.length, 5); assert.match(text(active[2]), /CONTINUAR RONDA/);
  (active[2].props.onClick as () => void)(); assert.equal(resumed, 1);
});

function privacyHarness(initial: audience.PersistedProfileAudience = "private", failSave = false) {
  let server = initial; let cursor = 0; let effects: (() => void)[] = []; let tree: unknown;
  const values: unknown[] = [], effectDeps: unknown[][] = [], writes: string[] = [];
  const react = {
    useState: (initialValue: unknown) => { const index = cursor++; if (!(index in values)) values[index] = typeof initialValue === "function" ? initialValue() : initialValue; return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef: (initialValue: unknown) => { const index = cursor++; if (!(index in values)) values[index] = { current: initialValue }; return values[index]; },
    useEffect: (effect: () => void, deps: unknown[]) => { const index = cursor++; if (!effectDeps[index] || deps.some((value, n) => !Object.is(value, effectDeps[index][n]))) { effectDeps[index] = deps; effects.push(effect); } },
  };
  const component = load("app/components/profile-visibility-settings.tsx", { react, "../../lib/profile-visibility": { requestProfileAudience: async (_token: string, choice?: audience.ProfileAudienceChoice) => { if (choice) { writes.push(choice); if (failSave) throw new Error("failed"); server = choice; } return server; } } });
  const render = () => { cursor = 0; tree = component.ProfileVisibilitySettings({ userId: "owner", accessToken: "token", authenticated: true }); const pending = effects; effects = []; pending.forEach((effect) => effect()); };
  return { writes, server: () => server, render, tree: () => tree, buttons: () => nodes(tree).filter((node) => node.type === "button"),
    settle: async () => { for (let i = 0; i < 3; i++) { render(); await new Promise<void>((resolve) => setImmediate(resolve)); } },
  };
}

test("actual privacy UI offers only Public/Friends and does not widen a legacy private profile", async () => {
  const h = privacyHarness(); await h.settle();
  assert.deepEqual(h.buttons().map(text), ["Público", "Amigos"]);
  assert.ok(h.buttons().every((button) => button.props["aria-pressed"] === false));
  assert.equal(h.writes.length, 0); assert.equal(h.server(), "private");
  assert.match(text(h.tree()), /configuración anterior sigue protegida/);
});

test("public/friends changes wait for server persistence and reload reads the confirmed choice", async () => {
  for (const [index, choice] of [[0, "public"], [1, "friends"]] as const) {
    const h = privacyHarness(); await h.settle();
    (h.buttons()[index].props.onClick as () => void)();
    (h.buttons()[index].props.onClick as () => void)();
    await h.settle(); assert.deepEqual(h.writes, [choice]); assert.equal(h.server(), choice);
    assert.equal(h.buttons()[index].props["aria-pressed"], true);
    const reload = privacyHarness(h.server()); await reload.settle(); assert.equal(reload.buttons()[index].props["aria-pressed"], true);
  }
});

test("failed privacy save keeps the previously confirmed audience", async () => {
  const h = privacyHarness("friends", true); await h.settle();
  (h.buttons()[0].props.onClick as () => void)(); await h.settle();
  assert.equal(h.server(), "friends"); assert.equal(h.buttons()[1].props["aria-pressed"], true);
  assert.match(text(h.tree()), /selección anterior se conserva/);
});

test("profile audience client validates exact server acknowledgement and never sends a userId", async () => {
  const transport = (async (_url, init) => { assert.equal(init?.method, "PATCH"); assert.deepEqual(JSON.parse(String(init?.body)), { visibility: "public" }); return Response.json({ visibility: "public" }); }) as typeof fetch;
  assert.equal(await audience.requestProfileAudience("owner-token", "public", undefined, transport), "public");
  await assert.rejects(audience.requestProfileAudience("owner-token", "public", undefined, (async () => Response.json({ visibility: "friends" })) as typeof fetch));
  const base = { userId: "owner", displayName: "Owner", defaultHandicap: null, avatarUrl: "", email: "private@example.test" };
  assert.equal(normalizeBackyardProfileCache({ profileVisibility: "public" }, base).profileVisibility, "public");
  assert.equal(normalizeBackyardProfileCache({}, base).profileVisibility, "private");
});

test("public social projection searchable, legacy private not widened", () => {
  const profiles = [{ userId: "a", username: "test.a", displayName: "A", privacy: "PUBLIC" as const }, { userId: "b", username: "test.b", displayName: "B", privacy: "PRIVATE" as const }];
  assert.deepEqual(searchSocialProfiles(profiles, "test", "viewer", []).map((p) => p.userId), ["a"]);
});

test("actual privacy API derives ownership and rejects extra account IDs/private/cross-site writes", async () => {
  const writes: unknown[] = [], ownerFilters: unknown[] = [];
  const client = {
    rpc: (_name: string, body: { requested_visibility: string }) => { writes.push(body); return { abortSignal: async () => ({ data: body.requested_visibility, error: null }) }; },
    from: () => { const query = { select: () => query, eq: (_key: string, owner: string) => { ownerFilters.push(owner); return query; }, abortSignal: () => query, maybeSingle: async () => ({ data: { profile_visibility: "friends" }, error: null }) }; return query; },
  };
  const routes = load("app/api/account/privacy/route.ts", { "next/server": { NextResponse: Response }, "../../../../lib/server-auth": { authenticatedRequest: async () => ({ ok: true, userId: "verified-owner", client }) }, "../../../../lib/profile-visibility": audience, "../../../../lib/backyard-ai/server/http-security": security });
  const invoke = async (method: string, body?: unknown, origin?: string) => (routes[method] as unknown as (req: Request) => Promise<Response>)(new Request("https://preview.invalid/api/account/privacy", { method, headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  assert.equal((await invoke("GET")).status, 200); assert.deepEqual(ownerFilters, ["verified-owner"]);
  for (const bad of [{ visibility: "private" }, { visibility: "public", userId: "victim" }]) assert.equal((await invoke("PATCH", bad)).status, 400);
  assert.equal((await invoke("PATCH", { visibility: "public" }, "https://evil.invalid")).status, 403);
  assert.equal(writes.length, 0);
  assert.equal((await invoke("PATCH", { visibility: "public" })).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ requested_visibility: "public" }]);
});

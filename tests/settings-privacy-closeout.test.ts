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

test("all five primary headers open the existing profile and notification actions", () => {
  const profile = load("app/components/profile-navigation-button.tsx", { "./profile-avatar-media": { ProfileAvatarMedia: () => null } });
  const header = load("app/components/primary-header.tsx", { "./profile-navigation-button": profile, "../../lib/app-navigation": navigation, "./admin-mode-menu": { AdminModeMenu: () => null } });
  for (const tab of Object.values(navigation.BOTTOM_NAV_TARGETS)) {
    const visited: string[] = [];
    const tree = header.PrimaryHeader({ tab, displayName: "Golfista", avatarUrl: "", onProfile: () => visited.push("profile"), onNotifications: () => visited.push("notifications"), onHome: () => visited.push("home") });
    const rendered = nodes(tree);
    assert.ok(rendered.every((node) => node.type !== "h1" && node.props.className !== "primaryScreenHeading"));
    const wordmark = rendered.find((node) => node.props.className === "editorialWordmark")!;
    assert.match(text(wordmark), /The Backyard/);
    assert.match(text(wordmark), /GOLF MORE TOGETHER/);
    assert.equal(rendered.filter((node) => node.type === "svg").length, 2);
    assert.equal(rendered.filter((node) => node.type === "details").length, 0);
    const buttons = rendered.filter((node) => node.type === "button");
    for (const label of ["Ir a Mi Perfil", "Notificaciones", "Ir a Inicio"]) (buttons.find((node) => node.props["aria-label"] === label)!.props.onClick as () => void)();
    assert.deepEqual(visited, ["profile", "notifications", "home"]);
  }
  assert.match(readFileSync("app/components/profile-account-panel.tsx", "utf8"), /<b>Configuración<\/b><small>Preferencias, cuenta, notificaciones, privacidad y permisos/);
});

test("admin access remains in the top header actions with its existing links and logout", () => {
  let loggedOut = 0;
  const admin = load("app/components/admin-mode-menu.tsx", { "next/link": { __esModule: true, default: "a" }, "./account-provider": { useBackyardAccount: () => ({ adminAccess: { hasAccess: true }, logout: () => { loggedOut++; } }) } });
  const header = load("app/components/primary-header.tsx", { "./profile-navigation-button": { ProfileNavigationButton: () => null }, "./admin-mode-menu": admin });
  const tree = header.PrimaryHeader({ tab: "home", displayName: "Admin", avatarUrl: "", onProfile: () => {}, onNotifications: () => {}, onHome: () => {} });
  const actions = nodes(tree).find((node) => node.props.className === "primaryHeaderActions")!;
  const menu = nodes(actions).find((node) => node.type === "details")!;
  assert.match(text(menu), /Administrador/);
  assert.deepEqual(nodes(menu).filter((node) => node.type === "a").map((node) => [node.props.href, text(node)]), [["/", "Modo jugador"], ["/manage", "Modo administrador"]]);
  const logout = nodes(menu).find((node) => node.type === "button")!;
  (logout.props.onClick as () => void)();
  assert.equal(loggedOut, 1);
  assert.ok(nodes(tree).every((node) => node.props.className !== "primaryScreenHeading"));
});
test("actual bottom navigation has five tabs and Play is always the central destination", () => {
  const nav = load("app/components/app-bottom-nav.tsx", { "next/image": { __esModule: true, default: "img" }, "../../lib/app-navigation": navigation });
  let resumed = 0;
  const inactive = nodes(nav.AppBottomNav({ activeTab: "profile", onNavigate: () => {} })).filter((node) => node.type === "button");
  assert.equal(inactive.length, 5); assert.ok(inactive.every((node) => !/CONTINUAR/.test(text(node))));
  const visited: string[] = [];
  const active = nodes(nav.AppBottomNav({ activeTab: "play", onNavigate: (tab: string) => visited.push(tab), onResumeRound: () => { resumed++; } })).filter((node) => node.type === "button");
  assert.deepEqual(active.map((node) => text(node).trim()), ["Inicio", "Carrera", "Play", "My Coach", "Reglas"]);
  assert.equal(active[2].props["aria-current"], "page");
  (active[2].props.onClick as () => void)(); assert.deepEqual(visited, ["play"]); assert.equal(resumed, 0);
  for (const [index, tab] of Object.values(navigation.BOTTOM_NAV_TARGETS).entries()) {
    const buttons = nodes(nav.AppBottomNav({ activeTab: tab, onNavigate: () => {} })).filter((node) => node.type === "button");
    assert.equal(buttons.filter((node) => node.props["aria-current"] === "page").length, 1);
    assert.equal(buttons[index].props["aria-current"], "page");
  }
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
  assert.deepEqual(h.buttons().map((button) => text(button).trim()), ["Público", "Amigos"]);
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
    assert.equal(h.buttons()[index].props.className, "active");
    assert.match(text(h.buttons()[index]), /✓/);
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
  const rpcCalls: Array<{ name: string; body?: Record<string, unknown> }> = [], ownerFilters: unknown[] = [];
  const client = {
    rpc: (name: string, body?: Record<string, unknown>) => {
      rpcCalls.push({ name, ...(body ? { body } : {}) });
      return { abortSignal: async () => ({ data: name === "set_my_profile_visibility" ? body?.requested_visibility : true, error: null }) };
    },
    from: () => { const query = { select: () => query, eq: (_key: string, owner: string) => { ownerFilters.push(owner); return query; }, abortSignal: () => query, maybeSingle: async () => ({ data: { profile_visibility: "friends" }, error: null }) }; return query; },
  };
  const routes = load("app/api/account/privacy/route.ts", { "next/server": { NextResponse: Response }, "../../../../lib/server-auth": { authenticatedRequest: async () => ({ ok: true, userId: "verified-owner", client }) }, "../../../../lib/profile-visibility": audience, "../../../../lib/backyard-ai/server/http-security": security });
  const invoke = async (method: string, body?: unknown, origin?: string) => (routes[method] as unknown as (req: Request) => Promise<Response>)(new Request("https://preview.invalid/api/account/privacy", { method, headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  assert.equal((await invoke("GET")).status, 200); assert.deepEqual(ownerFilters, ["verified-owner"]);
  for (const bad of [{ visibility: "private" }, { visibility: "public", userId: "victim" }]) assert.equal((await invoke("PATCH", bad)).status, 400);
  assert.equal((await invoke("PATCH", { visibility: "public" }, "https://evil.invalid")).status, 403);
  assert.equal(rpcCalls.length, 0);
  assert.equal((await invoke("PATCH", { visibility: "public" })).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls)), [
    { name: "set_my_profile_visibility", body: { requested_visibility: "public" } },
  ]);
});

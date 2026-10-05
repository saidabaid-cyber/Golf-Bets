import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as discovery from "../lib/friends-discovery";
import * as connections from "../lib/social-connections";
import * as careerNavigation from "../lib/career-navigation";
type Node = { type: any; props: Record<string, any> };
function harness(path: string, boundaries: Record<string, any> = {}) {
  const slots: any[] = [], effects: any[] = []; let cursor = 0; let pending: Array<() => void> = [];
  const react = {
    useState(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value; return [slots[i], (value: any) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(value: any) { return slots[cursor++] ||= { current: value }; }, useMemo(fn: any) { cursor++; return fn(); }, useCallback(fn: any) { cursor++; return fn; },
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (effects[i] && deps.every((d, j) => Object.is(d, effects[i].deps[j]))) return; effects[i]?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = fn(); }); },
  };
  const exports: any = {};
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let sequence = 0;
  runInNewContext(source, { exports, Set, Promise, AbortController, setTimeout, clearTimeout, confirm: () => false, crypto: { randomUUID: () => `operation-${++sequence}` }, require: (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "fragment" };
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) };
    if (id.endsWith("/social-connections")) return connections;
    if (id.endsWith("/friends-discovery")) return discovery;
    if (id.endsWith("/use-view-scroll-reset")) return { useViewScrollReset() {} };
    if (id.endsWith("/round-achievements")) return { deriveRoundAchievements: () => null };
    if (id.endsWith("/account-provider")) return { useBackyardAccount: () => ({ retryCloudSync: async () => {} }) };
    if (id.endsWith("/group-invitations")) return { useGroupNotificationsBadge: () => ({ unread: 2, refreshUnread: async () => {} }), GroupInvitationInbox: "GroupInvitationInbox" };
    if (id.endsWith("/social-qr")) return { SocialQrScanner: "SocialQrScanner", PersonalQr: "PersonalQr" };
    for (const [key, value] of Object.entries(boundaries)) if (id.endsWith(`/${key}`)) return value;
    return new Proxy({}, { get: (_t, key) => String(key) });
  } });
  return { render(name: string, props: any) { cursor = 0; const tree = exports[name](props); const batch = pending; pending = []; batch.forEach(fn => fn()); return tree; } };
}
function nodes(node: any): Node[] { return Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join(" ").replace(/\s+/g, " ").trim() : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""; }
function find(tree: any, predicate: (node: Node) => boolean) { const found = nodes(tree).find(predicate); assert.ok(found); return found; }
function click(tree: any, label: string) { return find(tree, node => node.type === "button" && text(node) === label).props.onClick(); }
const flush = () => new Promise(resolve => setImmediate(resolve));
const person = (id: string, name = `QA ${id}`, username = `qa_${id}`): connections.SocialPerson => ({ user_id: id, display_name: name, username, avatar_url: null });
function setup(count = 5, initialView = "list") {
  let data: connections.ConnectionPage = { people: Array.from({ length: count }, (_, i) => person(`friend-${i}`)), friends: Array.from({ length: count }, (_, i) => `friend-${i}`), requests: [], blocked: [] };
  const calls: any[] = [];
  const request = async (path: string, token: string, init?: any) => {
    assert.equal(token, "qa-token"); calls.push({ path, init });
    if (path.includes("discovery=nearby")) return { users: [person("club-peer", "Carlos Pérez", "near_carlos")], label: "Mismo club" };
    if (path.includes("?target=")) return { person: person(decodeURIComponent(path.split("?target=")[1])) };
    if (path.startsWith("/api/groups/users")) return { users: [person("general-peer", "Carlos Pérez", "far_carlos"), person("club-peer", "Carlos Pérez", "near_carlos")] };
    if (init?.method === "POST") {
      const b = init.body;
      if (b.action === "request" && !data.requests.some(r => r.state === "PENDING" && r.addressee_id === b.target)) data = { ...data, people: [...data.people, person(b.target)], requests: [...data.requests, { id: b.operationId, requester_id: "owner", addressee_id: b.target, state: "PENDING", created_at: "now" }] };
      else if (["ACCEPTED", "REJECTED", "CANCELLED"].includes(b.action)) data = { ...data, requests: data.requests.map(r => r.id === b.id ? { ...r, state: b.action } : r), friends: b.action === "ACCEPTED" ? [...data.friends, data.requests.find(r => r.id === b.id)!.requester_id] : data.friends };
    }
    return data;
  };
  const h = harness("app/components/social-connections-panel.tsx", { "social-activity-client": { socialRequest: request, socialErrorMessage: String } });
  const props = { ownerId: "owner", accessToken: "qa-token", initialView, name: "QA Owner", username: "qa_owner" };
  return { render: () => h.render("FriendsHub", props), calls, graph: () => data, setGraph(next: connections.ConnectionPage) { data = next; }, props };
}

test("Career selects exactly five views; Friends remains its existing independent domain", () => {
  const h = harness("app/components/career-shared.tsx", { "career-navigation": careerNavigation }), views: string[] = [];
  for (const selected of careerNavigation.CAREER_TABS) {
    const tree = h.render("CareerTabs", { view: selected.id, onView: (v: string) => views.push(v) });
    assert.equal(text(tree), "Resumen Logros Rivalidades Rondas Torneos");
    assert.equal(nodes(tree).filter(n => n.props["aria-current"] === "page").length, 1);
    click(tree, selected.label);
  }
  assert.deepEqual(views, careerNavigation.CAREER_TABS.map(v => v.id));
  assert.match(readFileSync("app/page.tsx", "utf8"), /tab === "friends" && <FriendsHub/);
});
for (const count of [0, 5, 20, 100]) test(`existing graph list supports ${count} friends, local filter and compact profile rows`, async () => {
  const h = setup(count); h.render(); await flush(); let tree = h.render();
  assert.match(text(tree), new RegExp(`Mis amigos · ${count}`));
  const rows = nodes(tree).filter(n => n.props["aria-label"]?.startsWith("Ver perfil de")); assert.equal(rows.length, count);
  assert.doesNotMatch(text(tree), /Bloquear|teléfono|@.*\.invalid/);
  if (count) { const before = h.calls.length; find(tree, n => n.type === "input").props.onChange({ target: { value: "qa_friend-1" } }); tree = h.render(); assert.ok(nodes(tree).filter(n => n.props["aria-label"]?.startsWith("Ver perfil de")).length > 0); assert.equal(h.calls.length, before); }
  else assert.match(text(tree), /Conecta con golfistas[\s\S]*Buscar amigos/);
});
test("add view has four real options, dedicated search/nearby, and no phone or map", async () => {
  const h = setup(); h.render(); await flush(); let tree = h.render(); click(tree, "＋ Agregar amigos"); tree = h.render();
  assert.match(text(tree), /Buscar jugadores[\s\S]*Cerca de ti[\s\S]*Escanear QR[\s\S]*Compartir mi QR/); assert.doesNotMatch(text(tree), /teléfono|mapa|GPS/);
  find(tree, n => n.type === "button" && text(n).startsWith("⚑ Cerca de ti")).props.onClick(); tree = h.render(); assert.match(text(tree), /Jugadores cerca de ti[\s\S]*Mismo club/);
});
test("search debounces existing directory, same-club duplicate names rank first, request lock and confirmation retain flow", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] }); const h = setup(0, "search"); h.render(); await flush(); let tree = h.render();
  find(tree, n => n.type === "input").props.onChange({ target: { value: "Carlos" } }); h.render(); context.mock.timers.tick(300); await flush(); tree = h.render();
  assert.ok(h.calls.some(call => call.path === "/api/groups/users?q=Carlos"));
  const rows = nodes(tree).filter(n => n.props["aria-label"]?.startsWith("Ver perfil de")); assert.match(text(rows[0]), /near_carlos/);
  const add = find(tree, n => n.type === "button" && text(n) === "Agregar"); add.props.onClick(); add.props.onClick(); await flush(); tree = h.render();
  assert.equal(h.calls.filter(call => call.init?.method === "POST").length, 1); assert.equal(h.graph().requests.length, 1);
  assert.match(text(tree), /¡Solicitud enviada![\s\S]*Buscar más amigos[\s\S]*Ver perfil/);
  click(tree, "Buscar más amigos"); tree = h.render(); assert.match(text(tree), /Buscar jugadores/); assert.doesNotMatch(text(tree), /¡Solicitud enviada!/);
});
test("incoming accept/reject and outgoing cancel reuse supported API commands", async () => {
  for (const [button, command, incoming] of [["Aceptar", "ACCEPTED", true], ["Rechazar", "REJECTED", true], ["Cancelar solicitud", "CANCELLED", false]] as const) {
    const h = setup(0, "requests"); h.setGraph({ people: [person("peer")], friends: [], blocked: [], requests: [{ id: "request-1", requester_id: incoming ? "peer" : "owner", addressee_id: incoming ? "owner" : "peer", state: "PENDING", created_at: "now" }] });
    h.render(); await flush(); let tree = h.render(); click(tree, button); await flush(); tree = h.render();
    assert.equal(h.calls.find(call => call.init?.method === "POST").init.body.action, command); assert.match(text(tree), /No hay solicitudes pendientes/);
    if (incoming && command === "ACCEPTED") assert.ok(h.graph().friends.includes("peer"));
  }
});
test("QR scanner opens authorized profile for review, never sends request automatically; own QR keeps identity", async () => {
  const h = setup(0, "scan"); let tree = h.render(); await flush(); tree = h.render();
  const scanner = find(tree, n => n.type === "SocialQrScanner"); scanner.props.onFound("gallery-peer"); await flush(); tree = h.render();
  assert.match(text(tree), /QA gallery-peer[\s\S]*Agregar amigo/); assert.equal(h.calls.filter(call => call.init?.method === "POST").length, 0);
  const qr = setup(0, "qr"); tree = qr.render(); const own = find(tree, n => n.type === "PersonalQr"); assert.equal(own.props.userId, "owner"); assert.equal(own.props.username, "qa_owner"); assert.equal(own.props.backLabel, "Amigos");
});
test("deep target is authorized through existing profile RPC endpoint", async () => {
  const h = setup(); Object.assign(h.props, { targetId: "target-peer" }); h.render(); await flush(); const tree = h.render(); assert.match(text(tree), /QA target-peer/); assert.ok(h.calls.some(call => call.path.endsWith("?target=target-peer")));
});
test("SocialFeed menus and friend notification action delegate to canonical hub, group notifications remain", () => {
  const views: any[] = []; const h = harness("app/components/social-feed.tsx"); const props = { initialView: "activity", identityUserId: "owner", accessToken: "qa-token", onOpenFriends: (view: any) => views.push(view) };
  let tree = h.render("SocialFeed", props); click(tree, "Amigos y solicitudes"); click(tree, "Mi QR"); click(tree, "Escanear QR"); assert.deepEqual(views, ["list", "qr", "scan"]);
  tree = h.render("SocialFeed", props); find(tree, n => n.props["aria-label"]?.startsWith("Notificaciones")).props.onClick(); tree = h.render("SocialFeed", props);
  assert.ok(nodes(tree).some(n => n.type === "GroupInvitationInbox")); find(tree, n => n.type === "CloudSocialNotifications").props.onFriends(); assert.equal(views.at(-1), "list");
});
test("ranking prioritizes exact username, exact name and same public club without duplicates, self or blocked", () => {
  const people = [person("far", "Carlos Pérez", "far"), person("near", "Carlos Pérez", "near"), person("owner", "Carlos", "owner"), person("blocked", "Carlos", "blocked"), person("exact-name", "Carlos", "other"), person("exact-user", "Z", "Carlos"), person("near", "Carlos Pérez", "near")];
  assert.deepEqual(discovery.rankFriendResults(people, "@Carlos", new Set(["near"]), "owner", ["blocked"]).map(p => p.user_id), ["exact-user", "exact-name", "near", "far"]);
  assert.deepEqual(discovery.filterCurrentFriends([person("d", "QA Diego Green", "qa_diego_green")], "Diego").map(p => p.user_id), ["d"]);
  assert.equal(discovery.filterCurrentFriends([person("d", "QA Diego Green", "qa_diego_green")], "@qa_diego").length, 1);
});
test("Home, first nudge and preserved QR URL/cache route explicitly to Carrera Friends", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const nudge = page.split("async function openFirstExperienceFriends()")[1].split("\n  }")[0]; assert.match(nudge, /resolve\("friendDiscovery", "opened"\)[\s\S]*openCareerFriends\(\)/); assert.doesNotMatch(nudge, /setTab\("social"\)/);
  assert.match(page, /onOpenFriends=\{\(\) => openCareerFriends\(\)\}/); assert.match(page, /setSocialTarget\(id\); setFriendsInitialView\("list"\); setTab\("friends"\)/); assert.match(page, /sessionStorage.getItem\(PENDING_SOCIAL_KEY\)/);
  assert.match(page, /careerView, setCareerView.*useScreenNavigation/);
});

test("profile response exposes only authorized identity and an already-public club; denied card never reads club", async () => {
  const code = ts.transpileModule(readFileSync("app/api/social/connections/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const permitted of [true, false]) {
    let clubRead = 0; const exports: any = {};
    const ctx = { userId: "owner", client: { rpc: async () => ({ data: permitted ? [{ ...person("peer"), email: "secret@example.invalid", coordinates: [1, 2] }] : [], error: null }) }, admin: { from(table: string) { clubRead++; assert.equal(table, "social_profiles"); const query = { select(column: string) { assert.equal(column, "club_name"); return query; }, eq(column: string, value: string) { if (column === "privacy") assert.equal(value, "PUBLIC"); return query; }, maybeSingle: async () => ({ data: { club_name: "La Vista Country Club" }, error: null }) }; return query; } } };
    runInNewContext(code, { exports, URL, Set, Promise, require: () => ({ socialHttp: async (_request: Request, fn: any) => fn(ctx), socialId: (id: string) => id }) });
    if (permitted) { const result = await exports.GET(new Request("https://dev.thebackyard.com.mx/api/social/connections?target=peer")); assert.equal(result.person.club_name, "La Vista Country Club"); assert.deepEqual(Object.keys(result.person).sort(), ["avatar_url", "club_name", "display_name", "user_id", "username"]); assert.equal(clubRead, 1); }
    else { await assert.rejects(exports.GET(new Request("https://dev.thebackyard.com.mx/api/social/connections?target=blocked-peer")), (error: any) => error.code === "NOT_FOUND"); assert.equal(clubRead, 0); }
  }
});

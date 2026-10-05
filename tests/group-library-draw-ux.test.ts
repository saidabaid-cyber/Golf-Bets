import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as generator from "../lib/group-generator";
import * as templates from "../lib/group-game-template";
import * as editor from "../lib/group-template-editor";
import * as invitations from "../lib/group-invitations";
import * as notificationPresentation from "../features/notifications/presentation";
import type { FrequentGroup } from "../lib/types";

type Node = { type: any; props: Record<string, any> };
function harness(path: string, boundaries: Record<string, any> = {}) {
  const clipboardWrites: string[] = [];
  const slots: any[] = [], effects: any[] = []; let cursor = 0; let pending: Array<() => void> = [];
  const react = {
    useState(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value; return [slots[i], (v: any) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
    useRef(value: any) { return slots[cursor++] ||= { current: value }; },
    useMemo(fn: any) { cursor++; return fn(); }, useCallback(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i].deps[j]))) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (effects[i] && deps.every((d, j) => Object.is(d, effects[i].deps[j]))) return; effects[i]?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = fn(); }); },
  };
  const exports: any = {};
  const modules: Record<string, any> = { "group-generator": generator, "group-game-template": templates, "group-template-editor": editor,
    "account-provider": { useBackyardAccount: () => ({ identity: { accessToken: "controlled-qa" } }) }, ...boundaries };
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let uuid = 0;
  runInNewContext(code, { exports, Date, Set, Promise, AbortController, AbortSignal, window: { scrollY: 200, scrollTo() {}, addEventListener() {}, removeEventListener() {} }, document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} }, navigator: { share: boundaries.navigatorShare, clipboard: { writeText: async (value: string) => { clipboardWrites.push(value); } } }, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout, crypto: { randomUUID: () => `qa-id-${++uuid}` }, fetch: boundaries.fetch,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "next/dynamic") return { __esModule: true, default: () => () => null };
      if (id === "react/jsx-runtime") return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "fragment" };
      if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) };
      if (id === "../../lib/group-invitations") return invitations;
      for (const [key, module] of Object.entries(modules)) if (id.endsWith(`/${key}`)) return module;
      return new Proxy({}, { get: (_t, key) => String(key) });
    } });
  return { render(name: string, props: any) { cursor = 0; const tree = exports[name](props); const batch = pending; pending = []; batch.forEach(fn => fn()); return tree; }, exports, clipboardWrites };
}
function nodes(node: any): Node[] { if (Array.isArray(node)) return node.flatMap(nodes); return node?.props ? [node, ...nodes(node.props.children)] : []; }
function text(node: any): string { if (Array.isArray(node)) return node.map(text).join(" ").replace(/\s+/g, " ").trim(); return node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""; }
function find(tree: any, predicate: (node: Node) => boolean) { const result = nodes(tree).find(predicate); assert.ok(result); return result; }
const click = (tree: any, label: string) => find(tree, n => n.type === "button" && text(n) === label).props.onClick();
function fixture(count = 5): FrequentGroup { const group: FrequentGroup = { id: "qa-domingo", name: "Domingo", uses: 0, updatedAt: "2026-10-04", privacy: "private", players: Array.from({ length: count }, (_, i) => ({ memberId: `member-${i}`, name: `QA Player ${i}`, handicap: i + 4, accountUserId: `qa-account-${i}` })) }; group.gameTemplate = templates.createEmptyGroupGameTemplate(group); group.gameTemplate.betConfig.foursome.enabled = true; group.gameTemplate.betConfig.foursome.fixedValue = 200; return group; }
const flush = () => new Promise(resolve => setImmediate(resolve));

test("created group confirmation can create another while edit confirmation keeps its existing actions", () => {
  const h = harness("app/components/group-builder.tsx"); const events: string[] = [];
  const props = { group: fixture(12), created: true, onClose() {}, onEdit: () => events.push("view"), onPlay: () => events.push("round"), onCreateAnother: () => events.push("another") };
  const created = h.render("GroupDetailDialog", props);
  for (const label of ["Ver grupo", "Crear ronda con este grupo", "CREAR OTRO GRUPO"]) click(created, label);
  assert.deepEqual(events, ["view", "round", "another"]); assert.equal(props.group.players.length, 12);
  const edited = h.render("GroupDetailDialog", { ...props, created: false });
  assert.doesNotMatch(text(edited), /CREAR OTRO GRUPO|¡Grupo creado!/);
});

test("participant review requires explicit confirmation; cancel writes nothing and success refreshes canonical history", async () => {
  const calls: Array<{path: string; options: any}> = []; let refreshed = 0;
  let card = { roundId: "canonical-qa", version: 7, materialHash: "server-hash", courseName: "QA Course", groupName: "QA Group", completed: true,
    players: [{ playerKey: "carlos", accountUserId: "qa-carlos", name: "QA Carlos", status: "PENDING_CONFIRMATION", score: 72, scorecard: [{ hole: 1, score: 4 }] }], myPlayerKey: "carlos", myBalance: -300, canConfirm: true };
  const h = harness("app/components/round-participation-card.tsx", { "social-activity-client": { socialErrorMessage: () => "error", socialRequest: async (path: string, _token: string, options: any) => {
    calls.push({ path, options });
    if (options?.method === "POST") { card = { ...card, canConfirm: false }; return { ok: true }; }
    return { data: card };
  } } });
  const props = { accessToken: "qa-session", roundId: "canonical-qa", onConfirmed: async () => { refreshed++; } };
  h.render("RoundParticipationCard", props); await flush(); let tree = h.render("RoundParticipationCard", props);
  click(tree, "CONFIRMAR MI PARTICIPACIÓN"); tree = h.render("RoundParticipationCard", props);
  click(tree, "VOLVER A REVISAR"); tree = h.render("RoundParticipationCard", props); assert.equal(calls.filter(c => c.options?.method === "POST").length, 0);
  click(tree, "CONFIRMAR MI PARTICIPACIÓN"); tree = h.render("RoundParticipationCard", props); click(tree, "SÍ, CONFIRMAR TARJETA"); await flush(); tree = h.render("RoundParticipationCard", props);
  const writes = calls.filter(c => c.options?.method === "POST"); assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/api/social/rounds/canonical-qa/links"); assert.deepEqual(JSON.parse(JSON.stringify(writes[0].options.body)), { playerKey: "carlos", expectedVersion: 7, expectedHash: "server-hash" });
  assert.equal(refreshed, 1); assert.match(text(tree), /Participación confirmada/); assert.doesNotMatch(text(tree), /SÍ, CONFIRMAR TARJETA/);
});

test("20 compact library cards have one open target, limited avatars/bets and no inline tools or nested buttons", () => {
  const h = harness("app/components/group-builder.tsx"); const groups = Array.from({ length: 20 }, (_, i) => ({ ...fixture(20), id: `group-${i}`, name: `Grupo ${i}` })); let opened = "", played = "";
  const tree = h.render("GroupLibraryView", { groups, onCreate() {}, onDraw() {}, onOpen: (g: FrequentGroup) => { opened = g.id; }, onPlay: (g: FrequentGroup) => { played = g.id; } });
  const cards = nodes(tree).filter(n => n.type === "article"); assert.equal(cards.length, 20);
  for (const card of cards) { assert.equal(nodes(card).filter(n => n.type?.name === "MemberInitial").length, 3); for (const button of nodes(card).filter(n => n.type === "button")) assert.equal(nodes(button.props.children).some(n => n.type === "button"), false); }
  find(tree, n => n.props["aria-label"] === "Abrir grupo Grupo 0").props.onClick(); assert.equal(opened, "group-0");
  find(tree, n => n.props["aria-label"] === "Crear ronda con Grupo 0").props.onClick(); assert.equal(played, "group-0");
  assert.match(text(cards[0]), /20 jugadores[\s\S]*HCP · Diferencial/); assert.doesNotMatch(text(tree), /Jugadores seleccionados|Configuración del sorteo|Invitaciones/);
  const many = fixture(); many.gameTemplate!.betConfig.skins.enabled = true; many.gameTemplate!.betConfig.polla.total18.enabled = true;
  assert.match(h.exports.compactGroupBetSummary(many), /\+1$/);
});

test("draw is a dedicated view; loading deduplicates, guest stays visible, unknown HCP blocks balanced only, and Back returns", async () => {
  const h = harness("app/components/group-builder.tsx"); const g = fixture(5); let saved: any;
  const props = { frequentGroups: [g], frequentPlayers: [], onBack() {}, onPlay() {}, onSaveFrequentGroup: (name: string, players: any) => { saved = { name, players }; return true; }, onCreateFrequentGroup() {}, onOpenFrequentGroup() {}, onStartFrequentGroup() {}, onEditFrequentGroup() {}, onDeleteFrequentGroup() {}, onAcceptedMembers() {}, onCloseDetail() {} };
  let tree = h.render("GroupBuilder", props); find(tree, n => n.type?.name === "GroupLibraryView").props.onDraw();
  tree = h.render("GroupBuilder", props); assert.match(text(tree), /Armar grupos[\s\S]*Sortea o balancea/); assert.equal(nodes(tree).some(n => n.type === "details"), false);
  find(tree, n => n.type === "button" && text(n).includes("Domingo")).props.onClick(); tree = h.render("GroupBuilder", props);
  find(tree, n => n.type === "button" && text(n).includes("Domingo")).props.onClick(); tree = h.render("GroupBuilder", props); assert.match(text(tree), /Seleccionados · 5/); assert.match(text(tree), /Esos jugadores ya estaban seleccionados/);
  const discovery = find(tree, n => n.type?.name === "GroupMemberSelection"); assert.equal(discovery.props.friendsOnly, true);
  discovery.props.onAdd({ memberId: "friend-unknown", name: "Unknown HCP", handicap: null, accountUserId: "friend-unknown" }); tree = h.render("GroupBuilder", props);
  assert.equal(find(tree, n => n.type === "button" && text(n) === "Balanceado por HCP").props.disabled, true); assert.notEqual(find(tree, n => n.type === "button" && text(n) === "Aleatorio").props.disabled, true);
  find(tree, n => n.props["aria-label"] === "Quitar seleccionado Unknown HCP").props.onClick(); tree = h.render("GroupBuilder", props);
  find(tree, n => n.type === "input" && n.props.placeholder === "Nombre del jugador").props.onChange({ target: { value: "Juan Pérez" } });
  find(tree, n => n.type === "NumericCaptureInput").props.onValueChange(14); tree = h.render("GroupBuilder", props); click(tree, "+ Agregar"); tree = h.render("GroupBuilder", props);
  const selected = find(tree, n => n.props["aria-label"] === "Jugadores seleccionados"); assert.match(text(selected), /Juan Pérez[\s\S]*HCP 14[\s\S]*Sin app/); assert.equal(nodes(selected).filter(n => n.type === "button").length, 6);
  for (const size of [3, 4, 5]) { click(tree, `Grupos de ${size}`); tree = h.render("GroupBuilder", props); assert.equal(find(tree, n => n.type === "button" && text(n) === `Grupos de ${size}`).props["aria-pressed"], true); }
  click(tree, "Balanceado por HCP"); tree = h.render("GroupBuilder", props); click(tree, "Armar grupos"); tree = h.render("GroupBuilder", props); assert.match(text(tree), /Resultado/);
  const result = nodes(tree).filter(n => n.type === "article"); const names = result.flatMap(card => nodes(card).filter(n => n.type === "li").map(n => text(n))); assert.equal(names.length, 6); assert.equal(new Set(names).size, 6);
  click(tree, "Intercambiar jugadores"); tree = h.render("GroupBuilder", props);
  const swapOptions = nodes(find(tree, n => n.props["aria-label"] === "Primer jugador a intercambiar")).filter(n => n.type === "option" && n.props.value);
  const originalFirst = text(result[0]); const incoming = text(swapOptions[3]);
  find(tree, n => n.props["aria-label"] === "Primer jugador a intercambiar").props.onChange({ target: { value: swapOptions[0].props.value } }); find(tree, n => n.props["aria-label"] === "Segundo jugador a intercambiar").props.onChange({ target: { value: swapOptions[3].props.value } }); tree = h.render("GroupBuilder", props); click(tree, "Intercambiar"); tree = h.render("GroupBuilder", props);
  const swappedFirst = text(nodes(tree).filter(n => n.type === "article")[0]); assert.notEqual(swappedFirst, originalFirst); assert.ok(swappedFirst.includes(incoming));
  await click(tree, "Compartir"); assert.equal(h.clipboardWrites.length, 1); assert.match(h.clipboardWrites[0], /Grupo/);
  click(tree, "Volver a sortear"); tree = h.render("GroupBuilder", props); find(tree, n => n.type === "button" && text(n) === "Guardar como grupo frecuente").props.onClick(); tree = h.render("GroupBuilder", props);
  find(tree, n => n.props["aria-label"] === "Nombre del grupo generado 1").props.onChange({ target: { value: "QA Draw" } }); tree = h.render("GroupBuilder", props); click(tree, "Guardar"); assert.equal(saved.name, "QA Draw"); assert.ok(saved.players.length >= 3);
  click(tree, "← Mis grupos"); tree = h.render("GroupBuilder", props); assert.ok(nodes(tree).some(n => n.type?.name === "GroupLibraryView")); assert.equal(g.players.length, 5);
});

test("detail is full page, shows every member and opens the existing editor, selector and outgoing manager", () => {
  const h = harness("app/components/group-builder.tsx"); const events: string[] = []; const group = fixture(); group.players[4] = { name: "Juan Pérez", handicap: 14, kind: "guest", memberId: "guest" };
  const props = { group, onBack: () => events.push("back"), onEdit: () => events.push("edit"), onPlay: () => events.push("play"), onDelete: () => events.push("delete"), onAcceptedMembers() {} }; let tree = h.render("GroupDetailView", props);
  assert.doesNotMatch(text(tree), /ModalShell/); assert.equal(nodes(tree).some(n => n.props.role === "dialog"), false); assert.match(text(tree), /Jugadores[\s\S]*QA Player 0[\s\S]*Juan Pérez[\s\S]*Sin app/);
  for (const label of ["← Mis grupos", "Editar grupo", "Crear ronda con este grupo", "Eliminar grupo"]) click(tree, label); assert.deepEqual(events, ["back", "edit", "play", "delete"]);
  click(tree, "Invitar / administrar integrantes"); tree = h.render("GroupDetailView", props); assert.ok(nodes(tree).some(n => n.type === "GroupInviteManager")); assert.doesNotMatch(text(tree), /Configuración de HCP/);
});

test("Share uses native Web Share with the generated result when available", async () => {
  const shares: any[] = [];
  const h = harness("app/components/group-builder.tsx", { navigatorShare: async (payload: any) => { shares.push(payload); } });
  const props = { frequentGroups: [fixture()], frequentPlayers: [], onBack() {}, onPlay() {}, onSaveFrequentGroup() {}, onCreateFrequentGroup() {}, onOpenFrequentGroup() {}, onStartFrequentGroup() {}, onEditFrequentGroup() {}, onDeleteFrequentGroup() {}, onAcceptedMembers() {}, onCloseDetail() {} };
  let tree = h.render("GroupBuilder", props); find(tree, n => n.type?.name === "GroupLibraryView").props.onDraw();
  tree = h.render("GroupBuilder", props); find(tree, n => n.type === "button" && text(n).includes("Domingo")).props.onClick();
  tree = h.render("GroupBuilder", props); click(tree, "Armar grupos"); tree = h.render("GroupBuilder", props);
  await click(tree, "Compartir"); tree = h.render("GroupBuilder", props);
  assert.equal(shares.length, 1); assert.equal(shares[0].title, "The Backyard · Grupos");
  for (let i = 0; i < 5; i++) assert.ok(shares[0].text.includes(`QA Player ${i}`));
  assert.equal(h.clipboardWrites.length, 0); assert.match(text(tree), /Resumen compartido/);
});

test("badge composes unread socials plus only pending incoming invitations and refreshes after acceptance", async () => {
  const now = Date.now(); const invites = [{ id: "incoming", outgoing: false, state: "PENDING", expires_at: new Date(now + 3600000).toISOString() }, { id: "outgoing", outgoing: true, state: "PENDING", expires_at: new Date(now + 3600000).toISOString() }, { id: "expired", outgoing: false, state: "PENDING", expires_at: new Date(now - 1).toISOString() }, { id: "accepted", outgoing: false, state: "ACCEPTED", expires_at: new Date(now + 3600000).toISOString() }];
  const h = harness("app/components/group-invitations.tsx", {
    "presentation":notificationPresentation,
    "client":{unreadNotificationEvents:async()=>[{id:"unread",type:"friend_request",activityId:"request",readAt:null,createdAt:new Date(now).toISOString()}]},
    "social-activity-client": { socialRequest: async () => ({ enabled:true,data:[{type:"group_invite",inApp:true}] }) },
    fetch: async () => ({ ok: true, json: async () => ({ invitations: invites }) }) });
  assert.equal(h.exports.pendingIncomingGroupInvitations(invites, now).length, 1); h.render("useGroupNotificationsBadge", "QA"); await flush(); let state = h.render("useGroupNotificationsBadge", "QA"); assert.equal(state.unread, 2);
  invites[0].state = "ACCEPTED"; await state.refreshUnread(); state = h.render("useGroupNotificationsBadge", "QA"); assert.equal(state.unread, 1);
  const builder = readFileSync("app/components/group-builder.tsx", "utf8"), social = readFileSync("app/components/social-feed.tsx", "utf8"), page = readFileSync("app/page.tsx", "utf8");
  assert.doesNotMatch(builder, /GroupInvitationInbox|groupDrawTools|role="tab"/); assert.match(social, /view === "notifications"[\s\S]*GroupInvitationInbox/); assert.match(social, /await retryCloudSync\(\); await refreshUnread\(\)/); assert.match(page, /notificationCount=\{groupNotificationsUnread\}/);
  const inbox = readFileSync("app/components/group-invitations.tsx", "utf8"); assert.match(inbox, /filter\(\(invite: GroupInvitation\) => !invite.outgoing\)/); assert.match(inbox, /CaptureGroupInvitationLink/); assert.match(inbox, /PendingGroupInvitation/);
});

test("incoming inbox hides outgoing invitations and acceptance reloads then invokes cloud/count callback", async () => {
  const invitation = { id: "incoming-qa", group_name: "QA Invitation", outgoing: false, state: "PENDING", expires_at: new Date(Date.now() + 3600000).toISOString() };
  const calls: string[] = []; let synced = 0;
  const h = harness("app/components/group-invitations.tsx", { fetch: async (url: string, options: any) => {
    assert.equal(url, "/api/groups/invitations"); calls.push(options.method);
    if (options.method === "POST") { assert.deepEqual(JSON.parse(options.body), { action: "accept", invitationId: "incoming-qa" }); invitation.state = "ACCEPTED"; }
    return { ok: true, json: async () => ({ invitations: [invitation, { ...invitation, id: "outgoing", group_name: "Outgoing QA", outgoing: true }] }) };
  } });
  const props = { accessToken: "controlled-qa", onAccepted: async () => { synced++; } };
  h.render("GroupInvitationInbox", props); await flush(); let tree = h.render("GroupInvitationInbox", props);
  assert.match(text(tree), /QA Invitation/); assert.doesNotMatch(text(tree), /Outgoing QA|Rechazar/);
  click(tree, "Aceptar"); await flush(); tree = h.render("GroupInvitationInbox", props); assert.equal(synced, 1); assert.deepEqual(calls, ["GET", "POST", "GET"]); assert.match(text(tree), /Invitación aceptada/); assert.equal(nodes(tree).some(n => n.type === "button" && text(n) === "Aceptar"), false);
});

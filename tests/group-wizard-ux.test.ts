import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as generator from "../lib/group-generator";
import * as editor from "../lib/group-template-editor";
import * as templates from "../lib/group-game-template";
import * as frequent from "../lib/frequent-templates";
import * as engine from "../lib/engine";
import * as foursome from "../lib/foursome-config";
import * as registry from "../lib/bets/registry";
import * as supplemental from "../lib/supplemental-bets";
import type { FrequentGroup } from "../lib/types";

type Node = { type: unknown; props: Record<string, any> };
const page = readFileSync("app/page.tsx", "utf8");
const fixture = (): FrequentGroup => ({ id: "qa-wizard", name: "QA UX Group", privacy: "private", uses: 0, updatedAt: "2026-10-04", players: [{ memberId: "owner", name: "Owner", accountUserId: "owner", handicap: 8.2 }] });
const person = { user_id: "friend", display_name: "QA Diego Green", username: "qa_diego_green", avatar_url: null };

/** Executes the real component's event handlers/effects without a browser or network. */
function componentHarness(path: string, boundaries: Record<string, unknown> = {}) {
  const slots: any[] = [], effects: Array<{ deps: any[]; cleanup?: () => void }> = [];
  let cursor = 0, pending: Array<() => void> = [];
  const timers = new Map<number, () => void>(); let nextTimer = 0;
  const react = {
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(initial: any) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useMemo(callback: () => any) { cursor++; return callback(); },
    useEffect(callback: () => any, deps: any[]) { const index = cursor++; const previous = effects[index]; if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return; previous?.cleanup?.(); effects[index] = { deps }; pending.push(() => { effects[index].cleanup = callback(); }); },
  };
  const jsx = { jsx: (type: unknown, props: any) => ({ type, props }), jsxs: (type: unknown, props: any) => ({ type, props }), Fragment: "fragment" };
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const modules: Record<string, unknown> = { "group-generator": generator, "group-game-template": templates, "group-template-editor": editor, "bets/registry": registry, engine, "foursome-config": foursome, "supplemental-bets": supplemental, ...boundaries };
  runInNewContext(code, { exports, crypto: { randomUUID: () => "unique-member" }, AbortController,
    setTimeout: (fn: () => void) => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: (id: number) => timers.delete(id),
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return jsx;
      if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) };
      for (const [key, value] of Object.entries(modules)) if (id.endsWith(`/${key}`)) return value;
      if (id.endsWith("/use-visual-content")) return { useVisualContent: () => [] };
      return new Proxy({}, { get: (_t, name) => String(name) });
    } });
  return { render(name: string, props: any): Node { cursor = 0; const tree = exports[name](props); const batch = pending; pending = []; batch.forEach(run => run()); return tree; }, tick() { const batch = [...timers.values()]; timers.clear(); batch.forEach(run => run()); }, close() { effects.forEach(effect => effect?.cleanup?.()); } };
}
function nodes(root: any): Node[] { if (Array.isArray(root)) return root.flatMap(nodes); if (!root || typeof root !== "object" || !root.props) return []; return [root, ...nodes(root.props.children)]; }
function text(root: any): string { if (Array.isArray(root)) return root.map(text).join(" "); if (typeof root === "string" || typeof root === "number") return String(root); return root?.props ? text(root.props.children) : ""; }
function find(root: Node, predicate: (node: Node) => boolean) { const result = nodes(root).find(predicate); assert.ok(result); return result; }

test("friends appear without global search; local filter, one-tap selection and account deduplication", async () => {
  let group = fixture(); const calls: string[] = [];
  const h = componentHarness("app/components/group-builder.tsx", { "social-activity-client": { socialRequest: async (url: string) => { calls.push(url); return url.includes("groups/users") ? { users: [person] } : { people: [person], friends: [person.user_id], blocked: [] }; } } });
  const props = () => ({ group, frequentPlayers: [], accessToken: "QA", onAdd: (member: any) => { group = frequent.addFrequentGroupMember(group, member); }, onRemove: (index: number) => { group = frequent.removeFrequentGroupMember(group, index); } });
  h.render("GroupMemberSelection", props()); await new Promise(resolve => setImmediate(resolve));
  let tree = h.render("GroupMemberSelection", props()); assert.match(text(tree), /QA Diego Green/); assert.deepEqual(calls, ["/api/social/connections"]);
  find(tree, n => n.type === "button" && n.props["aria-label"] === "Agregar QA Diego Green").props.onClick();
  assert.equal(group.players.length, 2); assert.equal(group.players[1].accountUserId, "friend"); assert.equal(group.players[1].handicap, null);
  tree = h.render("GroupMemberSelection", props()); assert.equal(find(tree, n => n.type === "button" && n.props["aria-label"] === "Quitar QA Diego Green").props["aria-pressed"], true);
  find(tree, n => n.type === "input" && n.props.placeholder === "Buscar entre mis amigos").props.onChange({ target: { value: "missing" } });
  tree = h.render("GroupMemberSelection", props()); assert.doesNotMatch(text(tree), /QA Diego Green/); assert.equal(calls.length, 1);
  find(tree, n => n.type === "input" && n.props.placeholder === "Nombre o @usuario").props.onChange({ target: { value: "@qa_diego_green" } });
  h.render("GroupMemberSelection", props()); h.tick(); await new Promise(resolve => setImmediate(resolve));
  tree = h.render("GroupMemberSelection", props()); assert.ok(calls[1].endsWith("%40qa_diego_green"));
  assert.equal(find(tree, n => n.type === "button" && n.props["aria-label"] === "Quitar QA Diego Green").props["aria-pressed"], true);
  group = frequent.addFrequentGroupMember(group, { ...group.players[1], name: "Different display name", memberId: "duplicate" }); assert.equal(group.players.length, 2);
  assert.doesNotMatch(text(tree), /email|@example/); h.close();
});

test("Foursome first level has real basics; advanced HCP/rounding/pressure are collapsed", () => {
  const group = fixture(); const value = templates.createEmptyGroupGameTemplate(group); value.betConfig.foursome.enabled = true;
  const h = componentHarness("app/components/group-bet-template-editor.tsx");
  const tree = h.render("GroupBetTemplateEditor", { value, players: templates.groupTemplatePlayers(group), ownerId: "owner", mode: "details", onlyBetId: "foursome", onChange: () => {} });
  assert.match(text(tree), /Configurar Foursome[\s\S]*Modalidad[\s\S]*Tramos/);
  const advanced = find(tree, n => n.type === "details" && n.props.className === "advanced");
  assert.equal(advanced.props.open, undefined); assert.match(text(advanced), /Redondeo del cálculo[\s\S]*Presión/);
  assert.ok(nodes(advanced).some(n => n.type === "HcpPercentageInput"));
  const outside = nodes(tree).filter(n => n.type === "details" && n !== advanced); assert.ok(outside.length > 0);
  assert.ok(nodes(tree).some(n => n.type === "HandicapBaseControl"));
  for (const name of ["Valor fijo", "Valor por punto / patada"]) assert.doesNotMatch(text(advanced), new RegExp(name));
});

test("shared HCP mapping is relative/course and money prefix keeps capture callback unchanged", () => {
  assert.deepEqual(editor.HANDICAP_BASIS_LABELS, { relative: "Diferencial · Entre jugadores", course: "Completo · Contra el campo" });
  const h = componentHarness("app/components/round-handicap-basis-control.tsx"); let saved = "";
  const tree = h.render("RoundHandicapBasisControl", { value: "relative", onChange: (value: string) => { saved = value; } });
  const buttons = nodes(tree).filter(n => n.type === "button"); assert.equal(buttons.length, 2);
  buttons[0].props.onClick(); assert.equal(saved, "relative"); buttons[1].props.onClick(); assert.equal(saved, "course");
  const money = componentHarness("app/components/bet-money-input.tsx").render("BetMoneyInput", { label: "Valor", value: 200.75, onChange: (v: number) => { saved = String(v); }, step: 0.01 });
  assert.match(text(money), /\$/); const capture = find(money, n => n.type === "NumericCaptureInput"); assert.equal(capture.props.value, 200.75); capture.props.onValueChange(200.75); assert.equal(saved, "200.75");
  assert.match(page, /const MoneyInput = BetMoneyInput/); assert.match(readFileSync("app/components/group-bet-template-editor.tsx", "utf8"), /BetMoneyInput/);
});

test("wizard retains validation, private default, legacy invite_only and first-experience return contracts", () => {
  const wizard = page.split('{frequentGroupDraft && <div className="modalBackdrop"')[1].split("<ModalShell")[0];
  assert.match(wizard, /1 de 2 · Jugadores/); assert.match(wizard, /2 de 2 · Apuestas/); assert.match(wizard, /Siguiente →/); assert.match(wizard, /Guardar grupo/); assert.match(wizard, /setFrequentGroupEditorTab\("members"\)/);
  assert.doesNotMatch(wizard, /groupPrivacyChoices|GroupInviteManager|role="tab"|Jugador nuevo/);
  assert.match(page.split("function beginCreateFrequentGroup()")[1].split("function addPlayerToFrequentGroup")[0], /privacy: "private"/);
  assert.equal(frequent.parseFrequentGroups(frequent.serializeFrequentGroups([{ ...fixture(), privacy: "invite_only" }]))[0].privacy, "invite_only");
  assert.match(wizard, /canEditGuestHandicap\(member\)/); assert.match(wizard, /Sin app/);
  const save = page.split("async function saveFrequentGroupEdit()")[1].split("async function attachScorecardPhoto")[0];
  assert.match(save, /templateIssues.blocking.length/); assert.match(save, /firstContext.origin === "round" \? "firstRoundGroup" : "firstGroup", "created"/); assert.match(save, /setTab\(firstContext.tab\)/);
  assert.doesNotMatch(save, /setCourse|setPlayers|setBets|setScores|requestNewRoundIntent/);
  const createGuest = page.split("function addNewPlayerToFrequentGroup()")[1].split("function editFrequentGroupMember")[0];
  assert.match(createGuest, /kind: "guest"/); assert.doesNotMatch(createGuest, /accountUserId|fetch\(|auth\.|invitation/i);
  assert.match(readFileSync("app/components/group-builder.tsx", "utf8"), /activeSection === "invitations"[\s\S]*GroupInviteManager/);
});

test("guest, Foursome and personal values survive serialization; editing group cannot mutate round snapshot", () => {
  let group = frequent.addFrequentGroupMember(fixture(), { memberId: "guest", name: "Juan Pérez", handicap: 14, kind: "guest" });
  group.gameTemplate = templates.createEmptyGroupGameTemplate(group);
  group.gameTemplate = editor.patchGroupTemplateCore(group.gameTemplate, "foursome", { enabled: true, mode: "fixed", fixedValue: 200, pointValue: 50, segmentSize: 6, hcpPct: 85, decimals: "partial", baseMode: "moving", pressureMultiplier: 3, pressSecond9: true });
  let sequence = 0;
  const round = templates.instantiateGroupGameTemplate(frequent.parseFrequentGroups(frequent.serializeFrequentGroups([group]))[0], () => `round-player-${++sequence}`);
  const frozen = JSON.stringify(round); assert.equal(round.players.find(p => p.name === "Juan Pérez")?.accountUserId, undefined);
  for (const key of ["mode", "fixedValue", "pointValue", "segmentSize", "hcpPct", "decimals", "baseMode", "pressureMultiplier", "pressSecond9"] as const) assert.equal(round.bets.foursome[key], group.gameTemplate.betConfig.foursome[key]);
  group = frequent.updateFrequentGroupMember(group, 1, { handicap: 24 }); group.gameTemplate = editor.patchGroupTemplateCore(group.gameTemplate!, "foursome", { fixedValue: 999 });
  assert.equal(JSON.stringify(round), frozen); assert.match(editor.groupTemplatePresentationDetails(group).join(" "), /Foursome · Fijo · \$999 · 6 hoyos/);
});

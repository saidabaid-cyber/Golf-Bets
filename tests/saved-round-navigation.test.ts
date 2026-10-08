import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as navigation from "../lib/app-navigation";
import * as careerNavigation from "../lib/career-navigation";

type Hook = { tab: navigation.AppTab; careerView:careerNavigation.CareerView;setCareerView:(view:careerNavigation.CareerView)=>void; careerDetail:careerNavigation.CareerDetail;setCareerDetail:(detail:careerNavigation.CareerDetail)=>void; historyDetailId: string | null; setTab: (tab: navigation.AppTab, options?: { roundId?: string | null; careerView?: careerNavigation.CareerView }) => void; setNavigationGuard: (guard: (tab: navigation.AppTab) => navigation.AppTab) => void };

/** Execute the real navigation hook with browser history and React state
 * boundaries, without loading unrelated providers or a remote database. */
function browserAt(search: string) {
  const listeners = new Map<string, () => void>();
  const entries = [{ url: `/${search}`, state: {} as Record<string, unknown> }];
  let position = 0;
  const location = { pathname: "/", search };
  const history = {
    state: entries[0].state,
    replaceState(state: Record<string, unknown>, _title: string, url: string) { entries[position] = { state, url }; update(); },
    pushState(state: Record<string, unknown>, _title: string, url: string) { entries.splice(position + 1); entries.push({ state, url }); position++; update(); },
    back() { if (position > 0) { position--; update(); listeners.get("popstate")?.(); } },
    forward() { if (position + 1 < entries.length) { position++; update(); listeners.get("popstate")?.(); } },
  };
  function update() { const parsed = new URL(entries[position].url, "https://qa.example.invalid"); location.pathname = parsed.pathname; location.search = parsed.search; history.state = entries[position].state; }
  const window = { location, history, scrollY: 0, addEventListener: (event: string, handler: () => void) => listeners.set(event, handler), removeEventListener: (event: string) => listeners.delete(event) };
  return window;
}

function mount(window: ReturnType<typeof browserAt>) {
  let cursor = 0;
  let initial = true;
  const slots: unknown[] = [];
  const effects: Array<() => void> = [];
  const react = {
    useState(value: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], (next: unknown) => { slots[index] = next; }]; },
    useRef(value: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useEffect(effect: () => void) { if (initial) effects.push(effect); },
    useCallback(callback: unknown) { return callback; },
  };
  const source = ts.transpileModule(readFileSync("app/components/use-screen-navigation.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported = {} as { useScreenNavigation: () => Hook };
  new Function("require", "exports", "window", source)((name: string) => name === "react" ? react : name.includes("app-navigation") ? navigation : name.includes("career-navigation") ? careerNavigation : { useViewScrollReset() {} }, exported, window);
  function render() { cursor = 0; const result = exported.useScreenNavigation(); initial = false; return result; }
  render(); effects.forEach(effect => effect());
  return render;
}

test("saved round URL survives reload without reconstructing an empty active round", () => {
  const browser = browserAt("?screen=results&friend=existing-invite");
  let render = mount(browser);
  render().setTab("historyDetail", { roundId: "qa-saved-round-9" });
  assert.equal(render().historyDetailId, "qa-saved-round-9");
  assert.equal(new URLSearchParams(browser.location.search).get("friend"), "existing-invite");
  render = mount(browser);
  assert.equal(render().tab, "historyDetail");
  assert.equal(render().historyDetailId, "qa-saved-round-9");
});
test('global history normalization preserves a social profile and its child card through reload and Back',()=>{
  const child='?player=22222222-2222-4222-8222-222222222222&playerTab=rounds&card=social%3A44444444-4444-4444-8444-444444444444';
  const browser=browserAt(child);let render=mount(browser);
  assert.equal(new URLSearchParams(browser.location.search).get('playerTab'),'rounds');
  render=mount(browser);assert.equal(new URLSearchParams(browser.location.search).get('player'),'22222222-2222-4222-8222-222222222222');
  render().setTab('coach');assert.equal(new URLSearchParams(browser.location.search).has('player'),false);
  browser.history.back();assert.equal(render().tab,'welcome');assert.equal(new URLSearchParams(browser.location.search).get('playerTab'),'rounds');assert.match(browser.location.search,/card=social/);
  render().setTab('welcome');assert.equal(new URLSearchParams(browser.location.search).has('player'),false,'an explicit Inicio action leaves the profile');
});
test("all five Carrera tabs survive direct reload and browser Back within the same screen",()=>{
  const browser=browserAt("?screen=career&career=summary");let render=mount(browser);
  for(const tab of careerNavigation.CAREER_TABS){render().setCareerView(tab.id);assert.equal(render().careerView,tab.id);render=mount(browser);assert.equal(render().careerView,tab.id);}
  browser.history.back();assert.equal(render().careerView,"rounds");assert.equal(render().tab,"career");
});
test("switching from an index detail clears only the detail and Back/Forward restore section URLs",()=>{
  const browser=browserAt("?screen=career&career=summary&careerDetail=attest&unrelated=keep"),render=mount(browser);
  render().setCareerView("achievements");
  assert.equal(new URLSearchParams(browser.location.search).has("careerDetail"),false);
  assert.equal(new URLSearchParams(browser.location.search).get("unrelated"),"keep");
  browser.history.back();assert.equal(render().careerView,"summary");assert.equal(new URLSearchParams(browser.location.search).get("careerDetail"),"attest");
  browser.history.forward();assert.equal(render().careerView,"achievements");assert.equal(render().tab,"career");
});
test("bottom-nav Career clears a live Summary detail in state and URL, while Back restores it",()=>{
  const browser=browserAt("?screen=career&career=summary&unrelated=keep"),render=mount(browser);
  for(const detail of ["attest","index"] as const){
    render().setCareerDetail(detail);
    assert.equal(render().careerDetail,detail);
    render().setTab("career",{careerView:"summary"});
    assert.equal(render().careerDetail,null);
    assert.equal(render().careerView,"summary");
    assert.equal(new URLSearchParams(browser.location.search).has("careerDetail"),false);
    assert.equal(new URLSearchParams(browser.location.search).get("unrelated"),"keep");
    browser.history.back();assert.equal(render().careerDetail,detail);
    browser.history.forward();assert.equal(render().careerDetail,null);
  }
  const page=readFileSync("app/page.tsx","utf8");
  assert.match(page,/detail=\{careerDetail\} onDetail=\{setCareerDetail\}/);
});
test("Career subviews do not change global routes or prevent returning to Inicio/Play/Coach/Reglas",()=>{
  const browser=browserAt("?screen=career&career=rounds"),render=mount(browser);
  for(const tab of ["welcome","play","coach","rules","career"] as const){render().setTab(tab);assert.equal(render().tab,tab);}
  assert.equal(render().careerView,"rounds");
});

for (const previous of ["achievements", "tournaments"] as const) test(`bottom-nav Career opens summary after visiting ${previous}, preserving Back/Forward`, () => {
  const browser=browserAt(`?screen=career&career=${previous}&careerDetail=index`),render=mount(browser);
  render().setTab("welcome");
  render().setTab("career",{careerView:"summary"});
  assert.equal(render().careerView,"summary");
  assert.equal(render().tab,"career");
  assert.equal(new URLSearchParams(browser.location.search).has("careerDetail"),false);
  browser.history.back();assert.equal(render().tab,"welcome");
  browser.history.back();assert.equal(render().careerView,previous);
  browser.history.forward();browser.history.forward();assert.equal(render().careerView,"summary");
  const page=readFileSync("app/page.tsx","utf8");
  const adapter=page.slice(page.indexOf("function navigateFromBottomBar"),page.indexOf("function openRulesForRound"));
  assert.match(adapter,/setTab\(target, target === "career" \? \{ careerView: "summary" \} : target === "welcome" \? \{ resetHome: true \} : undefined\)/);
});

test("opening another historical round and browser Back restore the respective selections", () => {
  const browser = browserAt("?screen=history");
  const render = mount(browser);
  render().setTab("historyDetail", { roundId: "qa-round-a" });
  render().setTab("historyDetail", { roundId: "qa-round-b" });
  assert.equal(render().historyDetailId, "qa-round-b");
  browser.history.back();
  assert.equal(render().historyDetailId, "qa-round-a");
  render().setTab("play");
  assert.equal(render().historyDetailId, null);
  assert.equal(new URLSearchParams(browser.location.search).has("round"), false);
});

test("navigation guard does not carry an inaccessible historical selection into another screen", () => {
  const browser = browserAt("?screen=play");
  const render = mount(browser);
  render().setNavigationGuard(() => "setup");
  render().setTab("historyDetail", { roundId: "private-foreign-id" });
  assert.equal(render().tab, "setup");
  assert.equal(render().historyDetailId, null);
  assert.equal(browser.location.search, "?screen=setup");
});

test("round references are screen scoped and reject malformed or oversized URL values", () => {
  assert.equal(navigation.historicalRoundIdFromSearch("?screen=historyDetail&round=2vj25cjj"), "2vj25cjj");
  for (const value of ["", "<script>", "../another", "x".repeat(129)]) {
    const href = navigation.screenHref("historyDetail", "", value);
    assert.equal(navigation.historicalRoundIdFromSearch(href.slice(1)), null);
    assert.equal(href.includes("round="), false);
  }
  assert.equal(navigation.historicalRoundIdFromSearch("?screen=results&round=qa-round"), null);
});

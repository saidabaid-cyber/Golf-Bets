import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { CAREER_TABS, careerDetailFromSearch } from "../lib/career-navigation";
import * as careerNavigation from "../lib/career-navigation";
import { primarySectionForTab } from "../lib/app-navigation";
import { uiNodes, uiFind } from "./helpers/social-ui";

/** Run the real shell/handlers; substitute scheduling, lazy module loads and browser geometry. */
function shell(search="?screen=career&career=summary") {
  const slots:any[]=[],effects:any[]=[];let cursor=0,pending:Array<()=>void>=[];
  const effect=(fn:any,deps:any[])=>{const i=cursor++;if(effects[i]&&deps.every((d,j)=>Object.is(d,effects[i].deps[j])))return;effects[i]?.cleanup?.();effects[i]={deps};pending.push(()=>{effects[i].cleanup=fn();});};
  const react={
    useState(initial:any){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==="function"?initial():initial;return[slots[i],(next:any)=>{slots[i]=typeof next==="function"?next(slots[i]):next;}];},
    useRef(initial:any){return slots[cursor++]||={current:initial};},useEffect:effect,useLayoutEffect:effect,
  };
  const listeners=new Map<string,()=>void>(),scrollKeys:string[]=[];
  const location={search,href:`https://dev.thebackyard.com.mx/${search}`};
  const window={location,history:{state:{},pushState(_state:any,_title:string,url:any){location.href=String(url);location.search=new URL(String(url)).search;}},addEventListener:(type:string,fn:()=>void)=>listeners.set(type,fn),removeEventListener:(type:string)=>listeners.delete(type)};
  const modules=["CareerOverview","CareerAchievements","CareerRivalries","CareerRounds","CareerTournaments"];
  let lazy=0;
  const exports:any={};
  const js=ts.transpileModule(readFileSync("app/components/career-hub.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  runInNewContext(js,{exports,window,URL,URLSearchParams,require(id:string){
    if(id==="react")return react;
    if(id==="react/jsx-runtime")return{jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:"fragment"};
    if(id==="next/dynamic")return()=>modules[lazy++];
    if(id.endsWith(".css"))return{__esModule:true,default:new Proxy({},{get:(_t,k)=>String(k)})};
    if(id.endsWith("/career-navigation"))return careerNavigation;
    if(id.endsWith("/use-view-scroll-reset"))return{useViewScrollReset(key:string){effect(()=>{scrollKeys.push(key);},[key]);}};
    if(id.endsWith("/career"))return{recordCareerEvent(){}};
    return new Proxy({},{get:(_t,k)=>String(k)});
  }});
  const props:any={userId:"qa-owner",displayName:"QA Owner",view:careerNavigation.careerViewFromSearch(search),detail:careerNavigation.careerDetailFromSearch(search),ready:true,index:{source:"UNKNOWN",value:null},rounds:[],insights:{},onDetail:(detail:string|null)=>{props.detail=detail;const url=new URL(location.href);if(detail)url.searchParams.set("careerDetail",detail);else url.searchParams.delete("careerDetail");location.search=url.search;location.href=url.href;},onView:(view:string)=>{props.view=view;props.detail=null;const url=new URL(location.href);url.searchParams.set("career",view);url.searchParams.delete("careerDetail");location.search=url.search;location.href=url.href;}};
  const render=()=>{cursor=0;const tree=exports.CareerHub(props),batch=pending;pending=[];batch.forEach(fn=>fn());return tree;};
  const selected=(tree:any)=>uiNodes(tree).filter(n=>n.props.role==="tabpanel"&&!n.props.hidden);
  return{props,render,selected,scrollKeys,location,pop(next:string){location.search=next;location.href=`https://dev.thebackyard.com.mx/${next}`;props.view=careerNavigation.careerViewFromSearch(next);props.detail=careerNavigation.careerDetailFromSearch(next);listeners.get("popstate")?.();},select(tree:any,view:string){uiFind(tree,n=>n.type==="CareerTabs").props.onView(view);}};
}

test("Career entry starts at Resumen with tabs first, no hero, and Index/Atest inside that panel",()=>{
  const h=shell(),tree=h.render(),children=tree.props.children.flat();
  assert.equal(children[0].type,"CareerTabs");
  assert.equal(h.selected(tree).length,1);
  assert.equal(h.selected(tree)[0].props.id,"career-panel-summary");
  assert.ok(uiNodes(h.selected(tree)[0]).some(n=>n.type==="CareerIndexPanel"));
  assert.ok(uiNodes(h.selected(tree)[0]).some(n=>n.type==="CareerOverview"));
  assert.ok(!uiNodes(tree).some(n=>n.type==="CareerHeader"));
  assert.doesNotMatch(readFileSync("app/components/career-shared.tsx","utf8"),/TU TRAYECTORIA|Tu historia en el golf/);
});
for(const [view,component] of [["achievements","CareerAchievements"],["rivalries","CareerRivalries"],["rounds","CareerRounds"],["tournaments","CareerTournaments"]] as const){
  test(`${view} switches directly without summary content and resets its own start`,()=>{
    const h=shell();let tree=h.render();h.select(tree,view);tree=h.render();
    assert.equal(h.selected(tree).length,1);const panel=h.selected(tree)[0];
    assert.equal(panel.props.id,`career-panel-${view}`);
    assert.ok(uiNodes(panel).some(n=>n.type===component));
    assert.ok(!uiNodes(panel).some(n=>["CareerOverview","CareerIndexPanel","CareerHeader"].includes(n.type)));
    assert.equal(new URLSearchParams(h.location.search).get("career"),view);
    assert.equal(h.scrollKeys.at(-1),`${view}:section`);
    assert.equal(primarySectionForTab("career"),"Carrera");
    h.select(tree,"summary");tree=h.render();assert.equal(h.selected(tree)[0].props.id,"career-panel-summary");
    assert.equal(h.scrollKeys.at(-1),"summary:section");
  });
}
test("only visited views mount, retain stable panel identities, and do not remount the hub",()=>{
  const h=shell("?screen=career&career=rounds");let tree=h.render();
  assert.equal(uiNodes(tree).filter(n=>n.props.role==="tabpanel").length,1);
  assert.ok(!uiNodes(tree).some(n=>n.type==="CareerIndexPanel"||n.type==="CareerTournaments"));
  const rounds=uiFind(tree,n=>n.props.id==="career-panel-rounds");
  h.select(tree,"tournaments");tree=h.render();
  assert.equal(uiNodes(tree).filter(n=>n.props.role==="tabpanel").length,2);
  assert.equal(uiFind(tree,n=>n.props.id==="career-panel-rounds").type,rounds.type);
  assert.equal(uiFind(tree,n=>n.props.id==="career-panel-rounds").props.hidden,true);
  h.select(tree,"rounds");tree=h.render();
  assert.equal(uiFind(tree,n=>n.props.id==="career-panel-tournaments").props.hidden,true);
  const before=h.scrollKeys.length;h.render();assert.equal(h.scrollKeys.length,before);
});
test("existing Index/Atest deep links remain details of Resumen, with tabs always available",()=>{
  for(const detail of ["index","attest"] as const){
    const h=shell(`?screen=career&career=summary&careerDetail=${detail}`);let tree=h.render();
    assert.equal(uiFind(tree,n=>n.type==="CareerIndexPanel").props.detail,detail);
    assert.ok(uiNodes(tree).some(n=>n.type==="CareerTabs"));
    assert.equal(uiFind(tree,n=>n.type==="CareerOverview").props.displayName,"QA Owner");
    const summary=uiFind(tree,n=>n.type==="CareerOverview"),container=uiNodes(tree).find(n=>n.props.children===summary);
    assert.equal(container?.props.hidden,true);
    h.select(tree,"achievements");tree=h.render();assert.equal(new URLSearchParams(h.location.search).has("careerDetail"),false);
    assert.equal(h.selected(tree)[0].props.id,"career-panel-achievements");
    h.pop(`?screen=career&career=summary&careerDetail=${detail}`);tree=h.render();
    assert.equal(uiFind(tree,n=>n.type==="CareerIndexPanel").props.detail,detail);
    assert.equal(h.scrollKeys.at(-1),`summary:${detail}`);
  }
  assert.equal(careerDetailFromSearch("?career=rounds&careerDetail=index"),null);
});
test("panels are account-scoped and inactive content stays outside the accessible view",()=>{
  const h=shell();let tree=h.render();h.select(tree,"rounds");tree=h.render();
  h.props.userId="qa-other";tree=h.render();assert.equal(uiNodes(tree).filter(n=>n.props.role==="tabpanel").length,1);
  const panel=h.selected(tree)[0];assert.equal(panel.props["aria-labelledby"],"career-tab-rounds");assert.equal(panel.props.tabIndex,0);
});
test("clearing Summary detail restores the overview without remounting visited panels",()=>{
  const h=shell("?screen=career&career=summary&careerDetail=attest");let tree=h.render();
  const before=uiFind(tree,n=>n.props.id==="career-panel-summary");
  h.props.onDetail(null);tree=h.render();
  assert.equal(uiFind(tree,n=>n.type==="CareerIndexPanel").props.detail,null);
  const overview=uiFind(tree,n=>n.type==="CareerOverview");
  assert.equal(uiNodes(tree).find(n=>n.props.children===overview)?.props.hidden,false);
  assert.equal(uiFind(tree,n=>n.props.id==="career-panel-summary").type,before.type);
  assert.equal(h.scrollKeys.at(-1),"summary:section");
});
test("tab navigation has linked ARIA states, five fixed columns, and no document anchors",()=>{
  const shared=readFileSync("app/components/career-shared.tsx","utf8"),hub=readFileSync("app/components/career-hub.tsx","utf8"),css=readFileSync("app/components/career-hub.module.css","utf8");
  assert.match(shared,/role="tablist"/);assert.match(shared,/role="tab"/);assert.match(shared,/aria-selected/);assert.match(shared,/ArrowRight/);assert.match(shared,/ArrowLeft/);assert.match(shared,/preventScroll:true/);
  assert.match(css,/\.tabs\{position:sticky/);assert.match(css,/--career-header-height/);assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);assert.doesNotMatch(css.match(/\.tabs\{[^}]+\}/)?.[0]??"",/overflow-x:auto/);assert.match(css,/white-space:nowrap/);assert.match(css,/min-height:44px/);assert.match(css,/\.content\[hidden\]\{display:none\}/);
  assert.doesNotMatch(shared+hub,/scrollIntoView|href=["']#|getElementById/);
  assert.deepEqual(CAREER_TABS.map(t=>t.label),["Resumen","Logros","Rivalidades","Rondas","Torneos"]);
});
test("fixed tab strip never scrolls horizontally and keyboard focus never scrolls the document",()=>{
  const selections:string[]=[],focusOptions:any[]=[],horizontal:any[]=[];
  const selected={getBoundingClientRect:()=>({left:440,right:530,width:90})};
  const buttons=CAREER_TABS.map(()=>({focus:(options:any)=>focusOptions.push(options)}));
  const container={scrollLeft:0,clientWidth:320,querySelector:()=>selected,querySelectorAll:()=>buttons,getBoundingClientRect:()=>({left:16,right:336}),scrollTo:(options:any)=>horizontal.push(options)};
  const exports:any={},js=ts.transpileModule(readFileSync("app/components/career-shared.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(js,{exports,require(id:string){
    if(id==="react")return{useRef:()=>({current:container}),useEffect:(effect:any)=>effect()};
    if(id==="react/jsx-runtime")return{jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props})};
    if(id.endsWith("/career-navigation"))return careerNavigation;
    return{default:{tabs:"tabs"}};
  }});
  const tree=exports.CareerTabs({view:"tournaments",onView:(view:string)=>selections.push(view)});
  const tabs=uiNodes(tree).filter(n=>n.props.role==="tab");
  assert.equal(tabs.length,5);assert.equal(tabs.filter(n=>n.props["aria-selected"]).length,1);
  assert.equal(tabs[4].props.tabIndex,0);assert.equal(tabs[4].props["aria-controls"],"career-panel-tournaments");
  assert.equal(horizontal.length,0);assert.doesNotMatch(readFileSync("app/components/career-shared.tsx","utf8"),/scrollTo|scrollLeft|getBoundingClientRect/);
  let prevented=0;tabs[4].props.onKeyDown({key:"ArrowRight",preventDefault:()=>prevented++});
  tabs[0].props.onKeyDown({key:"End",preventDefault:()=>prevented++});
  tabs[4].props.onKeyDown({key:"Home",preventDefault:()=>prevented++});
  assert.deepEqual(selections,["summary","tournaments","summary"]);assert.equal(prevented,3);
  assert.ok(focusOptions.every(options=>options.preventScroll===true));
});

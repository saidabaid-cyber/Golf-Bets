import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as navigation from "../lib/golf-object-navigation";
import { golfCoachContextFromSearch, golfCoachMetric } from "../lib/golf-coach-context";
import { careerRound } from "./helpers/career-round";
const player="11111111-1111-4111-8111-111111111111", round="22222222-2222-4222-8222-222222222222";
function mount(search:string) {
  const slots:any[]=[],effects:any[]=[],pending:Array<()=>void>=[];let cursor=0,serial=0,position=0;
  const listeners=new Map<string,()=>void>(),location={search},entries=[{url:`/${search}`,state:{backyardTab:"welcome"} as any}];
  const history={state:entries[0].state,pushState(state:any,_title:string,url:string){entries.splice(position+1);entries.push({state,url});position++;update();},replaceState(state:any,_title:string,url:string){entries[position]={state,url};update();},back(){if(position){position--;update();listeners.get("popstate")?.();}},forward(){if(position+1<entries.length){position++;update();listeners.get("popstate")?.();}}};
  function update(){location.search=new URL(entries[position].url,"https://qa.example.invalid").search;history.state=entries[position].state;}
  const window={history,scrollY:0,scrollTo({top}:{top:number}){window.scrollY=top;},addEventListener:(key:string,fn:()=>void)=>listeners.set(key,fn),removeEventListener:(key:string)=>listeners.delete(key)};
  function effect(fn:any,deps:any[]){const i=cursor++;if(effects[i]&&deps.every((v,j)=>Object.is(v,effects[i].deps[j])))return;effects[i]?.cleanup?.();effects[i]={deps};pending.push(()=>{effects[i].cleanup=fn();});}
  const react={useState(value:any){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],(next:any)=>{slots[i]=next;}];},useRef(value:any){const i=cursor++;return slots[i]||=( {current:value});},useCallback(fn:any,deps:any[]){const i=cursor++;if(!slots[i]||!deps.every((v,j)=>Object.is(v,slots[i].deps[j])))slots[i]={deps,fn};return slots[i].fn;},useEffect:effect,useLayoutEffect:effect,createContext:()=>({}),useContext:()=>null};
  const source=ts.transpileModule(readFileSync("app/components/golf-object-navigation.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:any={};new Function("require","exports","window","location","document","crypto","requestAnimationFrame","cancelAnimationFrame",source)((id:string)=>id==="react"?react:navigation,exports,window,location,{querySelector:()=>null},{randomUUID:()=>`frame-${++serial}`},(fn:()=>void)=>{fn();return 1;},()=>{});
  function render(){cursor=0;const result=exports.useGolfObjectNavigation("viewer");pending.splice(0).forEach(fn=>fn());return result as {frames:navigation.GolfObjectFrame[];active:navigation.GolfObject|null;open:(object:navigation.GolfObject)=>void;back:()=>void;clear:()=>void};}
  render();render();return{render,window,location,history};
}
test("Feed → player → round → hole → Back restores each selection and exact scroll context",()=>{
  const h=mount("?home=feed&filter=keep");h.window.scrollY=620;h.render().open({kind:"player",id:player});h.render();h.window.scrollY=340;
  h.render().open({kind:"round",id:round,source:"activity"});h.render();h.window.scrollY=215;
  h.render().open({kind:"hole",id:round,source:"activity",hole:7});h.render();assert.equal(h.window.scrollY,0);
  h.window.scrollY=91;h.render().open({kind:"rules",id:"mine"});h.render();h.render().back();assert.equal(h.render().active?.kind,"hole");assert.equal(h.window.scrollY,91);
  h.render().back();assert.equal(h.render().active?.kind,"round");assert.equal(h.window.scrollY,215);
  h.render().back();assert.equal(h.render().active?.kind,"player");assert.equal(h.window.scrollY,340);
  h.render().back();assert.equal(h.render().active,null);assert.equal(h.window.scrollY,620);assert.equal(h.location.search,"?home=feed&filter=keep");assert.equal(h.history.state.backyardTab,"welcome");
});
test("Friends and latest-20 origins survive dedicated round navigation",()=>{for(const origin of ["?home=friends&query=car","?screen=career&career=summary&careerDetail=attest"]){const h=mount(origin);h.window.scrollY=188;h.render().open({kind:"round",id:"saved-qa",source:"history"});h.render().back();assert.equal(h.render().active,null);assert.equal(h.location.search,origin);assert.equal(h.window.scrollY,188);}});
test("round options keep the round frame and parent context without replacing module history",()=>{
  const h=mount("?screen=career&career=rounds");h.render().open({kind:"round",source:"history",id:"qa-saved"});h.render();h.window.scrollY=281;
  h.render().open({kind:"round-options",source:"history",id:"qa-saved"});h.render();h.render().back();assert.equal(h.render().active?.kind,"round");assert.equal(h.window.scrollY,281);
  assert.equal(navigation.golfObjectFromSearch("?object=round-options&objectId=qa-saved&objectSource=activity"),null);
});
test("direct object links use an in-app return and malformed selections grant no destination",()=>{
  const h=mount(`?home=feed&object=player&objectId=${player}`);assert.equal(h.render().active?.kind,"player");h.render().back();assert.equal(h.render().active,null);assert.equal(h.location.search,"?home=feed");
  for(const s of ["?object=player&objectId=not-a-uuid",`?object=hole&objectId=${round}&objectSource=activity&hole=19`,`?object=round&objectId=${round}&objectSource=unknown`,`?object=round&objectId=../private&objectSource=history`])assert.equal(navigation.golfObjectFromSearch(s),null);
});
test("object links round-trip only their actual selection and retain parent module",()=>{const objects:navigation.GolfObject[]=[{kind:"player",id:player},{kind:"round",id:round,source:"activity"},{kind:"hole",id:"local:qa",source:"history",hole:18},{kind:"equipment",id:round,item:"real-club"},{kind:"achievement",id:round,item:"Birdie Club"},{kind:"statistics",id:"mine"},{kind:"coach",id:"mine",context:{category:"putting",metric:"putts",period:20,holes:18}}];for(const object of objects){const href=navigation.golfObjectHref(object,"?screen=career&career=rounds");assert.deepEqual(navigation.golfObjectFromSearch(href.slice(1)),object);assert.equal(new URLSearchParams(href.slice(1)).get("career"),"rounds");}});
test("Coach accepts category/metric/period context and recomputes values from captured data",()=>{
  assert.equal(golfCoachContextFromSearch("?category=tee&metric=putts&period=20"),null);assert.equal(golfCoachContextFromSearch("?category=putting&metric=putts&period=fake"),null);
  const context=golfCoachContextFromSearch("?category=putting&metric=putts&period=20&holes=18&value=7.9")!;
  assert.equal(golfCoachMetric([careerRound("qa",1)],context).value,null);
  const r=careerRound("qa",1);r.putts=Object.fromEntries(r.order!.map(h=>[h,{"owner-player":2}]));assert.equal(golfCoachMetric([r],context).value,36);
});
test("captured GIR never infers a green from score and putts and respects the eligible period",()=>{
  const r=careerRound("qa-recorded",1);r.putts=Object.fromEntries(r.order!.map(h=>[h,{"owner-player":2}]));
  const context={category:"approach",metric:"gir",period:20} as const;
  assert.equal(golfCoachMetric([r],context).value,null);
  r.advancedStats={1:{"owner-player":{greenInRegulation:true}},2:{"owner-player":{greenInRegulation:false}}};
  assert.equal(golfCoachMetric([r],context).value,50);assert.equal(golfCoachMetric([r],context).sample,2);
});

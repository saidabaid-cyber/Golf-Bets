import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as ghinProfile from "../lib/ghin/profile";
import { readCareerAttestSummary } from "../lib/career-attest-client";
import { careerAttestSummary } from "../lib/career-index-presentation";
import * as presentation from "../lib/career-index-presentation";
import { buildGolfInsights } from "../lib/golf-insights";
import { calculateBackyardIndex } from "../lib/backyard-index";
import { socialUI, uiText, uiFind, uiNodes, settleUI } from "./helpers/social-ui";

const score = {id:"provider-score",playedOn:"2026-09-23",courseId:null,courseName:"Campo sintético de prueba",teeId:null,teeName:"Blancas",grossScore:null,adjustedGrossScore:84,differential:15.7,courseRating:67.5,slopeRating:119,holes:18,scoreType:"H",postingMethod:"M"};
const profile = {associationStatus:"VERIFIED",lastSyncedAt:"2026-10-05T12:00:00Z",handicapIndex:7.9};
const control = () => ({enabled:true,ready:true,profile,scores:null as any,scoresLoading:false,reauthorizationRequired:false,error:"",loadScores:async()=>{}});
function ghPanel(c=control()) {
  const h=socialUI("app/components/career-ghin-scores.tsx",{"career-statistics":{careerDate:(value:any)=>value??"—",careerNumber:(value:any)=>value??"—"}});
  const opened:string[]=[];
  return {h,c,opened,render:(expanded=true)=>h.render("CareerGhinScores",{control:c,userId:"owner",expanded,onOpen:()=>opened.push("attest"),onReauthorize:()=>opened.push("profile")})};
}

test("Career reads its private attest endpoint directly instead of the Social route allowlist",async()=>{
  const empty=careerAttestSummary([],[],"owner"),calls:any[]=[];
  const fetcher=(async(path:any,options:any)=>{calls.push({path,options});return{ok:true,json:async()=>empty};}) as typeof fetch;
  const result=await readCareerAttestSummary("synthetic-own-account",undefined,fetcher);
  assert.deepEqual(result,empty);assert.equal(calls.length,1);assert.equal(calls[0].path,"/api/career/attest");
  assert.equal(calls[0].options.method,"GET");assert.equal(calls[0].options.cache,"no-store");assert.equal(calls[0].options.body,undefined);
});
test("an attest read failure or invalid metric is never converted into a fake zero",async()=>{
  await assert.rejects(readCareerAttestSummary("owner",undefined,(async()=>({ok:false})) as any),/UNAVAILABLE/);
  const invalid={...careerAttestSummary([],[],"owner"),percent:85};
  await assert.rejects(readCareerAttestSummary("owner",undefined,(async()=>({ok:true,json:async()=>invalid})) as any),/INVALID_RESPONSE/);
});
test("GHIN scoring record is requested once only on the cards detail and cached across tab visits",()=>{
  const p=ghPanel();let requests=0;p.c.loadScores=async()=>{requests++;};
  p.render(false);assert.equal(requests,0);p.render(true);p.render(true);p.render(false);p.render(true);assert.equal(requests,1);
  p.c.profile={...profile,lastSyncedAt:"2026-10-05T13:00:00Z"};p.render(true);assert.equal(requests,2);
});
test("GHIN cards show provider-only labels and normalized safe fields, capped at 20",()=>{
  const p=ghPanel();p.c.scores={items:Array.from({length:21},(_,i)=>({...score,id:`ghin-${i}`})),count:503,truncated:true,fetchedAt:"2026-10-05"};
  const tree=p.render();assert.equal(uiNodes(tree).filter(n=>n.type==="article").length,20);
  assert.match(uiText(tree),/Últimas tarjetas GHIN GHIN · SOLO LECTURA/);assert.match(uiText(tree),/20 tarjetas GHIN disponibles[\s\S]*503/);
  assert.match(uiText(tree),/Blancas[\s\S]*84[\s\S]*15.7[\s\S]*67.5[\s\S]*119[\s\S]*18[\s\S]*Tipo H[\s\S]*Método M/);
  assert.doesNotMatch(uiText(tree),/Atestada|Pendiente|85%/);assert.equal(uiNodes(tree).filter(n=>n.type==="button").length,0);
});
test("reauthorization keeps persisted index, stops scoring retries and opens the existing profile flow",()=>{
  const p=ghPanel();p.c.reauthorizationRequired=true;let requested=0;p.c.loadScores=async()=>{requested++;};
  const tree=p.render();assert.equal(requested,0);assert.equal(p.c.profile.handicapIndex,7.9);
  assert.match(uiText(tree),/Renueva autorización GHIN para consultar tus tarjetas/);
  uiFind(tree,n=>n.type==="button"&&uiText(n)==="RENOVAR AUTORIZACIÓN GHIN").props.onClick();assert.deepEqual(p.opened,["profile"]);
});
test("GHIN has honest empty and failure states and never fabricates rows",()=>{
  const p=ghPanel();p.c.scores={items:[],count:0,truncated:false,fetchedAt:"2026-10-05"};
  assert.match(uiText(p.render()),/No hay tarjetas disponibles/);p.c.scores=null;p.c.error="Failed";
  assert.match(uiText(p.render()),/último índice válido se conserva/);assert.equal(uiNodes(p.render()).filter(n=>n.type==="article").length,0);
});
test("unlinked and not-ready provider state cannot show another account's scoring record",()=>{
  const p=ghPanel();p.c.scores={items:[score]};p.c.ready=false;assert.equal(p.render(),null);
  p.c.ready=true;p.c.enabled=false;assert.equal(p.render(),null);
});
test("0 eligible Backyard cards plus GHIN scores keeps zero percent and the fixed 20 slots",async()=>{
  const empty=careerAttestSummary([],[],"owner"),before=structuredClone(empty),ghin=control();
  ghin.scores={items:Array.from({length:20},(_,i)=>({...score,id:String(i)})),count:503,truncated:true,fetchedAt:"2026-10-05"};
  const props={userId:"owner",accessToken:"own",index:{source:"GHIN",value:7.9},rounds:[],history:[],insights:buildGolfInsights([]),ghin};
  const h=socialUI("app/components/career-index-panel.tsx",{"career-attest-client":{readCareerAttestSummary:async()=>empty},"career-index-presentation":presentation,"career-statistics":{careerDate:(s:string)=>s,careerNumber:(n:any)=>n??"—"},"backyard-index":{calculateBackyardIndex}});
  const render=()=>h.render("CareerIndexPanel",{props,detail:"attest",onDetail(){}});
  render();await settleUI();const tree=render();assert.match(uiText(tree),/Atest de tarjetas Backyard 0%/);assert.match(uiText(tree),/Sin tarjetas Backyard elegibles · 0\/20/);
  assert.equal(uiNodes(tree).filter(n=>n.type==="i").length,20);assert.deepEqual(empty,before);
  assert.equal(uiNodes(tree).filter(n=>n.props.className==="row").length,0);
});
test("GHIN summaries remain read-only and Backyard Index reads only Backyard history",()=>{
  const code=readFileSync("app/components/career-ghin-scores.tsx","utf8")+readFileSync("app/components/career-index-panel.tsx","utf8");
  assert.doesNotMatch(code,/rounds_cloud|RoundSnapshot|localStorage|score-posting|submitScore|postScore|careerAttestSummary\(/);
  assert.match(code,/backyardIndexTimeline\(props.history\?\?props.rounds,props.userId,props.index.resetAt\)/);
  assert.doesNotMatch(code,/Backyard Index conservado/);
  const hook=readFileSync("app/components/use-ghin-read-only-profile.ts","utf8");
  assert.match(hook,/post\(\{ operation: "scores" \}\)/);assert.doesNotMatch(hook,/\/api\/profile\/ghin\/scores|postScore|submitScore|score-posting/);
  const endpoint=readFileSync("app/api/profile/ghin/route.ts","utf8");
  const read=endpoint.slice(endpoint.indexOf('if (operation === "scores") {'),endpoint.indexOf('const attemptedAt = new Date().toISOString();',endpoint.indexOf('if (operation === "scores") {')));
  assert.match(read,/getScores/);assert.match(read,/scorePostingCalls: 0/);assert.doesNotMatch(read,/persistVerifiedGolfer|\.insert\(|\.update\(|postScore/);
});

test("the real GHIN controller sends only operation=scores and never reuses another account's cache",async()=>{
  const slots:any[]=[],effects:any[]=[],calls:any[]=[];let cursor=0,pending:Array<()=>void>=[],account="synthetic-account-one";
  const memo=(fn:any,deps:any[])=>{const i=cursor++;if(!slots[i]||!deps.every((d,j)=>Object.is(d,slots[i].deps[j])))slots[i]={deps,value:fn()};return slots[i].value;};
  const react={useState(value:any){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],(next:any)=>{slots[i]=typeof next==="function"?next(slots[i]):next;}];},useRef(value:any){return slots[cursor++]||=({current:value});},useCallback(fn:any,deps:any[]){return memo(()=>fn,deps);},useEffect(fn:any,deps:any[]){const i=cursor++;if(effects[i]&&deps.every((d,j)=>Object.is(d,effects[i].deps[j])))return;effects[i]?.cleanup?.();effects[i]={deps};pending.push(()=>{effects[i].cleanup=fn();});}};
  const persisted={...profile,ghinNumber:"11103349",playerName:"Synthetic player",clubName:null,homeClubName:null,status:"Active",revisionDate:null,lastAttemptedAt:profile.lastSyncedAt,syncStatus:"SUCCESS",lastErrorCode:null};
  const exports:any={},code=ts.transpileModule(readFileSync("app/components/use-ghin-read-only-profile.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports,AbortSignal,require:(id:string)=>id==="react"?react:ghinProfile,fetch:async(path:string,options:any)=>{
    calls.push({path,method:options.method??"GET",body:options.body?JSON.parse(options.body):null});
    return {ok:true,json:async()=>options.method==="POST"?{available:true,count:1,fetchedAt:"2026-10-05",httpStatus:200,items:[score],truncated:false}:{available:true,linkState:"GHIN_LINKED",profile:persisted}};
  }});
  const render=()=>{cursor=0;const result=exports.useGhinReadOnlyProfile(account),batch=pending;pending=[];batch.forEach(fn=>fn());return result;};
  render();await settleUI();await render().loadScores();assert.equal(render().scores.items.length,1);
  assert.deepEqual(calls.filter(c=>c.method==="POST").map(c=>c.body),[{operation:"scores"}]);
  assert.ok(calls.every(c=>c.path==="/api/profile/ghin"));
  account="synthetic-account-two";assert.equal(render().scores,null);await settleUI();assert.equal(render().scores,null);
});

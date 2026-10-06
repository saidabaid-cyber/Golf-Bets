import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { settleUI } from "./helpers/social-ui";
function harness(fetcher:(path:string,init:RequestInit)=>Promise<Response>){
  const slots:any[]=[],effects:any[]=[],logs:string[]=[];let cursor=0,pending:(()=>void)[]=[];
  const memo=(fn:any,deps:any[])=>{const i=cursor++;if(!slots[i]||!deps.every((d,j)=>Object.is(d,slots[i].deps[j])))slots[i]={deps,value:fn()};return slots[i].value;};
  const react={useState(initial:any){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],(next:any)=>{slots[i]=typeof next==="function"?next(slots[i]):next;}];},useRef(initial:any){return slots[cursor++]||=({current:initial});},useCallback: memo,
    useEffect(fn:any,deps:any[]){const i=cursor++;if(effects[i]&&deps.every((d,j)=>Object.is(d,effects[i].deps[j])))return;effects[i]?.cleanup?.();effects[i]={deps};pending.push(()=>effects[i].cleanup=fn());}};
  // useCallback memoizes the function itself, not its invocation.
  react.useCallback=(fn:any,deps:any[])=>memo(()=>fn,deps);
  const exports:any={};runInNewContext(ts.transpileModule(readFileSync("app/components/use-ghin-imported-scores.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,AbortController,AbortSignal,TextEncoder,Map,fetch:fetcher,console:{info:(...args:string[])=>logs.push(args.join(" "))},require:()=>react});
  return {logs,render(token="account-one",enabled=true){cursor=0;const result=exports.useGhinImportedScores(token,enabled),batch=pending;pending=[];batch.forEach(fn=>fn());return result;}};
}
const page=(ids=["one"],cursor:string|null=null)=>({items:ids.map(id=>({id})),links:[],total:2,nextCursor:cursor,summary:null,grossTotals:{9:{rounds:0,sum:0,best:null},18:{rounds:0,sum:0,best:null}},filters:{years:[],courses:[]}});
test("clean login reads private server persistence once; navigation is not provider polling",async()=>{
  const calls:string[]=[],h=harness(async(path)=>{calls.push(path);return Response.json(page());});
  h.render();await settleUI();const c=h.render();assert.equal(c.data.items[0].id,"one");h.render();h.render();assert.deepEqual(calls,["/api/profile/ghin/import"]);
  assert.ok(h.logs.every(l=>!l.includes("account-one")&&!l.includes("authorization")&&!l.includes('"items"')));
});
test("sync is explicit and simultaneous taps coalesce to one request",async()=>{
  const calls:RequestInit[]=[],h=harness(async(_,init)=>{calls.push(init);return Response.json(page());});
  h.render();await settleUI();const c=h.render();await Promise.all([c.sync(),c.sync()]);
  const posts=calls.filter(c=>c.method==="POST");assert.equal(posts.length,1);assert.equal(posts[0].body,JSON.stringify({operation:"sync"}));
});
test("pagination uses cursor and de-duplicates cards without full record downloads",async()=>{
  const paths:string[]=[],h=harness(async(path)=>{paths.push(path);return Response.json(path.includes("cursor")?page(["one","two"]):page(["one"],"20"));});
  h.render();await settleUI();await h.render().next();assert.deepEqual(JSON.parse(JSON.stringify(h.render().data.items.map((r:any)=>r.id))),["one","two"]);
  assert.equal(paths[1],"/api/profile/ghin/import?cursor=20");
});
test("late response from another account cannot leak cards into current account",async()=>{
  let first:((value:Response)=>void)|undefined;let calls=0;
  const h=harness(async()=>++calls===1?new Promise<Response>(resolve=>first=resolve):Response.json(page(["second"])));
  h.render("first");h.render("second");await settleUI();first!(Response.json(page(["first-private"])));await settleUI();
  assert.equal(h.render("second").data.items[0].id,"second");
});
test("reauth-required preserves imported data and does not retry automatically",async()=>{
  let calls=0;const h=harness(async()=>++calls===1?Response.json(page()):Response.json({code:"REAUTH_REQUIRED"},{status:409}));
  h.render();await settleUI();await h.render().sync();const c=h.render();assert.equal(c.reauthorizationRequired,true);assert.equal(c.data.items[0].id,"one");h.render();h.render();assert.equal(calls,2);
});
test("disabled or unauthenticated state never fetches persisted cards",async()=>{
  let calls=0;const h=harness(async()=>{calls++;return Response.json(page());});h.render("account",false);await settleUI();assert.equal(calls,0);
});

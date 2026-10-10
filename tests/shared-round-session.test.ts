import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

test("real shared view saves only explicit own score; GPS stays mounted under score and card", async () => {
  const states: any[] = [], effects: any[] = [], refs: any[] = [], callbacks: any[] = []; let cursor=0;
  const values=new Map<string,string>(), writes:any[]=[]; const reader=Symbol("GPS"), exports:any={}; let exits=0, failNext=false;
  const round={order:[1,2,3],players:[{id:"a",accountUserId:"A",name:"QA A",handicap:null},{id:"b",accountUserId:"B",name:"QA B",handicap:null}],scores:{},scorekeeping:{mode:"self"},lifecycleState:"live",courseName:"QA course",teeName:"White",courseSnapshot:{id:"stored",holes:[{number:1,par:4},{number:2,par:4},{number:3,par:3}]}};
  let card:any={id:"canonical",version:1,ownerId:"A",snapshot:round,editablePlayerKeys:["a"],joined:true};
  const storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)};
  runInNewContext(ts.transpileModule(readFileSync("app/components/shared-round-session.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,AbortController,TextEncoder,crypto:{randomUUID},localStorage:storage,sessionStorage:storage,
    window:{addEventListener(){},removeEventListener(){}},document:{hidden:false},setInterval:()=>1,clearInterval(){},
    fetch:async (_url:string,options:any)=>{if(options?.method==="PATCH"){const body=JSON.parse(options.body);writes.push(body);if(failNext){failNext=false;return{ok:false,json:async()=>({error:"Offline fixture",code:"WRITE_FAILED"})};}const scores={...card.snapshot.scores}; for(const p of body.patches)scores[p.hole]={...scores[p.hole],[p.playerKey]:p.score}; card={...card,version:card.version+1,snapshot:{...card.snapshot,scores}};}return{ok:true,json:async()=>({data:card})};},
    require(name:string){
      if(name==="react/jsx-runtime")return{jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props})};
      if(name==="react")return{
        useState(initial:any){const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],(next:any)=>{states[i]=typeof next==="function"?next(states[i]):next;}];},
        useRef(initial:any){const i=cursor++;return refs[i]||(refs[i]={current:initial});},
        useCallback(fn:any,deps:any[]){const i=cursor++;const old=callbacks[i];if(old&&deps.every((d,n)=>d===old.deps[n]))return old.fn;callbacks[i]={fn,deps};return fn;},
        useEffect(fn:any,deps?:any[]){const i=cursor++;const old=effects[i];if(old&&deps?.every((d,n)=>d===old.deps[n]))return;old?.cleanup?.();effects[i]={deps,cleanup:fn()};}
      };
      if(name==="./account-provider")return{useBackyardAccount:()=>({identity:{mode:"authenticated",userId:"A",accessToken:"synthetic"},openAccess(){}})};
      if(name==="./golf-gps/golf-gps-reader")return{GolfGpsReader:reader};
      if(name==="./round-participation-card")return{RoundParticipationCard:"confirmed-card"};
      if(name==="./shared-bet-capture")return{SharedGroupBetCapture:"group-bets",SharedPlayerBetCapture:"player-bets",sharedBetPending:()=>null,sharedPuttsRequired:()=>false};
      if(name.endsWith(".css"))return{default:new Proxy({}, {get:(_target,key)=>String(key)})};throw Error(name);
    }
  });
  const render=()=>{cursor=0;return exports.SharedRoundSession({roundId:"canonical",onExit(){exits++;}});};
  const walk=(node:any):any[]=>Array.isArray(node)?node.flatMap(walk):node&&typeof node==="object"?[node,...walk(node.props?.children)]:[];
  const text=(node:any):string=>Array.isArray(node)?node.map(text).join(""):node&&typeof node==="object"?text(node.props?.children):node==null?"":String(node);
  const find=(tree:any,predicate:(n:any)=>boolean)=>{const result=walk(tree).find(predicate);assert.ok(result);return result;};
  const click=(tree:any,label:string)=>find(tree,n=>n.type==="button"&&text(n)===label).props.onClick();
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  render();await settle();let tree=render();
  const input=find(tree,n=>n.type==="input"&&n.props["aria-label"]==="Score QA A hoyo 1");assert.equal(input.props.value,"");
  assert.equal(walk(tree).some(n=>n.props?.["aria-label"]==="Score QA B hoyo 1"),false);
  input.props.onChange({target:{value:"4"}});tree=render();assert.equal(writes.length,0);
  click(tree,"Guardar mi captura");await settle();tree=render();assert.equal(writes.length,1);
  assert.equal(writes[0].roundId,"canonical");assert.equal(writes[0].patches.length,1);assert.equal(writes[0].patches[0].playerKey,"a");
  assert.equal(card.snapshot.scores[1].a,4);assert.equal(card.snapshot.scores[1].b,undefined);
  click(tree,"GPS");tree=render();let gps=find(tree,n=>n.type===reader);assert.equal(gps.props.active,true);
  gps.props.roundContext.onScore(2);tree=render();gps=find(tree,n=>n.type===reader);assert.equal(gps.props.initialPosition,2);assert.equal(writes.length,1);
  assert.ok(find(tree,n=>n.props?.role==="dialog"&&n.props["aria-label"]==="Anotar score"));
  click(tree,"Volver al mapa");tree=render();gps=find(tree,n=>n.type===reader);assert.equal(gps.props.initialPosition,2);
  gps.props.roundContext.onCard();tree=render();assert.ok(find(tree,n=>n.props?.role==="dialog"&&n.props["aria-label"]==="Tarjeta compartida"));
  assert.equal(find(tree,n=>n.type===reader).props.active,true);assert.match(text(tree),/QA AQA B14—/);
  click(tree,"Volver al GPS");tree=render();assert.equal(find(tree,n=>n.type===reader).props.initialPosition,2);assert.equal(writes.length,1);
  assert.ok([...values.values()].some(v=>v.includes('"outbox":[]')));
  find(tree,n=>n.type===reader).props.roundContext.onScore(2);tree=render();
  find(tree,n=>n.type==="input"&&n.props["aria-label"]==="Score QA A hoyo 2").props.onChange({target:{value:"5"}});
  tree=render();click(tree,"Guardar y salir a Play");assert.equal(exits,0);await settle();render();
  assert.equal(exits,1);assert.equal(writes.length,2);assert.equal(card.snapshot.scores[1].a,4);assert.equal(card.snapshot.scores[2].a,5);
  tree=render();find(tree,n=>n.type===reader).props.roundContext.onScore(3);tree=render();
  find(tree,n=>n.type==="input"&&n.props["aria-label"]==="Score QA A hoyo 3").props.onChange({target:{value:"6"}});
  failNext=true;tree=render();click(tree,"Guardar y salir a Play");await settle();tree=render();
  assert.equal(exits,1);assert.equal(card.snapshot.scores[3],undefined);assert.match(text(tree),/Pendiente de sincronizar; conservado/);
  assert.ok(find(tree,n=>n.props?.role==="dialog"&&n.props["aria-label"]==="Anotar score"));
  assert.ok([...values.values()].some(v=>v.includes('"score":6')&&!v.includes('"outbox":[]')));
});

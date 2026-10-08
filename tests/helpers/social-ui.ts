import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { careerIndexChart } from "../../lib/career-index-chart";
export type UINode={type:any;props:Record<string,any>};
function presentationNode(node:any){if(node?.type==="ScorecardNavigationBoundary")return node.props.children(()=>{});return typeof node?.type==="function"&&["ScoreSummary","HandicapChart","SocialFeedSkeleton","RoundContent"].includes(node.type.name)?node.type(node.props):node;}
export function uiNodes(node:any):UINode[]{node=presentationNode(node);return Array.isArray(node)?node.flatMap(uiNodes):node?.props?[node,...uiNodes(node.props.children)]:[];}
export function uiText(node:any):string{node=presentationNode(node);return Array.isArray(node)?node.map(uiText).join(" ").replace(/\s+/g," ").trim():node?.props?uiText(node.props.children):typeof node==="string"||typeof node==="number"?String(node):"";}
export function uiFind(tree:any,predicate:(n:UINode)=>boolean){const node=uiNodes(tree).find(predicate);assert.ok(node);return node;}
/** Execute application components and their event handlers; replace only React's scheduler and external boundaries. */
export function socialUI(file:string,boundaries:Record<string,any>={},globals:Record<string,unknown>={}) {
  const slots:any[]=[],effects:any[]=[];let cursor=0,pending:Array<()=>void>=[];
  const memo=(fn:any,deps:any[])=>{const i=cursor++;if(!slots[i]||!deps.every((d,j)=>Object.is(d,slots[i].deps[j])))slots[i]={deps,value:fn()};return slots[i].value;};
  const effect=(fn:any,deps:any[])=>{const i=cursor++;if(effects[i]&&deps.every((d,j)=>Object.is(d,effects[i].deps[j])))return;effects[i]?.cleanup?.();effects[i]={deps};pending.push(()=>{effects[i].cleanup=fn();});};
  const react={useState(value:any){const i=cursor++;if(!(i in slots))slots[i]=typeof value==="function"?value():value;return[slots[i],(next:any)=>{slots[i]=typeof next==="function"?next(slots[i]):next;}];},useRef(value:any){return slots[cursor++]||=( {current:value});},useMemo:memo,useCallback(fn:any,deps:any[]){return memo(()=>fn,deps);},useEffect:effect,useLayoutEffect:effect};
  const listeners=new Map<string,Set<(...args:any[])=>void>>();
  const add=(type:string,fn:any)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type)!.add(fn);};
  const remove=(type:string,fn:any)=>listeners.get(type)?.delete(fn);
  const location={search:""};const history={state:{} as Record<string,unknown>,pushState(state:any,_title:string,url:string){history.state=state;location.search=new URL(url,"https://dev.thebackyard.com.mx").search;}};
  const window={location,history,scrollY:0,scrollTo(){},addEventListener:add,removeEventListener:remove,confirm:()=>true,dispatchEvent(event:Event){listeners.get(event.type)?.forEach(fn=>fn(event));}};
  const document={visibilityState:"visible",addEventListener:add,removeEventListener:remove};
  const surface={addEventListener:add,removeEventListener:remove};let intersect:((entries:any[])=>void)|undefined;
  class Observer{constructor(callback:any){intersect=callback;}observe(){}disconnect(){intersect=undefined;}}
  class Element{closest(){return null;}}
  const exports:any={};
  const source=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  runInNewContext(source,{exports,window,document,location,IntersectionObserver:Observer,Element,URL,URLSearchParams,Set,Map,Promise,AbortController,Event,setTimeout,clearTimeout,crypto:{randomUUID:()=>"test-operation"},...globals,require(id:string){
    if(id==="react")return react;
    if(id==="react/jsx-runtime")return{jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:"fragment"};
    if(id.endsWith(".css"))return{__esModule:true,default:new Proxy({},{get:(_t,k)=>String(k)})};
    for(const [key,value]of Object.entries(boundaries))if(id===key||id.endsWith(`/${key}`))return value;
    if(id.endsWith("/career-index-chart"))return{careerIndexChart};
    if(id.endsWith("/use-visual-content"))return{useVisualContent:()=>[]};
    if(id.endsWith("/account-provider"))return{useBackyardAccount:()=>({retryCloudSync:async()=>{}})};
    return new Proxy({},{get:(_t,k)=>String(k)});
  }});
  return{window,location,render(name:string,props:any){cursor=0;const tree=exports[name](props);for(const n of uiNodes(tree))if(n.props.ref)n.props.ref.current=surface;const batch=pending;pending=[];batch.forEach(fn=>fn());return tree;},emit(type:string,event:any={}){listeners.get(type)?.forEach(fn=>fn(event));},intersect(){intersect?.([{isIntersecting:true}]);},unmount(){effects.forEach(e=>e?.cleanup?.());}};
}
export const settleUI=()=>new Promise(resolve=>setImmediate(resolve));

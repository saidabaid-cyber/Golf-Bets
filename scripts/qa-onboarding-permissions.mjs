// Actual Step 2 component and existing Shell/CSS, with synthetic HTTP only.
// Run after compiling tests. Physical Safari/system permission QA stays separate.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const root=process.cwd(), require=createRequire(import.meta.url);
const runtimeRequire=createRequire(process.env.QA_PLAYWRIGHT_PACKAGE || "C:/Users/said_/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json");
const { chromium }=runtimeRequire("playwright");
const optional=require(path.join(root,".test-dist/lib/account-optional-authorizations.js"));
const legal=require(path.join(root,".test-dist/lib/legal-evidence.js"));
const react=path.dirname(require.resolve("react/package.json")),dom=path.dirname(require.resolve("react-dom/package.json"));
const scheduler=path.dirname(createRequire(path.join(dom,"package.json")).resolve("scheduler/package.json"));
const external={react:readFileSync(path.join(react,"cjs/react.production.js"),"utf8"),"react/jsx-runtime":readFileSync(path.join(react,"cjs/react-jsx-runtime.production.js"),"utf8"),"react-dom":readFileSync(path.join(dom,"cjs/react-dom.production.js"),"utf8"),"react-dom/client":readFileSync(path.join(dom,"cjs/react-dom-client.production.js"),"utf8"),scheduler:readFileSync(path.join(scheduler,"cjs/scheduler.production.js"),"utf8"),"next/image":"exports.__esModule=true;exports.default=({priority,unoptimized,...props})=>require('react').createElement('img',props);"};
const source=readFileSync("app/components/beta-onboarding-flow.tsx","utf8");
const parsed=ts.createSourceFile("flow.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const shell=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="Shell").getText(parsed);
// Extract the unchanged production Shell, not a hand-drawn approximation.
const shellFile="app/components/qa-permission-shell.tsx";
const virtual=`import {useEffect,useRef,useState} from 'react';import {BrandLockup} from './brand-lockup';import {ModalShell} from './modal-shell';import {STORAGE_KEYS} from '../../lib/round-utils';import styles from './beta-onboarding-flow.module.css';export ${shell}`;
const sources={...external},css=[];
function load(file){
  if(sources[file]!==undefined)return;
  sources[file]="";
  if(file.endsWith(".css")){
    const prefix=`qa-${css.length}-`;
    css.push(readFileSync(file,"utf8").replace(/(?<![\w/-])\.([a-zA-Z_][\w-]*)/g,"."+prefix+"$1"));
    sources[file]=`exports.__esModule=true;exports.default=new Proxy({},{get:(_,key)=>${JSON.stringify(prefix)}+key});`;return;
  }
  const text=file===shellFile?virtual:readFileSync(file,"utf8");
  let compiled=ts.transpileModule(text,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  compiled=compiled.replace(/require\("([^"\n]+)"\)/g,(_,name)=>{
    let id=name;
    if(name.startsWith(".")){
      const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),name));
      id=[base,base+".tsx",base+".ts",base+".js"].find(candidate=>existsSync(candidate))||base;
    }else if(!(name in external))throw Error(`Unexpected external ${name}`);
    load(id);return `require(${JSON.stringify(id)})`;
  });sources[file]=compiled;
}
load("app/components/onboarding-privacy-choices.tsx");load(shellFile);
const bundle=`const definitions={${Object.entries(sources).map(([name,value])=>`${JSON.stringify(name)}:(module,exports,require)=>{${value}\n}`).join(",")}},cache={};function require(name){if(!cache[name]){const result={exports:{}};cache[name]=result;definitions[name](result,result.exports,require)}return cache[name].exports}
const React=require('react'),{createRoot}=require('react-dom/client'),{Shell}=require('${shellFile}'),{OnboardingPrivacyChoices}=require('app/components/onboarding-privacy-choices.tsx');
function App(){const[advanced,setAdvanced]=React.useState(false);return advanced?React.createElement('p',{role:'status'},'QA: siguiente paso'):React.createElement(Shell,{progress:{step:'permissions',mode:'complete'},eyebrow:'TÚ DECIDES',title:'Permisos y privacidad',description:'Elige qué autorizas. Cada propósito se guarda por separado; puedes revisar o revocar tus decisiones después.',actions:null,onBack:()=>{},onSaveAndExit:()=>{}},React.createElement(OnboardingPrivacyChoices,{userId:'11111111-1111-4111-8111-111111111111',accessToken:'SYNTHETIC-QA',onContinue:()=>setAdvanced(true)}))}createRoot(document.getElementById('root')).render(React.createElement(App));`;
const syntax=ts.createSourceFile("bundle.js",bundle,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics;
if(syntax.length)throw Error(syntax.map(error=>`${ts.flattenDiagnosticMessageText(error.messageText," ")}: ${bundle.slice(error.start-160,error.start+160)}`).join("\n"));
const at="2026-10-03T21:00:00.000Z",fixtures=new Map();
function fixture(name){
  if(fixtures.has(name))return fixtures.get(name);
  const accepted=name!=="none";
  const state={bundleVersion:optional.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,resolved:accepted,eligible:!accepted,receipt:accepted?{action:"authorize_all",idempotencyKey:"550e8400-e29b-41d4-a716-446655440000",decidedAt:at}:null,
    scopes:Object.fromEntries(optional.OPTIONAL_AUTHORIZATION_SCOPES.map(scope=>[scope,{active:accepted,status:accepted?"accepted":"missing",policyVersion:optional.OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],source:accepted?"onboarding_authorize_all":null,decidedAt:accepted?at:null}])),
    legal:Object.fromEntries(["financial_data","marketing"].map(subject=>[subject,{active:accepted,status:accepted?"accepted":"missing",policyVersion:legal.legalEvidenceDefinition(subject,"accepted").version,decidedAt:accepted?at:null}])),profileVisibility:"public",socialPrivacy:accepted?"FRIENDS":"PRIVATE",socialProfilePrivacy:"PUBLIC",
    sharing:Object.fromEntries(["enabledForFriends","rounds","achievements","equipment","courses"].map(k=>[k,accepted])),notifications:Object.fromEntries(["internal","master","push","email","rounds","reminders"].map(k=>[k,accepted]))};
  const f={state,media:{camera:name==="media"?{version:1,value:"enabled",changedAt:at}:null,photos:name==="media"?{version:1,value:"enabled",changedAt:at}:null},social:Object.fromEntries(["enabledForFriends","shareRounds","shareAchievements","shareEquipment","shareCourses","notifyLike","notifyComment","notifyAttest","notifyFriendAchievement","notifyEquipment","notifyFriendRequest"].map(k=>[k,accepted])),writes:[]};
  fixtures.set(name,f);return f;
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost");res.setHeader("cache-control","no-store");
  if(url.pathname.startsWith("/api/")){
    const f=fixture(String(req.headers["x-qa-scenario"]||"none"));let raw="";for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
    let result;
    if(req.method!=="GET")f.writes.push({path:url.pathname,body});
    if(url.pathname==="/api/account/optional-authorizations"){
      assert.notEqual(req.method,"POST");
      if(req.method==="PATCH"){f.state.scopes[body.scope]={active:body.enabled,status:body.enabled?"accepted":"revoked",policyVersion:optional.OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[body.scope],source:"settings",decidedAt:at};if(body.scope==="NOTIFICATION_INTERNAL")f.state.notifications.internal=f.state.notifications.master=body.enabled;}result=f.state;
    }else if(url.pathname==="/api/account/device-permission-preferences"){
      if(req.method==="PATCH")f.media[body.preference]={version:1,value:body.enabled?"enabled":"disabled",changedAt:at};result=f.media;
    }else if(url.pathname==="/api/social/preferences"){
      if(req.method==="PUT"){f.social=body;f.state.sharing={enabledForFriends:body.enabledForFriends,rounds:body.shareRounds,achievements:body.shareAchievements,equipment:body.shareEquipment,courses:body.shareCourses};}result={data:f.social};
    }else if(url.pathname==="/api/account/notification-preferences"){
      Object.assign(f.state.notifications,body);result={initialized:true,preferences:body,delivery:{push:{configured:false,state:"not_configured"},email:{configured:false,state:"not_configured"}}};
    }else if(url.pathname==="/api/backyard-ai/consent"){
      for(const row of body.decisions||[])f.state.scopes[row.scope]={active:row.accepted,status:row.accepted?"accepted":"declined",policyVersion:"2026-09-08-v2",source:"onboarding",decidedAt:at};
      result={resolved:true,policyVersion:"2026-09-08-v2",decisions:(body.decisions||[]).map(row=>({...row,active:row.accepted,status:row.accepted?"accepted":"declined",policyVersion:"2026-09-08-v2",source:"onboarding",decidedAt:at,acceptedAt:row.accepted?at:null,revokedAt:null}))};
    }else if(url.pathname==="/api/legal/evidence"){
      for(const event of body.events||[])f.state.legal[event.subject]={active:event.action==="accepted",status:event.action,policyVersion:event.documentVersion,decidedAt:at};result={ok:true};
    }else {res.statusCode=404;result={error:"Unexpected QA endpoint"};}
    res.setHeader("content-type","application/json");res.end(JSON.stringify(result));return;
  }
  if(url.pathname==="/bundle.js"){res.setHeader("content-type","text/javascript");res.end(bundle);return;}
  if(url.pathname==="/globals.css"){res.setHeader("content-type","text/css");res.end(readFileSync("app/globals.css"));return;}
  if(url.pathname.startsWith("/brand/")||url.pathname.startsWith("/fonts/")){
    const file=path.join(root,"public",url.pathname);if(existsSync(file)){res.setHeader("content-type",file.endsWith("svg")?"image/svg+xml":"image/png");res.end(readFileSync(file));return;}
  }
  res.setHeader("content-type","text/html;charset=utf-8");res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/globals.css"><style>${css.join("\n")}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`,artifacts=".qa-artifacts/onboarding-step2";
mkdirSync(artifacts,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER_EXECUTABLE||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
let checks=0;const pass=label=>{checks++;console.log("STEP2_UI PASS: "+label);};
async function context(scenario){
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,extraHTTPHeaders:{"x-qa-scenario":scenario}});
  await ctx.addInitScript(()=>{
    window.qaPrompts={camera:0,photos:0,location:0,push:0};
    Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia:()=>{window.qaPrompts.camera++;return Promise.reject(Error("QA camera"));}}});
    Object.defineProperty(navigator,"geolocation",{value:{getCurrentPosition:()=>{window.qaPrompts.location++;}}});
    if(window.Notification)Notification.requestPermission=()=>{window.qaPrompts.push++;return Promise.resolve("denied");};
    document.addEventListener("click",event=>{if(event.target instanceof HTMLInputElement&&event.target.type==="file")window.qaPrompts.photos++;},true);
  });return ctx;
}
try{
  for(const scenario of ["legacy","media","none"]){
    const ctx=await context(scenario),page=await ctx.newPage(),errors=[];page.on("pageerror",error=>{errors.push(error.message);console.error("QA browser error:",error.message);});
    await page.goto(origin);const cta=page.getByRole("button",{name:"GUARDAR Y CONTINUAR",exact:true});await cta.waitFor();
    assert.equal(await page.locator("details[open]").count(),0);assert.equal(await page.locator("details").count(),5);pass(`${scenario}: all five accordions closed`);
    const counts=await page.locator("summary").allTextContents();assert.match(counts[0],new RegExp(`${scenario==="media"?8:scenario==="legacy"?6:0} seleccionadas`));pass(`${scenario}: real canonical counts`);
    assert.equal(await page.locator('input[type="checkbox"]:checked').count(),scenario==="none"?0:scenario==="legacy"?24:26);pass(`${scenario}: no silent consent; existing purposes checked`);
    const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));assert.ok(geometry.scrollWidth<=geometry.width);pass(`${scenario}: 390×844 has no horizontal overflow`);
    await page.screenshot({path:`${artifacts}/${scenario}-compact.png`,fullPage:true});
    if(scenario==="media"){
      await page.locator("summary").first().click();const device=page.locator("details").first();
      const camera=device.getByRole("checkbox",{name:/Cámara/}),photos=device.getByRole("checkbox",{name:/Fotos \/ Fototeca/}),reminders=device.getByRole("checkbox",{name:/Recordatorios/});
      await camera.uncheck();await photos.uncheck();await camera.check();await photos.check();
      await reminders.scrollIntoViewIfNeeded();const scrollBefore=await page.evaluate(()=>scrollY);
      await reminders.uncheck();assert.match(await device.locator("summary").innerText(),/7 seleccionadas/);
      assert.equal(await page.evaluate(()=>scrollY),scrollBefore);pass("checkbox changes do not move scroll");
      assert.equal(await page.locator("details[open]").count(),1);assert.ok(await device.getAttribute("open")!==null);pass("deselect updates counter and leaves only the chosen accordion open");
      await cta.click();await page.getByRole("status").filter({hasText:"QA: siguiente paso"}).waitFor();pass("save persists exact decisions and advances directly");
      assert.equal(fixture(scenario).state.notifications.reminders,false);
      assert.deepEqual(await page.evaluate(()=>window.qaPrompts),{camera:0,photos:0,location:0,push:0});pass("camera/photo toggles and save never request OS permission");
      await page.reload();await cta.waitFor();assert.match(await page.locator("summary").first().innerText(),/7 seleccionadas/);assert.equal(await page.locator("details[open]").count(),0);pass("reload preserves revocation and compact view");
      await ctx.close();const second=await context(scenario),fresh=await second.newPage();await fresh.goto(origin);await fresh.getByRole("button",{name:"GUARDAR Y CONTINUAR",exact:true}).waitFor();
      assert.match(await fresh.locator("summary").first().innerText(),/7 seleccionadas/);pass("new browser session reads latest choices despite old authorization receipt");
      assert.deepEqual(await fresh.evaluate(()=>window.qaPrompts),{camera:0,photos:0,location:0,push:0});await second.close();
    }else{
      assert.deepEqual(await page.evaluate(()=>window.qaPrompts),{camera:0,photos:0,location:0,push:0});await ctx.close();
    }
    assert.deepEqual(errors,[]);pass(`${scenario}: no early OS prompt or browser error`);
  }
  console.log(JSON.stringify({status:"PASS",checks,viewport:"390x844",engine:"Chromium",transport:"synthetic; real production Step 2 and Shell",iphone:"PENDING_DEVICE_QA",artifacts}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

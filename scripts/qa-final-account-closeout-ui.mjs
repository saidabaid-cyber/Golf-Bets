// Local visual verification of the production React components. Synthetic HTTP
// fixtures only: no credentials, Auth, Supabase or destructive operation.
// This is NOT evidence of remote persistence. Run after test compilation.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";
const root=process.cwd(),require=createRequire(import.meta.url),port=Number(process.argv[2]||3199);
const optional=require(path.join(root,".test-dist/lib/account-optional-authorizations.js"));
const legal=require(path.join(root,".test-dist/lib/legal-evidence.js"));
const react=path.dirname(require.resolve("react/package.json")),dom=path.dirname(require.resolve("react-dom/package.json"));
const scheduler=path.dirname(createRequire(path.join(dom,"package.json")).resolve("scheduler/package.json"));
const external={react:readFileSync(path.join(react,"cjs/react.production.js"),"utf8"),"react/jsx-runtime":readFileSync(path.join(react,"cjs/react-jsx-runtime.production.js"),"utf8"),"react-dom":readFileSync(path.join(dom,"cjs/react-dom.production.js"),"utf8"),"react-dom/client":readFileSync(path.join(dom,"cjs/react-dom-client.production.js"),"utf8"),scheduler:readFileSync(path.join(scheduler,"cjs/scheduler.production.js"),"utf8"),"next/navigation":"exports.usePathname=()=>'/';"};
function compileBundle(before=false) {
  const sources={...external},styles=[];
  function resolve(name,owner) {
    if(!name.startsWith(".")){if(!(name in external))throw new Error(`Unexpected external ${name}`);return name;}
    const base=path.posix.normalize(path.posix.join(path.posix.dirname(owner),name));
    return [base,base+".tsx",base+".ts",base+".js"].find(file=>existsSync(path.join(root,file)))||base;
  }
  function load(file) {
    if(sources[file]!==undefined)return;
    sources[file]="";
    if(file.endsWith(".css")) {
      const prefix="qa-"+styles.length+"-";
      styles.push(readFileSync(path.join(root,file),"utf8").replace(/\.([a-zA-Z_][\w-]*)/g,"."+prefix+"$1"));
      sources[file]=`exports.__esModule=true;exports.default=new Proxy({},{get:(_,key)=>${JSON.stringify(prefix)}+key});`;return;
    }
    const text=before&&file==="app/components/profile-data-dialogs.tsx"?execFileSync("git",["show","20a11d128166945aaccb81457fe66c6cc7aa179c:"+file],{encoding:"utf8"}):readFileSync(path.join(root,file),"utf8");
    let compiled=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    compiled=compiled.replace(/require\("([^"\n]+)"\)/g,(_,name)=>{const id=resolve(name,file);load(id);return `require(${JSON.stringify(id)})`;});
    sources[file]=compiled;
  }
  ["app/components/profile-data-dialogs.tsx","app/components/onboarding-privacy-choices.tsx","app/components/viewport-navigation.tsx"].forEach(load);
  const script=`const definitions={${Object.entries(sources).map(([key,value])=>`${JSON.stringify(key)}:(module,exports,require)=>{${value}\n}`).join(",")}},cache={};function require(name){if(!cache[name]){const result={exports:{}};cache[name]=result;definitions[name](result,result.exports,require)}return cache[name].exports}
    const React=require('react'),{createRoot}=require('react-dom/client'),{AccountDataDialog,StatisticsResetDialog}=require('app/components/profile-data-dialogs.tsx'),{OnboardingPrivacyChoices}=require('app/components/onboarding-privacy-choices.tsx'),{ViewportNavigation}=require('app/components/viewport-navigation.tsx');
    function App(){const[kind,setKind]=React.useState(new URLSearchParams(location.search).get('kind')||'account'),[word,setWord]=React.useState(''),[policy,setPolicy]=React.useState(null),[notice,setNotice]=React.useState('');
      const common={confirmation:word,onConfirmation:setWord,busy:false,error:'',onClose:()=>setKind('closed'),onConfirm:()=>{setNotice('CALLBACK QA: no se ejecutó ninguna eliminación.');setKind('closed')}};
      return React.createElement(React.Fragment,null,React.createElement(ViewportNavigation),React.createElement('main',{style:{maxWidth:600,margin:'auto',padding:20}},React.createElement('h1',null,kind==='privacy'?'Permisos y privacidad':'Cuenta y privacidad'),React.createElement('p',{role:'status'},notice),kind==='privacy'?React.createElement(OnboardingPrivacyChoices,{userId:'11111111-1111-4111-8111-111111111111',accessToken:'LOCAL-UI-QA',onContinue:()=>setNotice('CALLBACK QA: decisiones sintéticas confirmadas')}):React.createElement('p',null,'Controles de cuenta — vista local del componente real.')),kind==='account'?React.createElement(AccountDataDialog,{...common,policy,onPolicy:setPolicy,onDeactivate:()=>{setNotice('CALLBACK QA: no se ejecutó ninguna desactivación.');setKind('closed')}}):kind==='stats'?React.createElement(StatisticsResetDialog,common):null)}
    createRoot(document.getElementById('root')).render(React.createElement(App));`;
  return {script,css:styles.join("\n")};
}
const bundles={after:compileBundle(),before:compileBundle(true)};
const at=new Date().toISOString();
const state={bundleVersion:optional.OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,resolved:false,eligible:true,receipt:null,
  scopes:Object.fromEntries(optional.OPTIONAL_AUTHORIZATION_SCOPES.map(scope=>[scope,{active:false,status:"missing",policyVersion:optional.OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],source:null,decidedAt:null}])),
  legal:Object.fromEntries(["financial_data","marketing"].map(subject=>[subject,{active:false,status:"missing",policyVersion:legal.legalEvidenceDefinition(subject,"accepted").version,decidedAt:null}])),
  profileVisibility:"private",socialPrivacy:"PRIVATE",socialProfilePrivacy:"PRIVATE",sharing:{enabledForFriends:false,rounds:false,achievements:false,equipment:false,courses:false},notifications:{internal:false,master:false,push:false,email:false,rounds:false,reminders:false}};
let social=Object.fromEntries(["enabledForFriends","shareRounds","shareAchievements","shareEquipment","shareCourses","notifyLike","notifyComment","notifyAttest","notifyFriendAchievement","notifyEquipment","notifyFriendRequest"].map(key=>[key,false]));
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,`http://127.0.0.1:${port}`);res.setHeader("cache-control","no-store");
  if(url.pathname.startsWith("/api/")){
    res.setHeader("content-type","application/json");let raw="";for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
    let result={};
    if(url.pathname==="/api/account/optional-authorizations"){
      if(req.method==="PATCH"){state.eligible=false;state.scopes[body.scope]={active:body.enabled,status:body.enabled?"accepted":"declined",policyVersion:optional.OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[body.scope],source:"settings",decidedAt:at};if(body.scope==="NOTIFICATION_INTERNAL")state.notifications.internal=state.notifications.master=body.enabled;}
      result=state;
    }else if(url.pathname==="/api/social/preferences"){
      if(req.method==="PUT"){social=body;state.sharing={enabledForFriends:body.enabledForFriends,rounds:body.shareRounds,achievements:body.shareAchievements,equipment:body.shareEquipment,courses:body.shareCourses};}
      result={data:social};
    }else if(url.pathname==="/api/legal/evidence"){
      for(const event of body.events||[])state.legal[event.subject]={active:event.action==="accepted",status:event.action,policyVersion:event.documentVersion,decidedAt:at};
    }else if(url.pathname==="/api/backyard-ai/consent"){
      const decisions=(body.decisions||[{scope:body.scope,accepted:req.method==="POST"}]).filter(row=>row.scope);
      for(const row of decisions)state.scopes[row.scope]={active:row.accepted,status:row.accepted?"accepted":"declined",policyVersion:optional.OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[row.scope],source:"onboarding",decidedAt:at};
      result={policyVersion:"2026-09-08-v2",resolved:true,decisions:decisions.map(row=>({scope:row.scope,policyVersion:"2026-09-08-v2",active:row.accepted,status:row.accepted?"accepted":"declined",source:"onboarding",decidedAt:at,acceptedAt:row.accepted?at:null,revokedAt:null}))};
    }else if(url.pathname==="/api/account/device-permission-preferences"){
      const preference=scope=>state.scopes[scope].status==="missing"?null:{version:1,value:state.scopes[scope].active?"enabled":"disabled",changedAt:state.scopes[scope].decidedAt};
      result={location:preference("LOCATION_INTERNAL"),notifications:preference("NOTIFICATION_INTERNAL")};
    }else if(url.pathname==="/api/account/notification-preferences"){
      Object.assign(state.notifications,body);result={initialized:true,preferences:body,delivery:{push:{configured:false,state:"not_configured"},email:{configured:false,state:"not_configured"}}};
    }else{res.statusCode=404;result={error:"No fixture for this endpoint"};}
    res.end(JSON.stringify(result));return;
  }
  const stage=url.searchParams.get("stage")==="before"?"before":"after";
  if(url.pathname==="/bundle.js"){res.setHeader("content-type","text/javascript");res.end(bundles[stage].script);return;}
  if(url.pathname==="/globals.css"){res.setHeader("content-type","text/css");res.end(readFileSync(path.join(root,"app/globals.css")));return;}
  if(url.pathname!=="/"){res.statusCode=404;res.end();return;}
  res.setHeader("content-type","text/html;charset=utf-8");
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Closeout LOCAL UI QA</title><link rel="stylesheet" href="/globals.css"><style>${bundles[stage].css}</style></head><body><div style="padding:8px;text-align:center;font:11px system-ui;background:#ffe6a6;color:#312700">LOCAL UI QA · DATOS SINTÉTICOS · SIN DB REMOTA · ${stage.toUpperCase()}</div><div id="root"></div><script src="/bundle.js?stage=${stage}"></script></body></html>`);
});
server.listen(port,"127.0.0.1",()=>console.log(`LOCAL UI QA ONLY http://127.0.0.1:${port}`));

// LOCAL MOCK ONLY: real production React components/CSS, loopback metadata and
// profile fixtures. Never connects to Supabase, Auth or a published deployment.
// node scripts/qa-hard-closeout-browser.mjs [port]; drive with agent-browser.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";

const root = process.cwd(), port = Number(process.argv[2] || 3198), require = createRequire(import.meta.url);
const modules = new Map(), css = [], fixtures = new Map();
const read = file => readFileSync(file, "utf8");
function fixture(key) {
  if (!fixtures.has(key)) fixtures.set(key, { profile: null, metadata: {}, events: [] });
  return fixtures.get(key);
}
const provider = read(path.join(root, "app/components/account-provider.tsx"));
const ast = ts.createSourceFile("provider.tsx", provider, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const setup = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ProfileSetupScreen");
if (!setup) throw new Error("Production ProfileSetupScreen missing");
const setupSource = `import {useState} from 'react';
import {validateProfileDraft,validateProfileAvatarUrl} from '../../lib/account-state';
import {normalizeProfileLocation,validateProfileLocation} from '../../lib/profile-geography';
import {BrandLockup} from './brand-lockup';import {ProfileImagePicker} from './profile-image-picker';
import {ProfileLocationPicker} from './profile-location-picker';import {HandicapSourceSelector} from './handicap-source-selector';
export ${setup.getText(ast)}`;
const overrides = new Map([
  [path.join(root, "app/components/qa-production-setup.tsx"), setupSource],
  [path.join(root, "lib/supabase/client.ts"), `
  export function getSupabaseBrowser(){return {auth:{
    getUser:async()=>({data:{user:{id:'local-qa',user_metadata:await request('GET')}},error:null}),
    updateUser:async({data})=>({data:{user:{id:'local-qa',user_metadata:await request('POST',data)}},error:null})
  }}}
  async function request(method,body){const r=await fetch('/qa/metadata?fixture='+encodeURIComponent(window.qaFixture),{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error('LOCAL MOCK failure');return r.json()}`],
]);
function load(file) {
  const id = path.isAbsolute(file) ? path.relative(root, file).replaceAll('\\','/') : file;
  if (modules.has(id)) return id;
  modules.set(id, "");
  if (file.endsWith('.css')) {
    const prefix = 'qa-' + path.basename(file).replace(/[^a-z]/g,'') + '-';
    css.push(read(file).replace(/\.([A-Za-z][\w-]*)/g, '.' + prefix + '$1'));
    modules.set(id, `exports.__esModule=true;exports.default=new Proxy({},{get:(_,k)=>${JSON.stringify(prefix)}+k});`);
    return id;
  }
  let source = overrides.get(file) ?? read(file);
  if (/\.[jt]sx?$/.test(file) && !file.includes('node_modules')) source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  source = source.replace(/require\(["']([^"']+)["']\)/g, (_whole, name) => {
    if (['react','react/jsx-runtime','react-dom','react-dom/client','scheduler','next/link','next/image'].includes(name)) return `require(${JSON.stringify(name)})`;
    let dep;
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(file), name);
      dep = [base, base+'.ts',base+'.tsx',base+'.js'].find(candidate => existsSync(candidate) || overrides.has(candidate));
    } else dep = require.resolve(name);
    if (!dep) throw new Error('Unresolved QA module '+name+' from '+file);
    return `require(${JSON.stringify(load(dep))})`;
  });
  modules.set(id, source); return id;
}
const reactDir=path.dirname(require.resolve('react/package.json')),domDir=path.dirname(require.resolve('react-dom/package.json'));
const schedulerDir=path.dirname(createRequire(path.join(domDir,'package.json')).resolve('scheduler/package.json'));
for(const[name,file]of Object.entries({react:path.join(reactDir,'cjs/react.production.js'),'react/jsx-runtime':path.join(reactDir,'cjs/react-jsx-runtime.production.js'),'react-dom':path.join(domDir,'cjs/react-dom.production.js'),'react-dom/client':path.join(domDir,'cjs/react-dom-client.production.js'),scheduler:path.join(schedulerDir,'cjs/scheduler.production.js')}))modules.set(name,read(file));
modules.set('next/link',`exports.__esModule=true;exports.default=({children,...p})=>require('react').createElement('a',p,children);`);
modules.set('next/image',`exports.__esModule=true;exports.default=({preload,priority,fill,unoptimized,...p})=>require('react').createElement('img',{...p,style:fill?{position:'absolute',width:'100%',height:'100%',inset:0,...p.style}:p.style});`);
const setupId=load(path.join(root,'app/components/qa-production-setup.tsx'));
const homeId=load(path.join(root,'app/components/home-dashboard.tsx'));
const navId=load(path.join(root,'app/components/app-bottom-nav.tsx'));
const baselinePath=path.join(root,'app/components/qa-baseline-home.tsx');
overrides.set(baselinePath,execFileSync('git',['show','eed282dee381e4b6b5eb4c3fc8771602620680b7:app/components/home-dashboard.tsx'],{cwd:root,encoding:'utf8'}));
const baselineId=load(baselinePath);
const bundle=`const process={env:{NODE_ENV:'production'}};
const definitions={${[...modules].map(([key,source])=>JSON.stringify(key)+':(module,exports,require)=>{'+source+'\n}').join(',')}};
const cache={};function require(id){if(!cache[id]){cache[id]={exports:{}};definitions[id](cache[id],cache[id].exports,require)}return cache[id].exports}
window.__consoleErrors=[];window.addEventListener('error',e=>window.__consoleErrors.push(e.message));
document.body.firstElementChild.style.position='sticky';document.body.firstElementChild.style.top='0px';
const params=new URLSearchParams(location.search);window.qaFixture=params.get('fixture')||'default';const page=params.get('case')||'profile';
const React=require('react'),{createRoot}=require('react-dom/client'),{ProfileSetupScreen}=require(${JSON.stringify(setupId)}),{HomeDashboard}=require(params.has('baseline')?${JSON.stringify(baselineId)}:${JSON.stringify(homeId)}),{AppBottomNav}=require(${JSON.stringify(navId)});
const noop=()=>{};
fetch('/qa/state?fixture='+encodeURIComponent(window.qaFixture)).then(r=>r.json()).then(initial=>{
function App(){const[status,setStatus]=React.useState('');const identity={userId:'local-qa',mode:'authenticated',accessToken:'LOCAL-MOCK',displayName:'Francisco Javier Martínez',givenName:'Francisco Javier',familyName:'Martínez',avatarUrl:'',defaultHandicap:null,countryCode:'',country:'',stateCode:'',state:'',...initial.profile};
if(page==='home')return React.createElement(React.Fragment,null,React.createElement('main',{style:{height:'calc(100dvh - 96px)'}},React.createElement(HomeDashboard,{displayName:'Golfista',avatarUrl:'',activeRound:null,insights:{scoredRounds:0,averageScore:null,betBalance:0},groupCount:0,onContinueRound:noop,onAiRound:noop,onNewRound:noop,onOpenProfile:noop,onOpenNotifications:noop,onOpenHistory:noop,onOpenBalances:noop,onOpenStats:noop,onOpenGroups:noop,onOpenRules:noop,onOpenSettings:noop})),React.createElement(AppBottomNav,{activeTab:'home',onNavigate:noop}));
return React.createElement(React.Fragment,null,React.createElement(ProfileSetupScreen,{identity,onBack:noop,onSave:async profile=>{const r=await fetch('/qa/profile?fixture='+encodeURIComponent(window.qaFixture),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(profile)});if(!r.ok)throw new Error('Mock save failed');setStatus('PERFIL GUARDADO — LOCAL MOCK');}}),React.createElement('p',{id:'qa-save-result',role:'status'},status));}
createRoot(document.getElementById('root')).render(React.createElement(App));});`;
const server=createServer(async(request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1:'+port);response.setHeader('cache-control','no-store');response.setHeader('content-security-policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:");
 if(url.pathname.startsWith('/qa/')){response.setHeader('content-type','application/json');const value=fixture(url.searchParams.get('fixture')||'default');if(request.method==='POST'){let raw='';for await(const chunk of request)raw+=chunk;const body=JSON.parse(raw);value.events.push({path:url.pathname,body});if(url.pathname==='/qa/metadata')value.metadata={...value.metadata,...body};if(url.pathname==='/qa/profile')value.profile=body;}return response.end(JSON.stringify(url.pathname==='/qa/metadata'?value.metadata:value));}
 if(url.pathname==='/bundle.js'){response.setHeader('content-type','text/javascript');return response.end(bundle);}
 if(url.pathname==='/globals.css'){response.setHeader('content-type','text/css');return response.end(read(path.join(root,'app/globals.css')));}
 if(url.pathname.startsWith('/brand/')){const file=path.resolve(root,'public','.'+url.pathname);if(file.startsWith(path.resolve(root,'public','brand')+path.sep)){try{response.setHeader('content-type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.jpg')?'image/jpeg':'image/png');return response.end(readFileSync(file));}catch{}}}
 if(url.pathname!=='/'){response.statusCode=404;return response.end();}response.setHeader('content-type','text/html;charset=utf-8');response.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hard closeout — LOCAL MOCK</title><link rel="stylesheet" href="/globals.css"><style>${css.join('\n')}</style></head><body><div style="font:10px system-ui;text-align:center;background:#ffe6a6;color:#312700;position:relative;z-index:100000">LOCAL MOCK · NO ES PREVIEW DB</div><div id="root"></div><script src="/bundle.js"></script></body></html>`);
});
server.listen(port,'127.0.0.1',()=>console.log('LOCAL MOCK COMPONENT QA http://127.0.0.1:'+port));

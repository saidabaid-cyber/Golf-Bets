// LOCAL FAILURE INJECTION ONLY. No Supabase, provider, login or real user.
// Serves production checkpoint + consent client (real parser/timeout) + Home.
// Substitutes Next media, avatar initials, authenticated identity and API only.
// Navigation beyond Home is a callback probe, not a full feature test.
// Run: node scripts/qa-account-consent-browser.mjs [port]
// Cases: onboarding, existing, declined, failure (save), get500, migration,
// network, timeout. Failure cases use production client + browser fetch.
// This validates UI/client behavior, NOT Preview DB persistence/authorization.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = process.cwd();
const port = Number(process.argv[2] || 3197);
const TEXT = "AI_PROVIDER_PROCESSING_CONSENT";
const IMAGE = "AI_IMAGE_PROCESSING_CONSENT";
const LAUNCH = "AI_LAUNCH_MONITOR_PROCESSING_CONSENT";
const version = readFileSync(path.join(root, "lib/backyard-ai/privacy.ts"), "utf8").match(/CONSENT_VERSION = "([^"]+)"/)[1];
const fixtures = new Map();
function fixture(name) {
  if (!fixtures.has(name)) {
    const states = name === "existing" ? ["accepted", "missing", "declined"] : name === "declined" ? ["declined", "revoked", "declined"] : ["missing", "missing", "missing"];
    const now = new Date().toISOString();
    fixtures.set(name, { legal: !name.startsWith("onboarding"), mutations: [], requests: [], decisions: [TEXT, IMAGE, LAUNCH].map((scope, index) => ({ scope, status: states[index], active: states[index] === "accepted", policyVersion: version, acceptedAt: ["accepted", "revoked"].includes(states[index]) ? now : null, revokedAt: states[index] === "revoked" ? now : null, source: states[index] === "missing" ? null : "legacy", decidedAt: states[index] === "missing" ? null : now })) });
  }
  return fixtures.get(name);
}
function result(value) { return { decisions: value.decisions, resolved: value.decisions.every((decision) => decision.status !== "missing"), policyVersion: version }; }
function cjs(file) { return readFileSync(file, "utf8"); }
function compile(file) { return ts.transpileModule(cjs(path.join(root, file)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText; }
const reactDir = path.dirname(require.resolve("react/package.json"));
const domDir = path.dirname(require.resolve("react-dom/package.json"));
const schedulerDir = path.dirname(createRequire(path.join(domDir, "package.json")).resolve("scheduler/package.json"));
const checkpointCss = cjs(path.join(root, "app/components/account-consent-checkpoint.module.css")).replace(/\.([a-zA-Z][\w-]*)/g, ".qa-consent-$1");
const homeCss = cjs(path.join(root, "app/components/home-dashboard-clean.module.css")).replace(/\.([a-zA-Z][\w-]*)/g, ".qa-home-$1");
const modules = {
  react: cjs(path.join(reactDir, "cjs/react.production.js")),
  "react/jsx-runtime": cjs(path.join(reactDir, "cjs/react-jsx-runtime.production.js")),
  "react-dom": cjs(path.join(domDir, "cjs/react-dom.production.js")),
  "react-dom/client": cjs(path.join(domDir, "cjs/react-dom-client.production.js")),
  scheduler: cjs(path.join(schedulerDir, "cjs/scheduler.production.js")),
  "next/link": 'exports.__esModule=true;exports.default=function({children,...props}){return require("react").createElement("a",props,children)}',
  "next/image": 'exports.__esModule=true;exports.default=function({priority,preload,fill,...props}){return require("react").createElement("img",{...props,style:{...props.style,...(fill?{position:"absolute",inset:0,width:"100%",height:"100%"}:{})}})}',
  "../../lib/backyard-ai/privacy": compile("lib/backyard-ai/privacy.ts"),
  "./privacy": compile("lib/backyard-ai/privacy.ts"),
  "./processing-consent": compile("lib/backyard-ai/processing-consent.ts"),
  "./consent-record": compile("lib/backyard-ai/consent-record.ts"),
  "./memory/storage": compile("lib/backyard-ai/memory/storage.ts"),
  "./memory/types": compile("lib/backyard-ai/memory/types.ts"),
  "./types": compile("lib/backyard-ai/memory/types.ts"),
  "./brand-lockup": compile("app/components/brand-lockup.tsx"),
  "./account-consent-checkpoint.module.css": 'exports.__esModule=true;exports.default=new Proxy({},{get:(_,key)=>"qa-consent-"+key})',
  "../../lib/backyard-ai/consent-client": compile("lib/backyard-ai/consent-client.ts"),
  "./home-dashboard-clean.module.css": 'exports.__esModule=true;exports.default=new Proxy({},{get:(_,key)=>"qa-home-"+key})',
  "./modal-shell": compile("app/components/modal-shell.tsx"),
  "./profile-avatar-media": 'exports.ProfileAvatarMedia=({fallback})=>require("react").createElement("span",null,fallback)',
  home: compile("app/components/home-dashboard.tsx"),
  checkpoint: compile("app/components/account-consent-checkpoint.tsx"),
};
const bundle = `const definitions={${Object.entries(modules).map(([key, source]) => `${JSON.stringify(key)}:(module,exports,require)=>{${source}\n}`).join(",")}};const cache={};function require(name){if(!cache[name]){const module={exports:{}};cache[name]=module;definitions[name](module,module.exports,require)}return cache[name].exports}
window.__consoleErrors=[];window.addEventListener('error',event=>window.__consoleErrors.push(event.message));
window.qaCase=new URLSearchParams(location.search).get('case')||'onboarding';
const React=require('react'),{createRoot}=require('react-dom/client'),{AccountConsentCheckpoint}=require('checkpoint'),{HomeDashboard}=require('home');
fetch('/qa/state?case='+encodeURIComponent(window.qaCase)).then(response=>response.json()).then(initial=>{
 function App(){const[legal,setLegal]=React.useState(initial.legal),[screen,setScreen]=React.useState('home'),[access,setAccess]=React.useState(false);const token='local-QA:'+window.qaCase;
   async function checkAi(){try{const decision=await require('../../lib/backyard-ai/consent-client').readRemoteAiProcessingConsent(token,${JSON.stringify(TEXT)});setScreen(decision.active?'AI_VERIFIED_PROBE':'AI_BLOCKED_PROBE')}catch{setScreen('AI_BLOCKED_PROBE')}}
   if(access)return React.createElement('main',null,React.createElement('h1',null,'ACCESO QA · SESIÓN EXISTENTE'),React.createElement('button',{onClick:()=>setAccess(false)},'CONTINUAR A MI CUENTA'));
   const home=React.createElement('div',{id:'qa-entered'},screen==='home'?React.createElement(HomeDashboard,{displayName:'Golfista',avatarUrl:null,insights:{scoredRounds:0},groupCount:0,onContinueRound:()=>setScreen('manual'),onAiRound:checkAi,onNewRound:()=>setScreen('manual'),onOpenProfile:()=>setScreen('profile'),onOpenNotifications:()=>setScreen('notifications'),onOpenHistory:()=>setScreen('history'),onOpenBalances:()=>setScreen('balances'),onOpenStats:()=>setScreen('stats'),onOpenGroups:()=>setScreen('groups'),onOpenRules:()=>setScreen('rules')}):React.createElement('main',{id:'qa-navigation-probe'},React.createElement('h1',null,screen==='AI_BLOCKED_PROBE'?'IA BLOQUEADA · SIN CONSENTIMIENTO VERIFICABLE':'NAVEGACIÓN QA: '+screen),React.createElement('p',null,'Destino instrumentado: prueba del callback, no de toda esta pantalla.'),React.createElement('button',{onClick:()=>setScreen('home')},'VOLVER A HOME')));
   return React.createElement(AccountConsentCheckpoint,{userId:'synthetic-'+window.qaCase,accessToken:token,legalRequired:!legal,onAcceptLegal:async()=>{await fetch('/qa/legal?case='+encodeURIComponent(window.qaCase),{method:'POST'});setLegal(true)},onBack:async()=>setAccess(true)},home)}
 createRoot(document.getElementById('root')).render(React.createElement(App));
});`;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:");
  if (url.pathname.startsWith("/qa/") || url.pathname === "/api/backyard-ai/consent") {
    response.setHeader("content-type", "application/json");
    const name = url.pathname.startsWith("/qa/") ? url.searchParams.get("case") || "onboarding" : request.headers.authorization?.replace(/^Bearer local-QA:/, "") || "existing"; const value = fixture(name);
    if (url.pathname === "/qa/state") return response.end(JSON.stringify(value));
    if (url.pathname === "/qa/legal" && request.method === "POST") { value.legal = true; return response.end('{"ok":true}'); }
    if (url.pathname === "/api/backyard-ai/consent") {
      value.requests.push({ method: request.method, at: new Date().toISOString(), scope: url.searchParams.get("scope") });
      if (name === "network") return request.socket.destroy();
      if (name === "timeout") return; // Production client must reach its real deadline.
      if (name === "get500" || name === "migration") {
        response.statusCode = name === "get500" ? 500 : 503;
        return response.end(JSON.stringify({ error: "Injected local consent lookup failure", code: name === "migration" ? "consent_schema_unavailable" : "consent_lookup_unavailable" }));
      }
      if (request.method === "POST") {
        let payload = ""; for await (const chunk of request) payload += chunk;
        const mutation = JSON.parse(payload); value.mutations.push(mutation);
        if (name === "failure") { response.statusCode = 503; return response.end('{"error":"synthetic failure"}'); }
        value.decisions = value.decisions.map((decision) => { const next = mutation.decisions.find((item) => item.scope === decision.scope); return next ? { ...decision, status: next.accepted ? "accepted" : "declined", active: next.accepted, acceptedAt: next.accepted ? new Date().toISOString() : null, revokedAt: null, decidedAt: new Date().toISOString(), source: mutation.source } : decision; });
      }
      if (url.searchParams.has("scope")) return response.end(JSON.stringify(value.decisions.find((decision) => decision.scope === url.searchParams.get("scope"))));
      return response.end(JSON.stringify(result(value)));
    }
  }
  if (url.pathname === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle); }
  if (url.pathname === "/globals.css") { response.setHeader("content-type", "text/css"); return response.end(cjs(path.join(root, "app/globals.css"))); }
  if (url.pathname.startsWith("/brand/")) {
    const target = path.resolve(root, "public", `.${url.pathname}`);
    if (target.startsWith(path.resolve(root, "public", "brand") + path.sep)) {
      try { response.setHeader("content-type", target.endsWith(".svg") ? "image/svg+xml" : target.endsWith(".jpg") ? "image/jpeg" : "image/png"); return response.end(readFileSync(target)); } catch { /* missing image is a legitimate fallback test */ }
    }
  }
  if (url.pathname !== "/") { response.statusCode = 404; return response.end(); }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consent Hotfix — LOCAL FAILURE INJECTION</title><link rel="stylesheet" href="/globals.css"><style>${checkpointCss}\n${homeCss}</style></head><body><div style="padding:6px;text-align:center;font:10px system-ui;background:#ffe6a6;color:#312700">LOCAL FAILURE INJECTION · IDENTIDAD QA · NO ES PREVIEW DB</div><div id="root"></div><script src="/bundle.js"></script></body></html>`);
});
server.listen(port, "127.0.0.1", () => console.log(`LOCAL FAILURE INJECTION ONLY http://127.0.0.1:${port}`));

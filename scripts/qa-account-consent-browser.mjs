// LOCAL COMPONENT HARNESS ONLY. No Supabase, provider, login or real user.
// Serves the production checkpoint TSX/CSS with real React, substituting only
// Next Link/Image and the remote consent boundary with an in-memory QA server.
// Run: node scripts/qa-account-consent-browser.mjs [port]
// Open /?case=onboarding (or existing, declined, failure) with agent-browser.
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
    fixtures.set(name, { legal: !name.startsWith("onboarding"), mutations: [], decisions: [TEXT, IMAGE, LAUNCH].map((scope, index) => ({ scope, status: states[index], active: states[index] === "accepted", policyVersion: version, acceptedAt: null, revokedAt: null, source: null })) });
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
const modules = {
  react: cjs(path.join(reactDir, "cjs/react.production.js")),
  "react/jsx-runtime": cjs(path.join(reactDir, "cjs/react-jsx-runtime.production.js")),
  "react-dom": cjs(path.join(domDir, "cjs/react-dom.production.js")),
  "react-dom/client": cjs(path.join(domDir, "cjs/react-dom-client.production.js")),
  scheduler: cjs(path.join(schedulerDir, "cjs/scheduler.production.js")),
  "next/link": 'exports.__esModule=true;exports.default=function({children,...props}){return require("react").createElement("a",props,children)}',
  "next/image": 'exports.__esModule=true;exports.default=function({priority,...props}){return require("react").createElement("img",props)}',
  "../../lib/backyard-ai/privacy": `exports.AI_PROVIDER_PROCESSING_CONSENT=${JSON.stringify(TEXT)};exports.AI_IMAGE_PROCESSING_CONSENT=${JSON.stringify(IMAGE)};exports.AI_LAUNCH_MONITOR_PROCESSING_CONSENT=${JSON.stringify(LAUNCH)};`,
  "./brand-lockup": compile("app/components/brand-lockup.tsx"),
  "./account-consent-checkpoint.module.css": 'exports.__esModule=true;exports.default=new Proxy({},{get:(_,key)=>"qa-consent-"+key})',
  "../../lib/backyard-ai/consent-client": `
    async function request(method,body,signal){const response=await fetch('/qa/consent?case='+encodeURIComponent(window.qaCase),{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal});if(!response.ok)throw new Error('QA consent failure');return response.json()}
    exports.readRemoteAiConsentDecisions=(_token,signal)=>request('GET',null,signal);
    exports.saveRemoteAiConsentDecisions=(_token,_userId,decisions,source,signal)=>request('POST',{decisions,source},signal);
  `,
  checkpoint: compile("app/components/account-consent-checkpoint.tsx"),
};
const bundle = `const definitions={${Object.entries(modules).map(([key, source]) => `${JSON.stringify(key)}:(module,exports,require)=>{${source}\n}`).join(",")}};const cache={};function require(name){if(!cache[name]){const module={exports:{}};cache[name]=module;definitions[name](module,module.exports,require)}return cache[name].exports}
window.__consoleErrors=[];window.addEventListener('error',event=>window.__consoleErrors.push(event.message));
window.qaCase=new URLSearchParams(location.search).get('case')||'onboarding';
const React=require('react'),{createRoot}=require('react-dom/client'),{AccountConsentCheckpoint}=require('checkpoint');
fetch('/qa/state?case='+encodeURIComponent(window.qaCase)).then(response=>response.json()).then(initial=>{
 function App(){const[legal,setLegal]=React.useState(initial.legal);return React.createElement(AccountConsentCheckpoint,{userId:'synthetic-'+window.qaCase,accessToken:'local-QA-only',legalRequired:!legal,onAcceptLegal:async()=>{await fetch('/qa/legal?case='+encodeURIComponent(window.qaCase),{method:'POST'});setLegal(true)},onBack:async()=>{}},React.createElement('main',{id:'qa-entered'},React.createElement('h1',null,'APP QA — PREFERENCIAS RESUELTAS'),React.createElement('p',null,'Componente local; sin Supabase ni cuentas reales.')))}
 createRoot(document.getElementById('root')).render(React.createElement(App));
});`;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:");
  if (url.pathname.startsWith("/qa/")) {
    response.setHeader("content-type", "application/json");
    const name = url.searchParams.get("case") || "onboarding"; const value = fixture(name);
    if (url.pathname === "/qa/state") return response.end(JSON.stringify(value));
    if (url.pathname === "/qa/legal" && request.method === "POST") { value.legal = true; return response.end('{"ok":true}'); }
    if (url.pathname === "/qa/consent") {
      if (request.method === "POST") {
        let payload = ""; for await (const chunk of request) payload += chunk;
        const mutation = JSON.parse(payload); value.mutations.push(mutation);
        if (name === "failure") { response.statusCode = 503; return response.end('{"error":"synthetic failure"}'); }
        value.decisions = value.decisions.map((decision) => { const next = mutation.decisions.find((item) => item.scope === decision.scope); return next ? { ...decision, status: next.accepted ? "accepted" : "declined", active: next.accepted, acceptedAt: next.accepted ? new Date().toISOString() : null, source: mutation.source } : decision; });
      }
      return response.end(JSON.stringify(result(value)));
    }
  }
  if (url.pathname === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle); }
  if (url.pathname === "/globals.css") { response.setHeader("content-type", "text/css"); return response.end(cjs(path.join(root, "app/globals.css"))); }
  if (url.pathname.startsWith("/brand/")) {
    const target = path.resolve(root, "public", `.${url.pathname}`);
    if (target.startsWith(path.resolve(root, "public", "brand") + path.sep)) {
      try { response.setHeader("content-type", target.endsWith(".svg") ? "image/svg+xml" : "image/png"); return response.end(readFileSync(target)); } catch { /* missing image is a legitimate fallback test */ }
    }
  }
  if (url.pathname !== "/") { response.statusCode = 404; return response.end(); }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consent QA — LOCAL MOCK</title><link rel="stylesheet" href="/globals.css"><style>${checkpointCss}</style></head><body><div style="padding:6px;text-align:center;font:11px system-ui;background:#ffe6a6;color:#312700">QA LOCAL · API EN MEMORIA · NO ES PREVIEW DB</div><div id="root"></div><script src="/bundle.js"></script></body></html>`);
});
server.listen(port, "127.0.0.1", () => console.log(`LOCAL COMPONENT QA ONLY http://127.0.0.1:${port}`));

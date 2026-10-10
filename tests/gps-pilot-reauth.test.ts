import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

test("DEV pilot reauthentication uses existing login without signing out other sessions; normal return remains pilot",()=>{
  const effects:Array<()=>void>=[], redirects:string[]=[];let logins=0, requested=0;
  const exports:Record<string,any>={};
  const compiled=ts.transpileModule(readFileSync("app/components/gps-pilot-login.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(compiled+"\nexports.testReturn = ReturnToPilot;",{exports,window:{location:{host:"dev.thebackyard.com.mx",replace:(url:string)=>redirects.push(url)}},
    require(name:string){
      if(name==="react")return{useEffect:(fn:()=>void)=>effects.push(fn),useState:()=>[]};
      if(name==="next/navigation")return{};
      if(name==="react/jsx-runtime")return{jsx:()=>null};
      if(name==="./account-provider")return{useBackyardAccount:()=>({identity:{mode:"authenticated",accessToken:"synthetic"},openAccess:()=>logins++})};
      return{consumeGpsPilotReturn(){},gpsReturnStorage(){},GPS_PILOT_PATH:"/gps-pilot/la-vista-1"};
    }});
  exports.testReturn({reauthenticate:true,onRequested:()=>requested++,destination:"/?screen=play"});effects.pop()!();
  assert.equal(logins,1);assert.equal(requested,1);assert.deepEqual(redirects,[]);
  exports.testReturn({reauthenticate:false,onRequested:()=>requested++,destination:"/?screen=play"});effects.pop()!();
  assert.deepEqual(redirects,["/?screen=play"]);
  exports.testReturn({reauthenticate:false,onRequested:()=>requested++,destination:"/gps-pilot/la-vista-1"});effects.pop()!();
  assert.equal(redirects[1],"/gps-pilot/la-vista-1");
  const route=readFileSync("app/gps-pilot/login/page.tsx","utf8");assert.match(route,/pilotHostEnabled/);assert.match(route,/notFound/);
});

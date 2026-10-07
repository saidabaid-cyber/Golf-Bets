"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GhinImportPage } from "../../lib/ghin/score-reconciliation";

export type GhinImportedScoresController = {
  data: GhinImportPage | null; loading: boolean; syncing: boolean; error: string; reauthorizationRequired: boolean;
  load: () => Promise<void>; sync: () => Promise<void>; next: () => Promise<void>;
};
/** Private server persistence, not browser storage. No interval, foreground
 * polling or automatic provider fetch. Import happens only on explicit tap. */
export function useGhinImportedScores(accessToken: string | null, enabled: boolean, linkRevision = ""): GhinImportedScoresController {
  const generation=useRef(0),busy=useRef(false);
  const [state,setState]=useState({account:null as string|null,data:null as GhinImportPage|null,loading:false,syncing:false,error:"",reauthorizationRequired:false});
  const data=state.account===accessToken ? state.data : null;
  const request=useCallback(async(mode:"read"|"sync"|"next",signal?:AbortSignal,cursor?:string)=>{
    if(!accessToken || !enabled || busy.current)return;
    busy.current=true;const run=generation.current;
    setState(s=>({...s,loading:mode!=="sync",syncing:mode==="sync",error:""}));
    const path=`/api/profile/ghin/import${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`;
    const body=mode==="sync"?JSON.stringify({operation:"sync"}):undefined;
    try {
      const response=await fetch(path,{method:mode==="sync"?"POST":"GET",cache:"no-store",headers:{authorization:`Bearer ${accessToken}`,...(body?{"content-type":"application/json"}:{})},body,signal:signal??AbortSignal.timeout(30_000)});
      const raw=await response.text();
      // Sanitized DEV request accounting; no IDs, payloads or auth material.
      console.info("BACKYARD_GHIN_REQUEST",JSON.stringify({endpoint:"/api/profile/ghin/import",method:body?"POST":"GET",status:response.status,requestBytes:body?new TextEncoder().encode(body).length:0,responseBytes:new TextEncoder().encode(raw).length}));
      const payload=JSON.parse(raw) as GhinImportPage & {code?:string};
      if(!response.ok)throw Object.assign(new Error("GHIN_IMPORT_REQUEST_FAILED"),{code:payload.code});
      if(!Array.isArray(payload.items)||!Array.isArray(payload.links)||typeof payload.total!=="number"||!payload.grossTotals)throw new Error("INVALID_RESPONSE");
      if(run!==generation.current||signal?.aborted)return;
      setState(s=>({...s,account:accessToken,data:mode==="next"&&s.data?{...payload,items:[...new Map([...s.data.items,...payload.items].map(r=>[r.id,r])).values()]}:payload,error:"",reauthorizationRequired:false}));
    } catch(error) {
      if(run!==generation.current||signal?.aborted)return;
      const code=(error as {code?:string}).code;
      setState(s=>({...s,error:code==="REAUTH_REQUIRED"?"Renueva autorización GHIN para sincronizar tarjetas.":"No pudimos consultar las tarjetas guardadas. Tus rondas Backyard se conservan.",reauthorizationRequired:code==="REAUTH_REQUIRED"}));
    } finally {if(run===generation.current){busy.current=false;setState(s=>({...s,loading:false,syncing:false}));}}
  },[accessToken,enabled]);
  useEffect(()=>{
    const run=++generation.current;busy.current=false;setState({account:null,data:null,loading:false,syncing:false,error:"",reauthorizationRequired:false});
    const controller=new AbortController();
    if(accessToken&&enabled)void request("read",controller.signal);
    return()=>{controller.abort();generation.current=run+1;busy.current=false;};
  },[accessToken,enabled,request,linkRevision]);
  return { ...state,data,load:()=>request("read"),sync:()=>request("sync"),next:()=>data?.nextCursor?request("next",undefined,data.nextCursor):Promise.resolve() };
}

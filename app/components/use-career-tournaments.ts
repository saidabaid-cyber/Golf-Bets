"use client";
import { useEffect,useState,useCallback } from "react";
import type { CareerTournament } from "../../lib/career-tournaments";
type Page={events:CareerTournament[];nextOffset:number|null;ranking:null};
// Account-scoped, short-lived memo. Auth loss clears it; tokens never enter cache keys or payloads.
const cache=new Map<string,{at:number;page:Page}>();
export function useCareerTournaments(userId:string,accessToken?:string|null) {
  const [state,setState]=useState<{owner:string;page:Page|null;loading:boolean;error:boolean}>({owner:userId,page:null,loading:!!accessToken,error:false});
  const [revision,retry]=useState(0),[offset,setOffset]=useState(0);
  useEffect(()=>{
    if(!accessToken){cache.clear();return;}
    const saved=cache.get(userId);
    if(offset===0&&revision===0&&saved&&Date.now()-saved.at<60000){setState({owner:userId,page:saved.page,loading:false,error:false});return;}
    const controller=new AbortController();
    setState(s=>({owner:userId,page:s.owner===userId?s.page:null,loading:true,error:false}));
    void fetch(`/api/career/tournaments?offset=${offset}`,{headers:{authorization:`Bearer ${accessToken}`},cache:"no-store",signal:controller.signal}).then(async response=>{
      if(!response.ok) throw new Error("UNAVAILABLE");
      const page=await response.json() as Page;
      if(!Array.isArray(page.events)||(page.nextOffset!==null&&!Number.isInteger(page.nextOffset))) throw new Error("INVALID_RESPONSE");
      if(controller.signal.aborted)return;
      setState(s=>{const merged=offset&&s.owner===userId&&s.page?{...page,events:[...new Map([...s.page.events,...page.events].map(e=>[e.id,e])).values()]}:page;cache.set(userId,{at:Date.now(),page:merged});return{owner:userId,page:merged,loading:false,error:false};});
    }).catch(()=>{if(!controller.signal.aborted)setState(s=>({...s,loading:false,error:true}));});
    return()=>controller.abort();
  },[userId,accessToken,revision,offset]);
  const reload=useCallback(()=>{cache.delete(userId);setOffset(0);retry(n=>n+1);},[userId]);
  const loadMore=useCallback(()=>{if(!state.loading&&state.page?.nextOffset!==null&&state.page?.nextOffset!==undefined)setOffset(state.page.nextOffset);},[state]);
  return {events:state.owner===userId&&accessToken?state.page?.events??[]:[],loading:!!accessToken&&(state.owner!==userId||state.loading),error:!!accessToken&&state.owner===userId&&state.error,nextOffset:state.page?.nextOffset??null,authenticated:!!accessToken,reload,loadMore};
}

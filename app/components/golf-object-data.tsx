"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { SocialActivityCard } from "../../lib/social-activity-contract";
import type { RoundSnapshot } from "../../lib/types";
import type { GolfObject } from "../../lib/golf-object-navigation";
import { historyGolfDetail, scorecardTotals, type GolfRoundDetail } from "../../lib/golf-scorecard-presentation";
import type { SharedRoundCard } from "../../lib/shared-round-participants";
import { socialRequest } from "../../lib/social-activity-client";
import { readAccountUiPreferences, type DistanceUnit } from "../../lib/account-ui-preferences";
export function useGolfDistanceUnit(): DistanceUnit {
  const {viewerId}=useGolfObjectData(), [unit,setUnit]=useState<DistanceUnit>("yards");
  useEffect(()=>{const update=()=>setUnit(readAccountUiPreferences(localStorage,viewerId).distanceUnit);update();window.addEventListener("storage",update);window.addEventListener("focus",update);return()=>{window.removeEventListener("storage",update);window.removeEventListener("focus",update);};},[viewerId]);
  return unit;
}
export type GolfObjectData = { viewerId: string; accessToken?: string; history: RoundSnapshot[]; readActivity: (id: string) => Promise<SocialActivityCard>; invalidateActivity: (id: string) => void };
export const GolfObjectDataContext = createContext<GolfObjectData | null>(null);
export function useGolfObjectData() { const context = useContext(GolfObjectDataContext); if (!context) throw Error("Golf object reader missing"); return context; }
export function useRoundObject(object: Extract<GolfObject, { source: string }>) {
  const context = useGolfObjectData(), [activity,setActivity] = useState<SocialActivityCard | null>(null), [failed,setFailed] = useState(false), [attempt,setAttempt] = useState(0), [loading,setLoading] = useState(object.source !== "history");
  const local = object.source === "history" ? context.history.find(r => r.id === object.id) : undefined;
  const [shared,setShared]=useState<GolfRoundDetail|null>(null);
  useEffect(()=>{
    if(object.source!=="shared"||object.kind!=="hole"||!context.accessToken)return;
    const controller=new AbortController();setLoading(true);setFailed(false);
    void socialRequest<{data:SharedRoundCard}>(`/api/social/rounds/card?roundId=${encodeURIComponent(object.id)}`,context.accessToken,{signal:controller.signal}).then(({data:card})=>{
      if(controller.signal.aborted)return;const totals=scorecardTotals(card.myScorecard||[]);
      setShared({card:{roundId:card.roundId,localRoundId:card.localRoundId,date:card.date,courseName:card.courseName,teeName:null,holesPlayed:card.myScorecard?.length||0,ownerScore:totals.score,coursePar:card.myScorecard?.length?totals.par:null,scorecard:card.myScorecard},shots:[]});
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[object.source,object.kind,object.id,context.accessToken,attempt]);
  useEffect(() => {
    if (object.source !== "activity") return;
    let live = true; setLoading(true); setFailed(false);
    void context.readActivity(object.id).then(card => { if(live) setActivity(card); }).catch(()=>{if(live)setFailed(true);}).finally(()=>{if(live)setLoading(false);});
    return () => { live=false; };
  }, [context,object.id,object.source,attempt]);
  const detail: GolfRoundDetail | null = local ? historyGolfDetail(local) : object.source==="shared"?shared:activity?.round ? { card: activity.round, playerName: activity.author.displayName, shots: [] } : null;
  return { detail, activity, local, loading: object.source === "history" ? false : loading, failed, retry: () => { context.invalidateActivity(object.id); setAttempt(n=>n+1); }, context };
}
/** A bounded session cache coalesces profile → round → hole reads without persisting private cards. */
export function createGolfActivityReader(token?: string) {
  const cache = new Map<string, { at: number; promise: Promise<SocialActivityCard> }>();
  return {
    readActivity(id: string) {
      if (!token) return Promise.reject(Error("Authentication required"));
      const saved = cache.get(id);
      if (saved && Date.now()-saved.at < 60_000) return saved.promise;
      if (cache.size >= 48) cache.delete(cache.keys().next().value!);
      const promise = socialRequest<{ data: SocialActivityCard }>(`/api/social/activity/${encodeURIComponent(id)}`,token).then(result=>result.data).catch(error=>{cache.delete(id);throw error;});
      cache.set(id,{at:Date.now(),promise}); return promise;
    },
    invalidateActivity(id: string) { cache.delete(id); },
  };
}

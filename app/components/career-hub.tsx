"use client";
import dynamic from "next/dynamic";
import { useEffect,useRef,useState } from "react";
import { CareerIndexPanel,type CareerIndexDetail } from "./career-index-panel";
import { recordCareerEvent } from "../../features/analytics/career";
import type { GolfInsights } from "../../lib/golf-insights";
import type { RoundSnapshot } from "../../lib/types";
import type { SelectedHandicapIndex } from "../../lib/handicap-source";
import type { CareerView } from "../../lib/career-navigation";
import type { GhinProfileProjection } from "../../lib/ghin/profile";
import type { CareerCompetitionEvidence } from "../../lib/round-achievements";
import { CareerHeader, CareerTabs, CareerSkeleton, CareerErrorState } from "./career-shared";
import styles from "./career-hub.module.css";
const CareerOverview = dynamic(() => import("./career-overview").then(m => m.CareerOverview), { loading: CareerSkeleton });
const CareerAchievements = dynamic(() => import("./career-achievements").then(m => m.CareerAchievements), { loading: CareerSkeleton });
const CareerRivalries = dynamic(() => import("./career-rivalries").then(m => m.CareerRivalries), { loading: CareerSkeleton });
const CareerRounds = dynamic(() => import("./career-rounds").then(m => m.CareerRounds), { loading: CareerSkeleton });
const CareerTournaments = dynamic(() => import("./career-tournaments").then(m => m.CareerTournaments), { loading: CareerSkeleton });
export type CareerHubProps = {
  displayName: string; avatarUrl?: string | null; userId: string; index: SelectedHandicapIndex;
  username?: string | null; club?: string | null; city?: string | null; accessToken?: string | null;
  ghin?: { profile: GhinProfileProjection | null; enabled: boolean;ready?:boolean; error?: string | null };
  insights: GolfInsights; rounds: RoundSnapshot[]; history?: RoundSnapshot[]; ready: boolean; error?: boolean;
  view: CareerView; onView: (view: CareerView) => void;
  onOpenStats: () => void; onOpenHistory: () => void; onOpenRound: (id: string) => void;
  onCreateRound: () => void; onFindRival: () => void; onRetry?: () => void;
  onOpenProfile?: () => void; onExploreTournaments?: () => void;
  competitionEvidence?: CareerCompetitionEvidence;
};
export function CareerHub(props: CareerHubProps) {
  const [detail,setDetail]=useState<CareerIndexDetail>(null);
  useEffect(()=>{const read=()=>{const value=new URLSearchParams(location.search).get("careerDetail");setDetail(value==="index"||value==="attest"?value:null);};read();window.addEventListener("popstate",read);return()=>window.removeEventListener("popstate",read);},[]);
  function openDetail(value:CareerIndexDetail){setDetail(value);const url=new URL(location.href);if(value)url.searchParams.set("careerDetail",value);else url.searchParams.delete("careerDetail");window.history.pushState({...window.history.state,backyardTab:"career"},"",url);window.scrollTo({top:0});}
  const opened=useRef(""),viewed=useRef("");
  useEffect(()=>{
    if(!props.accessToken)return;
    if(opened.current!==props.userId){opened.current=props.userId;recordCareerEvent("career_opened","career",props.accessToken);}
    const key=`${props.userId}:${props.view}`;
    if(viewed.current!==key){viewed.current=key;recordCareerEvent("career_tab_viewed",props.view,props.accessToken);}
  },[props.userId,props.view,props.accessToken]);
  const data={...props,onOpenRound:(id:string)=>{recordCareerEvent("round_opened",props.view,props.accessToken);props.onOpenRound(id);}};
  return <section className={styles.screen} aria-label="Carrera">{!detail&&<CareerHeader />}<CareerIndexPanel props={data} detail={detail} onDetail={openDetail}/>{!detail&&<><CareerTabs view={props.view} onView={props.onView} /><div className={styles.content} key={props.view}>
    {props.view === "tournaments" ? <CareerTournaments {...data} /> : !props.ready && !props.error ? <CareerSkeleton /> : props.view === "summary" ? <CareerOverview {...data} /> : props.error ? <CareerErrorState onRetry={props.onRetry} /> : props.view === "achievements" ? <CareerAchievements {...data} /> : props.view === "rivalries" ? <CareerRivalries {...data} /> : <CareerRounds {...data} />}
  </div></>}</section>;
}

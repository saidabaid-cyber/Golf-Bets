"use client";
import dynamic from "next/dynamic";
import { useEffect,useLayoutEffect,useRef,useState } from "react";
import { CareerIndexPanel,type CareerIndexDetail } from "./career-index-panel";
import { recordCareerEvent } from "../../features/analytics/career";
import type { GolfInsights } from "../../lib/golf-insights";
import type { RoundSnapshot } from "../../lib/types";
import type { SelectedHandicapIndex } from "../../lib/handicap-source";
import { CAREER_TABS, type CareerView } from "../../lib/career-navigation";
import type { GhinReadOnlyProfileController } from "./use-ghin-read-only-profile";
import type { CareerCompetitionEvidence } from "../../lib/round-achievements";
import type { PendingRoundRecovery } from "../../lib/pending-round-recovery";
import { CareerTabs, CareerSkeleton, CareerErrorState } from "./career-shared";
import { useViewScrollReset } from "./use-view-scroll-reset";
import styles from "./career-hub.module.css";
const CareerOverview = dynamic(() => import("./career-overview").then(m => m.CareerOverview), { loading: CareerSkeleton });
const CareerAchievements = dynamic(() => import("./career-achievements").then(m => m.CareerAchievements), { loading: CareerSkeleton });
const CareerRivalries = dynamic(() => import("./career-rivalries").then(m => m.CareerRivalries), { loading: CareerSkeleton });
const CareerRounds = dynamic(() => import("./career-rounds").then(m => m.CareerRounds), { loading: CareerSkeleton });
const CareerTournaments = dynamic(() => import("./career-tournaments").then(m => m.CareerTournaments), { loading: CareerSkeleton });
export type CareerHubProps = {
  displayName: string; avatarUrl?: string | null; userId: string; index: SelectedHandicapIndex;
  username?: string | null; club?: string | null; city?: string | null; accessToken?: string | null;
  ghin?: Pick<GhinReadOnlyProfileController,"profile"|"enabled"> & Partial<Pick<GhinReadOnlyProfileController,"ready"|"error"|"scores"|"scoresLoading"|"reauthorizationRequired"|"loadScores"|"imports">>;
  insights: GolfInsights; rounds: RoundSnapshot[]; history?: RoundSnapshot[]; ready: boolean; error?: boolean;
  view: CareerView; onView: (view: CareerView) => void;
  detail: CareerIndexDetail; onDetail: (detail: CareerIndexDetail) => void;
  onOpenStats: () => void; onOpenHistory: () => void; onOpenRound: (id: string) => void;
  onCreateRound: () => void; onFindRival: () => void; onRetry?: () => void;
  onOpenProfile?: () => void; onExploreTournaments?: () => void;
  competitionEvidence?: CareerCompetitionEvidence;
  activeRoundId?: string; onResumeRound?: (row: PendingRoundRecovery) => void;
};
export function CareerHub(props: CareerHubProps) {
  const root=useRef<HTMLElement>(null);
  const selectedDetail=props.view==="summary"?props.detail:null;
  useViewScrollReset(`${props.view}:${selectedDetail??"section"}`);
  // Preserve filters and loaded data only after a section has actually been visited.
  const [visited,setVisited]=useState<{owner:string;views:CareerView[]}>({owner:props.userId,views:[props.view]});
  const views=visited.owner===props.userId?visited.views:[props.view];
  useEffect(()=>setVisited(previous=>previous.owner===props.userId&&previous.views.includes(props.view)?previous:{owner:props.userId,views:previous.owner===props.userId?[...previous.views,props.view]:[props.view]}),[props.userId,props.view]);
  useLayoutEffect(()=>{
    const screen=root.current,header=screen?.closest(".careerModule")?.querySelector<HTMLElement>(".primaryHeader");
    if(!screen||!header)return;
    const measure=()=>screen.style.setProperty("--career-header-height",`${header.getBoundingClientRect().height}px`);
    measure();
    const observer=new ResizeObserver(measure);observer.observe(header);return()=>observer.disconnect();
  },[]);
  function selectView(view:CareerView){props.onView(view);}
  const opened=useRef(""),viewed=useRef("");
  useEffect(()=>{
    if(!props.accessToken)return;
    if(opened.current!==props.userId){opened.current=props.userId;recordCareerEvent("career_opened","career",props.accessToken);}
    const key=`${props.userId}:${props.view}`;
    if(viewed.current!==key){viewed.current=key;recordCareerEvent("career_tab_viewed",props.view,props.accessToken);}
  },[props.userId,props.view,props.accessToken]);
  const data={...props,onOpenRound:(id:string)=>{recordCareerEvent("round_opened",props.view,props.accessToken);props.onOpenRound(id);}};
  return <section ref={root} className={styles.screen} aria-label="Carrera"><CareerTabs view={props.view} onView={selectView}/>
    {CAREER_TABS.filter(tab=>views.includes(tab.id)||tab.id===props.view).map(tab=><div key={`${props.userId}:${tab.id}`} className={styles.content} role="tabpanel" id={`career-panel-${tab.id}`} aria-labelledby={`career-tab-${tab.id}`} hidden={props.view!==tab.id} tabIndex={0}>
      {tab.id==="summary"?<><CareerIndexPanel props={data} detail={selectedDetail} onDetail={props.onDetail}/><div className={styles.content} hidden={!!selectedDetail}>{!props.ready&&!props.error?<CareerSkeleton/>:<CareerOverview {...data}/>}</div></>:tab.id==="tournaments"?<CareerTournaments {...data}/>:!props.ready&&!props.error?<CareerSkeleton/>:props.error?<CareerErrorState onRetry={props.onRetry}/>:tab.id==="achievements"?<CareerAchievements {...data}/>:tab.id==="rivalries"?<CareerRivalries {...data}/>:<CareerRounds {...data}/>}
    </div>)}
  </section>;
}

"use client";
import dynamic from "next/dynamic";
import type { GolfInsights } from "../../lib/golf-insights";
import type { RoundSnapshot } from "../../lib/types";
import type { SelectedHandicapIndex } from "../../lib/handicap-source";
import type { CareerView } from "../../lib/career-navigation";
import type { GhinProfileProjection } from "../../lib/ghin/profile";
import type { CareerCompetitionEvidence } from "../../lib/round-achievements";
import { CareerHeader, CareerTabs, CareerEmptyState, CareerSkeleton, CareerErrorState } from "./career-shared";
import styles from "./career-hub.module.css";
const CareerOverview = dynamic(() => import("./career-overview").then(m => m.CareerOverview), { loading: CareerSkeleton });
const CareerAchievements = dynamic(() => import("./career-achievements").then(m => m.CareerAchievements), { loading: CareerSkeleton });
const CareerRivalries = dynamic(() => import("./career-rivalries").then(m => m.CareerRivalries), { loading: CareerSkeleton });
export type CareerHubProps = {
  displayName: string; avatarUrl?: string | null; userId: string; index: SelectedHandicapIndex;
  username?: string | null; club?: string | null; city?: string | null; accessToken?: string | null;
  ghin?: { profile: GhinProfileProjection | null; enabled: boolean; error?: string | null };
  insights: GolfInsights; rounds: RoundSnapshot[]; history?: RoundSnapshot[]; ready: boolean; error?: boolean;
  view: CareerView; onView: (view: CareerView) => void;
  onOpenStats: () => void; onOpenHistory: () => void; onOpenRound: (id: string) => void;
  onCreateRound: () => void; onFindRival: () => void; onRetry?: () => void;
  onOpenProfile?: () => void; onExploreTournaments?: () => void;
  competitionEvidence?: CareerCompetitionEvidence;
};
export function CareerHub(props: CareerHubProps) {
  return <section className={styles.screen} aria-label="Carrera"><CareerHeader /><CareerTabs view={props.view} onView={props.onView} /><div className={styles.content} key={props.view}>
    {!props.ready && !props.error ? <CareerSkeleton /> : props.view === "summary" ? <CareerOverview {...props} /> : props.error ? <CareerErrorState onRetry={props.onRetry} /> : props.view === "achievements" ? <CareerAchievements {...props} /> : props.view === "rivalries" ? <CareerRivalries {...props} /> : <CareerEmptyState title={props.view === "rounds" ? "Tu historia empieza con tu primera ronda." : "Todavía no tienes torneos registrados."} action="Crear ronda" onAction={props.onCreateRound} />}
  </div></section>;
}

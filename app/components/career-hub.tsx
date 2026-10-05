"use client";
import type { GolfInsights } from "../../lib/golf-insights";
import type { RoundSnapshot } from "../../lib/types";
import type { SelectedHandicapIndex } from "../../lib/handicap-source";
import type { CareerView } from "../../lib/career-navigation";
import { CareerHeader, CareerTabs, CareerEmptyState, CareerSkeleton, CareerErrorState } from "./career-shared";
import styles from "./career-hub.module.css";
export type CareerHubProps = {
  displayName: string; avatarUrl?: string | null; userId: string; index: SelectedHandicapIndex;
  insights: GolfInsights; rounds: RoundSnapshot[]; history?: RoundSnapshot[]; ready: boolean; error?: boolean;
  view: CareerView; onView: (view: CareerView) => void;
  onOpenStats: () => void; onOpenHistory: () => void; onOpenRound: (id: string) => void;
  onCreateRound: () => void; onFindRival: () => void; onRetry?: () => void;
};
export function CareerHub(props: CareerHubProps) {
  return <section className={styles.screen} aria-label="Carrera"><CareerHeader /><CareerTabs view={props.view} onView={props.onView} /><div className={styles.content} key={props.view}>
    {props.error ? <CareerErrorState onRetry={props.onRetry} /> : !props.ready ? <CareerSkeleton /> : <CareerEmptyState title={props.view === "summary" || props.view === "rounds" ? "Tu historia empieza con tu primera ronda." : props.view === "achievements" ? "Tus primeros logros aparecerán conforme juegues." : props.view === "rivalries" ? "Juega con amigos para empezar a construir tus rivalidades." : "Todavía no tienes torneos registrados."} action={props.view === "rivalries" ? "Encuentra un rival" : "Crear ronda"} onAction={props.view === "rivalries" ? props.onFindRival : props.onCreateRound} />}
  </div></section>;
}

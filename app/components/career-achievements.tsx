"use client";
import { useMemo, useState,useRef } from "react";
import { deriveCareerAchievements, rankFameEntries, type CareerAchievement, type FameEntry } from "../../lib/round-achievements";
import { careerNumber, careerDate } from "../../lib/career-statistics";
import type { CareerHubProps } from "./career-hub";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { CareerPanel, CareerEmptyState, CareerCta } from "./career-shared";
import styles from "./career-hub.module.css";
import { deriveCareerRivalries, rivalryCompetitionEvidence } from "../../lib/career-rivalries";
import { useCareerTournaments } from "./use-career-tournaments";
import { recordCareerEvent } from "../../features/analytics/career";

export function AchievementBadge({ icon, locked = false }: { icon: CareerAchievement["icon"]; locked?: boolean }) {
  return <span className={`${styles.achievementBadge} ${locked ? styles.lockedBadge : ""}`} aria-hidden="true"><svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icon === "trophy" ? <><path d="M15 10h18v10a9 9 0 0 1-18 0zM24 29v8M17 39h14M15 13H8v5a8 8 0 0 0 9 8M33 13h7v5a8 8 0 0 1-9 8" /></> : icon === "flag" ? <path d="M15 40V8l20 5-20 8" /> : icon === "bars" ? <><path d="M10 34V26h5v8zM22 34V18h5v16zM34 34V10h5v24z" /></> : icon === "star" ? <path d="m24 7 5 11 12 2-9 8 2 12-10-6-10 6 2-12-9-8 12-2z" /> : icon === "flame" ? <path d="M25 6c3 14 14 14 12 25-3 15-25 15-26 0-1-8 6-11 7-18 2 7 1 9 5 12 5-6 5-11 2-19z" /> : icon === "ace" ? <><circle cx="24" cy="22" r="11" /><path d="M13 39h22M24 33v6M20 23l4-8 4 8M21 21h6" /></> : <path d="M8 27c9 0 13-4 16-14 5 3 7 8 6 12l10-2-9 7c-6 11-17 10-23-3z" />}</svg></span>;
}
const stateLabel = (achievement: CareerAchievement) => achievement.status === "unlocked" ? "Desbloqueado" : achievement.status === "in_progress" ? "En progreso" : "Por desbloquear";
export function AchievementProgressCard({ achievement, onOpen }: { achievement: CareerAchievement; onOpen: (slug: string) => void }) {
  const a = achievement;
  return <button type="button" className={styles.achievementCard} onClick={() => onOpen(a.slug)} aria-label={`Ver logro ${a.name}`}><AchievementBadge icon={a.icon} locked={a.status === "locked"} /><span className={styles.achievementBody}><strong>{a.name}</strong><small>{stateLabel(a)}</small><span>{a.value === null ? "Sin datos suficientes" : a.criterion === "best18" ? `${a.value} golpes · meta ≤${a.threshold}` : `${careerNumber(a.value)} / ${a.threshold}`}</span><span className={styles.progressTrack} role="progressbar" aria-label={`Progreso de ${a.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.progress)}><i style={{ width: `${a.progress}%` }} /></span></span><span className={styles.progressPercent}>{Math.round(a.progress)}%</span></button>;
}
export function FameLeaderboard({ entries = [], onFullRanking }: { entries?: readonly FameEntry[]; onFullRanking?: () => void }) {
  const ranking = useMemo(() => rankFameEntries(entries),[entries]);
  const [expanded,setExpanded] = useState(false), leader = ranking[0];
  return <CareerPanel title="Salón de la Fama" action={ranking.length ? "Ver ranking completo" : undefined} onAction={onFullRanking ?? (() => setExpanded(true))}><div className={styles.fameLayout}><div className={styles.honorPlate}><span className={styles.laurel} aria-hidden="true">❧</span><AchievementBadge icon="trophy" /><span className={styles.eyebrow}>HONOR AL MÉRITO</span>{leader ? <><strong className={styles.honorRank}>#1</strong><h3>{leader.name}</h3><p>{leader.achievements} logros · líder de la colección</p></> : <><h3>Una historia que merece<br />su lugar.</h3><p>Los grandes momentos se construyen ronda a ronda.</p></>}<span className={styles.laurelEnd} aria-hidden="true">❧</span></div><div>{ranking.length ? <ol className={styles.fameList}>{ranking.slice(0,expanded ? ranking.length : 5).map(entry => <li key={entry.userId}><b>{entry.position}</b><ProfileAvatarMedia value={entry.avatarUrl} fallback={entry.name.slice(0,1)} className={styles.smallAvatar} /><strong>{entry.name}</strong><span>{entry.achievements}<small>logros</small></span></li>)}</ol> : <p className={styles.caption}>La clasificación aparecerá cuando exista un ranking global de logros verificados. Tu colección personal ya cuenta cada avance.</p>}</div></div></CareerPanel>;
}
export function CareerAchievements(props: CareerHubProps) {
  const hero=useRef<HTMLElement>(null);
  const tournaments = useCareerTournaments(props.userId,props.accessToken);
  const achievements = useMemo(() => deriveCareerAchievements(props.rounds,props.userId,props.competitionEvidence ?? { ...rivalryCompetitionEvidence(deriveCareerRivalries(props.rounds,props.userId)),podiums:tournaments.loading||tournaments.error||!tournaments.authenticated ? undefined : tournaments.events.filter(e=>e.resultStatus === "final" && e.position !== null && e.position<=3).map(e=>({id:e.id,date:e.date,courseName:e.courseName})).sort((a,b)=>a.date.localeCompare(b.date)) }),[props.rounds,props.userId,props.competitionEvidence,tournaments.events,tournaments.loading,tournaments.error,tournaments.authenticated]);
  const [selected,setSelected] = useState<string | null>(null), [filter,setFilter] = useState("all");
  const featured = achievements.find(a => a.slug === selected) ?? achievements.find(a => a.status === "unlocked") ?? achievements[0];
  const open=(slug:string)=>{setSelected(slug);recordCareerEvent("achievement_opened",slug,props.accessToken);hero.current?.scrollIntoView({block:"start",behavior:"smooth"});};
  return <><div className={styles.filters}><label>Estado<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todos los logros</option><option value="unlocked">Desbloqueados</option><option value="in_progress">En progreso</option><option value="locked">Por desbloquear</option></select></label><p className={styles.caption}>{achievements.filter(a => a.status === "unlocked").length} de {achievements.length} logros desbloqueados</p></div>
    <section ref={hero} className={styles.achievementHero} aria-label="Logro destacado"><AchievementBadge icon={featured.icon} /><div><span className={styles.eyebrow}>{selected ? "TU COLECCIÓN" : "LOGRO DESTACADO"}</span><h2>{featured.name}</h2><p>{featured.description}</p><small>{stateLabel(featured)} · {Math.round(featured.progress)}%</small>{featured.unlocked_at && <small>{careerDate(featured.unlocked_at)}{featured.courseName ? ` · ${featured.courseName}` : ""}</small>}<div className={styles.milestones} aria-label="Hitos">{featured.milestones.map(m => <span key={m} data-complete={featured.value !== null && (featured.criterion === "best18" ? featured.value <= m : featured.value >= m)}>{m}</span>)}</div>{featured.round_id && <button type="button" onClick={() => props.onOpenRound(featured.round_id!)}>Ver ronda del hito ›</button>}</div></section>
    {!achievements.some(a => a.value !== null && a.value > 0) && <CareerEmptyState title="Tus primeros logros aparecerán conforme juegues." />}
    <CareerPanel title="Tu colección"><div className={styles.achievementGrid}>{achievements.filter(a => filter === "all" || a.status === filter).map(a => <AchievementProgressCard key={a.id} achievement={a} onOpen={open} />)}</div></CareerPanel>
    <FameLeaderboard /><CareerCta title="Cada logro acerca una gran historia." label="Seguir jugando" onAction={props.onCreateRound} /></>;
}

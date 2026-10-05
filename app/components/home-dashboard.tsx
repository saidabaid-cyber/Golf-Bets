"use client";

import { useEffect, useState } from "react";
import { FriendsHub, type FriendsView } from "./social-connections-panel";
import { homeSocialHref, homeSocialViewFromSearch, type HomeSocialView } from "../../lib/home-social-navigation";
import { CloudSocialActivity } from "./cloud-social-activity";
import styles from "./home-dashboard-clean.module.css";

export type ActiveRoundSummary = {
  courseName: string; roundDate: string; startedAt?: string;
  status: "setup" | "live" | "review"; totalHoles: 9 | 18;
  currentHole?: number; playedHoles?: number; playerCount: number;
  partialGross?: number; partialToPar?: number;
};

export type HomeDashboardProps = {
  displayName: string; avatarUrl?: string | null; identityUserId: string; accessToken?: string;
  onOpenRounds: () => void; onOpenFriends: () => void; onPrivacy: () => void;
  onOpenAchievements: () => void;
  onOpenSocialProfile?: (userId:string) => void;
  friendsInitialView?: FriendsView; friendsEntry?: number; targetId?: string | null; onCloseTarget?: () => void; username?: string;
  activeRound?: ActiveRoundSummary | null;
  onContinueRound?: () => void;
};

/** Home composes the existing server-filtered activity feed, never local private snapshots. */
export function HomeDashboard({ displayName, avatarUrl, identityUserId, accessToken, onOpenAchievements, onOpenSocialProfile, friendsInitialView="list", friendsEntry=0, targetId, onCloseTarget, username="", activeRound, onContinueRound }: HomeDashboardProps) {
  const [view, setView] = useState<HomeSocialView>("feed");
  useEffect(() => { const read=()=>setView(homeSocialViewFromSearch(location.search)); read(); window.addEventListener("popstate",read); return ()=>window.removeEventListener("popstate",read); }, []);
  useEffect(() => { if(friendsEntry || targetId) setView(friendsInitialView === "add" || friendsInitialView === "search" ? "add-friends" : "friends"); else setView(homeSocialViewFromSearch(location.search)); }, [friendsEntry,friendsInitialView,targetId]);
  function select(next:HomeSocialView) { setView(next); onCloseTarget?.(); window.history.pushState({...window.history.state,backyardTab:"welcome"},"",homeSocialHref(next,location.search)); window.scrollTo({top:0}); }
  return <section className={styles.home} data-home-version="social-home" aria-label="Inicio social">
    <nav className={styles.selector} aria-label="Secciones de Inicio">{([['feed','Feed'],['friends','Amigos'],['add-friends','Agregar amigos']] as const).map(([id,label])=><button type="button" key={id} aria-current={view===id?"page":undefined} className={id==="add-friends"?styles.addFriends:undefined} onClick={()=>select(id)}>{label}</button>)}</nav>
    {activeRound?.status === "live" && onContinueRound && <button type="button" className={styles.continueRound} onClick={onContinueRound}>
      <span><strong>Continuar ronda</strong><small>{activeRound.courseName} · Hoyo {activeRound.currentHole ?? 1} de {activeRound.totalHoles}</small></span><span aria-hidden="true">›</span>
    </button>}
    {view === "feed" ? <CloudSocialActivity key={identityUserId} viewerId={identityUserId} accessToken={accessToken} viewerName={displayName} viewerAvatarUrl={avatarUrl} friendsOnly onOpenProfile={onOpenSocialProfile} onOpenAchievements={onOpenAchievements} /> : <FriendsHub key={`${identityUserId}:${view}:${friendsEntry}`} ownerId={identityUserId} accessToken={accessToken} name={displayName} username={username} avatar={avatarUrl || ""} embedded initialView={view === "add-friends" ? "add" : friendsInitialView === "requests" ? "requests" : "list"} targetId={targetId} onCloseTarget={onCloseTarget} onViewChange={next=>{if(next==="add"&&view!=="add-friends")select("add-friends");}} />}
  </section>;
}

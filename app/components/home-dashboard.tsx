"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FriendsHub, type FriendsView } from "./social-connections-panel";
import { homeSocialHref, homeSocialViewFromSearch, type HomeSocialView } from "../../lib/home-social-navigation";
import { CloudSocialActivity } from "./cloud-social-activity";
import { BackyardIcon } from "./backyard-icon";
import styles from "./home-dashboard-clean.module.css";
import {SocialPlayerProfile} from './social-player-profile';
import {socialPlayerFromSearch,socialPlayerHref} from '../../lib/social-player-navigation';

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
  onOpenOwnProfile?:()=>void;
  friendsInitialView?: FriendsView; friendsEntry?: number; targetId?: string | null; onCloseTarget?: () => void; username?: string;
  activeRound?: ActiveRoundSummary | null;
  onContinueRound?: () => void;
};

/** Home composes the existing server-filtered activity feed, never local private snapshots. */
export function HomeDashboard({ displayName, avatarUrl, identityUserId, accessToken, onOpenAchievements, onOpenOwnProfile, friendsInitialView="list", friendsEntry=0, targetId, onCloseTarget, username="" }: HomeDashboardProps) {
  const [view, setView] = useState<HomeSocialView>("feed");
  const [profileId,setProfileId]=useState<string|null>(null),positions=useRef(new Map<string,number>()),returning=useRef(false),currentProfile=useRef<string|null>(null);
  useEffect(()=>{const read=()=>{positions.current.set(currentProfile.current??'home',window.scrollY);const id=socialPlayerFromSearch(location.search);currentProfile.current=id;returning.current=true;setProfileId(id);};setProfileId(socialPlayerFromSearch(location.search));currentProfile.current=socialPlayerFromSearch(location.search);window.addEventListener('popstate',read);return()=>window.removeEventListener('popstate',read);},[]);
  useLayoutEffect(()=>{if(returning.current){returning.current=false;window.scrollTo({top:positions.current.get(profileId??'home')??0,behavior:'instant'});}},[profileId]);
  function openPlayer(id:string){if(id===identityUserId&&onOpenOwnProfile){onOpenOwnProfile();return;}positions.current.set(profileId??'home',window.scrollY);window.history.pushState({...window.history.state,backyardSocialPlayer:id},'',socialPlayerHref(location.search,id));currentProfile.current=id;setProfileId(id);window.scrollTo({top:0,behavior:'instant'});}
  function closePlayer(){if(window.history.state?.backyardSocialPlayer===profileId)window.history.back();else{window.history.replaceState(window.history.state,'',socialPlayerHref(location.search,null));returning.current=true;currentProfile.current=null;setProfileId(null);onCloseTarget?.();}}
  useEffect(() => { const read=()=>setView(homeSocialViewFromSearch(location.search)); read(); window.addEventListener("popstate",read); return ()=>window.removeEventListener("popstate",read); }, []);
  useEffect(() => { if(friendsEntry || targetId) setView(friendsInitialView === "add" || friendsInitialView === "search" ? "add-friends" : "friends"); else setView(homeSocialViewFromSearch(location.search)); }, [friendsEntry,friendsInitialView,targetId]);
  function select(next:HomeSocialView) { setView(next); onCloseTarget?.(); window.history.pushState({...window.history.state,backyardTab:"welcome"},"",homeSocialHref(next,location.search)); window.scrollTo({top:0}); }
  return <section className={styles.home} data-home-version="social-home" aria-label="Inicio social">
    <div hidden={Boolean(profileId)}>
    <nav className={styles.selector} aria-label="Secciones de Inicio">{([['feed','Feed'],['friends','Amigos'],['add-friends','Agregar amigos']] as const).map(([id,label])=><button type="button" key={id} aria-current={view===id?"page":undefined} className={id==="add-friends"?styles.addFriends:undefined} onClick={()=>select(id)}>{id==="add-friends"&&<BackyardIcon name="personAdd" size={19}/>}<span>{label}</span></button>)}</nav>
    {view === "feed" ? <CloudSocialActivity key={identityUserId} viewerId={identityUserId} accessToken={accessToken} viewerName={displayName} viewerAvatarUrl={avatarUrl} friendsOnly includeOwn onOpenProfile={openPlayer} onOpenAchievements={onOpenAchievements} /> : <FriendsHub key={`${identityUserId}:${view}:${friendsEntry}`} ownerId={identityUserId} accessToken={accessToken} name={displayName} username={username} avatar={avatarUrl || ""} embedded onOpenProfile={openPlayer} initialView={view === "add-friends" ? "add" : friendsInitialView === "requests" ? "requests" : "list"} targetId={targetId} onCloseTarget={onCloseTarget} onViewChange={next=>{if(next==="add"&&view!=="add-friends")select("add-friends");}} />}
    </div>{profileId&&accessToken&&<SocialPlayerProfile key={profileId} userId={profileId} viewerId={identityUserId} accessToken={accessToken} onBack={closePlayer} onOpenPlayer={openPlayer} onOwnProfile={onOpenOwnProfile}/>}
  </section>;
}

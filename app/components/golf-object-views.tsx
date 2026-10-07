"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { GolfObject, GolfObjectFrame } from "../../lib/golf-object-navigation";
import type { SocialActivityCard } from "../../lib/social-activity-contract";
import type { RoundSnapshot } from "../../lib/types";
import type { GolfCoachContext } from "../../lib/golf-coach-context";
import { GolfObjectDataContext, createGolfActivityReader, useGolfObjectData } from "./golf-object-data";
import { useGolfNavigation } from "./golf-object-navigation";
import { GolfPlayerProfile, GolfEquipmentList, type GolfOwnProfile } from "./golf-player-profile";
import { GolfRoundDetailView, GolfHoleDetailView, GolfCourseDetailView } from "./golf-round-detail";
import { GolfDetailHeader, GolfDetailSkeleton, GolfEmptyState, golfDate } from "./golf-detail-ui";
import { SocialRoundActivityCard } from "./cloud-social-activity";
import { BackyardIcon } from "./backyard-icon";
import Image from "next/image";
import styles from "./golf-object.module.css";
function GolfEventDetail({object}:{object:Extract<GolfObject,{kind:"equipment"|"achievement"|"leaderboard"|"activity"}>}) {
  const context=useGolfObjectData(),navigation=useGolfNavigation(),[card,setCard]=useState<SocialActivityCard|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let live=true;void context.readActivity(object.id).then(result=>{if(live){setCard(result);setError(false);}}).catch(()=>{if(live)setError(true);});return()=>{live=false;};},[context,object.id,attempt]);
  const item=card?.equipment?.items.find(i=>i.id===object.item), achievement=card?.achievements.find(label=>label===object.item);
  const title=object.kind==="equipment"?object.item?"Equipo":"Mi bolsa de golf":object.kind==="achievement"?"Logro":object.kind==="leaderboard"?"Resultados de la ronda":"Actividad";
  if(object.kind==="activity"&&card?.round)return <GolfRoundDetailView object={{kind:"round",id:card.id,source:"activity"}} onStats={()=>navigation?.open({kind:"statistics",id:"mine"})} onManage={()=>{}} onRules={()=>navigation?.open({kind:"rules",id:"mine"})}/>;
  return <section className={styles.screen}><GolfDetailHeader title={title}/>{error?<GolfEmptyState title="No pudimos cargar esta actividad" copy="Puedes volver a intentarlo." retry={()=>{context.invalidateActivity(object.id);setAttempt(n=>n+1);}}/>:!card?<GolfDetailSkeleton/>:<>
    <button type="button" className={styles.playerLink} onClick={()=>navigation?.open({kind:"player",id:card.author.userId})}>{card.author.displayName} ›</button>
    {object.kind==="equipment"&&(object.item?item?<div className={styles.equipmentHero}>{item.imageUrl?<Image src={item.imageUrl} alt={`${item.brand} ${item.model}`} width={160} height={160}/>:<BackyardIcon name={item.category==="Bola"?"ball":"club"} size={72}/>}<p>{item.category}</p><h2>{item.brand} {item.model}</h2><p>Equipo compartido por {card.author.displayName}</p></div>:<GolfEmptyState title="Equipo no disponible" copy="Este elemento ya no forma parte de la actividad compartida."/>:<GolfEquipmentList card={card}/>)}
    {object.kind==="achievement"&&(achievement?<><div className={styles.achievementHero}><BackyardIcon name="trophy" size={54}/><h2>{achievement}</h2><p>{golfDate(card.createdAt)}</p></div>{card.round&&<button type="button" className={styles.textAction} onClick={()=>navigation?.open({kind:"round",id:card.id,source:"activity"})}>Ver la ronda de este logro ›</button>}</>:<GolfEmptyState title="Logro no disponible" copy="No hay un logro compartido que corresponda a esta vista."/>)}
    {object.kind==="leaderboard"&&(card.round?.leaderboard?.length?<ol className={styles.ranking}>{card.round.leaderboard.map((p,i)=><li key={p.userId}><button type="button" onClick={()=>navigation?.open({kind:"player",id:p.userId})}><span>{i+1}</span><b>{p.name}</b><strong>{p.score}</strong><BackyardIcon name="chevron" size={17}/></button></li>)}</ol>:<GolfEmptyState title="Sin resultados compartidos" copy="Solo se muestran jugadores con tarjetas autorizadas."/>)}
    {context.accessToken&&<SocialRoundActivityCard card={card} viewerId={context.viewerId} accessToken={context.accessToken} actionsOnly={object.kind!=="activity"} onRefresh={async()=>{context.invalidateActivity(card.id);const updated=await context.readActivity(card.id);setCard(updated);}}/>}
  </>}</section>;
}
export function GolfObjectViews({frames,viewerId,accessToken,history,ownProfile,onEditProfile,onStats,onManageRound,onRules,statistics,analysis,coach,rules}:{frames:GolfObjectFrame[];viewerId:string;accessToken?:string;history:RoundSnapshot[];ownProfile:GolfOwnProfile;onEditProfile:()=>void;onStats:()=>void;onManageRound:(id:string)=>void;onRules:()=>void;statistics:ReactNode;analysis:ReactNode;coach:(context:GolfCoachContext)=>ReactNode;rules:ReactNode}) {
  const reader=useMemo(()=>createGolfActivityReader(accessToken),[accessToken]);
  const data=useMemo(()=>({viewerId,accessToken,history,...reader}),[viewerId,accessToken,history,reader]);
  return <GolfObjectDataContext.Provider value={data}>{frames.map((frame,i)=>{const object=frame.object,active=i===frames.length-1;return <div key={`${viewerId}:${frame.key}`} hidden={!active} data-golf-object-active={active?"true":undefined}>
    {object.kind==="player"?<GolfPlayerProfile userId={object.id} ownProfile={ownProfile} onEdit={onEditProfile}/>:object.kind==="round"?<GolfRoundDetailView object={object} onStats={onStats} onManage={onManageRound} onRules={onRules}/>:object.kind==="hole"?<GolfHoleDetailView object={object} onRules={onRules}/>:object.kind==="course"?<GolfCourseDetailView object={object}/>:object.kind==="statistics"?statistics:object.kind==="analysis"?<><GolfDetailHeader title="Análisis de mi juego"/>{analysis}</>:object.kind==="rules"?rules:object.kind==="coach"?<><GolfDetailHeader title="My Coach"/>{coach(object.context)}</>:<GolfEventDetail object={object}/>}
  </div>;})}</GolfObjectDataContext.Provider>;
}

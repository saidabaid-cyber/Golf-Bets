"use client";
import { useEffect, useRef, useState } from "react";
import type { SocialActivityCard, SocialActivityPage } from "../../lib/social-activity-contract";
import { connectionState, type ConnectionPage, type SocialPerson } from "../../lib/social-connections";
import { socialRequest } from "../../lib/social-activity-client";
import { againstPar } from "../../lib/golf-scorecard-presentation";
import { useGolfObjectData } from "./golf-object-data";
import { useGolfNavigation } from "./golf-object-navigation";
import { GolfDetailHeader, GolfDetailSkeleton, GolfEmptyState, golfDate } from "./golf-detail-ui";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { SocialRoundActivityCard } from "./cloud-social-activity";
import { BackyardIcon } from "./backyard-icon";
import Image from "next/image";
import styles from "./golf-object.module.css";
export type GolfOwnProfile = SocialPerson & { club_name?: string | null; city?: string | null; index?: { value: number | null; label: string } };
export function GolfEquipmentList({ card }: { card: SocialActivityCard }) {
  const navigation=useGolfNavigation();
  return card.equipment?.items.length ? <div className={styles.equipmentList}>{card.equipment.items.map(item=><button type="button" key={item.id} onClick={()=>navigation?.open({kind:"equipment",id:card.id,item:item.id})}><span className={styles.equipmentImage}>{item.imageUrl?<Image src={item.imageUrl} alt="" width={49} height={49}/>:<BackyardIcon name={item.category==="Bola"?"ball":"club"} size={30}/>}</span><span><small>{item.category}</small><b>{item.brand} {item.model}</b></span><BackyardIcon name="chevron" size={18}/></button>)}</div> : <GolfEmptyState title="Sin equipo compartido" copy="La bolsa aparecerá aquí cuando el jugador elija compartirla."/>;
}
export function GolfPlayerProfile({ userId, ownProfile, onEdit }: { userId: string; ownProfile: GolfOwnProfile; onEdit: () => void }) {
  const {viewerId,accessToken}=useGolfObjectData(), navigation=useGolfNavigation();
  const [person,setPerson]=useState<GolfOwnProfile|null>(userId===viewerId?ownProfile:null), [graph,setGraph]=useState<ConnectionPage|null>(null), [cards,setCards]=useState<SocialActivityCard[]>([]), [cursor,setCursor]=useState<string|null>(null);
  const [view,setView]=useState("activity"),[loading,setLoading]=useState(true),[error,setError]=useState(false),[activityError,setActivityError]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[attempt,setAttempt]=useState(0);
  const live=useRef(true), writing=useRef(false), ownIdentity=useRef(ownProfile);
  useEffect(()=>{ownIdentity.current=ownProfile;if(userId===viewerId)setPerson(ownProfile);},[ownProfile,userId,viewerId]);
  useEffect(()=>{
    live.current=true;const controller=new AbortController();setLoading(true);setError(false);setActivityError(false);
    if(!accessToken){setLoading(false);return;}
    void Promise.allSettled([
      userId===viewerId?Promise.resolve({person:ownIdentity.current}):socialRequest<{person:GolfOwnProfile}>(`/api/social/connections?target=${encodeURIComponent(userId)}`,accessToken,{signal:controller.signal}),
      socialRequest<ConnectionPage>("/api/social/connections",accessToken,{signal:controller.signal}),
      socialRequest<SocialActivityPage>(`/api/social/activity?authorId=${encodeURIComponent(userId)}`,accessToken,{signal:controller.signal}),
    ]).then(([identity,connections,activity])=>{
      if(controller.signal.aborted)return;
      if(identity.status==="fulfilled")setPerson(identity.value.person);else setError(true);
      if(connections.status==="fulfilled")setGraph(connections.value);
      if(activity.status==="fulfilled"){setCards(activity.value.data);setCursor(activity.value.nextCursor);}else setActivityError(true);
      setLoading(false);
    });
    return()=>{live.current=false;controller.abort();};
  },[userId,viewerId,accessToken,attempt]);
  async function change(action: "request"|"ACCEPTED"|"REJECTED"|"CANCELLED") {
    if(!accessToken || !graph || writing.current)return;writing.current=true;setBusy(true);setNotice("");
    const request=graph.requests.find(r=>r.state==="PENDING"&&(r.requester_id===userId||r.addressee_id===userId));
    try{const result=await socialRequest<ConnectionPage>("/api/social/connections",accessToken,{method:"POST",body:{action,...(action==="request"?{target:userId,operationId:crypto.randomUUID()}:{id:request?.id})}});if(live.current){setGraph(result);window.dispatchEvent(new Event("backyard:notifications-changed"));}}
    catch{if(live.current)setNotice("No pudimos guardar la conexión. Reintenta.");}finally{writing.current=false;if(live.current)setBusy(false);}
  }
  async function more() {
    if(!accessToken||!cursor||writing.current)return;writing.current=true;setBusy(true);
    try{const page=await socialRequest<SocialActivityPage>(`/api/social/activity?authorId=${encodeURIComponent(userId)}&cursor=${encodeURIComponent(cursor)}`,accessToken);if(live.current){setCards(current=>[...new Map([...current,...page.data].map(c=>[c.id,c])).values()]);setCursor(page.nextCursor);}}
    catch{if(live.current)setNotice("No pudimos cargar más actividad. Reintenta.");}finally{writing.current=false;if(live.current)setBusy(false);}
  }
  const state=graph?connectionState(graph,viewerId,userId):null,rounds=cards.filter(c=>c.round), achievements=cards.flatMap(card=>card.achievements.map(label=>({card,label}))), equipment=cards.find(c=>c.type==="EQUIPMENT_UPDATED"&&c.equipment?.items.length);
  const courses=[...new Set(rounds.map(c=>c.round!.courseName))].filter(name=>name!=="Campo privado");
  return <section className={styles.screen}><GolfDetailHeader title={userId===viewerId?"Mi perfil":"Jugador"} action={userId===viewerId?<button type="button" aria-label="Editar mi perfil" onClick={onEdit}><BackyardIcon name="more" size={22}/></button>:undefined}/>
    {loading?<GolfDetailSkeleton profile/>:error||!person?<GolfEmptyState title="Perfil no disponible" copy="Este perfil puede ser privado o haber cambiado su disponibilidad." retry={()=>setAttempt(n=>n+1)}/>:<>
      <div className={styles.profileCover}>GOLF MORE TOGETHER</div><section className={styles.profileIdentity}><span className={styles.profileAvatar}><ProfileAvatarMedia value={person.avatar_url} fallback={person.display_name[0]||"G"}/></span>{person.index&&<div className={styles.profileIndex}><span>Índice</span><b>{person.index.value===null?"—":person.index.value.toFixed(1)}</b><small>{person.index.label}</small></div>}<h2>{person.display_name}</h2>{person.username&&<p className={styles.username}>@{person.username}</p>}{(person.city||person.club_name)&&<p className={styles.profileClub}><BackyardIcon name="flag" size={15}/>{person.city || person.club_name}</p>}<div className={styles.relationship}>{state==="NONE"?<button type="button" className={styles.primary} disabled={busy} onClick={()=>void change("request")}>Agregar amigo</button>:state==="INCOMING"?<><button type="button" className={styles.primary} disabled={busy} onClick={()=>void change("ACCEPTED")}>Aceptar</button><button type="button" className={styles.secondary} disabled={busy} onClick={()=>void change("REJECTED")}>Ignorar</button></>:state==="PENDING"?<><span>Solicitud pendiente</span><button type="button" className={styles.secondary} disabled={busy} onClick={()=>void change("CANCELLED")}>Cancelar</button></>:state==="FRIEND"?<span><BackyardIcon name="players" size={18}/>Amigos</span>:null}</div></section>
      <nav className={`${styles.tabs} ${styles.tabsFive}`} aria-label="Secciones del jugador">{[['activity','Actividad'],['rounds','Rondas'],['achievements','Logros'],['courses','Campos'],['equipment','Equipo']].map(([id,label])=><button type="button" key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</button>)}</nav>
      {activityError?<GolfEmptyState title="No pudimos cargar su actividad" copy="Puedes reintentar sin perder este perfil." retry={()=>setAttempt(n=>n+1)}/>:<>
        {view==="activity"&&(cards.length?cards.map(card=><SocialRoundActivityCard key={card.id} card={card} viewerId={viewerId} accessToken={accessToken!} onRefresh={async()=>{const result=await socialRequest<{data:SocialActivityCard}>(`/api/social/activity/${card.id}`,accessToken!);if(live.current)setCards(current=>current.map(c=>c.id===card.id?result.data:c));}}/>):<GolfEmptyState title="Cada ronda cuenta una historia" copy="La actividad que este jugador comparta aparecerá aquí."/>)}
        {view==="rounds"&&(rounds.length?<ul className={styles.roundList}>{rounds.map(card=><li key={card.id}><button type="button" onClick={()=>navigation?.open({kind:"round",id:card.id,source:"activity"})}><span><b>{card.round!.courseName}</b><small>{golfDate(card.round!.date)} · {card.round!.holesPlayed} hoyos</small></span><strong>{card.round!.ownerScore??"—"}{card.round!.toPar!==undefined&&<small>{againstPar(card.round!.toPar!)}</small>}</strong><BackyardIcon name="chevron" size={18}/></button></li>)}</ul>:<GolfEmptyState title="Sin rondas compartidas" copy="Sus tarjetas aparecerán aquí cuando estén disponibles para ti."/>)}
        {view==="achievements"&&(achievements.length?<div className={styles.achievementList}>{achievements.map(({card,label},i)=><button type="button" key={`${card.id}:${i}`} onClick={()=>navigation?.open({kind:"achievement",id:card.id,item:label})}><BackyardIcon name="trophy" size={25}/><b>{label}</b><small>{golfDate(card.createdAt)}</small></button>)}</div>:<GolfEmptyState title="Logros por compartir" copy="Aquí encontrarás los hitos reales que el jugador comparta."/>)}
        {view==="courses"&&(courses.length?<ul className={styles.roundList}>{courses.map(name=>{const played=rounds.filter(c=>c.round!.courseName===name),first=played[0],scores=played.filter(c=>c.round!.holesPlayed===first.round!.holesPlayed).map(c=>c.round!.ownerScore).filter((s):s is number=>s!==null);return <li key={name}><button type="button" onClick={()=>navigation?.open({kind:"course",id:first.id,source:"activity"})}><span><b>{name}</b><small>{played.length} {played.length===1?"ronda compartida":"rondas compartidas"} · {golfDate(first.round!.date)}</small></span>{scores.length>0&&<strong>{Math.min(...scores)}<small>Mejor · {first.round!.holesPlayed} H</small></strong>}<BackyardIcon name="chevron" size={18}/></button></li>;})}</ul>:<GolfEmptyState title="Campos por descubrir" copy="Se muestran únicamente los campos que el jugador permite compartir."/>)}
        {view==="equipment"&&(equipment?<GolfEquipmentList card={equipment}/>:<GolfEmptyState title="Sin equipo compartido" copy="La bolsa del jugador aparecerá cuando la comparta con su comunidad."/>)}
        {cursor&&<button type="button" className={styles.textAction} disabled={busy} onClick={()=>void more()}>{busy?"Cargando…":"Ver más actividad"}</button>}
      </>}
    </>}{notice&&<p className={styles.caption} role="status">{notice}</p>}
  </section>;
}

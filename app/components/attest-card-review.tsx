"use client";
import {useRef,useState} from 'react';
import type {SocialActivityCard} from '../../lib/social-activity-contract';
import {socialRequest,socialErrorMessage} from '../../lib/social-activity-client';
import {socialScorecardDestination} from './cloud-social-activity';
import {ScorecardNavigationBoundary} from './scorecard-boundary';
import styles from './cloud-social-activity.module.css';
export function AttestCardReview({card,viewerId,accessToken,expectedHash,onRefresh,onBack}:{card:SocialActivityCard;viewerId:string;accessToken:string;expectedHash?:string;onRefresh:()=>Promise<void>;onBack:()=>void}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const lock=useRef(false);
  const stale=expectedHash!==undefined&&expectedHash!==card.currentHash;
  async function act(confirmParticipation:boolean){if(lock.current)return;
    if(!window.confirm(confirmParticipation?'¿Confirmas que participaste en esta ronda con tu cuenta? Esto no atesta la tarjeta.':'¿Confirmas que participaste en esta ronda y que esta tarjeta corresponde a los resultados registrados?'))return;
    lock.current=true;setBusy(true);setMessage('');try{await socialRequest(`/api/social/rounds/${encodeURIComponent(card.roundId!)}/${confirmParticipation?'links':'attest'}`,accessToken,{method:'POST',body:{expectedVersion:card.sourceVersion,expectedHash:card.currentHash,...(confirmParticipation?{playerKey:card.participantPlayerKey}:{targetUserId:card.targetUserId})}});await onRefresh();setMessage(confirmParticipation?'Participación confirmada. Ya puedes atestar la tarjeta.':'✓ Atestada para esta versión de la tarjeta.');}catch(e){setMessage(socialErrorMessage(e));}finally{lock.current=false;setBusy(false);}}
  const actions=<div className={styles.attestReview} aria-label="Revisión de solicitud Atest">{stale?<p>Solicitud desactualizada: la tarjeta cambió. Solicita al autor una nueva invitación antes de confirmar.</p>:card.author.userId===viewerId?<p>Tu propia tarjeta no se puede autoatestar.</p>:card.isAttestedByMe?<p>✓ Atestada por ti</p>:card.requiresParticipantConfirmation&&card.participantPlayerKey?<button type="button" className={styles.attestButton} disabled={busy} onClick={()=>void act(true)}>Confirmar mi participación</button>:card.canAttest?<button type="button" className={styles.attestButton} disabled={busy} onClick={()=>void act(false)}>Confirmar Atest</button>:<p>No tienes una participación autorizada para atestar esta tarjeta.</p>}{message&&<p role="status">{message}</p>}</div>;
  return <ScorecardNavigationBoundary destination={socialScorecardDestination(card)} originLabel="Notificaciones" initialOpen onReturn={onBack} navigation={actions}>{()=>null}</ScorecardNavigationBoundary>;
}

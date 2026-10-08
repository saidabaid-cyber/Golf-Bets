"use client";
import { useEffect,useRef,useState } from 'react';
import type { SocialActivityCard } from '../../lib/social-activity-contract';
import { attestCompanionLabel,canRequestAttest,type AttestRoster } from '../../lib/attest-requests';
import { socialRequest,socialErrorMessage } from '../../lib/social-activity-client';
import { useModalDialog } from './use-modal-dialog';
import { ProfileAvatarMedia } from './profile-avatar-media';
import { notificationsChanged } from '../../features/notifications/client';
import styles from './attest-request-dialog.module.css';
export function AttestRequestDialog({card,accessToken,onClose,onSent}:{card:SocialActivityCard;accessToken:string;onClose:()=>void;onSent:(pending:number)=>void}) {
  const [roster,setRoster]=useState<AttestRoster|null>(null),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[sent,setSent]=useState(false);
  const lock=useRef(false),alive=useRef(true); const dialog=useModalDialog(true,()=>{if(!lock.current)onClose();});
  const path=`/api/social/activity/${encodeURIComponent(card.id)}/attest-requests`;
  useEffect(()=>{alive.current=true;const controller=new AbortController();void socialRequest<AttestRoster>(path,accessToken,{signal:controller.signal}).then(r=>{if(!controller.signal.aborted)setRoster(r);}).catch(e=>{if(!controller.signal.aborted)setMessage(socialErrorMessage(e));});return()=>{alive.current=false;controller.abort();};},[path,accessToken]);
  async function send(){
    if(lock.current||!roster||!selected.length)return;lock.current=true;setBusy(true);setMessage('');
    try {const result=await socialRequest<{data:unknown[];roster:AttestRoster}>(path,accessToken,{method:'POST',body:{expectedHash:roster.expectedHash,recipients:selected}});
      if(alive.current){const names=roster.data.filter(p=>selected.includes(p.userId!)).map(p=>p.name);setRoster(result.roster);setSelected([]);setSent(true);setMessage(`Solicitud enviada a ${names.join(', ')}. La tarjeta sigue pendiente de confirmación.`);onSent(result.roster.data.filter(p=>p.state==='PENDING').length);notificationsChanged();}
    }catch(e){if(alive.current)setMessage(socialErrorMessage(e));}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  return <div className={styles.backdrop}><section ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="attest-request-title" tabIndex={-1}>
    <header><div><small>CONFIRMACIÓN DE COMPAÑEROS</small><h2 id="attest-request-title">Solicitar Atest</h2></div><button type="button" disabled={busy} aria-label="Cerrar solicitud Atest" onClick={onClose}>×</button></header>
    <div className={styles.body}><div className={styles.round}><b>{card.round?.courseName}</b><span>{card.round?.date} · {card.author.displayName}</span><span>Score {card.round?.ownerScore??'—'} · {card.round?.teeName||'Tee no registrado'}</span><small>Ronda · {card.round?.localRoundId}</small></div><p>Selecciona a los compañeros de esta ronda para solicitar que confirmen tu tarjeta.</p>
    {!roster&&!message&&<p role="status">Consultando participantes…</p>}{roster&&!roster.data.length&&<p>No hay compañeros en esta ronda.</p>}
    <ul>{roster?.data.map(p=><li key={p.playerKey}><label><input type="checkbox" checked={selected.includes(p.userId!)} disabled={busy||!canRequestAttest(p)} onChange={e=>setSelected(values=>e.target.checked?[...values,p.userId!]:values.filter(id=>id!==p.userId))}/><ProfileAvatarMedia className={styles.avatar} value={p.avatarUrl} fallback={p.name?.[0]||'J'}/><span><b>{p.name}</b>{p.username&&<small>@{p.username}</small>}<small>{attestCompanionLabel(p)}</small></span></label></li>)}</ul>
    {message&&<p role="status" className={styles.notice}>{message}</p>}<p className={styles.caption}>Atest confirma esta versión de la tarjeta. No es una certificación GHIN/WHS.</p></div>
    <footer><button type="button" disabled={busy} onClick={onClose}>{sent?'Listo':'Cancelar'}</button><button type="button" disabled={busy||!selected.length} onClick={()=>void send()}>{busy?'Enviando…':'Enviar solicitud'}</button></footer>
  </section></div>;
}

"use client";
import { useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import { FEEDBACK_CATEGORIES,feedbackMailto,validateFeedback,type FeedbackCategory,type FeedbackInput } from '../../lib/feedback';
import { ModalShell } from './modal-shell';
import styles from './feedback-dialog.module.css';
export function requestFeedback(category:FeedbackCategory='GENERAL'){window.dispatchEvent(new CustomEvent('backyard:feedback',{detail:category}));}
export function FeedbackLink({category='GENERAL',children}:{category?:FeedbackCategory;children?:React.ReactNode}) {return <button type="button" className="textButton" onClick={()=>requestFeedback(category)}>{children??'Ayuda y sugerencias'}</button>;}
export function FeedbackDialog({token,email}:{token?:string|null;email?:string|null}) {
  const [open,setOpen]=useState(false),[confirmClose,setConfirmClose]=useState(false),[busy,setBusy]=useState(false),[available,setAvailable]=useState(false),[error,setError]=useState(''),[accepted,setAccepted]=useState(false);
  const [form,setForm]=useState<FeedbackInput>({category:'GENERAL',name:'',description:'',replyEmail:email??'',city:'',state:'',brand:'',model:'',rules:''});
  const lock=useRef(false),request=useRef<{id:string;body:string}|null>(null);
  const [requestId,setRequestId]=useState('');
  const dirty=Boolean(form.name||form.description||form.city||form.state||form.brand||form.model||form.rules);
  useEffect(()=>{const handler=(e:Event)=>{const category=(e as CustomEvent).detail;if(Object.hasOwn(FEEDBACK_CATEGORIES,category)){setForm(v=>({...v,category,replyEmail:v.replyEmail||email||''}));setOpen(true);}};
    window.addEventListener('backyard:feedback',handler);return()=>window.removeEventListener('backyard:feedback',handler);},[email]);
  useEffect(()=>{if(!open)return;const c=new AbortController();fetch('/api/feedback',{signal:c.signal,cache:'no-store'}).then(r=>r.json()).then(r=>{if(!c.signal.aborted)setAvailable(r.serverEmailAvailable===true);}).catch(()=>setAvailable(false));return()=>c.abort();},[open]);
  useEffect(()=>{if(!open||!dirty||accepted)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[open,dirty,accepted]);
  function close(){if(busy)return;if(dirty&&!accepted){setConfirmClose(true);return;}setOpen(false);}
  function clearClose(){setOpen(false);setConfirmClose(false);setAccepted(false);setError('');request.current=null;setForm(v=>({...v,name:'',description:'',city:'',state:'',brand:'',model:'',rules:''}));}
  function update(key:keyof FeedbackInput,value:string){setAccepted(false);setError('');setForm(v=>({...v,[key]:value}));}
  async function registerMailto(input:FeedbackInput) {
    if(!token||lock.current)return;
    const body=JSON.stringify(input);if(request.current?.body!==body)request.current={id:crypto.randomUUID(),body};
    lock.current=true;
    try {const response=await fetch('/api/feedback',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({id:request.current.id,input,mailtoOnly:true}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)setError('No se guardó una copia en la app. Puedes enviar el mensaje desde tu correo; el texto se conserva aquí.');
    }catch{setError('No se guardó una copia en la app. El texto se conserva aquí y en el correo que abriste.');}finally{lock.current=false;}
  }
  async function send(){if(lock.current)return;const checked=validateFeedback(form);if(!checked.ok){setError(checked.error);return;}if(!token){setError('Inicia sesión o usa Abrir correo.');return;}
    const body=JSON.stringify(checked.data);if(request.current?.body!==body)request.current={id:crypto.randomUUID(),body};setRequestId(request.current.id);lock.current=true;setBusy(true);setError('');
    try {const response=await fetch('/api/feedback',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({id:request.current.id,input:checked.data}),signal:AbortSignal.timeout(30000)});
      const data=await response.json();if(!response.ok)throw Error(data.error);if(data.status==='ACCEPTED_BY_PROVIDER')setAccepted(true);else setError(data.status==='SENDING'?'Tu solicitud aún se está procesando. Reintenta en unos segundos.':'No se envió ningún correo. Usa Abrir correo.');
    }catch(e){setError(e instanceof Error?e.message:'No pudimos enviar. Tu texto se conserva.');}finally{lock.current=false;setBusy(false);}}
  if(!open)return null;
  return createPortal(<ModalShell open onClose={close} closeDisabled={busy} className={`confirmDialog ${styles.dialog}`} labelledBy="feedback-title"><h2 id="feedback-title">Ayuda y sugerencias</h2>
    {confirmClose?<><p>Hay texto sin enviar. ¿Quieres descartarlo?</p><div className={styles.actions}><button type="button" className="secondary" onClick={()=>setConfirmClose(false)}>Seguir escribiendo</button><button type="button" className="dangerGhost" onClick={clearClose}>Descartar y cerrar</button></div></>:
    <form onSubmit={e=>{e.preventDefault();void send();}}><fieldset disabled={busy}>
      <label>Categoría<select value={form.category} onChange={e=>update('category',e.target.value)}>{Object.entries(FEEDBACK_CATEGORIES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      {!['BUG','GENERAL'].includes(form.category)&&<label>Nombre del campo, producto o propuesta<input maxLength={200} value={form.name} onChange={e=>update('name',e.target.value)}/></label>}
      {form.category==='COURSE'&&<div className={styles.grid}>{(['city','state'] as const).map(key=><label key={key}>{key==='city'?'Ciudad':'Estado'}<input value={form[key]} maxLength={200} onChange={e=>update(key,e.target.value)}/></label>)}</div>}
      {['CLUB','BALL','SHAFT'].includes(form.category)&&<div className={styles.grid}>{(['brand','model'] as const).map(key=><label key={key}>{key==='brand'?'Marca':'Modelo'}<input value={form[key]} maxLength={200} onChange={e=>update(key,e.target.value)}/></label>)}</div>}
      <label>Descripción<textarea rows={4} maxLength={2000} value={form.description} onChange={e=>update('description',e.target.value)}/></label>
      {form.category==='BET'&&<label>Reglas, participantes y ejemplo de cálculo (opcional)<textarea rows={3} maxLength={2000} value={form.rules} onChange={e=>update('rules',e.target.value)}/></label>}
      <label>Correo de respuesta<input type="email" autoComplete="email" inputMode="email" maxLength={200} value={form.replyEmail} onChange={e=>update('replyEmail',e.target.value)}/></label>
      <p>Destino: contacto@thebackyard.com.mx</p>
      {!available&&<p>El envío desde la app no está disponible. «Abrir correo» prepara el mensaje en tu aplicación; tú decides enviarlo.</p>}
      {accepted?<p role="status">El proveedor aceptó tu solicitud. Identificador: {requestId}. La recepción aún no está confirmada.</p>:<div className={styles.actions}>{available&&token&&<button type="submit" className="primary">{busy?'Enviando…':'Enviar solicitud'}</button>}<a className="secondary" href={feedbackMailto(form)} onClick={e=>{const result=validateFeedback(form);if(!result.ok){e.preventDefault();setError(result.error);}else void registerMailto(result.data);}}>Abrir correo</a></div>}
      {error&&<p role="alert">{error}</p>}<button type="button" className="secondary" onClick={accepted?clearClose:close}>{accepted?'Cerrar':'Cancelar'}</button>
    </fieldset></form>}
  </ModalShell>,document.body);
}

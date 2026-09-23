"use client";
import { useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import { FEEDBACK_CATEGORIES,FEEDBACK_SHORT_LABELS,FEEDBACK_ATTACHMENT_MAX_BYTES,validateFeedback,type FeedbackCategory,type FeedbackInput } from '../../lib/feedback';
import { feedbackAttachmentType,type FeedbackAttachment } from '../../lib/feedback-attachment';
import { ModalShell } from './modal-shell';
import styles from './feedback-dialog.module.css';
export function requestFeedback(category:FeedbackCategory='GENERAL'){window.dispatchEvent(new CustomEvent('backyard:feedback',{detail:category}));}
export function FeedbackLink({category='GENERAL',children}:{category?:FeedbackCategory;children?:React.ReactNode}) {return <button type="button" className={styles.contextLink} onClick={()=>requestFeedback(category)}>{children??'Ayuda y feedback'}<span aria-hidden="true"> ↗</span></button>;}
const emptyForm=(email?:string|null):FeedbackInput=>({category:'GENERAL',name:'',description:'',replyEmail:email??'',city:'',state:'',brand:'',model:'',rules:'',clubType:'',flex:'',players:'',example:'',occurred:'',expected:'',module:''});
const paths:Record<FeedbackCategory,string>={COURSE:'M5 21V3l13 4-13 5',TEE:'M4 12h16M7 8h10M9 4h6M6 16h12M8 20h8',CLUB:'M16 3 8 18H4v3h7l8-17',BALL:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 9h.01M13 8h.01M10 14h.01M16 13h.01',SHAFT:'m6 21 11-18M9 21 11-18',BET:'M4 6h16v12H4zM12 9v6M9 12h6',BUG:'M9 3h6M8 7h8v10a4 4 0 0 1-8 0V7ZM4 10h4m8 0h4M4 16h4m8 0h4M12 7v13',GENERAL:'M4 4h16v13H9l-5 4V4ZM8 8h8M8 12h5'};
export function FeedbackDialog({token,email,screen=''}:{token?:string|null;email?:string|null;screen?:string}) {
  const [open,setOpen]=useState(false),[confirmClose,setConfirmClose]=useState(false),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState(''),[accepted,setAccepted]=useState(false);
  const [form,setForm]=useState<FeedbackInput>(()=>emptyForm(email));
  const [attachment,setAttachment]=useState<(FeedbackAttachment&{preview:string;name:string})|null>(null);
  const lock=useRef(false),request=useRef<{id:string;body:string}|null>(null),guestKey=useRef(''),origin=useRef({screen:'',category:'GENERAL'}),fileGeneration=useRef(0);
  const [requestId,setRequestId]=useState('');
  const dirty=Boolean(attachment||Object.entries(form).some(([key,value])=>!['category','replyEmail'].includes(key)&&Boolean(value))||form.replyEmail!==(email??''));
  useEffect(()=>{const handler=(e:Event)=>{const category=(e as CustomEvent).detail;if(Object.hasOwn(FEEDBACK_CATEGORIES,category)){if(!open){origin.current={screen:screen||window.location.pathname,category};setForm(v=>({...v,category,replyEmail:v.replyEmail||email||''}));}setOpen(true);}};
    window.addEventListener('backyard:feedback',handler);return()=>window.removeEventListener('backyard:feedback',handler);},[email,screen,open]);
  useEffect(()=>{if(!open||!dirty||accepted)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[open,dirty,accepted]);
  function close(){if(busy||reading)return;if(dirty&&!accepted){setConfirmClose(true);return;}clearClose();}
  function clearClose(){fileGeneration.current++;setOpen(false);setConfirmClose(false);setAccepted(false);setError('');setAttachment(null);request.current=null;setForm(emptyForm(email));}
  function update(key:keyof FeedbackInput,value:string){setError('');setForm(v=>({...v,[key]:value}));}
  async function chooseFile(file?:File){if(!file)return;const generation=++fileGeneration.current;setReading(true);setError('');try {
    if(file.size>FEEDBACK_ATTACHMENT_MAX_BYTES)throw Error('La imagen debe pesar como máximo 2 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer());feedbackAttachmentType(file.type,bytes);
    const preview=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('No pudimos leer la imagen.'));reader.readAsDataURL(file);});
    if(generation===fileGeneration.current)setAttachment({mime:file.type,data:preview.split(',')[1],preview,name:file.name});
  }catch(e){if(generation===fileGeneration.current)setError(e instanceof Error?e.message:'No pudimos leer la imagen.');}finally{if(generation===fileGeneration.current)setReading(false);}}
  async function send(){if(lock.current||reading)return;const checked=validateFeedback(form);if(!checked.ok){setError(checked.error);return;}
    const content={input:checked.data,attachment:attachment?{mime:attachment.mime,data:attachment.data}:null,screen:origin.current.screen,contextualCategory:origin.current.category};
    const body=JSON.stringify(content);if(request.current?.body!==body)request.current={id:crypto.randomUUID(),body};if(!guestKey.current)guestKey.current=crypto.randomUUID();
    setRequestId(request.current.id);lock.current=true;setBusy(true);setError('');
    try {const response=await fetch('/api/feedback',{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'},body:JSON.stringify({id:request.current.id,guestKey:guestKey.current,...content}),signal:AbortSignal.timeout(30000)});
      const data=await response.json();if(!response.ok||!data.received||data.attachmentPending)throw Error(data.error||'No pudimos confirmar la solicitud.');setAccepted(true);
    }catch(e){setError(e instanceof Error&&e.name!=='TimeoutError'&&e.name!=='TypeError'?e.message:'No pudimos confirmar la solicitud. Tu texto se conserva; reintenta.');}finally{lock.current=false;setBusy(false);}}
  const field=(key:keyof FeedbackInput,label:string,multiline=false)=><label key={key} className={styles.field}><span>{label}</span>{multiline?<textarea rows={3} maxLength={2000} value={form[key]??''} onChange={e=>update(key,e.target.value)}/>:<input inputMode={key==='players'?'numeric':key==='replyEmail'?'email':'text'} type={key==='replyEmail'?'email':'text'} autoComplete={key==='replyEmail'?'email':'off'} maxLength={200} value={form[key]??''} onChange={e=>update(key,e.target.value)}/>}</label>;
  if(!open)return null;
  return createPortal(<ModalShell open onClose={close} closeDisabled={busy||reading} className={`confirmDialog ${styles.dialog}`} labelledBy="feedback-title">
    <header className={styles.header}><span className={styles.eyebrow}>THE BACKYARD · SOPORTE</span><h2 id="feedback-title">{confirmClose?'¿Salir sin enviar?':accepted?'Solicitud recibida':'Soporte · Ayuda y feedback'}</h2><p>{confirmClose?'Tu mensaje todavía no se ha enviado.':accepted?'Gracias. La revisaremos y te avisaremos cuando tengamos novedades.':'Cuéntanos qué necesitas. Esto nos ayuda a mejorar The Backyard.'}</p></header>
    {confirmClose?<div className={styles.actions}><button type="button" className={styles.submit} onClick={()=>setConfirmClose(false)}>Seguir escribiendo</button><button type="button" className={styles.cancel} onClick={clearClose}>Descartar</button></div>:accepted?<div className={styles.success}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><p>Referencia {requestId.slice(0,8).toUpperCase()}</p><button type="button" className={styles.submit} onClick={clearClose}>Cerrar</button></div>:
    <form onSubmit={e=>{e.preventDefault();void send();}}><fieldset disabled={busy||reading} className={styles.fields}>
      <fieldset className={styles.categories}><legend>¿Cómo podemos ayudarte?</legend>{(Object.keys(FEEDBACK_CATEGORIES) as FeedbackCategory[]).map(category=><button key={category} type="button" aria-pressed={category===form.category} onClick={()=>update('category',category)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[category]}/></svg>{FEEDBACK_SHORT_LABELS[category]}</button>)}</fieldset>
      {form.category==='COURSE'&&<>{field('name','Nombre del campo')}<div className={styles.grid}>{field('city','Ciudad')}{field('state','Estado')}</div></>}
      {form.category==='TEE'&&<>{field('name','Campo / recorrido')}{field('model','Nombre o color del tee (si lo conoces)')}</>}
      {['CLUB','BALL','SHAFT'].includes(form.category)&&<><div className={styles.grid}>{field('brand','Marca')}{field('model','Modelo')}</div>{form.category==='CLUB'&&field('clubType','Tipo de bastón')}{form.category==='SHAFT'&&field('flex','Flex (opcional)')}</>}
      {form.category==='BET'&&<>{field('name','Nombre de la apuesta')}{field('rules','Reglas',true)}{field('players','Número de jugadores (opcional)')}{field('example','Ejemplo de cálculo (opcional)',true)}</>}
      {form.category==='BUG'&&<>{field('occurred','¿Qué ocurrió?')}{field('expected','¿Qué esperabas que ocurriera?')}{field('module','Pantalla o módulo')}</>}
      {form.category==='GENERAL'&&field('name','Título')}
      {field('description','Descripción',true)}{field('replyEmail','Correo de respuesta')}
      <div className={styles.attachment}><label className={styles.attachButton}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 5h16v14H4zM4 16l5-6 5 5 3-3 3 3M16 8h.01"/></svg>{attachment?'Cambiar imagen':'Adjuntar foto o captura'}<input aria-label="Adjuntar foto o captura" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{void chooseFile(e.target.files?.[0]);e.target.value='';}}/></label><small>Opcional · JPG, PNG o WEBP · máximo 2 MB. Se adjunta al enviar.</small>
        {attachment&&<div className={styles.preview}>{/* User-selected local image; never a public Storage URL. */}
          <img src={attachment.preview} alt="Vista previa del adjunto"/><button type="button" onClick={()=>setAttachment(null)}>Quitar imagen</button></div>}
      </div>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.submit}>{busy?'Guardando solicitud…':reading?'Preparando imagen…':'Enviar solicitud'}</button><button type="button" className={styles.cancel} onClick={close}>Cancelar</button></div>
    </fieldset></form>}
  </ModalShell>,document.body);
}

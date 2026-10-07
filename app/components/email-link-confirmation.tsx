'use client';

import Link from 'next/link';
import { useEffect,useRef,useState } from 'react';
import { emailLinkHash,verifyEmailLink } from '../../lib/email-link';
import { getSupabaseBrowser } from '../../lib/supabase/client';
import { BrandLockup } from './brand-lockup';
import { consumeGpsPilotReturn, gpsReturnStorage } from '../../lib/gps-pilot-la-vista-1/auth-return';

export function EmailLinkConfirmation(){
  const token=useRef<string|null>(null),initialized=useRef(false),inFlight=useRef(false);
  const [state,setState]=useState<'loading'|'ready'|'busy'|'error'>('loading');
  const [error,setError]=useState('');
  useEffect(()=>{
    function readLink(){
      if(inFlight.current)return;
      token.current=emailLinkHash(window.location.hash);
      window.history.replaceState(window.history.state,'',window.location.pathname);
      if(token.current){setError('');setState('ready');}
      else{setError('Abre el enlace más reciente que recibiste por correo.');setState('error');}
    }
    if(!initialized.current){initialized.current=true;readLink();}
    window.addEventListener('hashchange',readLink);
    return()=>window.removeEventListener('hashchange',readLink);
  },[]);
  async function signIn(){
    if(inFlight.current||!token.current)return;
    const auth=getSupabaseBrowser();
    if(!auth){setError('El acceso todavía no está configurado en este entorno.');setState('error');return;}
    inFlight.current=true;setState('busy');
    try{await verifyEmailLink(auth.auth,token.current);token.current=null;window.location.replace(consumeGpsPilotReturn(gpsReturnStorage(), window.location.host) || '/manage');}
    catch{token.current=null;setError('El enlace ya se utilizó o caducó. Solicita uno nuevo.');setState('error');}
    finally{inFlight.current=false;}
  }
  return <main className="accessScreen"><section className="accessCard callbackCard">
    <BrandLockup compact />
    <h1>Tu acceso a The Backyard</h1>
    {state==='error'?<p role="alert">{error}</p>:<p>Pulsa Iniciar sesión para abrir tu cuenta. El enlace se utiliza una sola vez.</p>}
    {(state==='ready'||state==='busy')&&<button className="primary big" disabled={state==='busy'} onClick={()=>void signIn()}>{state==='busy'?'Validando acceso…':'Iniciar sesión'}</button>}
    <Link className="textButton" href="/">Volver a The Backyard</Link>
  </section></main>;
}

'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {getSupabaseBrowser} from '../../../lib/supabase/client';
import type {ScorecardQaFixture} from '../../../lib/scorecard-qa-fixture';
import {ScorecardQa} from './scorecard-qa';

export function ScorecardQaGate(){
  const [fixture,setFixture]=useState<ScorecardQaFixture|null>(null),[message,setMessage]=useState('Comprobando acceso QA…');
  useEffect(()=>{
    const controller=new AbortController();
    const client=getSupabaseBrowser();
    let revision=0,verifiedUser:string|null=null;
    async function verify(){
      const current=++revision;
      try{
        const session=await client?.auth.getSession();
        if(controller.signal.aborted||current!==revision)return;
        if(session?.error)throw session.error;
        if(!session?.data.session){verifiedUser=null;setFixture(null);setMessage('Inicia sesión en DEV con una cuenta QA autorizada y vuelve a esta demo.');return;}
        const response=await fetch('/api/qa/scorecard',{headers:{Authorization:`Bearer ${session.data.session.access_token}`},cache:'no-store',signal:controller.signal});
        const result=await response.json();
        if(controller.signal.aborted||current!==revision)return;
        if(!response.ok)throw new Error(result.error||'No pudimos comprobar tu acceso.');
        verifiedUser=session.data.session.user.id;
        setFixture(result.data);
      }catch(error){if(!controller.signal.aborted&&current===revision){verifiedUser=null;setFixture(null);setMessage(error instanceof Error?error.message:'No pudimos comprobar tu acceso.');}}
    }
    void verify();const subscription=client?.auth.onAuthStateChange((_event,session)=>{
      revision++;
      // Revalidate every event, but keep in-memory UI for the same verified
      // identity. Sign-out/account changes discard it before any async response.
      if(!session||session.user.id!==verifiedUser){verifiedUser=null;setFixture(null);}
      // Run outside the auth callback's lock; ignore any older account response.
      setTimeout(()=>{if(!controller.signal.aborted)void verify();},0);
    });
    return()=>{revision++;controller.abort();subscription?.data.subscription.unsubscribe();};
  },[]);
  return fixture?<ScorecardQa fixture={fixture}/>:<main className="scorecardQaShell"><h1>DEMO QA — DATOS DE PRUEBA</h1><p role="status">{message}</p><Link href="/">Abrir DEV para iniciar sesión</Link></main>;
}

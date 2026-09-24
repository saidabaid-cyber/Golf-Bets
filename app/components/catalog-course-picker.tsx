"use client";
import { useEffect,useMemo,useRef,useState } from 'react';
import { nearestReviewedClubs,reviewedClubsLocationSummary,searchReviewedCourses,type ReviewedCatalogCourse } from '../../lib/review-course-catalog';
import { resolveAuthorizedNearbyLocation,type NearbyLocationResolution } from '../../lib/device-permissions';
import { beginRoundCourseSelection } from '../../lib/round-course-selection';
import type { Course } from '../../lib/types';
import { AnchoredSearch,AnchoredSearchOption } from './anchored-search';
import styles from './catalog-course-picker.module.css';
type Entry=Omit<ReviewedCatalogCourse,'tees'> & {teeCount:number;completeCards:number};
type PickerLocationState=NearbyLocationResolution|{status:'idle'|'loading'};
export function CatalogCoursePicker({token,permissionOwnerId,onSelect,onSelectClub,onSelectHomeCourse,selectedName='',onRequest,showHeading=true,purpose='round',onSelectionReadyChange}:{token?:string|null;permissionOwnerId:string;onSelect?:(course:Course,cards:Course[])=>void;onSelectClub?:(club:{clubId:string;clubName:string})=>void;onSelectHomeCourse?:(selection:{clubId:string;clubName:string;courseId:string;courseName:string})=>void|Promise<void>;selectedName?:string;onRequest?:()=>void;showHeading?:boolean;purpose?:'round'|'home-club';onSelectionReadyChange?:(ready:boolean)=>void}) {
  const [entries,setEntries]=useState<Entry[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [location,setLocation]=useState<PickerLocationState>({status:'idle'});
  const locationController=useRef<AbortController|null>(null);
  const nearby=useMemo(()=>location.status==='located'?nearestReviewedClubs(entries,location.point):[],[entries,location]);
  const locating=location.status==='loading';
  const [club,setClub]=useState<string|null>(null),[chosen,setChosen]=useState(''),[retry,setRetry]=useState(0),[retryCourseId,setRetryCourseId]=useState<string|null>(null);
  const loadSequence=useRef(0);
  useEffect(()=>()=>locationController.current?.abort(),[permissionOwnerId]);
  useEffect(()=>{const controller=new AbortController(); if(!token) return; setLoading(true);setError('');
    const timer=window.setTimeout(()=>{controller.abort();setLoading(false);setError('Se agotó la espera del catálogo. Puedes reintentar.');},15000);
    fetch('/api/courses/catalog',{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,cache:'no-store'})
      .then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data;})
      .then(data=>{if(!controller.signal.aborted)setEntries(data.courses??[]);})
      .catch(e=>{if(!controller.signal.aborted){setRetryCourseId(null);setError(e.message||'No pudimos cargar los campos.');}})
      .finally(()=>{window.clearTimeout(timer);if(!controller.signal.aborted)setLoading(false);});
    // These refs are request counters, not DOM nodes; invalidate late callbacks on cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{window.clearTimeout(timer);controller.abort();++loadSequence.current;};
  },[token,retry]);
  const matches=query.trim()?searchReviewedCourses(entries,query):[];
  const clubs=[...new Map(matches.map(c=>[c.clubId,c])).values()];
  const selectedClubCourses=club?entries.filter(course=>course.clubId===club):[];
  async function selectCourse(id:string) {
    if(!id||loading)return;
    const sequence=++loadSequence.current;setLoading(true);setError('');setRetryCourseId(null);setChosen('');
    if(purpose==='home-club')onSelectionReadyChange?.(false);
    try {
      if(purpose==='home-club'){
        const selected=entries.find(entry=>entry.id===id);if(!selected)throw Error('No encontramos ese recorrido en el catálogo.');
        if(!onSelectHomeCourse)throw Error('No pudimos guardar este Home Club. Reintenta.');
        await onSelectHomeCourse({clubId:selected.clubId,clubName:selected.clubName,courseId:selected.id,courseName:selected.name});
        if(sequence===loadSequence.current){setChosen(id);onSelectionReadyChange?.(true);}
        return;
      }
      const response=await fetch(`/api/courses/catalog?courseId=${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),cache:'no-store'});
      const data=await response.json();if(!response.ok)throw Error(data.error);
      if(sequence===loadSequence.current){
        const transition=beginRoundCourseSelection(data.cards??[]);
        if(!transition.ok)throw Error('Este recorrido todavía no tiene una tarjeta utilizable de 9 o 18 hoyos. Puedes solicitar su revisión.');
        setChosen(id);
        onSelect?.(transition.course,transition.teeOptions);
      }
    } catch(e){if(sequence===loadSequence.current){if(purpose==='home-club'){setRetryCourseId(id);onSelectionReadyChange?.(false);}setError(e instanceof Error?e.message:purpose==='home-club'?'No pudimos guardar este Home Club. Reintenta.':'No pudimos cargar la tarjeta.');}}
    finally {if(sequence===loadSequence.current)setLoading(false);}
  }
  function selectClub(entry:Entry) {++loadSequence.current;setLoading(false);setError('');setClub(entry.clubId);setQuery('');setChosen('');setRetryCourseId(null);if(purpose==='home-club')onSelectionReadyChange?.(false);onSelectClub?.(entry);const layouts=entries.filter(c=>c.clubId===entry.clubId);if(layouts.length===1)void selectCourse(layouts[0].id);}
  function locate() {
    locationController.current?.abort();
    const controller=new AbortController();
    locationController.current=controller;
    setLocation({status:'loading'});
    void resolveAuthorizedNearbyLocation(localStorage,permissionOwnerId,navigator,navigator.geolocation,{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setLocation(result);})
      .catch(()=>{if(!controller.signal.aborted)setLocation({status:'unavailable'});});
  }
  const locationError=({disabled:'Ubicación desactivada en The Backyard. Puedes revisarla en Configuración → Privacidad y permisos o buscar manualmente.',prompt:'La ubicación todavía no está resuelta en este dispositivo. Revísala desde Privacidad y permisos; la búsqueda manual sigue disponible.',denied:'La ubicación está bloqueada en este dispositivo. Puedes revisar el permiso o buscar manualmente.',timeout:'La ubicación agotó el tiempo. Puedes reintentar o buscar manualmente.',unavailable:'No pudimos obtener la ubicación. La búsqueda manual sigue disponible.', 'query-unsupported':'Este navegador no permite consultar el permiso. Revísalo desde Privacidad y permisos o busca manualmente.','geolocation-unavailable':'Este dispositivo no ofrece ubicación. Puedes buscar manualmente.'} as Record<string,string>)[location.status];
  return <section className={styles.picker} aria-label="Catálogo de campos">
    {showHeading&&<h3>Campo</h3>}
    <button type="button" className={styles.locate} disabled={locating||!token} onClick={locate}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 21s7-6 7-12A7 7 0 0 0 5 9c0 6 7 12 7 12ZM15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0"/></svg>{locating?'Buscando ubicación…':'Campos cercanos'}</button>
    {location.status==='idle'&&<small>Usa la ubicación aproximada ya autorizada para ordenar campos cercanos. La búsqueda manual siempre está disponible.</small>}
    {locating&&<><p role="status">Buscando tu ubicación autorizada…</p><button type="button" className="textButton" onClick={()=>{locationController.current?.abort();setLocation({status:'idle'});}}>Cancelar búsqueda</button></>}
    {locationError&&<div role="status"><p>{locationError}</p><button type="button" className="secondary" onClick={locate}>Reintentar</button></div>}
    {location.status==='located'&&<p role="status">{loading?'Ubicación obtenida. Cargando clubes…':error?'Ubicación obtenida. Reintenta cargar el catálogo.':reviewedClubsLocationSummary(nearby)}</p>}
    {nearby.map(c=><button type="button" className={styles.club} key={c.clubId} onClick={()=>selectClub(c)}><b>{c.clubName}</b><span>{[c.city,c.stateRegion].filter(Boolean).join(', ')} · {c.distanceKm.toFixed(1)} km</span></button>)}
    {nearby.length>0&&<details className={styles.notes}><summary>Sobre las distancias</summary><small>Distancia geográfica aproximada, no de manejo, entre clubes con ubicación verificada. Algunas ubicaciones: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors (ODbL)</a>.</small></details>}
    <AnchoredSearch inlineResults label="Buscar otro campo" value={query} onChange={setQuery} placeholder="Nombre, club o nombre alternativo" expanded={Boolean(query.trim())} status={loading?'Cargando catálogo…':query.trim()&&!clubs.length?'Sin coincidencias. Puedes solicitar el campo.':`${entries.length} recorridos disponibles`}>
      {clubs.slice(0,30).map(c=><AnchoredSearchOption key={c.clubId} label={`Seleccionar ${c.clubName}`} onSelect={()=>selectClub(c)}><b>{c.clubName}</b><small>{[c.city,c.stateRegion].filter(Boolean).join(', ')}</small></AnchoredSearchOption>)}
      {clubs.length>30&&<p>Refina el nombre para ver más coincidencias.</p>}
    </AnchoredSearch>
    {error&&<p role="alert">{error} <button type="button" className="textButton" onClick={()=>retryCourseId?void selectCourse(retryCourseId):setRetry(n=>n+1)}>Reintentar</button></p>}
    {!token&&<p>Inicia sesión para consultar el catálogo en revisión.</p>}
    {club&&selectedClubCourses.length>1&&<label>Recorrido<select aria-label="Recorrido" value={chosen} onChange={e=>void selectCourse(e.target.value)}><option value="">Selecciona recorrido</option>{selectedClubCourses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {purpose==='home-club'&&club&&chosen&&<p role="status">Recorrido seleccionado: {selectedClubCourses.find(course=>course.id===chosen)?.name}</p>}
    {selectedName&&(!club||chosen)&&<p role="status">Seleccionado: {selectedName}</p>}
    {onRequest&&<button type="button" className={styles.request} onClick={onRequest}>¿No encuentras tu campo? Solicítalo ↗</button>}
  </section>;
}

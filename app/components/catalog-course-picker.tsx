"use client";
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { courseSelectionLabel,homeCourseSelection,nearestReviewedClubs,reviewedClubsLocationSummary,searchReviewedCourses,singleReviewedCourseLayout,type ReviewedCatalogCourse } from '../../lib/review-course-catalog';
import { readDevicePermissionPreferences,resolveAuthorizedNearbyLocation,type NearbyLocationResolution } from '../../lib/device-permissions';
import { readAccountDevicePermissionPreferences } from '../../lib/account-device-permission-preferences';
import { beginRoundCourseSelection } from '../../lib/round-course-selection';
import type { Course } from '../../lib/types';
import { AnchoredSearch,AnchoredSearchOption } from './anchored-search';
import styles from './catalog-course-picker.module.css';
type Entry=Omit<ReviewedCatalogCourse,'tees'> & {teeCount:number;completeCards:number;configurationLabel?:string};
type PickerLocationState=NearbyLocationResolution|{status:'idle'|'loading'};
export function CatalogCoursePicker({token,permissionOwnerId,onSelect,onSelectClub,onSelectHomeCourse,selectedName='',selectedClubId='',selectedCourseId='',onRequest,showHeading=true,purpose='round',onSelectionReadyChange}:{token?:string|null;permissionOwnerId:string;onSelect?:(course:Course,cards:Course[])=>void;onSelectClub?:(club:{clubId:string;clubName:string})=>void;onSelectHomeCourse?:(selection:{clubId:string;clubName:string;courseId:string;courseName:string})=>void|Promise<void>;selectedName?:string;selectedClubId?:string;selectedCourseId?:string;onRequest?:(searchedName?:string)=>void;showHeading?:boolean;purpose?:'round'|'home-club';onSelectionReadyChange?:(ready:boolean)=>void}) {
  const [entries,setEntries]=useState<Entry[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [location,setLocation]=useState<PickerLocationState>({status:'idle'});
  const locationController=useRef<AbortController|null>(null);
  const nearby=useMemo(()=>location.status==='located'?nearestReviewedClubs(entries,location.point):[],[entries,location]);
  const relevant=useMemo(()=>{
    const clubs=new Map<string,Entry>();
    for(const entry of entries){const current=clubs.get(entry.clubId);if(!current||entry.completeCards>current.completeCards)clubs.set(entry.clubId,entry);}
    return [...clubs.values()].sort((a,b)=>Number(b.completeCards>0)-Number(a.completeCards>0)||a.clubName.localeCompare(b.clubName,'es-MX')||a.clubId.localeCompare(b.clubId)).slice(0,3);
  },[entries]);
  const [nearbyLimit,setNearbyLimit]=useState(3);
  const visibleNearby=nearby.slice(0,nearbyLimit);
  const locating=location.status==='loading';
  const [club,setClub]=useState<string|null>(selectedClubId||null),[chosen,setChosen]=useState(selectedCourseId),[selectingCourseId,setSelectingCourseId]=useState<string|null>(null),[retry,setRetry]=useState(0),[retryCourseId,setRetryCourseId]=useState<string|null>(null);
  const [choosingHomeCourse,setChoosingHomeCourse]=useState(!(purpose==='home-club'&&selectedClubId&&selectedCourseId));
  const loadSequence=useRef(0);
  useEffect(()=>()=>locationController.current?.abort(),[permissionOwnerId]);
  useEffect(()=>{
    if(purpose!=='home-club'||!selectedClubId||!selectedCourseId)return;
    setClub(selectedClubId);setChosen(selectedCourseId);setChoosingHomeCourse(false);
  },[purpose,selectedClubId,selectedCourseId]);
  useEffect(()=>{const controller=new AbortController(); if(!token) return; setLoading(true);setError('');
    const timer=window.setTimeout(()=>{controller.abort();setLoading(false);setError('Se agotó la espera del catálogo. Puedes reintentar.');},15000);
    fetch(`/api/courses/catalog${retry?'?fresh=1':''}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,cache:'no-store'})
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
  const [providerLookup,setProviderLookup]=useState('');
  const resolvedProviderQueries=useRef(new Set<string>());
  useEffect(()=>{
    const normalized=query.trim().toLocaleLowerCase('es-MX');
    if(!token||loading||normalized.length<3||clubs.length||resolvedProviderQueries.current.has(normalized)){if(clubs.length)setProviderLookup('');return;}
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      resolvedProviderQueries.current.add(normalized);setProviderLookup('Buscando también en el proveedor autorizado…');
      fetch(`/api/courses/search?q=${encodeURIComponent(query.trim())}&limit=20&resolve=1`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,cache:'no-store'})
        .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'COURSE_PROVIDER_UNAVAILABLE');return data;})
        .then(data=>{const status=String(data.remoteLookup?.status||'');if(status==='IMPORTED'){setProviderLookup('Campo agregado al Course Master. Actualizando…');setRetry(value=>value+1);return;}if(status==='PROVIDER_AMBIGUOUS'){setProviderLookup('Encontramos varias coincidencias. Escribe un nombre más específico.');return;}setProviderLookup('No encontramos este campo. Puedes solicitarlo con una foto de la tarjeta del club.');})
        .catch(error=>{if(!controller.signal.aborted)setProviderLookup(error instanceof Error&&error.name==='AbortError'?'':'No encontramos este campo. Puedes solicitarlo con una foto de la tarjeta del club.');});
    },800);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[clubs.length,loading,query,token]);
  const selectedClubCourses=club?entries.filter(course=>course.clubId===club):[];
  const selectedEntry=chosen?entries.find(course=>course.id===chosen):undefined;
  const selectionLabel=selectedEntry?courseSelectionLabel(homeCourseSelection(selectedEntry)):selectedName;
  async function selectCourse(id:string) {
    if(!id)return;
    const previousChosen=chosen;
    const sequence=++loadSequence.current;setSelectingCourseId(id);setError('');setRetryCourseId(null);setChosen(id);
    if(purpose==='home-club')onSelectionReadyChange?.(false);
    try {
      if(purpose==='home-club'){
        const selected=entries.find(entry=>entry.id===id);if(!selected)throw Error('No encontramos ese recorrido en el catálogo.');
        if(!onSelectHomeCourse)throw Error('No pudimos guardar este Home Club. Reintenta.');
        await onSelectHomeCourse(homeCourseSelection(selected));
        if(sequence===loadSequence.current){onSelectionReadyChange?.(true);setChoosingHomeCourse(false);}
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
    } catch(e){if(sequence===loadSequence.current){setChosen(previousChosen);if(purpose==='home-club'){setRetryCourseId(id);onSelectionReadyChange?.(false);}setError(e instanceof Error?e.message:purpose==='home-club'?'No pudimos guardar este Home Club. Reintenta.':'No pudimos cargar la tarjeta.');}}
    finally {if(sequence===loadSequence.current)setSelectingCourseId(null);}
  }
  function selectClub(entry:Entry) {++loadSequence.current;setError('');setClub(entry.clubId);setQuery('');setChosen('');setRetryCourseId(null);if(purpose==='home-club')onSelectionReadyChange?.(false);onSelectClub?.(entry);const course=singleReviewedCourseLayout(entries,entry.clubId);if(course)void selectCourse(course.id);}
  const locate=useCallback(() => {
    locationController.current?.abort();
    const controller=new AbortController();
    locationController.current=controller;
    setNearbyLimit(3);
    setLocation({status:'loading'});
    void resolveAuthorizedNearbyLocation(localStorage,permissionOwnerId,navigator,navigator.geolocation,{signal:controller.signal,readCurrent:()=>token?readAccountDevicePermissionPreferences(localStorage,permissionOwnerId):readDevicePermissionPreferences(localStorage,permissionOwnerId)})
      .then(result=>{if(!controller.signal.aborted)setLocation(result);})
      .catch(()=>{if(!controller.signal.aborted)setLocation({status:'unavailable'});});
  },[permissionOwnerId,token]);
  useEffect(()=>{
    if(!token||(purpose==='home-club'&&!choosingHomeCourse)||!readAccountDevicePermissionPreferences(localStorage,permissionOwnerId).locationEnabled)return;
    locate();
  },[choosingHomeCourse,locate,permissionOwnerId,purpose,token]);
  const locationError=({disabled:'Ubicación desactivada en The Backyard. Puedes revisarla en Configuración → Privacidad y permisos o buscar manualmente.',prompt:'La ubicación todavía no está resuelta en este dispositivo. Revísala desde Privacidad y permisos; la búsqueda manual sigue disponible.',denied:'La ubicación está bloqueada en este dispositivo. Puedes revisar el permiso o buscar manualmente.',timeout:'La ubicación agotó el tiempo. Puedes reintentar o buscar manualmente.',unavailable:'No pudimos obtener la ubicación. La búsqueda manual sigue disponible.', 'query-unsupported':'Este navegador no permite consultar el permiso. Revísalo desde Privacidad y permisos o busca manualmente.','geolocation-unavailable':'Este dispositivo no ofrece ubicación. Puedes buscar manualmente.'} as Record<string,string>)[location.status];
  const selectedNearbyClub=nearby.find(entry=>entry.clubId===club);
  const selectedPlace=selectedEntry?[selectedEntry.city,selectedEntry.stateRegion].filter(Boolean).join(', '):selectedNearbyClub?[selectedNearbyClub.city,selectedNearbyClub.stateRegion].filter(Boolean).join(', '):'';
  const selectedDistance=selectedNearbyClub?` · ${selectedNearbyClub.distanceKm.toFixed(1)} km`:'';
  if(purpose==='home-club'&&!choosingHomeCourse&&selectionLabel&&club&&chosen)return <section className={styles.picker} aria-label="Catálogo de campos">
    {showHeading&&<h3>Campo</h3>}
    <div className={`${styles.club} ${styles.clubSelected}`} role="status"><b>{selectionLabel}</b>{selectedPlace&&<span>{selectedPlace}{selectedDistance}</span>}<em>✓ Seleccionado</em></div>
    <button type="button" className="textButton" onClick={()=>{setChoosingHomeCourse(true);setError('');}}>Cambiar campo</button>
  </section>;
  return <section className={styles.picker} aria-label="Catálogo de campos">
    {showHeading&&<h3>Campo</h3>}
    <button type="button" className={styles.locate} disabled={locating||!token} onClick={locate}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 21s7-6 7-12A7 7 0 0 0 5 9c0 6 7 12 7 12ZM15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0"/></svg>{locating?'Buscando ubicación…':'Campos cercanos'}</button>
    {location.status==='idle'&&<small>Usa la ubicación autorizada para ordenar campos cercanos. La búsqueda manual siempre está disponible.</small>}
    {locating&&<><p role="status">Buscando tu ubicación autorizada…</p><button type="button" className="textButton" onClick={()=>{locationController.current?.abort();setLocation({status:'idle'});}}>Cancelar búsqueda</button></>}
    {locationError&&<div role="status"><p>{locationError}</p><button type="button" className="secondary" onClick={locate}>Reintentar</button></div>}
    {location.status==='located'&&<p role="status">{loading?'Ubicación obtenida. Cargando clubes…':error?'Ubicación obtenida. Reintenta cargar el catálogo.':`${reviewedClubsLocationSummary(nearby)}${location.point.accuracyMeters===undefined?'':` Precisión informada por el dispositivo: ±${location.point.accuracyMeters} m.`}`}</p>}
    {visibleNearby.map(c=><button type="button" className={`${styles.club} ${club===c.clubId?styles.clubSelected:''}`} aria-pressed={club===c.clubId} disabled={selectingCourseId!==null} key={c.clubId} onClick={()=>selectClub(c)}><b>{c.clubName}</b><span>{[c.city,c.stateRegion].filter(Boolean).join(', ')} · {c.distanceKm.toFixed(1)} km</span>{club===c.clubId&&<em>✓ {selectingCourseId?'Guardando…':'Seleccionado'}</em>}</button>)}
    {nearby.length>visibleNearby.length&&<button type="button" className="textButton" onClick={()=>setNearbyLimit(limit=>Math.min(limit+9,nearby.length))}>Ver más campos cercanos</button>}
    {nearby.length>0&&<details className={styles.notes}><summary>Sobre las distancias</summary><small>Distancia geográfica aproximada, no de manejo, entre clubes con ubicación disponible. Algunas ubicaciones: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors (ODbL)</a>.</small></details>}
    {!query.trim()&&!club&&relevant.length>0&&<div><p><b>Campos relevantes del catálogo</b></p><small>Primero mostramos campos con tarjeta completa; después se ordenan por nombre.</small>{relevant.map(c=><button type="button" className={styles.club} aria-pressed={false} disabled={selectingCourseId!==null} key={`relevant-${c.clubId}`} onClick={()=>selectClub(c)}><b>{c.clubName}</b><span>{[c.city,c.stateRegion].filter(Boolean).join(', ')}</span></button>)}</div>}
    <AnchoredSearch inlineResults label="Buscar otro campo" value={query} onChange={setQuery} placeholder="Nombre, club o nombre alternativo" expanded={Boolean(query.trim())} status={loading?'Cargando catálogo…':query.trim()&&!clubs.length?'Sin coincidencias. Puedes solicitar el campo.':`${entries.length} recorridos disponibles`}>
      {clubs.slice(0,30).map(c=><AnchoredSearchOption key={c.clubId} label={`Seleccionar ${c.clubName}`} onSelect={()=>selectClub(c)}><b>{c.clubName}</b><small>{[c.city,c.stateRegion].filter(Boolean).join(', ')}</small></AnchoredSearchOption>)}
      {clubs.length>30&&<p>Refina el nombre para ver más coincidencias.</p>}
    </AnchoredSearch>
    {providerLookup&&<p role="status">{providerLookup}</p>}
    {error&&<p role="alert">{error} <button type="button" className="textButton" onClick={()=>retryCourseId?void selectCourse(retryCourseId):setRetry(n=>n+1)}>Reintentar</button></p>}
    {!token&&<p>Inicia sesión para buscar campos.</p>}
    {club&&selectedClubCourses.length>1&&<label>Layout / configuración<select aria-label="Layout / configuración" value={chosen} onChange={e=>void selectCourse(e.target.value)}><option value="">Selecciona configuración</option>{selectedClubCourses.map(c=><option key={c.id} value={c.id}>{c.configurationLabel??c.name}{c.isProvisional?' · Provisional · No disponible para publicación GHIN':''}{c.completeCards===0?' · tarjeta pendiente':''}</option>)}</select></label>}
    {purpose==='home-club'&&selectionLabel&&<p role="status">✓ Seleccionado: {selectionLabel}</p>}
    {onRequest&&<button type="button" className={styles.request} onClick={()=>onRequest(query.trim()||undefined)}>{query.trim()&&!loading&&!clubs.length?'Solicitar este campo':'¿No encuentras tu campo? Solicitar este campo'} ↗</button>}
  </section>;
}

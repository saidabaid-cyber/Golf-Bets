"use client";
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { courseSelectionLabel,homeCourseSelection,nearestReviewedClubs,reviewedClubsLocationSummary,searchReviewedCourses,singleReviewedCourseLayout,type ReviewedCatalogCourse } from '../../lib/review-course-catalog';
import { readDevicePermissionPreferences,refreshDevicePermissionStateWithoutPrompt,requestInitialLocation,resolveAuthorizedNearbyLocation,type NearbyLocationResolution } from '../../lib/device-permissions';
import { cacheAccountDevicePermissionPreferences,readAccountDevicePermissionPreferences,requestAccountDevicePermissionPreferences } from '../../lib/account-device-permission-preferences';
import { beginRoundCourseSelection } from '../../lib/round-course-selection';
import type { Course } from '../../lib/types';
import { requestCourseLocation } from '../../lib/browser-course-location';
import { AnchoredSearch,AnchoredSearchOption } from './anchored-search';
import styles from './catalog-course-picker.module.css';
type Entry=Omit<ReviewedCatalogCourse,'tees'> & {teeCount:number;completeCards:number;configurationLabel?:string};
type PickerLocationState=NearbyLocationResolution|{status:'idle'|'loading'};
function SavedRoundCourses({title,courses,disabled,onSelect}:{title:string;courses:Course[];disabled:boolean;onSelect:(course:Course)=>void}) {
  return <div><h4>{title}</h4>{courses.length?courses.slice(0,5).map(card=><button type="button" className={styles.club} disabled={disabled} key={card.id} onClick={()=>onSelect(card)}><b>{card.name}</b><span>{card.scorecardProfileName||card.teeName}</span></button>):<small>Aún no tienes campos {title.toLowerCase()}.</small>}</div>;
}
export function CatalogCoursePicker({token,permissionOwnerId,onSelect,onSelectClub,onConfigurationPending,onSelectHomeCourse,selectedName='',selectedClubId='',selectedCourseId='',onRequest,showHeading=true,purpose='round',onSelectionReadyChange,onboardingLocation=false,recentCourses=[],favoriteCourses=[],requestCatalog=fetch}:{token?:string|null;permissionOwnerId:string;onSelect?:(course:Course,cards:Course[])=>void;onSelectClub?:(club:{clubId:string;clubName:string})=>void;onConfigurationPending?:(course:{id:string;clubId:string;name:string},issue?:string)=>void;onSelectHomeCourse?:(selection:{clubId:string;clubName:string;courseId:string;courseName:string})=>void|Promise<void>;selectedName?:string;selectedClubId?:string;selectedCourseId?:string;onRequest?:(searchedName?:string)=>void;showHeading?:boolean;purpose?:'round'|'home-club';onSelectionReadyChange?:(ready:boolean)=>void;onboardingLocation?:boolean;recentCourses?:Course[];favoriteCourses?:Course[];requestCatalog?:(url:string,init:RequestInit)=>Promise<Response>}) {
  const [entries,setEntries]=useState<Entry[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [catalogError,setCatalogError]=useState('');
  const [incompleteTees,setIncompleteTees]=useState<{id:string;name:string;gender:string|null;rating:number|null;slope:number|null;totalYards:number|null}[]>([]);
  const [location,setLocation]=useState<PickerLocationState>({status:'idle'});
  const [homeLocationEnabled,setHomeLocationEnabled]=useState(false);
  const locationController=useRef<AbortController|null>(null);
  const nearby=useMemo(()=>location.status==='located'?nearestReviewedClubs(entries,location.point):[],[entries,location]);
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
  useEffect(()=>{if(purpose==='round'&&selectedCourseId&&entries.length){setChosen(selectedCourseId);setClub(selectedClubId||entries.find(row=>row.id===selectedCourseId)?.clubId||null);}},[purpose,selectedClubId,selectedCourseId,entries]);
  useEffect(()=>{const controller=new AbortController(); if(!token) return; setLoading(true);setCatalogError('');
    const timer=window.setTimeout(()=>{controller.abort();setLoading(false);setCatalogError('Se agotó la espera del catálogo. Puedes reintentar.');},15000);
    requestCatalog(`/api/courses/catalog${retry?'?fresh=1':''}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,cache:'no-store'})
      .then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data;})
      .then(data=>{if(!controller.signal.aborted)setEntries(data.courses??[]);})
      .catch(e=>{if(!controller.signal.aborted){setCatalogError(e.message||'No pudimos cargar los campos.');}})
      .finally(()=>{window.clearTimeout(timer);if(!controller.signal.aborted)setLoading(false);});
    // These refs are request counters, not DOM nodes; invalidate late callbacks on cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{window.clearTimeout(timer);controller.abort();++loadSequence.current;};
  },[token,retry,requestCatalog]);
  const matches=purpose==='round'||query.trim()?searchReviewedCourses(entries,query):[];
  const clubs=[...new Map(matches.map(c=>[c.clubId,c])).values()];
  const [providerLookup,setProviderLookup]=useState('');
  const resolvedProviderQueries=useRef(new Set<string>());
  useEffect(()=>{
    const normalized=query.trim().toLocaleLowerCase('es-MX');
    if(purpose==='round'||!token||loading||normalized.length<3||clubs.length||resolvedProviderQueries.current.has(normalized)){if(clubs.length)setProviderLookup('');return;}
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      resolvedProviderQueries.current.add(normalized);setProviderLookup('Buscando también en el proveedor autorizado…');
      fetch(`/api/courses/search?q=${encodeURIComponent(query.trim())}&limit=20&resolve=1`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,cache:'no-store'})
        .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'COURSE_PROVIDER_UNAVAILABLE');return data;})
        .then(data=>{const status=String(data.remoteLookup?.status||'');if(status==='IMPORTED'){setProviderLookup('Campo agregado al Course Master. Actualizando…');setRetry(value=>value+1);return;}if(status==='PROVIDER_AMBIGUOUS'){setProviderLookup('Encontramos varias coincidencias. Escribe un nombre más específico.');return;}setProviderLookup('No encontramos este campo. Puedes solicitarlo con una foto de la tarjeta del club.');})
        .catch(error=>{if(!controller.signal.aborted)setProviderLookup(error instanceof Error&&error.name==='AbortError'?'':'No encontramos este campo. Puedes solicitarlo con una foto de la tarjeta del club.');});
    },800);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[clubs.length,loading,query,token,purpose]);
  const selectedClubCourses=club?entries.filter(course=>course.clubId===club):[];
  const selectedEntry=chosen?entries.find(course=>course.id===chosen):undefined;
  const selectionLabel=selectedEntry?courseSelectionLabel(homeCourseSelection(selectedEntry)):selectedName;
  async function selectCourse(id:string) {
    if(!id)return;
    const selectedEntry=entries.find(row=>row.id===id);
    setIncompleteTees([]);
    if(purpose==='round'&&selectedEntry)onConfigurationPending?.(selectedEntry);
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
      const response=await requestCatalog(`/api/courses/catalog?courseId=${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),cache:'no-store'});
      const data=await response.json();if(!response.ok)throw Error(data.error);
      if(sequence===loadSequence.current){
        const transition=beginRoundCourseSelection(data.cards??[]);
        if(!transition.ok){setIncompleteTees(data.availableTees??[]);if(selectedEntry)onConfigurationPending?.(selectedEntry,data.cardIssue);throw Error(data.cardIssue||'Falta la tarjeta por hoyo de esta configuración. Solicita su revisión.');}
        setChosen(id);
        onSelect?.(transition.course,transition.teeOptions);
      }
    } catch(e){if(sequence===loadSequence.current){setRetryCourseId(id);if(purpose==='home-club'){setRetryCourseId(id);onSelectionReadyChange?.(false);}setError(e instanceof Error?e.message:purpose==='home-club'?'No pudimos guardar este Home Club. Reintenta.':'No pudimos cargar la tarjeta.');}}
    finally {if(sequence===loadSequence.current)setSelectingCourseId(null);}
  }
  function selectClub(entry:Entry) {++loadSequence.current;setError('');setIncompleteTees([]);setClub(entry.clubId);setQuery('');setChosen('');setRetryCourseId(null);if(purpose==='home-club')onSelectionReadyChange?.(false);onSelectClub?.(entry);const course=singleReviewedCourseLayout(entries,entry.clubId);if(course)void selectCourse(course.id);}
  function selectSavedCourse(card:Course) {
    if(card.catalogCourseId) void selectCourse(card.catalogCourseId);
    else onSelect?.(card,[card]);
  }
  const locateRound=useCallback(() => {
    locationController.current?.abort();const controller=new AbortController();locationController.current=controller;
    setLocation({status:'loading'});
    const cancel=requestCourseLocation(navigator.geolocation,result=>{
      if(controller.signal.aborted)return;
      setLocation(result.status==='located'?{status:'located',point:{...result.point,capturedAt:new Date().toISOString()},source:'fresh'}:{status:result.status==='unsupported'?'geolocation-unavailable':result.status});
    });
    controller.signal.addEventListener('abort',cancel,{once:true});
  },[]);
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
    if(!token||(purpose==='home-club'&&!choosingHomeCourse))return;
    if(purpose==='round'){
      const controller=new AbortController();
      // Query permission without prompting; stored consent is not system permission.
      void navigator.permissions?.query({name:'geolocation'}).then(result=>{
        if(controller.signal.aborted)return;
        if(result.state==='granted')locateRound();
        else if(result.state==='denied')setLocation({status:'denied'});
      }).catch(()=>undefined);
      return()=>{controller.abort();locationController.current?.abort();};
    }
    if(!onboardingLocation||purpose!=='home-club'){
      if(readAccountDevicePermissionPreferences(localStorage,permissionOwnerId).locationEnabled)locate();
      return;
    }
    const controller=new AbortController();
    void Promise.all([requestAccountDevicePermissionPreferences(token,controller.signal),refreshDevicePermissionStateWithoutPrompt(localStorage,permissionOwnerId,navigator,undefined,{shouldCommit:()=>!controller.signal.aborted})]).then(([remote])=>{
      if(controller.signal.aborted)return;
      const current=cacheAccountDevicePermissionPreferences(localStorage,permissionOwnerId,remote);
      const enabled=current.locationPreference==='enabled';setHomeLocationEnabled(enabled);
      if(!enabled)return;
      if(current.locationEnabled)locate();
      else setLocation({status:current.location==='denied'?'denied':'prompt'});
    }).catch(()=>{if(!controller.signal.aborted)setLocation({status:'unavailable'});});
    return()=>controller.abort();
  },[choosingHomeCourse,locate,locateRound,permissionOwnerId,purpose,token,onboardingLocation]);
  async function retryHomeLocation(){
    if(purpose==='round'){
      locateRound();return;
    }
    if(!onboardingLocation||purpose!=='home-club'||!homeLocationEnabled){locate();return;}
    if(readAccountDevicePermissionPreferences(localStorage,permissionOwnerId).locationPreference!=='enabled')return;
    locationController.current?.abort();const controller=new AbortController();locationController.current=controller;
    setLocation({status:'loading'});
    const current=await requestInitialLocation(localStorage,permissionOwnerId,navigator.geolocation,{signal:controller.signal});
    if(controller.signal.aborted)return;
    if(current.location==='granted')locate();
    else setLocation({status:current.location==='denied'?'denied':current.location==='timeout'?'timeout':'unavailable'});
  }
  const locationError=({disabled:'Ubicación desactivada en The Backyard. Puedes revisarla en Configuración → Privacidad y permisos o buscar manualmente.',prompt:'La ubicación todavía no está resuelta en este dispositivo. Revísala desde Privacidad y permisos; la búsqueda manual sigue disponible.',denied:'La ubicación está bloqueada en este dispositivo. Puedes revisar el permiso o buscar manualmente.',timeout:'La ubicación agotó el tiempo. Puedes reintentar o buscar manualmente.',unavailable:'No pudimos obtener la ubicación. La búsqueda manual sigue disponible.', 'query-unsupported':'Este navegador no permite consultar el permiso. Revísalo desde Privacidad y permisos o busca manualmente.','geolocation-unavailable':'Este dispositivo no ofrece ubicación. Puedes buscar manualmente.'} as Record<string,string>)[location.status];
  const selectedNearbyClub=nearby.find(entry=>entry.clubId===club);
  const selectedPlace=selectedEntry?[selectedEntry.city,selectedEntry.stateRegion].filter(Boolean).join(', '):selectedNearbyClub?[selectedNearbyClub.city,selectedNearbyClub.stateRegion].filter(Boolean).join(', '):'';
  const selectedDistance=selectedNearbyClub?` · ${selectedNearbyClub.distanceKm.toFixed(1)} km`:'';
  if(purpose==='round'&&club)return <section className={styles.picker} aria-label="Configuraciones del club">
    <button type="button" className="textButton" onClick={()=>{++loadSequence.current;setClub(null);setChosen('');setError('');setIncompleteTees([]);setSelectingCourseId(null);}}>← Campos</button>
    <h3>{selectedClubCourses[0]?.clubName||selectedName}</h3>
    <p>Elige el recorrido. Después verás sus tees de salida.</p>
    <div className={styles.configurations} role="group" aria-label="Recorridos / configuraciones">
      {selectedClubCourses.map(c=><button type="button" key={c.id} className={`${styles.club} ${chosen===c.id?styles.clubSelected:''}`} aria-pressed={chosen===c.id} disabled={selectingCourseId!==null} onClick={()=>void selectCourse(c.id)}><b>{c.configurationLabel??c.name}</b><span>{c.holes} hoyos{c.isProvisional?' · Provisional':''}{c.completeCards===0?' · Tarjeta por hoyo pendiente':''}</span></button>)}
    </div>
    {selectingCourseId&&<p role="status">Leyendo los tees de esta configuración…</p>}
    {error&&<div role="alert"><p>{error}</p><button type="button" className="textButton" onClick={()=>retryCourseId&&void selectCourse(retryCourseId)}>Reintentar configuración</button></div>}
    {incompleteTees.length>0&&<div aria-label="Tees con tarjeta pendiente"><b>Tees registrados · tarjeta por hoyo pendiente</b>{incompleteTees.map(tee=><p key={tee.id}>{tee.name}{tee.gender==='MEN'?' · Hombres':tee.gender==='WOMEN'?' · Mujeres':''}{tee.totalYards!==null?` · ${tee.totalYards} yd`:''}{tee.rating!==null?` · Rating ${tee.rating}`:''}{tee.slope!==null?` · Slope ${tee.slope}`:''}</p>)}</div>}
    {onRequest&&<button type="button" className={styles.request} onClick={()=>onRequest(selectedEntry?.name||selectedClubCourses[0]?.clubName)}>Solicitar o reportar configuración del campo ↗</button>}
    {catalogError&&<p role="alert">{catalogError} <button type="button" className="textButton" onClick={()=>setRetry(n=>n+1)}>Reintentar catálogo</button></p>}
  </section>;
  if(purpose==='home-club'&&!choosingHomeCourse&&selectionLabel&&club&&chosen)return <section className={styles.picker} aria-label="Catálogo de campos">
    {showHeading&&<h3>Campo</h3>}
    <div className={`${styles.club} ${styles.clubSelected}`} role="status"><b>{selectionLabel}</b>{selectedPlace&&<span>{selectedPlace}{selectedDistance}</span>}<em>✓ Seleccionado</em></div>
    <button type="button" className="textButton" onClick={()=>{setChoosingHomeCourse(true);setError('');}}>Cambiar campo</button>
  </section>;
  return <section className={styles.picker} aria-label="Catálogo de campos">
    {showHeading&&<h3>Campo</h3>}
    {(purpose==='round'||location.status!=='idle'||(onboardingLocation&&purpose==='home-club'&&homeLocationEnabled))&&<button type="button" className={styles.locate} disabled={locating||!token} onClick={()=>void retryHomeLocation()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 21s7-6 7-12A7 7 0 0 0 5 9c0 6 7 12 7 12ZM15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0"/></svg>{locating?'Buscando ubicación…':'Usar mi ubicación'}</button>}
    {locating&&<><p role="status">Buscando tu ubicación autorizada…</p><button type="button" className="textButton" onClick={()=>{locationController.current?.abort();setLocation({status:'idle'});}}>Cancelar búsqueda</button></>}
    {locationError&&<div role="status"><p>{onboardingLocation?'No pudimos usar tu ubicación. Puedes buscar tu campo manualmente.':locationError}</p>{(!onboardingLocation||homeLocationEnabled)&&<button type="button" className="secondary" onClick={()=>void retryHomeLocation()}>{onboardingLocation?'REINTENTAR UBICACIÓN':'Reintentar'}</button>}</div>}
    {location.status==='located'&&<p role="status">{loading?'Ubicación obtenida. Cargando clubes…':catalogError&&!entries.length?'Ubicación obtenida. Reintenta cargar el catálogo.':`${reviewedClubsLocationSummary(nearby)}${location.point.accuracyMeters===undefined?'':` Precisión informada por el dispositivo: ±${location.point.accuracyMeters} m.`}`}</p>}
    {visibleNearby.map(c=><button type="button" className={`${styles.club} ${club===c.clubId?styles.clubSelected:''}`} aria-pressed={club===c.clubId} disabled={selectingCourseId!==null} key={c.clubId} onClick={()=>selectClub(c)}><b>{c.clubName}</b><span>{[c.city,c.stateRegion].filter(Boolean).join(', ')} · {c.distanceKm.toFixed(1)} km</span>{club===c.clubId&&<em>✓ {selectingCourseId?'Guardando…':'Seleccionado'}</em>}</button>)}
    {nearby.length>visibleNearby.length&&<button type="button" className="textButton" onClick={()=>setNearbyLimit(limit=>Math.min(limit+9,nearby.length))}>Ver más campos cercanos</button>}
    {nearby.length>0&&<details className={styles.notes}><summary>Sobre las distancias</summary><small>Distancia geográfica aproximada, no de manejo, entre clubes con ubicación disponible. Algunas ubicaciones: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors (ODbL)</a>.</small></details>}
    {purpose==='round'&&!club&&<><SavedRoundCourses title="Recientes" courses={recentCourses} disabled={selectingCourseId!==null} onSelect={selectSavedCourse}/><SavedRoundCourses title="Favoritos" courses={favoriteCourses} disabled={selectingCourseId!==null} onSelect={selectSavedCourse}/></>}
    {(!club||purpose!=='round')&&<AnchoredSearch inlineResults label={purpose==='round'?'Buscar campo':'Buscar otro campo'} value={query} onChange={setQuery} placeholder="Nombre, club o ciudad" expanded={purpose==='round'||query.trim().length>0} status={loading?'Cargando catálogo…':query.trim()&&!clubs.length?'Sin coincidencias. Puedes solicitar el campo.':`${entries.length} recorridos disponibles`}>
      {clubs.slice(0,30).map(c=><AnchoredSearchOption key={c.clubId} label={`Seleccionar ${c.clubName}`} onSelect={()=>selectClub(c)}><b>{c.clubName}</b><small>{[c.city,c.stateRegion].filter(Boolean).join(', ')}</small></AnchoredSearchOption>)}
      {clubs.length>30&&<p>Refina el nombre para ver más coincidencias.</p>}
    </AnchoredSearch>}
    {providerLookup&&<p role="status">{providerLookup}</p>}
    {purpose!=='round'&&error&&<p role="alert">{error} <button type="button" className="textButton" onClick={()=>retryCourseId?void selectCourse(retryCourseId):setRetry(n=>n+1)}>Reintentar</button></p>}
    {catalogError&&<p role="alert">{catalogError} <button type="button" className="textButton" onClick={()=>setRetry(n=>n+1)}>Reintentar catálogo</button></p>}
    {!token&&<p>Inicia sesión para buscar campos.</p>}

    {purpose==='home-club'&&club&&selectedClubCourses.length>1&&<label>Layout / configuración<select aria-label="Layout / configuración" value={chosen} onChange={e=>void selectCourse(e.target.value)}><option value="">Selecciona configuración</option>{selectedClubCourses.map(c=><option key={c.id} value={c.id}>{c.configurationLabel??c.name}{c.isProvisional?' · Provisional · No disponible para publicación GHIN':''}{c.completeCards===0?' · tarjeta pendiente':''}</option>)}</select></label>}
    {purpose==='home-club'&&selectionLabel&&<p role="status">✓ Seleccionado: {selectionLabel}</p>}
    {onRequest&&<button type="button" className={styles.request} onClick={()=>onRequest(query.trim()||undefined)}>{query.trim()&&!loading&&!clubs.length?'Solicitar este campo':'¿No encuentras tu campo? Solicitar este campo'} ↗</button>}
  </section>;
}

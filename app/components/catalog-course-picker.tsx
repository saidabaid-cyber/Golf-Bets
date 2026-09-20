"use client";
import { useEffect,useRef,useState } from 'react';
import { nearestReviewedClubs,searchReviewedCourses,type ReviewedCatalogCourse } from '../../lib/review-course-catalog';
import type { Course } from '../../lib/types';
import { AnchoredSearch,AnchoredSearchOption } from './anchored-search';
import styles from './catalog-course-picker.module.css';
type Entry=Omit<ReviewedCatalogCourse,'tees'> & {teeCount:number;completeCards:number};
export function CatalogCoursePicker({token,onSelect,selectedName='',onRequest}:{token?:string|null;onSelect:(course:Course,cards:Course[])=>void;selectedName?:string;onRequest?:()=>void}) {
  const [entries,setEntries]=useState<Entry[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [nearby,setNearby]=useState<(Entry&{distanceKm:number})[]>([]),[geo,setGeo]=useState(''),[locating,setLocating]=useState(false);
  const [club,setClub]=useState<string|null>(null),[cards,setCards]=useState<Course[]>([]),[chosen,setChosen]=useState(''),[retry,setRetry]=useState(0);
  const loadSequence=useRef(0),geoSequence=useRef(0);
  useEffect(()=>{const controller=new AbortController(); if(!token) return; setLoading(true);setError('');
    const timer=window.setTimeout(()=>{controller.abort();setLoading(false);setError('Se agotó la espera del catálogo. Puedes reintentar.');},15000);
    fetch('/api/courses/catalog',{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,cache:'no-store'})
      .then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data;})
      .then(data=>{if(!controller.signal.aborted)setEntries(data.courses??[]);})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message||'No pudimos cargar los campos.');})
      .finally(()=>{window.clearTimeout(timer);if(!controller.signal.aborted)setLoading(false);});
    // These refs are request counters, not DOM nodes; invalidate late callbacks on cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{window.clearTimeout(timer);controller.abort();++loadSequence.current;++geoSequence.current;};
  },[token,retry]);
  const matches=query.trim()?searchReviewedCourses(entries,query):[];
  const clubs=[...new Map(matches.map(c=>[c.clubId,c])).values()];
  async function selectCourse(id:string) {
    const sequence=++loadSequence.current;setLoading(true);setError('');setCards([]);setChosen('');
    try {const response=await fetch(`/api/courses/catalog?courseId=${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),cache:'no-store'});
      const data=await response.json();if(!response.ok)throw Error(data.error);
      if(sequence===loadSequence.current) {setCards(data.cards);setChosen(id);}
    } catch(e){if(sequence===loadSequence.current)setError(e instanceof Error?e.message:'No pudimos cargar la tarjeta.');}
    finally {if(sequence===loadSequence.current)setLoading(false);}
  }
  function selectClub(entry:Entry) {++loadSequence.current;setLoading(false);setClub(entry.clubId);setQuery('');setCards([]);setChosen('');const layouts=entries.filter(c=>c.clubId===entry.clubId);if(layouts.length===1)void selectCourse(layouts[0].id);}
  function locate() {
    if(!navigator.geolocation){setGeo('La ubicación no está disponible. Busca por nombre.');return;}
    const sequence=++geoSequence.current;setLocating(true);setGeo('');
    navigator.geolocation.getCurrentPosition(position=>{if(sequence!==geoSequence.current)return;
      setNearby(nearestReviewedClubs(entries,{latitude:position.coords.latitude,longitude:position.coords.longitude}));
      setLocating(false);setGeo('Distancia geográfica aproximada, no de manejo. Sólo clubes con ubicación documentada.');
    },e=>{if(sequence!==geoSequence.current)return;setLocating(false);setGeo(e.code===1?'No diste permiso. Puedes buscar por nombre o reintentar.':e.code===3?'Se agotó la espera. Reintenta o busca por nombre.':'No pudimos obtener tu ubicación. Busca por nombre o reintenta.');},
    {enableHighAccuracy:false,timeout:8000,maximumAge:60000});
  }
  return <section className={styles.picker} aria-label="Catálogo de campos">
    <h3>Clubes cerca de ti</h3><p>Usamos tu ubicación sólo para ordenar los 3 clubes más cercanos. No se guarda ni se envía al servidor.</p>
    <button type="button" className="secondary" disabled={loading||locating||!entries.length} onClick={locate}>{locating?'Buscando ubicación…':'Usar mi ubicación'}</button>
    {geo&&<p role="status">{geo}</p>}
    {nearby.map(c=><button type="button" className={styles.club} key={c.clubId} onClick={()=>selectClub(c)}><b>{c.clubName}</b><span>{[c.city,c.stateRegion].filter(Boolean).join(', ')} · {c.distanceKm.toFixed(1)} km</span></button>)}
    {geo&&!nearby.length&&!locating&&<p>No hay clubes geolocalizados disponibles en esta consulta. El buscador sigue disponible.</p>}
    {nearby.length>0&&<small>Ubicaciones con fuentes documentadas; algunas provienen de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors (ODbL)</a>.</small>}
    <AnchoredSearch label="Buscar otro campo" value={query} onChange={setQuery} placeholder="Nombre, club o nombre alternativo" expanded={Boolean(query.trim())} status={loading?'Cargando catálogo…':query.trim()&&!clubs.length?'Sin coincidencias. Puedes solicitar el campo.':`${entries.length} recorridos disponibles`}>
      {clubs.slice(0,30).map(c=><AnchoredSearchOption key={c.clubId} label={`Seleccionar ${c.clubName}`} onSelect={()=>selectClub(c)}><b>{c.clubName}</b><small>{[c.city,c.stateRegion].filter(Boolean).join(', ')}</small></AnchoredSearchOption>)}
      {clubs.length>30&&<p>Refina el nombre para ver más coincidencias.</p>}
    </AnchoredSearch>
    {error&&<p role="alert">{error} <button type="button" className="textButton" onClick={()=>setRetry(n=>n+1)}>Reintentar</button></p>}
    {!token&&<p>Inicia sesión para consultar el catálogo en revisión.</p>}
    {club&&<label>Recorrido<select aria-label="Recorrido" value={chosen} onChange={e=>void selectCourse(e.target.value)}><option value="">Selecciona recorrido</option>{entries.filter(c=>c.clubId===club).map(c=><option key={c.id} value={c.id}>{c.name} · {c.completeCards}/{c.teeCount} tarjetas</option>)}</select></label>}
    {cards.length>0&&<label>Salida / tee inicial<select aria-label="Salida del catálogo" value="" onChange={e=>{const c=cards.find(t=>t.id===e.target.value);if(c)onSelect(c,cards);}}><option value="">Elige una salida</option>{cards.map(c=><option disabled={c.holes.length!==18} key={c.id} value={c.id}>{c.teeName} · {c.holes.length===18?`${c.totalYards??'—'} yd`:'Sin tarjeta disponible'}{c.catalogReview?.issues.length?' · Datos señalados':''}</option>)}</select></label>}
    {selectedName&&<p role="status">Seleccionado: {selectedName}</p>}
    {cards.length>0&&<p>Categoría de rating por verificar. Los ratings no se aplican automáticamente; puedes registrar datos verificados manualmente. Selecciona 9/18 hoyos y después el tee de cada jugador.</p>}
    {onRequest&&<button type="button" className="textButton" onClick={onRequest}>¿No encuentras tu campo? Solicítalo</button>}
  </section>;
}

"use client";
import {useState} from 'react';
import type {PlayerTeeAssignmentSnapshot} from '../../lib/types';

export function ManualTeeRating({assignment,onSave}:{assignment:PlayerTeeAssignmentSnapshot;onSave:(value:PlayerTeeAssignmentSnapshot)=>void}) {
  const [rating,setRating]=useState(''),[slope,setSlope]=useState(''),[category,setCategory]=useState(''),[source,setSource]=useState(''),[error,setError]=useState('');
  if(!assignment.catalogReview)return null;
  return <details><summary>Captura manual de Rating/Slope</summary><div className="manualTeeRating">
    <p>Opcional. Sólo datos de 18 hoyos que hayas verificado para este tee y jugador. No habilita un índice oficial ni verifica el catálogo. Los ratings de 9 se conservan por separado.</p>
    {assignment.manualRatingDeclaration&&<p>Declarado: {assignment.rating} / {assignment.slope} · {assignment.manualRatingDeclaration.category} · {assignment.manualRatingDeclaration.source}</p>}
    <label>Course Rating · 18 hoyos<input inputMode="decimal" value={rating} onChange={e=>setRating(e.target.value)} placeholder="Por ejemplo: 72.1"/></label>
    <label>Slope · 18 hoyos<input inputMode="numeric" value={slope} onChange={e=>setSlope(e.target.value)} placeholder="55–155"/></label>
    <label>Categoría confirmada para este jugador<input value={category} maxLength={100} onChange={e=>setCategory(e.target.value)}/></label>
    <label>Fuente consultada<input value={source} maxLength={300} onChange={e=>setSource(e.target.value)} placeholder="Tarjeta del club, URL o autoridad"/></label>
    {error&&<p role="alert">{error}</p>}
    <button type="button" className="secondary" onClick={()=>{const r=Number(rating.replace(',','.')),s=Number(slope);if(!rating.trim()||!slope.trim()||!Number.isFinite(r)||r<40||r>100||!Number.isInteger(s)||s<55||s>155||!category.trim()||!source.trim()){setError('Completa Rating (40–100), Slope (55–155), categoría y fuente verificados.');return;}const at=new Date().toISOString();onSave({...assignment,rating:r,slope:s,source:'manual',indexRatingEvidence:undefined,manualRatingDeclaration:{category:category.trim(),source:source.trim(),declaredAt:at,holes:18},capturedAt:at});setError('');}}>Guardar declaración manual</button>
  </div></details>;
}

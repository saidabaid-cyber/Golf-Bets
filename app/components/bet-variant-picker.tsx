"use client";
import {useEffect,useState} from "react";
import type {BetVariant} from "../../lib/admin-bet-variants";
import type {Player} from "../../lib/types";
export function BetVariantPicker({players,ownerId,apply}:{players:Player[];ownerId:string;apply:(variant:BetVariant,rivalId?:string)=>void}) {
 const [items,setItems]=useState<BetVariant[]>([]),[selected,setSelected]=useState(""),[rivalId,setRivalId]=useState(""),[error,setError]=useState("");
 useEffect(()=>{const controller=new AbortController();void fetch("/api/catalog/bet-variants",{cache:"no-store",signal:controller.signal}).then(async response=>{if(response.ok)setItems((await response.json()).items||[]);}).catch(()=>{});return()=>controller.abort();},[]);
 const variant=items.find(item=>item.id===selected);
 if(!items.length)return null;
 return <details className="card"><summary>Usar una apuesta configurada por el club</summary><label>Variante<select value={selected} onChange={event=>{setSelected(event.target.value);setError("");}}><option value="">Selecciona una variante</option>{items.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{variant?.engine==="individual_nassau"&&<label>Rival<select value={rivalId} onChange={event=>setRivalId(event.target.value)}><option value="">Selecciona un rival</option>{players.filter(player=>player.id!==ownerId).map(player=><option key={player.id} value={player.id}>{player.name}</option>)}</select></label>}{variant&&<p>{variant.description} · {variant.minPlayers}–{variant.maxPlayers} jugadores. Revisa los montos antes de iniciar.</p>}{error&&<p role="alert" className="notice bad">{error}</p>}<button type="button" className="secondary" disabled={!variant} onClick={()=>{try{if(variant)apply(variant,rivalId);}catch(error){setError(error instanceof Error?error.message:"Revisa la configuración.");}}}>Aplicar configuración</button></details>;
}

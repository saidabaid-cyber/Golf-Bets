"use client";
import { useState } from "react";
export function AdminNumericValues({label,value,change,min=0,max=300}:{label:string;value:unknown;change:(value:unknown)=>void;min?:number;max?:number}) {
  const [next,setNext]=useState("");
  const values=Array.isArray(value)?value.map(Number):String(value||"").split(",").filter(item=>item.trim()).map(Number);
  return <div className="adminV2Stack"><label>{label}<input type="number" inputMode="decimal" min={min} max={max} step="any" value={next} onChange={event=>setNext(event.target.value)} placeholder="Agregar valor"/></label><div className="adminV2Chips">{values.map(number=><button className="secondary" type="button" key={number} aria-label={"Quitar "+number} onClick={()=>change(values.filter(value=>value!==number))}>{number} ×</button>)}<button className="secondary" type="button" disabled={!next||!Number.isFinite(Number(next))||Number(next)<min||Number(next)>max} onClick={()=>{change([...new Set([...values,Number(next)])]);setNext("");}}>+ Agregar valor</button></div></div>;
}
export function AdminHandedness({value,change}:{value:unknown;change:(value:unknown)=>void}) {
  const values=Array.isArray(value)?value:String(value||"").split(",").map(value=>value.trim()).filter(Boolean);
  const selected=values.length===2?"both":values[0]||"";
  return <label>Mano<select value={selected} onChange={event=>change(event.target.value==="both"?["RH","LH"]:event.target.value?[event.target.value]:[])}><option value="">Sin especificar</option><option value="RH">RH · Derecha</option><option value="LH">LH · Izquierda</option><option value="both">RH / LH · Ambas</option></select></label>;
}

"use client";
import { useRef, useState } from "react";

export type GhinPostingRequest = (body?: {operation:"dry-run"|"post"|"verify";roundId:string;fingerprint?:string;confirm?:boolean}) => Promise<Record<string,unknown>>;
type Item={id:string;date:string;course:string;tee:string;gross:number;receipt:string|null};
export function GhinPostingPanel({request,onReauthorize}:{request:GhinPostingRequest;onReauthorize:()=>void}) {
  const [items,setItems]=useState<Item[]>([]),[roundId,setRoundId]=useState(""),[result,setResult]=useState<Record<string,unknown>|null>(null);
  const [busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
  const inFlight=useRef(false);
  async function run(operation?:"dry-run"|"post"|"verify") {
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);
    try{
      const r=await request(operation?{operation,roundId,...(operation==="post"?{fingerprint:String(result?.fingerprint??""),confirm:confirmed}: {})}:undefined);
      if(!operation && Array.isArray(r.items)){setItems(r.items as Item[]);setRoundId((r.items as Item[])[0]?.id??"");setResult(null);}
      else setResult(r);
    } catch(error){setResult({code:error instanceof Error?error.message:"REQUEST_FAILED"});}
    finally{inFlight.current=false;setBusy(false);}
  }
  const canPost=result?.status==="READY" && result.roundId===roundId && confirmed;
  const canVerify=result?.code==="POSTED"||result?.code==="ALREADY_POSTED"||result?.code==="PROVIDER_ACK_RECEIPT_PENDING";
  return <details><summary>Publicar tarjeta en GHIN · QA DEV</summary>
    <p>Revisa una tarjeta completa antes de enviarla a tu cuenta GHIN. Una publicación confirmada queda vinculada a la ronda original.</p>
    <button type="button" className="secondary" disabled={busy} onClick={()=>void run()}>VER RONDAS PARA REVISAR</button>
    {!!items.length && <><label>Ronda Backyard<select value={roundId} disabled={busy} onChange={e=>{setRoundId(e.target.value);setResult(null);setConfirmed(false);}}>
      {items.map(r=><option key={r.id} value={r.id}>{r.date} · {r.course} · {r.tee} · {r.gross}{r.receipt?` · ${r.receipt}`:""}</option>)}</select></label>
      <button type="button" className="secondary" disabled={busy||!roundId} onClick={()=>void run("dry-run")}>VALIDAR SIN PUBLICAR</button></>}
    {result && <section aria-label="Validación GHIN"><p role="status">{String(result.code??result.status??"Respuesta recibida")}</p>
      {result.status==="READY" && <><dl>{[["Ronda",result.roundId],["Fecha",result.date],["Campo",result.course],["Tee",result.tee],["Course ID",result.providerCourseId],["Tee ID",result.providerTeeId],["Score",result.gross],["Hoyos",result.holes],["Gender",result.gender],["Score type",result.scoreType],["Fingerprint",result.fingerprint]].map(([k,v])=><div key={String(k)}><dt>{String(k)}</dt><dd style={{overflowWrap:"anywhere"}}>{String(v)}</dd></div>)}</dl>
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo publicar esta tarjeta QA en mi GHIN vinculado.</label>
        <button type="button" className="primary" disabled={busy||!canPost} onClick={()=>void run("post")}>PUBLICAR ESTA TARJETA</button></>}
      {result.code==="REAUTH_REQUIRED" && <button type="button" className="secondary" onClick={onReauthorize}>REAUTORIZAR GHIN</button>}
      {result.providerScoreId!=null && <p>Provider score ID: {String(result.providerScoreId)}</p>}
      {canVerify && <button type="button" className="secondary" disabled={busy} onClick={()=>void run("verify")}>CONFIRMAR EN GHIN</button>}
      {result.code==="PROVIDER_CONFIRMED" && <p>Confirmada una sola tarjeta en GHIN. Sincroniza tarjetas para verla vinculada en Histórico.</p>}
      {Array.isArray(result.errors)&&result.errors.length>0 && <p>{result.errors.map(String).join(" · ")}</p>}
    </section>}
    {busy && <p role="status">Verificando…</p>}
  </details>;
}

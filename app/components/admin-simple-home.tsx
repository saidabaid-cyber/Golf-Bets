"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useBackyardAccount } from "./account-provider";
import { BackyardWordmark } from "./primary-header";
import { AdminModeMenu } from "./admin-mode-menu";
import type {AdminRequestSeed} from "../../lib/admin-request-operations";
import type { SimpleAdminModule } from "../../lib/admin-mode";
const Administrators = dynamic(() => import("./admin-administrators").then(m => m.AdminAdministrators));
const Catalog = dynamic(() => import("./admin-visual-catalog").then(m=>m.AdminVisualCatalog));
const Presentation=dynamic(()=>import("./admin-presentation-editor").then(m=>m.AdminPresentationEditor));
const Audit=dynamic(()=>import("./admin-audit").then(m=>m.AdminAudit));
const Requests=dynamic(()=>import("./admin-requests").then(m=>m.AdminRequests));
const BetVariants=dynamic(()=>import("./admin-bet-variants").then(m=>m.AdminBetVariants));

const LABELS: Record<SimpleAdminModule, [string, string]> = {
  courses: ["Campos", "Información, tees y tarjetas"], equipment: ["Equipment", "Marcas, modelos y varillas"], balls: ["Bolas / Ball Fit", "Catálogo y configuración segura"], bets: ["Apuestas", "Motores y variantes"], competitions: ["Torneos", "Organiza y publica"], requests: ["Solicitudes", "Resuelve lo que pide tu comunidad"], users: ["Usuarios", "Perfiles y estado"], content: ["Contenido", "Textos de la app"], administrators: ["Administradores", "Asigna o retira permisos"], audit: ["Auditoría", "Cambios registrados"], advanced: ["Administración avanzada", "Importaciones y operaciones técnicas"],
};
const PRIMARY: SimpleAdminModule[] = ["courses", "equipment", "bets", "competitions", "requests"];
const SECONDARY: SimpleAdminModule[] = ["balls", "users"];
const ADVANCED: SimpleAdminModule[] = ["content", "administrators", "audit", "advanced"];
export function AdminSimpleHome() {
  const { identity, adminAccess } = useBackyardAccount(); const token = identity.accessToken || "";
  const [modules, setModules] = useState<SimpleAdminModule[]>([]); const [error, setError] = useState(""); const [selected, setSelected] = useState<SimpleAdminModule | null>(null);
  const [requestSeed,setRequestSeed]=useState<AdminRequestSeed|null>(null);
  const [ballSection,setBallSection]=useState("catalog");
  useEffect(() => {
    if (!token) return; const controller = new AbortController();
    void fetch("/api/admin/simple", { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error); setModules(body.modules); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [token]);
  return <main className="adminV2"><header className="adminV2Header"><Link href="/" aria-label="The Backyard · Inicio"><BackyardWordmark /></Link><AdminModeMenu /></header><div className="adminV2Title"><div><p className="adminV2Eyebrow">Modo administrador</p><h1>{selected ? LABELS[selected][0] : "Tu comunidad, en tus manos"}</h1></div><Link className="secondary" href="/">Volver a modo jugador</Link></div>
    {error && <p className="notice bad" role="alert">{error}</p>}
    {!token && <p className="notice">Inicia sesión con una cuenta administradora para continuar.</p>}
    {token && !adminAccess.hasAccess && !error && <p className="notice">Comprobando permisos…</p>}
    {selected && <button type="button" className="textButton" onClick={() => setSelected(null)}>← Volver a administración</button>}
    {!selected && <div className="adminV2Stack">{[PRIMARY, SECONDARY].map((group, index) => <section key={index} aria-label={index ? "Catálogos y comunidad" : "Operación principal"} className={index ? "adminV2Secondary" : "adminV2Grid"}>{group.filter(module => modules.includes(module)).map(module => <button className="adminV2Module" key={module} onClick={() => setSelected(module)}><div><h2>{LABELS[module][0]}</h2><p>{LABELS[module][1]}</p></div><span aria-hidden="true">→</span></button>)}</section>)}<details className="adminV2Advanced"><summary>Más / Avanzado</summary><div className="adminV2Secondary">{ADVANCED.filter(module => modules.includes(module)).map(module => module === "advanced" ? <Link className="adminV2Module" key={module} href="/admin"><h2>{LABELS[module][0]}</h2><span aria-hidden="true">→</span></Link> : <button className="adminV2Module" key={module} onClick={() => setSelected(module)}><h2>{LABELS[module][0]}</h2><span aria-hidden="true">→</span></button>)}</div></details></div>}
    {selected === "administrators" && <Administrators token={token} />}
    {selected === "users" && <Administrators token={token} readOnly />}
    {selected==="balls"&&<div className="adminV2Tabs"><button className={ballSection==="catalog"?"primary":"secondary"} onClick={()=>setBallSection("catalog")}>Bolas · catálogo</button><button className={ballSection==="fit"?"primary":"secondary"} onClick={()=>setBallSection("fit")}>Ball Fit</button></div>}
    {(selected === "courses"||selected==="equipment"||selected==="balls"&&ballSection==="catalog"||selected==="competitions") && <Catalog key={selected} token={token} module={selected} requestSeed={requestSeed} onRequestConsumed={()=>setRequestSeed(null)} />}
    {selected==="balls"&&ballSection==="fit"&&<><p className="notice">Administra el contenido seguro de Ball Fit. Los algoritmos y fórmulas permanecen en desarrollo / administración avanzada.</p>{modules.includes("content")?<Presentation token={token} module="content" onlyKey="coach_ball_fit"/>:<p>Tu permiso permite administrar el catálogo. La configuración de contenido requiere permisos adicionales.</p>}</>}
    {selected==="bets"&&<><BetVariants token={token}/><details><summary>Presentación de motores existentes</summary><Presentation token={token} module="bets"/></details></>}
    {selected==="content"&&<Presentation token={token} module="content"/>}
    {selected==="requests"&&<Requests token={token} onCreate={(module,request)=>{if(modules.includes(module)){setRequestSeed(request);setSelected(module);}}}/>}
    {selected==="audit"&&<Audit token={token}/>}

    
    {selected && <button type="button" className="textButton" onClick={() => setSelected(null)}>← Volver a administración</button>}
  </main>;
}

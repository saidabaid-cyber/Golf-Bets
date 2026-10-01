"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useBackyardAccount } from "./account-provider";
import { BackyardWordmark } from "./primary-header";
import { AdminModeMenu } from "./admin-mode-menu";
import type { SimpleAdminModule } from "../../lib/admin-mode";
const Administrators = dynamic(() => import("./admin-administrators").then(m => m.AdminAdministrators));
const Catalog = dynamic(() => import("./admin-visual-catalog").then(m=>m.AdminVisualCatalog));
const LABELS: Record<SimpleAdminModule, [string, string]> = {
  courses: ["Campos", "Información, tees, tarjetas y reglas locales"], equipment: ["Equipment", "Marcas, modelos y varillas"], balls: ["Bolas / Ball Fit", "Catálogo y opciones seguras"], bets: ["Apuestas", "Presentación y disponibilidad"], competitions: ["Torneos y competiciones", "Organiza y publica"], requests: ["Solicitudes", "Revisa lo que pide tu comunidad"], users: ["Usuarios", "Consulta perfiles y estado"], content: ["Contenido", "Textos de la app"], administrators: ["Administradores", "Asigna o retira permisos"], audit: ["Auditoría", "Consulta cambios registrados"], advanced: ["Administración avanzada", "Importaciones y operaciones técnicas"],
};
export function AdminSimpleHome() {
  const { identity, adminAccess } = useBackyardAccount(); const token = identity.accessToken || "";
  const [modules, setModules] = useState<SimpleAdminModule[]>([]); const [error, setError] = useState(""); const [selected, setSelected] = useState<SimpleAdminModule | null>(null);
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
    {!selected && <div className="adminV2Grid">{modules.map(module => module === "advanced" ? <Link className="card adminV2Module" key={module} href="/admin"><h2>{LABELS[module][0]}</h2><p>{LABELS[module][1]}</p><span>Abrir →</span></Link> : <button className="card adminV2Module" key={module} onClick={() => setSelected(module)}><h2>{LABELS[module][0]}</h2><p>{LABELS[module][1]}</p><span>Administrar →</span></button>)}</div>}
    {selected === "administrators" && <Administrators token={token} />}
    {selected === "users" && <Administrators token={token} readOnly />}
    {(selected === "courses"||selected==="equipment"||selected==="balls") && <Catalog key={selected} token={token} module={selected} />}
    {selected && !["administrators", "users", "courses", "equipment", "balls"].includes(selected) && <p className="notice">Cargando módulo…</p>}
    {selected && <button type="button" className="textButton" onClick={() => setSelected(null)}>← Volver a administración</button>}
  </main>;
}

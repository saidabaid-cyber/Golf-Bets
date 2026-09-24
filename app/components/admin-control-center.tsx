"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { useBackyardAccount } from "./account-provider";
import styles from "../admin/admin.module.css";

type View = "dashboard" | "courses" | "course-ops" | "rules" | "equipment" | "imports" | "quality" | "competitions" | "requests" | "revisions" | "audit";
type Json = Record<string, unknown>;
type Revision = Json & { id: string; entity_type: string; entity_id: string; version: number; status: string; provenance_status: string; preview_hash?: string | null };
type OperationsHole = { id: string; sourceBaseHoleId: string | null; sourceBaseHoleNumber: number | null; displayLabel: string; par: number; strokeIndex: number; playable: boolean; temporaryGreen?: boolean; temporaryTee?: boolean; dropZoneNote?: string | null; operationalNote?: string | null };
type CourseOperationsBaseResponse = { item?: { holes?: Array<{ id: string; holeNumber: number; par: number; strokeIndex: number }>; tees?: Array<{ id: string; name: string }> } };
type OperationRow = OperationsHole & { clientKey: string; kind: "BASE" | "TEMPORARY"; yardOverrides: Record<string, string> };
type OperationRating = { rating: string; slope: string; category: string };
type TeeDraft = { key: string; id: string; name: string; color: string; category: string; rating: string; slope: string; frontRating: string; backRating: string };
type HoleDraft = { par: string; strokeIndex: string; yards: Record<string, string> };
type WedgeVariantDraft = { key: string; loft: string; bounce: string; grind: string };

const NAVIGATION: readonly { group: string; items: readonly { id: View; label: string }[] }[] = [
  { group: "OPERACIÓN", items: [{ id: "dashboard", label: "Dashboard" }, { id: "revisions", label: "Publicaciones pendientes" }, { id: "requests", label: "Solicitudes" }] },
  { group: "CAMPOS", items: [{ id: "courses", label: "Catálogo" }, { id: "course-ops", label: "Configuraciones temporales" }, { id: "rules", label: "Reglas locales" }] },
  { group: "CATÁLOGOS", items: [{ id: "equipment", label: "Equipment" }, { id: "imports", label: "Importaciones" }, { id: "quality", label: "Calidad de datos" }] },
  { group: "EVENTOS", items: [{ id: "competitions", label: "Competiciones" }, { id: "audit", label: "Auditoría" }] },
] as const;

function object(value: unknown): Json | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null; }
function list(value: unknown): Json[] { return Array.isArray(value) ? value.filter((item): item is Json => object(item) !== null) : []; }
function message(value: unknown, fallback: string) { return object(value) && typeof object(value)?.error === "string" ? object(value)?.error as string : fallback; }
function stringValue(value: FormDataEntryValue | null) { return typeof value === "string" ? value.trim() : ""; }
function optionalNumber(value: string) { const parsed = Number(value); return value && Number.isFinite(parsed) ? parsed : null; }
function csv(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
function stableId(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 180); }
function schedule(form: FormData) { const from = stringValue(form.get("effectiveFrom")); const until = stringValue(form.get("effectiveUntil")); return { effectiveFrom: from ? new Date(from).toISOString() : null, effectiveUntil: until ? new Date(until).toISOString() : null }; }
function dateTimeLocal(value: unknown) { if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function textList(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function isQaItem(value: Json) { return typeof value.data_environment === "string" && value.data_environment !== "PRODUCTION"; }

function QaBadge({ item }: { item: Json }) {
  return isQaItem(item) ? <span className={styles.badge}>{String(item.data_environment)}</span> : null;
}

function Workflow() {
  return <div className={styles.workflow} aria-label="Flujo de publicación"><span>Draft</span><i>→</i><span>Preview</span><i>→</i><span>Diff</span><i>→</i><span>Confirm</span><i>→</i><span>Publish</span></div>;
}

function Field({ label, name, required, type = "text", placeholder, defaultValue }: { label: string; name: string; required?: boolean; type?: string; placeholder?: string; defaultValue?: string }) {
  return <label>{label}<input name={name} required={required} type={type} placeholder={placeholder} defaultValue={defaultValue} /></label>;
}

function StructuredValues({ label, values, onChange, numeric = false, placeholder }: { label: string; values: string[]; onChange: (values: string[]) => void; numeric?: boolean; placeholder: string }) {
  return <fieldset className={styles.structuredList}><legend>{label}</legend>
    {values.map((value, index) => <div key={`${label}-${index}`}><input aria-label={`${label} ${index + 1}`} type={numeric ? "number" : "text"} inputMode={numeric ? "decimal" : undefined} value={value} placeholder={placeholder} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><button type="button" className={styles.danger} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button></div>)}
    <button type="button" onClick={() => onChange([...values, ""])}>+ Agregar opción</button>
  </fieldset>;
}

function EvidenceFields({ initial }: { initial?: Json | null } = {}) {
  return <>
    <Field label="Fuente" name="sourceName" required placeholder="Documento, fabricante u organismo" defaultValue={typeof initial?.sourceName === "string" ? initial.sourceName : ""} />
    <Field label="URL de evidencia" name="sourceUrl" type="url" placeholder="https://…" defaultValue={typeof initial?.sourceUrl === "string" ? initial.sourceUrl : ""} />
    <Field label="Fecha verificada" name="verifiedAt" type="datetime-local" defaultValue={dateTimeLocal(initial?.verifiedAt)} />
    <Field label="Visible desde (opcional)" name="effectiveFrom" type="datetime-local" />
    <Field label="Visible hasta (opcional)" name="effectiveUntil" type="datetime-local" />
  </>;
}

export function AdminControlCenter() {
  const { identity, openAccess } = useBackyardAccount();
  const token = identity.mode === "authenticated" ? identity.accessToken : null;
  const [view, setView] = useState<View>("dashboard");
  const [data, setData] = useState<Json | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showQa, setShowQa] = useState(false);

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    if (!token) throw new Error("Inicia sesión para continuar.");
    const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${token}`, ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers }, cache: "no-store" });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(message(payload, "No fue posible completar la operación."));
    return object(payload) || {};
  }, [token]);

  const load = useCallback(async (nextView: View = view) => {
    if (!token) return;
    setLoading(true); setError("");
    try {
      const result = await api(`/api/admin/control-center?view=${nextView}&limit=100${showQa ? "&includeQa=1" : ""}`);
      setData(result); setAuthorized(true);
    } catch (loadError) {
      setData(null); setAuthorized(false); setError(loadError instanceof Error ? loadError.message : "No fue posible validar el acceso.");
    } finally { setLoading(false); }
  }, [api, showQa, token, view]);

  useEffect(() => { if (token) void load(view); }, [load, token, view]);

  async function mutate(payload: Json, done: string, nextView?: View) {
    setLoading(true); setError(""); setSuccess("");
    try {
      await api("/api/admin/control-center", { method: "POST", body: JSON.stringify(payload) });
      setSuccess(done);
      if (nextView) setView(nextView); else await load(view);
    } catch (mutationError) { setError(mutationError instanceof Error ? mutationError.message : "No fue posible guardar."); }
    finally { setLoading(false); }
  }

  if (!token) return <main className={styles.page}><section className={styles.authCard}><p className={styles.eyebrow}>THE BACKYARD · ADMIN</p><h1>Control Center</h1><p>Esta ruta sólo aparece para membresías administrativas verificadas en el servidor.</p><button type="button" onClick={openAccess}>Iniciar sesión</button><Link href="/">Volver a The Backyard</Link></section></main>;
  if (!authorized && !loading) return <main className={styles.page}><section className={styles.authCard}><p className={styles.eyebrow}>ACCESO RESTRINGIDO</p><h1>Admin no disponible</h1><p>{error || "Esta cuenta no tiene acceso administrativo."}</p><button type="button" onClick={() => void load("dashboard")}>Volver a validar</button><Link href="/">Volver a The Backyard</Link></section></main>;

  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>THE BACKYARD · ADMIN CONTROL CENTER v1</p><h1>Operación verificable.</h1><p>Datos publicados sin deployment, con versión, evidencia y auditoría.</p></div><Link href="/">Volver a la app</Link></header>
    <div className={styles.adminShell}>
      <aside className={styles.sidebar} aria-label="Navegación administrativa">{NAVIGATION.map((section) => <div key={section.group} style={{ display: "contents" }}><strong>{section.group}</strong>{section.items.map((item) => <button type="button" data-active={view === item.id} key={item.id} onClick={() => { setSuccess(""); setError(""); setView(item.id); }}>{item.label}</button>)}</div>)}</aside>
      <section className={styles.workspace}>
        {data?.canShowQa === true && <label className={styles.checkbox}><input type="checkbox" checked={showQa} onChange={(event) => setShowQa(event.target.checked)} /> Mostrar QA/Test <span className={styles.subtle}>Sólo SUPER_ADMIN</span></label>}
        {loading && <div className={styles.notice} role="status">Validando permisos y datos…</div>}
        {error && <div className={styles.error} role="alert">{error}</div>}
        {success && <div className={styles.success} role="status">{success}</div>}
        {view === "dashboard" && <Dashboard data={data} />}
        {view === "courses" && <CourseWorkspace data={data} loading={loading} request={api} showQa={showQa} submit={(payload) => mutate(payload, "Borrador de campo creado. Falta Review, Verify y Publish.", "revisions")} />}
        {view === "equipment" && <><EquipmentWorkspace data={data} loading={loading} request={api} showQa={showQa} submit={(payload) => mutate(payload, "Borrador de equipment creado sin publicarlo.", "revisions")} /><AssetEditor token={token} /></>}
        {view === "rules" && <RuleEditor loading={loading} submit={(payload) => mutate(payload, "Reglas locales guardadas como Draft.", "revisions")} />}
        {view === "competitions" && <CompetitionEditor loading={loading} submit={(payload) => mutate(payload, "Competición y reglamento guardados como Draft.", "revisions")} items={list(data?.items)} />}
        {view === "course-ops" && <CourseOperations loading={loading} submit={(payload) => mutate(payload, "Configuración temporal creada como Draft.")} request={api} refresh={() => load("course-ops")} items={list(data?.items)} />}
        {view === "imports" && <ImportEditor loading={loading} request={api} />}
        {view === "requests" && <Requests items={list(data?.items)} loading={loading} onConvert={(id, entityType) => mutate({ operation: "createDraftFromRequest", feedbackId: id, entityType }, "Solicitud convertida en Draft; no fue publicada.")} />}
        {view === "revisions" && <PublicationQueue items={list(data?.items) as Revision[]} loading={loading} mutate={mutate} request={api} />}
        {view === "quality" && <Quality data={data} />}
        {view === "audit" && <Audit items={list(data?.items)} />}
      </section>
    </div>
  </main>;
}

function Dashboard({ data }: { data: Json | null }) {
  const counts = object(data?.counts) || {};
  const qaCounts = object(data?.qaCounts) || {};
  const stats = [["Revisiones", counts.revisions], ["Pendientes", counts.pending], ["Configuraciones", counts.configurations], ["Competiciones", counts.competitions], ["Imports", counts.imports], ["Solicitudes", counts.requests]];
  // "pending" is a subset of revisions, so it must not inflate the internal total.
  const qaTotal = ["revisions", "configurations", "competitions", "imports", "requests"].reduce((total, key) => total + (typeof qaCounts[key] === "number" ? Number(qaCounts[key]) : 0), 0);
  return <><section className={styles.stats}>{stats.map(([label, value]) => <article className={styles.stat} key={String(label)}><span>{String(label)}</span><b>{typeof value === "number" ? value : "—"}</b></article>)}</section>{data?.canShowQa === true && qaTotal > 0 && <section className={styles.card}><div className={styles.sectionTitle}><div><h2>Datos QA/Test</h2><p>Separados de los KPIs operativos. Activa “Mostrar QA/Test” sólo cuando necesites revisar evidencia interna.</p></div><span className={styles.badge}>{qaTotal} INTERNOS</span></div></section>}<section className={styles.card}><div className={styles.sectionTitle}><div><h2>Publicación controlada</h2><p>Nada enviado por usuarios llega directamente al catálogo de jugadores.</p></div></div><Workflow /><div className={styles.notice}>Las publicaciones nuevas se resuelven desde Admin Published DB sobre el catálogo seed versionado. Los IDs históricos y Mi Bolsa permanecen resolubles.</div></section></>;
}

function CourseWorkspace({ data, loading, request, submit, showQa }: { data: Json | null; loading: boolean; request: (path: string, options?: RequestInit) => Promise<Json>; submit: (payload: Json) => void; showQa: boolean }) {
  const [items, setItems] = useState<Json[]>(() => list(data?.items));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Json | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => { setItems(list(data?.items)); }, [data]);
  async function search() {
    setStatus("Buscando en catálogo publicado…");
    try { const result = await request(`/api/admin/control-center?view=courses&limit=100&q=${encodeURIComponent(query)}${showQa ? "&includeQa=1" : ""}`); setItems(list(result.items)); setStatus(""); }
    catch (error) { setStatus(error instanceof Error ? error.message : "No fue posible buscar."); }
  }
  async function open(courseId: string) {
    setStatus("Cargando versión publicada…");
    try { const result = await request(`/api/admin/control-center?view=courses&courseId=${encodeURIComponent(courseId)}${showQa ? "&includeQa=1" : ""}`); setSelected(object(result.item)); setStatus("Editas una nueva versión; lo publicado y los históricos no cambian hasta confirmar Publish."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "No fue posible abrir el campo."); }
  }
  const selectedCourse = object(selected?.course);
  return <>
    <section className={styles.card}><div className={styles.sectionTitle}><div><h2>Catálogo de campos</h2><p>Busca el catálogo vigente y abre un recorrido para preparar una versión nueva, sin edición destructiva.</p></div><span className={styles.badge}>LAYERED COURSE PROVIDER</span></div><div className={styles.toolbar}><label>Nombre, alias, club o ciudad<input value={query} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" disabled={loading} onClick={() => void search()}>Buscar</button><button type="button" onClick={() => { setSelected(null); setStatus("Nuevo Draft vacío."); }}>+ Nuevo campo</button></div>{status && <div className={styles.notice}>{status}</div>}<div className={styles.list}>{items.map((item) => { const revision = object(item.adminRevision); return <article className={styles.item} key={String(item.id)}><div><strong>{String(item.clubName)} · {String(item.name)}</strong><span>{String(item.holes)} hoyos · {String(item.city || "ubicación pendiente")}</span><em>{revision ? `Admin v${String(revision.version)} · ${String(revision.status)}` : String(item.provider || "Catálogo vigente")}</em><QaBadge item={item} /></div><button type="button" onClick={() => void open(String(item.id))}>Abrir / nueva versión</button></article>; })}</div></section>
    <CourseEditor key={selectedCourse ? `course-${String(selectedCourse.id)}` : "new-course"} initial={selected} loading={loading} submit={submit} />
  </>;
}

function CourseEditor({ loading, submit, initial = null }: { loading: boolean; submit: (payload: Json) => void; initial?: Json | null }) {
  const initialCourse = object(initial?.course); const initialClub = object(initial?.club);
  const initialTeeRows = list(initial?.tees); const initialHoleRows = list(initial?.holes); const initialYardages = list(initial?.teeHoleYardages);
  const initialHoleCount: 9 | 18 = Number(initialCourse?.holes) === 9 ? 9 : 18;
  const [holeCount, setHoleCount] = useState<9 | 18>(initialHoleCount);
  const [includeScorecard, setIncludeScorecard] = useState(initialHoleRows.length === initialHoleCount);
  const [tees, setTees] = useState<TeeDraft[]>(() => initialTeeRows.map((tee) => ({ key: String(tee.id), id: String(tee.id), name: String(tee.name || ""), color: String(tee.color || ""), category: String(tee.gender || ""), rating: tee.rating == null ? "" : String(tee.rating), slope: tee.slope == null ? "" : String(tee.slope), frontRating: tee.frontNineRating == null ? "" : String(tee.frontNineRating), backRating: tee.backNineRating == null ? "" : String(tee.backNineRating) })));
  const [holes, setHoles] = useState<HoleDraft[]>(() => Array.from({ length: initialHoleCount }, (_, index) => {
    const hole = initialHoleRows.find((row) => Number(row.holeNumber) === index + 1);
    const yards = Object.fromEntries(initialTeeRows.map((tee) => [String(tee.id), String(initialYardages.find((row) => String(row.teeId) === String(tee.id) && Number(row.holeNumber) === index + 1)?.yards ?? "")]));
    return { par: hole?.par == null ? "" : String(hole.par), strokeIndex: hole?.strokeIndex == null ? "" : String(hole.strokeIndex), yards };
  }));
  function changeHoleCount(next: 9 | 18) {
    setHoleCount(next);
    setHoles((current) => Array.from({ length: next }, (_, index) => current[index] || { par: "", strokeIndex: "", yards: {} }));
  }
  function addTee() { setTees((current) => [...current, { key: crypto.randomUUID(), id: "", name: "", color: "", category: "", rating: "", slope: "", frontRating: "", backRating: "" }]); }
  function updateTee(index: number, changes: Partial<TeeDraft>) { setTees((current) => current.map((tee, teeIndex) => teeIndex === index ? { ...tee, ...changes } : tee)); }
  function updateHole(index: number, changes: Partial<HoleDraft>) { setHoles((current) => current.map((hole, holeIndex) => holeIndex === index ? { ...hole, ...changes } : hole)); }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const clubId = stringValue(form.get("clubId")); const courseId = stringValue(form.get("courseId")); const verifiedAt = stringValue(form.get("verifiedAt"));
    const sourceName = stringValue(form.get("sourceName")); const sourceUrl = stringValue(form.get("sourceUrl"));
    const normalizedTees = tees.map((tee) => {
      const id = tee.id || `${courseId}-tee-${stableId(tee.name)}`;
      const yardages = holes.map((hole) => optionalNumber(hole.yards[tee.key] || ""));
      return { id, courseId, name: tee.name.trim(), color: tee.color.trim() || null, category: tee.category.trim() || null, rating: optionalNumber(tee.rating), slope: optionalNumber(tee.slope), frontRating: optionalNumber(tee.frontRating), backRating: optionalNumber(tee.backRating), totalYards: yardages.every((yards) => yards !== null) ? yardages.reduce<number>((total, yards) => total + (yards || 0), 0) : null, active: true };
    });
    const normalizedHoles = includeScorecard ? holes.map((hole, index) => ({ id: `${courseId}-h${index + 1}`, courseId, holeNumber: index + 1, par: Number(hole.par), strokeIndex: Number(hole.strokeIndex) })) : [];
    const teeHoleYardages = includeScorecard ? normalizedTees.flatMap((tee, teeIndex) => holes.flatMap((hole, index) => {
      const yards = optionalNumber(hole.yards[tees[teeIndex].key] || "");
      return yards === null ? [] : [{ teeId: tee.id, holeId: `${courseId}-h${index + 1}`, holeNumber: index + 1, yards }];
    })) : [];
    submit({ operation: "createRevision", entityType: "COURSE", entityId: courseId, scopeType: "COURSE", scopeId: courseId, sourceType: "ADMIN_RESEARCH", sourceName, sourceUrl: sourceUrl || null, verifiedAt: verifiedAt ? new Date(verifiedAt).toISOString() : null, provenanceStatus: verifiedAt && sourceName ? "VERIFIED" : "REVIEWED", confidence: "HIGH", ...schedule(form), payload: { sourceName, sourceUrl: sourceUrl || null, verifiedAt: verifiedAt ? new Date(verifiedAt).toISOString() : null, club: { id: clubId, name: stringValue(form.get("clubName")), aliases: csv(stringValue(form.get("clubAliases"))), country: stringValue(form.get("country")) || null, stateRegion: stringValue(form.get("state")) || null, city: stringValue(form.get("city")) || null, address: stringValue(form.get("address")) || null, latitude: optionalNumber(stringValue(form.get("latitude"))), longitude: optionalNumber(stringValue(form.get("longitude"))), timezone: stringValue(form.get("timezone")) || null, website: stringValue(form.get("website")) || null, active: true }, course: { id: courseId, clubId, name: stringValue(form.get("courseName")), aliases: csv(stringValue(form.get("courseAliases"))), holes: holeCount, active: true }, tees: normalizedTees, holes: normalizedHoles, teeHoleYardages } });
  }
  return <section className={styles.card}><div className={styles.sectionTitle}><div><h2>{initialCourse ? "Nueva versión del campo" : "Nuevo campo"}</h2><p>Club, recorrido, tees y tarjeta conservan identidades separadas. Nada se completa por inferencia.</p></div><span className={styles.badge}>COURSE CATALOG</span></div><Workflow /><form className={styles.form} onSubmit={save}><Field label="Nombre oficial del club" name="clubName" required defaultValue={String(initialClub?.name || "")} /><Field label="ID estable del club" name="clubId" required placeholder="club-estable" defaultValue={String(initialClub?.id || "")} /><Field label="Aliases del club" name="clubAliases" placeholder="Separados por coma" defaultValue={textList(initialClub?.aliases).join(", ")} /><Field label="Recorrido" name="courseName" required defaultValue={String(initialCourse?.name || "")} /><Field label="ID estable del recorrido" name="courseId" required placeholder="recorrido-estable" defaultValue={String(initialCourse?.id || "")} /><Field label="Aliases del recorrido" name="courseAliases" placeholder="Separados por coma" defaultValue={textList(initialCourse?.aliases).join(", ")} /><label>Hoyos<select value={holeCount} onChange={(event) => changeHoleCount(Number(event.target.value) as 9 | 18)}><option value="18">18</option><option value="9">9</option></select></label><Field label="País" name="country" defaultValue={String(initialClub?.country || "")} /><Field label="Estado / región" name="state" defaultValue={String(initialClub?.stateRegion || "")} /><Field label="Ciudad" name="city" defaultValue={String(initialClub?.city || "")} /><Field label="Dirección" name="address" defaultValue={String(initialClub?.address || "")} /><Field label="Timezone" name="timezone" placeholder="America/Mexico_City" defaultValue={String(initialClub?.timezone || "")} /><Field label="Latitude (sólo evidencia)" name="latitude" type="number" defaultValue={initialClub?.latitude == null ? "" : String(initialClub.latitude)} /><Field label="Longitude (sólo evidencia)" name="longitude" type="number" defaultValue={initialClub?.longitude == null ? "" : String(initialClub.longitude)} /><Field label="Website" name="website" type="url" defaultValue={String(initialClub?.website || "")} />
    <div className={`${styles.wide} ${styles.sectionTitle}`}><div><h3>Tees</h3><p>Color y categoría son datos distintos. Rating/Slope sólo con evidencia.</p></div><button type="button" onClick={addTee}>+ Agregar tee</button></div>
    {tees.map((tee, index) => <div className={`${styles.wide} ${styles.inlineEditor}`} key={tee.key}><input aria-label={`Nombre tee ${index + 1}`} required placeholder="Nombre" value={tee.name} onChange={(event) => updateTee(index, { name: event.target.value })} /><input aria-label={`ID tee ${index + 1}`} placeholder="ID (opcional)" value={tee.id} onChange={(event) => updateTee(index, { id: event.target.value })} /><input aria-label={`Color tee ${index + 1}`} placeholder="Color si está documentado" value={tee.color} onChange={(event) => updateTee(index, { color: event.target.value })} /><input aria-label={`Categoría tee ${index + 1}`} placeholder="Categoría verificada" value={tee.category} onChange={(event) => updateTee(index, { category: event.target.value })} /><input aria-label={`Rating tee ${index + 1}`} inputMode="decimal" placeholder="Rating" value={tee.rating} onChange={(event) => updateTee(index, { rating: event.target.value })} /><input aria-label={`Slope tee ${index + 1}`} inputMode="numeric" placeholder="Slope" value={tee.slope} onChange={(event) => updateTee(index, { slope: event.target.value })} /><button type="button" className={styles.danger} onClick={() => setTees((current) => current.filter((_, teeIndex) => teeIndex !== index))}>Quitar</button></div>)}
    <label className={`${styles.checkbox} ${styles.wide}`}><input type="checkbox" checked={includeScorecard} onChange={(event) => setIncludeScorecard(event.target.checked)} /> Capturar tarjeta completa ahora</label>
    {includeScorecard && <div className={`${styles.tableWrap} ${styles.wide}`}><table className={styles.table}><thead><tr><th>Hoyo</th><th>Par</th><th>SI</th>{tees.map((tee, index) => <th key={tee.key}>{tee.name || `Tee ${index + 1}`} · yardas</th>)}</tr></thead><tbody>{holes.map((hole, index) => <tr key={index}><td>{index + 1}</td><td><input required type="number" min="3" max="6" value={hole.par} onChange={(event) => updateHole(index, { par: event.target.value })} /></td><td><input required type="number" min="1" max={holeCount} value={hole.strokeIndex} onChange={(event) => updateHole(index, { strokeIndex: event.target.value })} /></td>{tees.map((tee) => <td key={tee.key}><input aria-label={`Yardas hoyo ${index + 1} ${tee.name || "tee"}`} type="number" min="1" max="1000" value={hole.yards[tee.key] || ""} onChange={(event) => updateHole(index, { yards: { ...hole.yards, [tee.key]: event.target.value } })} /></td>)}</tr>)}</tbody></table></div>}
    <EvidenceFields initial={initial} /><button className={styles.primary} disabled={loading}>{initialCourse ? "Crear nueva versión Draft" : "Crear Draft y revisar"}</button></form></section>;
}

function EquipmentWorkspace({ data, loading, request, submit, showQa }: { data: Json | null; loading: boolean; request: (path: string, options?: RequestInit) => Promise<Json>; submit: (payload: Json) => void; showQa: boolean }) {
  const [items, setItems] = useState<Json[]>(() => list(data?.items)); const [query, setQuery] = useState(""); const [kind, setKind] = useState(""); const [selected, setSelected] = useState<Json | null>(null); const [status, setStatus] = useState("");
  useEffect(() => { setItems(list(data?.items)); }, [data]);
  async function search() { setStatus("Buscando en Admin Published DB + seed versionado…"); try { const result = await request(`/api/admin/control-center?view=equipment&limit=100&kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(query)}${showQa ? "&includeQa=1" : ""}`); setItems(list(result.items)); setStatus(""); } catch (error) { setStatus(error instanceof Error ? error.message : "No fue posible buscar."); } }
  async function open(entityType: string, entityId: string) { setStatus("Cargando registro vigente…"); try { const result = await request(`/api/admin/control-center?view=equipment&entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}${showQa ? "&includeQa=1" : ""}`); setSelected(object(result.item)); setStatus("La nueva versión conserva el ID; Mi Bolsa histórica seguirá resolviendo el registro."); } catch (error) { setStatus(error instanceof Error ? error.message : "No fue posible abrir el equipo."); } }
  return <><section className={styles.card}><div className={styles.sectionTitle}><div><h2>Equipment Catalog</h2><p>Busca bastones, bolas y varillas vigentes; abrir un registro crea una versión, nunca un overwrite.</p></div><span className={styles.badge}>LAYERED PROVIDER</span></div><div className={styles.toolbar}><label>Tipo<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Todos</option><option value="CLUB_EQUIPMENT">Bastones</option><option value="BALL">Bolas</option><option value="SHAFT">Varillas</option></select></label><label>Marca, modelo, generación o año<input value={query} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" disabled={loading} onClick={() => void search()}>Buscar</button><button type="button" onClick={() => { setSelected(null); setStatus("Nuevo Draft vacío."); }}>+ Nuevo</button></div>{status && <div className={styles.notice}>{status}</div>}<div className={styles.list}>{items.map((item) => <article className={styles.item} key={`${String(item.entityType)}:${String(item.id)}`}><div><strong>{String(item.brand)} · {String(item.model)}</strong><span>{String(item.entityType)} · {String(item.generation || item.year || "generación pendiente")}</span><em>{item.active === false ? "HISTÓRICO" : "ACTIVO"}</em><QaBadge item={item} /></div><button type="button" onClick={() => void open(String(item.entityType), String(item.id))}>Abrir / nueva versión</button></article>)}</div></section><EquipmentEditor key={selected ? `${String(selected.entityType)}:${String(selected.id)}` : "new-equipment"} initial={selected} loading={loading} submit={submit} /></>;
}

function EquipmentEditor({ loading, submit, initial = null }: { loading: boolean; submit: (payload: Json) => void; initial?: Json | null }) {
  const initialKind = typeof initial?.entityType === "string" ? initial.entityType : "CLUB_EQUIPMENT";
  const [kind, setKind] = useState(initialKind);
  const [handedness, setHandedness] = useState<string[]>(() => textList(initial?.handedness));
  const [lofts, setLofts] = useState<string[]>(() => Array.isArray(initial?.lofts) ? initial.lofts.map(String) : []);
  const [wedgeVariants, setWedgeVariants] = useState<WedgeVariantDraft[]>(() => list(initial?.variants).map((variant, index) => ({ key: `${String(initial?.id)}-${index}`, loft: variant.loft == null ? "" : String(variant.loft), bounce: variant.bounce == null ? "" : String(variant.bounce), grind: String(variant.grind || "") })));
  const [stockShafts, setStockShafts] = useState<string[]>(() => textList(initial?.stockShafts));
  const [stockFlexes, setStockFlexes] = useState<string[]>(() => textList(initial?.stockFlexes));
  const [weights, setWeights] = useState<string[]>(() => Array.isArray(initial?.weightOptions) ? initial.weightOptions.map(String) : []);
  const [flexOptions, setFlexOptions] = useState<string[]>(() => textList(initial?.flexOptions));
  const [torqueOptions, setTorqueOptions] = useState<string[]>(() => Array.isArray(initial?.torqueRange) ? initial.torqueRange.map(String) : []);
  const [colors, setColors] = useState<string[]>(() => textList(initial?.colors));
  const [targetProfile, setTargetProfile] = useState<string[]>(() => textList(initial?.targetProfile));
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const brand = stringValue(form.get("brand")); const model = stringValue(form.get("model")); const year = optionalNumber(stringValue(form.get("year"))); const generation = stringValue(form.get("generation")) || null; const sourceName = stringValue(form.get("sourceName")); const sourceUrl = stringValue(form.get("sourceUrl")); const verifiedInput = stringValue(form.get("verifiedAt")); const id = stringValue(form.get("id")) || stableId(`${brand}-${model}-${generation || year || "unknown"}`);
    const sourceType = stringValue(form.get("sourceType")); const officialUrl = stringValue(form.get("officialUrl")) || null;
    const common = { id, aliases: csv(stringValue(form.get("aliases"))), brand, model, generation, year, active: form.get("active") === "on", bagEligible: form.get("bagEligible") === "on", fitEligible: form.get("fitEligible") === "on", sourceName, sourceUrl: sourceUrl || null, sourceType, confidence: stringValue(form.get("confidence")) || null, provenance: [], verifiedAt: verifiedInput ? new Date(verifiedInput).toISOString() : null, officialUrl };
    const payload = kind === "CLUB_EQUIPMENT" ? { ...common, category: stringValue(form.get("category")), subCategory: stringValue(form.get("subCategory")) || null, handedness, lofts: lofts.map(Number).filter(Number.isFinite), variants: stringValue(form.get("category")) === "WEDGE" ? wedgeVariants.flatMap((variant) => { const loft = optionalNumber(variant.loft); return loft === null ? [] : [{ loft, bounce: optionalNumber(variant.bounce), grind: variant.grind.trim() || null, handedness }]; }) : [], standardLength: optionalNumber(stringValue(form.get("length"))), lie: optionalNumber(stringValue(form.get("lie"))), headVolume: optionalNumber(stringValue(form.get("headVolume"))), setMakeup: stringValue(form.get("setMakeup")) || null, stockShafts: stockShafts.filter(Boolean), stockFlexes: stockFlexes.filter(Boolean), externalId: null }
      : kind === "SHAFT" ? { ...common, usage: stringValue(form.get("usage")) || null, oemStockOrAftermarket: stringValue(form.get("market")) || null, weightOptions: weights.map(Number).filter(Number.isFinite), flexOptions: flexOptions.filter(Boolean), weight: null, flex: [], launch: stringValue(form.get("launch")) || null, spin: stringValue(form.get("spin")) || null, material: stringValue(form.get("material")) || null, torqueRange: torqueOptions.map(Number).filter(Number.isFinite), torque: null, tipDiameter: optionalNumber(stringValue(form.get("tipDiameter"))), buttDiameter: optionalNumber(stringValue(form.get("buttDiameter"))) }
        : { ...common, coverMaterial: stringValue(form.get("cover")) || null, construction: stringValue(form.get("construction")) || null, constructionPieces: optionalNumber(stringValue(form.get("constructionPieces"))), compression: optionalNumber(stringValue(form.get("compression"))), compressionType: stringValue(form.get("compression")) ? stringValue(form.get("compressionType")) : "UNKNOWN", compressionSource: stringValue(form.get("compression")) ? sourceName : null, compressionSourceUrl: stringValue(form.get("compression")) ? sourceUrl : null, flight: stringValue(form.get("flight")) || null, driverSpin: stringValue(form.get("driverSpin")) || null, ironSpin: stringValue(form.get("ironSpin")) || null, shortGameSpin: stringValue(form.get("shortGameSpin")) || null, feel: stringValue(form.get("feel")) || null, colors: colors.filter(Boolean), priceTier: stringValue(form.get("priceTier")) || null, targetProfile: targetProfile.filter(Boolean) };
    submit({ operation: "createRevision", entityType: kind, entityId: id, scopeType: "CATALOG", scopeId: "equipment", payload, sourceType, sourceName, sourceUrl: sourceUrl || null, verifiedAt: verifiedInput ? new Date(verifiedInput).toISOString() : null, provenanceStatus: verifiedInput && sourceName ? "VERIFIED" : "REVIEWED", confidence: stringValue(form.get("confidence")) || null, ...schedule(form) });
  }
  const profileOptions = ["VERY_LOW", "LOW", "MID", "HIGH", "VERY_HIGH", "VARIABLE"];
  return <section className={styles.card}>
    <div className={styles.sectionTitle}><div><h2>{initial ? "Nueva versión de equipment" : "Nuevo equipment"}</h2><p>Datos técnicos, elegibilidad e imágenes son capas separadas.</p></div><span className={styles.badge}>LAYERED PROVIDER</span></div>
    <div className={styles.tabs}>{[["CLUB_EQUIPMENT", "Bastón"], ["BALL", "Bola"], ["SHAFT", "Varilla"]].map(([id, label]) => <button type="button" data-active={kind === id} key={id} onClick={() => setKind(id)}>{label}</button>)}</div>
    <Workflow />
    <form className={styles.form} onSubmit={save}>
      <Field label="Marca" name="brand" required defaultValue={String(initial?.brand || "")} />
      <Field label="Modelo" name="model" required defaultValue={String(initial?.model || "")} />
      <Field label="ID estable" name="id" placeholder="Se genera si queda vacío" defaultValue={String(initial?.id || "")} />
      <Field label="Aliases" name="aliases" placeholder="Separados por coma" defaultValue={textList(initial?.aliases).join(", ")} />
      <Field label="Generación" name="generation" defaultValue={String(initial?.generation || "")} />
      <Field label="Año" name="year" type="number" defaultValue={initial?.year == null ? "" : String(initial.year)} />
      {kind === "CLUB_EQUIPMENT" && <>
        <label>Categoría<select name="category" defaultValue={String(initial?.category || "DRIVER")}><option>DRIVER</option><option>FAIRWAY_WOOD</option><option>HYBRID</option><option>IRON_SET</option><option>WEDGE</option><option>PUTTER</option></select></label>
        <Field label="Subcategoría" name="subCategory" defaultValue={String(initial?.subCategory || "")} />
        <fieldset className={styles.choiceGroup}><legend>Mano verificada</legend>{[["RH", "Derecha"], ["LH", "Izquierda"]].map(([value, label]) => <label className={styles.checkbox} key={value}><input type="checkbox" checked={handedness.includes(value)} onChange={(event) => setHandedness((current) => event.target.checked ? [...new Set([...current, value])] : current.filter((item) => item !== value))} /> {label}</label>)}</fieldset>
        <StructuredValues label="Lofts verificados" values={lofts} onChange={setLofts} numeric placeholder="10.5" />
        <Field label="Longitud estándar" name="length" type="number" defaultValue={initial?.standardLength == null ? "" : String(initial.standardLength)} />
        <Field label="Lie" name="lie" type="number" defaultValue={initial?.lie == null ? "" : String(initial.lie)} />
        <Field label="Volumen cabeza" name="headVolume" type="number" defaultValue={initial?.headVolume == null ? "" : String(initial.headVolume)} />
        <Field label="Set makeup" name="setMakeup" defaultValue={String(initial?.setMakeup || "")} />
        <StructuredValues label="Stock shafts" values={stockShafts} onChange={setStockShafts} placeholder="Modelo exacto" />
        <StructuredValues label="Stock flex OEM" values={stockFlexes} onChange={setStockFlexes} placeholder="R, S, 6.0…" />
        <div className={styles.wide}><h3>Variantes de wedge verificadas</h3>{wedgeVariants.map((variant, index) => <div className={styles.inlineEditor} key={variant.key}><input aria-label={`Loft wedge ${index + 1}`} type="number" inputMode="decimal" placeholder="Loft" value={variant.loft} onChange={(event) => setWedgeVariants((current) => current.map((item) => item.key === variant.key ? { ...item, loft: event.target.value } : item))} /><input aria-label={`Bounce wedge ${index + 1}`} type="number" inputMode="decimal" placeholder="Bounce" value={variant.bounce} onChange={(event) => setWedgeVariants((current) => current.map((item) => item.key === variant.key ? { ...item, bounce: event.target.value } : item))} /><input aria-label={`Grind wedge ${index + 1}`} placeholder="Grind OEM" value={variant.grind} onChange={(event) => setWedgeVariants((current) => current.map((item) => item.key === variant.key ? { ...item, grind: event.target.value } : item))} /><button type="button" className={styles.danger} onClick={() => setWedgeVariants((current) => current.filter((item) => item.key !== variant.key))}>Quitar</button></div>)}<button type="button" onClick={() => setWedgeVariants((current) => [...current, { key: crypto.randomUUID(), loft: "", bounce: "", grind: "" }])}>+ Agregar variante</button></div>
      </>}
      {kind === "SHAFT" && <>
        <label>Uso<select name="usage" defaultValue={String(initial?.usage || "WOOD")}><option>WOOD</option><option>FAIRWAY</option><option>HYBRID</option><option>UTILITY</option><option>IRON</option><option>WEDGE</option><option>PUTTER</option></select></label>
        <label>Mercado<select name="market" defaultValue={String(initial?.oemStockOrAftermarket || "")}><option value="">Desconocido</option><option>OEM_STOCK</option><option>AFTERMARKET</option></select></label>
        <StructuredValues label="Pesos estructurados (g)" values={weights} onChange={setWeights} numeric placeholder="60" />
        <StructuredValues label="Flex OEM" values={flexOptions} onChange={setFlexOptions} placeholder="R, S, 6.0, F4…" />
        <label>Launch<select name="launch" defaultValue={String(initial?.launch || "")}><option value="">Desconocido</option>{profileOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Spin<select name="spin" defaultValue={String(initial?.spin || "")}><option value="">Desconocido</option>{profileOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
        <Field label="Material" name="material" defaultValue={String(initial?.material || "")} />
        <StructuredValues label="Torque verificado" values={torqueOptions} onChange={setTorqueOptions} numeric placeholder="3.5" />
        <Field label="Tip diameter" name="tipDiameter" type="number" defaultValue={initial?.tipDiameter == null ? "" : String(initial.tipDiameter)} />
        <Field label="Butt diameter" name="buttDiameter" type="number" defaultValue={initial?.buttDiameter == null ? "" : String(initial.buttDiameter)} />
      </>}
      {kind === "BALL" && <>
        <Field label="Cover" name="cover" defaultValue={String(initial?.coverMaterial || "")} />
        <Field label="Construction" name="construction" defaultValue={String(initial?.construction || "")} />
        <Field label="Piezas" name="constructionPieces" type="number" defaultValue={initial?.constructionPieces == null ? "" : String(initial.constructionPieces)} />
        <Field label="Compression verificada" name="compression" type="number" defaultValue={initial?.compression == null ? "" : String(initial.compression)} />
        <label>Tipo de compression<select name="compressionType" defaultValue={String(initial?.compressionType || "MANUFACTURER")}><option>MANUFACTURER</option><option>INDEPENDENT_MEASURED</option><option>UNKNOWN</option></select></label>
        {[["flight", "Flight"], ["driverSpin", "Driver spin"], ["ironSpin", "Iron spin"], ["shortGameSpin", "Short game spin"], ["feel", "Feel"]].map(([name, label]) => <label key={name}>{label}<select name={name} defaultValue={String(initial?.[name] || "")}><option value="">Desconocido</option>{profileOptions.slice(0, 5).map((value) => <option key={value}>{value}</option>)}</select></label>)}
        <StructuredValues label="Colores" values={colors} onChange={setColors} placeholder="White" />
        <label>Price tier<select name="priceTier" defaultValue={String(initial?.priceTier || "")}><option value="">Desconocido</option><option>ECONOMY</option><option>MID</option><option>PREMIUM</option></select></label>
        <StructuredValues label="Target profile" values={targetProfile} onChange={setTargetProfile} placeholder="Perfil documentado" />
      </>}
      <Field label="URL oficial" name="officialUrl" type="url" defaultValue={String(initial?.officialUrl || "")} />
      <label>Tipo de fuente<select name="sourceType" defaultValue={String(initial?.sourceType || "ADMIN_RESEARCH")}><option>OEM_OFFICIAL</option><option>DISTRIBUTOR</option><option>SECONDARY_ARCHIVE</option><option>USER_SUBMITTED</option><option>ADMIN_RESEARCH</option><option>OTHER</option></select></label>
      <label>Confianza<select name="confidence" defaultValue={String(initial?.confidence || "HIGH")}><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label>
      <label className={styles.checkbox}><input type="checkbox" name="active" defaultChecked={initial?.active !== false} /> Activo en búsquedas nuevas</label>
      <label className={styles.checkbox}><input type="checkbox" name="bagEligible" defaultChecked={initial?.bagEligible !== false} /> Disponible en Mi Bolsa</label>
      <label className={styles.checkbox}><input type="checkbox" name="fitEligible" defaultChecked={initial?.fitEligible === true} /> Fit eligible (requiere datos suficientes)</label>
      <EvidenceFields initial={initial} />
      <button className={styles.primary} disabled={loading}>{initial ? "Crear nueva versión Draft" : "Crear Draft"}</button>
    </form>
  </section>;
}

function AssetEditor({ token }: { token: string }) {
  const [status, setStatus] = useState(""); const [uploading, setUploading] = useState(false); const [entityType, setEntityType] = useState("CLUB_EQUIPMENT");
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setUploading(true); setStatus("");
    const form = new FormData(event.currentTarget); const equipment = ["CLUB_EQUIPMENT", "BALL", "SHAFT"].includes(entityType); const competition = ["COMPETITION", "COMPETITION_RULE_SET"].includes(entityType); form.set("scopeType", equipment ? "CATALOG" : competition ? "COMPETITION" : "COURSE"); form.set("scopeId", equipment ? "equipment" : stringValue(form.get("scopeId"))); form.set("rightsApproved", form.get("rightsApproved") === "on" ? "true" : "false");
    try { const response = await fetch("/api/admin/documents", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form }); const payload: unknown = await response.json().catch(() => null); if (!response.ok) throw new Error(message(payload, "No fue posible subir el asset.")); setStatus(object(payload)?.warning as string || "Asset privado guardado con su estado de derechos."); event.currentTarget.reset(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "No fue posible subir el asset."); }
    finally { setUploading(false); }
  }
  return <section className={styles.card}><div className={styles.sectionTitle}><div><h2>Imágenes y documentos</h2><p>PDF/PNG/JPG/WEBP privados. Una URL nunca equivale a derechos aprobados.</p></div><span className={styles.badge}>PRIVATE STORAGE</span></div>{status && <div className={styles.notice}>{status}</div>}<form className={styles.form} onSubmit={upload}><label>Tipo<select name="entityType" value={entityType} onChange={(event) => setEntityType(event.target.value)}><option>CLUB_EQUIPMENT</option><option>BALL</option><option>SHAFT</option><option>COURSE</option><option>LOCAL_RULE_SET</option><option>COMPETITION</option><option>COMPETITION_RULE_SET</option></select></label><Field label="ID de la entidad" name="entityId" required />{!["CLUB_EQUIPMENT", "BALL", "SHAFT"].includes(entityType) && <Field label={entityType.startsWith("COMPETITION") ? "Competition ID (scope)" : "Course ID (scope)"} name="scopeId" required />}<label className={styles.wide}>Archivo<input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required /></label><Field label="Fuente del asset" name="source" /><Field label="Licencia" name="license" /><label className={styles.wide}>Evidencia de derechos<textarea name="rightsEvidence" /></label><Field label="Atribución" name="attribution" /><Field label="Fecha verificada" name="verifiedAt" type="datetime-local" /><label className={styles.checkbox}><input name="rightsApproved" type="checkbox" /> Derechos verificados y aprobados para vista Player</label><button className={styles.primary} disabled={uploading}>{uploading ? "Subiendo…" : "Guardar asset privado"}</button></form></section>;
}

function RuleEditor({ loading, submit }: { loading: boolean; submit: (payload: Json) => void }) {
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const courseId = stringValue(form.get("courseId")); const title = stringValue(form.get("title")); const sourceName = stringValue(form.get("sourceName")); const sourceUrl = stringValue(form.get("sourceUrl")); const verifiedAt = stringValue(form.get("verifiedAt")); submit({ operation: "createRevision", entityType: "LOCAL_RULE_SET", entityId: courseId, scopeType: "COURSE", scopeId: courseId, sourceType: "ADMIN_RESEARCH", sourceName, sourceUrl: sourceUrl || null, verifiedAt: verifiedAt ? new Date(verifiedAt).toISOString() : null, provenanceStatus: verifiedAt ? "VERIFIED" : "REVIEWED", ...schedule(form), payload: { courseId, title, rules: [{ title: stringValue(form.get("ruleTitle")), shortSummary: stringValue(form.get("summary")), body: stringValue(form.get("body")), category: stringValue(form.get("category")), holeRefs: csv(stringValue(form.get("holes"))).map(Number).filter(Number.isFinite), active: true }], sourceName, sourceUrl, verifiedAt } }); }
  return <section className={styles.card}><div className={styles.sectionTitle}><div><h2>Reglas locales</h2><p>Texto aprobado, resumen para jugador y referencia de fuente.</p></div></div><Workflow /><form className={styles.form} onSubmit={save}><Field label="Course ID" name="courseId" required /><Field label="Título del ruleset" name="title" required /><Field label="Título de la regla" name="ruleTitle" required /><label>Categoría<select name="category"><option>GENERAL</option><option>DROP_ZONE</option><option>PENALTY_AREA</option><option>GROUND_UNDER_REPAIR</option><option>PREFERRED_LIES</option><option>TEMPORARY_GREEN</option><option>TEMPORARY_TEE</option><option>PACE_OF_PLAY</option><option>OTHER</option></select></label><Field label="Hoyos" name="holes" placeholder="3,4" /><Field label="Resumen corto" name="summary" required /><label className={styles.wide}>Texto completo<textarea name="body" required /></label><EvidenceFields /><button className={styles.primary} disabled={loading}>Crear Draft</button></form></section>;
}

function CompetitionEditor({ loading, submit, items }: { loading: boolean; submit: (payload: Json) => void; items: Json[] }) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const id = stringValue(form.get("id")) || crypto.randomUUID(); const sourceName = stringValue(form.get("sourceName")); const verifiedAt = stringValue(form.get("verifiedAt"));
    const rules = [
      ["FORMAT", "Formato", stringValue(form.get("format"))],
      ["HANDICAP", "Handicap", [stringValue(form.get("handicapMaximum")) && `Máximo ${stringValue(form.get("handicapMaximum"))}`, stringValue(form.get("handicapPercentage")) && `${stringValue(form.get("handicapPercentage"))}%`].filter(Boolean).join(" · ")],
      ["PRIZE", "Premios", stringValue(form.get("prizes"))],
      ["CLOSEST_TO_PIN", "Oyes / closest to pin", stringValue(form.get("closestToPin"))],
      ["TIE_BREAK", "Desempate", stringValue(form.get("tieBreak"))],
      ["LOCAL_EVENT_RULE", "Reglas especiales", stringValue(form.get("specialRules"))],
      ["CONDUCT", "Reglamento", stringValue(form.get("rules"))],
    ].flatMap(([category, title, body]) => body ? [{ category, title, body }] : []);
    const startsInput = stringValue(form.get("startsAt")); const endsInput = stringValue(form.get("endsAt"));
    submit({ operation: "createRevision", entityType: "COMPETITION", entityId: id, scopeType: "COMPETITION", scopeId: id, sourceType: "ADMIN_RESEARCH", sourceName, sourceUrl: stringValue(form.get("sourceUrl")) || null, verifiedAt: verifiedAt ? new Date(verifiedAt).toISOString() : null, provenanceStatus: verifiedAt ? "VERIFIED" : "REVIEWED", ...schedule(form), payload: { id, name: stringValue(form.get("name")), type: stringValue(form.get("type")), courseId: stringValue(form.get("courseId")) || null, startsAt: startsInput ? new Date(startsInput).toISOString() : null, endsAt: endsInput ? new Date(endsInput).toISOString() : null, organizer: stringValue(form.get("organizer")) || null, visibility: stringValue(form.get("visibility")), description: stringValue(form.get("description")), format: stringValue(form.get("format")) || null, handicapMaximum: optionalNumber(stringValue(form.get("handicapMaximum"))), handicapPercentage: optionalNumber(stringValue(form.get("handicapPercentage"))), tees: stringValue(form.get("tees")) || null, prizes: stringValue(form.get("prizes")) || null, closestToPin: stringValue(form.get("closestToPin")) || null, tieBreak: stringValue(form.get("tieBreak")) || null, specialRules: stringValue(form.get("specialRules")) || null, rules } });
  }
  return <><section className={styles.card}><div className={styles.sectionTitle}><div><h2>Pollas, torneos y ligas</h2><p>El texto libre no modifica engines; sólo contratos estructurados aprobados pueden hacerlo.</p></div></div><Workflow /><form className={styles.form} onSubmit={save}><Field label="Nombre" name="name" required /><Field label="ID" name="id" placeholder="Se genera UUID" /><label>Tipo<select name="type"><option>POLLA</option><option>TOURNAMENT</option><option>LEAGUE</option><option>EVENT</option></select></label><Field label="Course ID" name="courseId" required /><Field label="Organizador" name="organizer" /><Field label="Inicio" name="startsAt" type="datetime-local" /><Field label="Fin" name="endsAt" type="datetime-local" /><label>Visibilidad<select name="visibility"><option>PRIVATE</option><option>PUBLIC</option></select></label><Field label="Formato" name="format" /><Field label="HCP máximo" name="handicapMaximum" type="number" /><Field label="% HCP" name="handicapPercentage" type="number" /><Field label="Salidas / tees" name="tees" /><Field label="Premios / nota" name="prizes" /><Field label="Oyes / closest to pin" name="closestToPin" /><Field label="Desempate" name="tieBreak" /><label className={styles.wide}>Descripción<textarea name="description" /></label><label className={styles.wide}>Reglas especiales<textarea name="specialRules" /></label><label className={styles.wide}>Reglamento<textarea name="rules" required /></label><EvidenceFields /><button className={styles.primary} disabled={loading}>Crear Draft</button></form></section>{items.length > 0 && <section className={styles.card}><h2>Competiciones existentes</h2><div className={styles.list}>{items.map((item) => <div className={styles.item} key={String(item.id)}><div><strong>{String(item.name)}</strong><span>{String(item.type)} · {String(item.status)}</span><QaBadge item={item} /></div>{String(item.visibility) === "PUBLIC" && String(item.status) === "PUBLISHED" && !isQaItem(item) && <Link href={`/competitions/${String(item.id)}`}>Vista Player</Link>}</div>)}</div></section>}</>;
}

function CourseOperations({ loading, submit, request, refresh, items }: { loading: boolean; submit: (payload: Json) => void; request: (path: string, options?: RequestInit) => Promise<Json>; refresh: () => Promise<void>; items: Json[] }) {
  const [courseId, setCourseId] = useState("");
  const [rows, setRows] = useState<OperationRow[]>([]);
  const [tees, setTees] = useState<Array<{ id: string; name: string }>>([]);
  const [ratings, setRatings] = useState<Record<string, OperationRating>>({});
  const [loadError, setLoadError] = useState("");
  const [previewHashes, setPreviewHashes] = useState<Record<string, string>>({});
  const [overlapResolution, setOverlapResolution] = useState("CANCEL");
  const [workflowStatus, setWorkflowStatus] = useState("");

  async function loadCourse() {
    setLoadError("");
    try {
      // The editor must start from the immutable published base card. Loading
      // the player-facing resolved operations would relabel temporary holes as
      // BASE and make a Competition override reference holes that do not belong
      // to the official Course.
      const payload = await request(`/api/admin/control-center?view=courses&courseId=${encodeURIComponent(courseId)}`) as CourseOperationsBaseResponse;
      if (!payload.item?.holes?.length) throw new Error("No fue posible cargar la tarjeta base publicada.");
      setRows(payload.item.holes.map((hole) => ({
        id: hole.id,
        sourceBaseHoleId: hole.id,
        sourceBaseHoleNumber: hole.holeNumber,
        displayLabel: String(hole.holeNumber),
        par: hole.par,
        strokeIndex: hole.strokeIndex,
        playable: true,
        temporaryGreen: false,
        temporaryTee: false,
        dropZoneNote: null,
        operationalNote: null,
        clientKey: `base-${hole.id}`,
        kind: "BASE",
        yardOverrides: {},
      })));
      setTees(payload.item.tees || []);
      setRatings({});
    } catch (error) { setLoadError(error instanceof Error ? error.message : "No fue posible cargar el campo."); }
  }
  function update(index: number, changes: Partial<OperationRow>) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row)); }
  function move(index: number, direction: -1 | 1) { setRows((current) => { const target = index + direction; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; }); }
  function addTemporary() { setRows((current) => [...current, { id: crypto.randomUUID(), clientKey: `temporary-${crypto.randomUUID()}`, kind: "TEMPORARY", sourceBaseHoleId: null, sourceBaseHoleNumber: null, displayLabel: "TEMP", par: 3, strokeIndex: Math.min(18, current.filter((row) => row.playable).length + 1), playable: true, temporaryGreen: false, temporaryTee: true, dropZoneNote: null, operationalNote: null, yardOverrides: {} }]); }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget); let runtimeHoleNumber = 0;
    const sourceDescription = stringValue(form.get("sourceDescription")); const verifiedInput = stringValue(form.get("verifiedAt")); const verifiedAt = verifiedInput ? new Date(verifiedInput).toISOString() : null;
    const teeHoles = rows.flatMap((row) => Object.entries(row.yardOverrides).flatMap(([teeId, value]) => optionalNumber(value) === null ? [] : [{ configurationHoleKey: row.clientKey, teeId, yardsOverride: optionalNumber(value), source: sourceDescription, verifiedAt }]));
    const ratingRows = tees.flatMap((tee) => { const value = ratings[tee.id]; const rating = optionalNumber(value?.rating || ""); const slope = optionalNumber(value?.slope || ""); return rating === null && slope === null ? [] : [{ teeId: tee.id, rating, slope, category: value?.category || null, source: sourceDescription, verifiedAt }]; });
    submit({ operation: "createCourseConfiguration", payload: { courseId, name: stringValue(form.get("name")), description: stringValue(form.get("description")), scopeType: stringValue(form.get("scopeType")), competitionId: stringValue(form.get("competitionId")) || null, effectiveFrom: new Date(stringValue(form.get("effectiveFrom"))).toISOString(), effectiveUntil: stringValue(form.get("effectiveUntil")) ? new Date(stringValue(form.get("effectiveUntil"))).toISOString() : null, reason: stringValue(form.get("reason")), sourceDescription, holes: rows.map((row, index) => ({ clientKey: row.clientKey, sequence: index + 1, runtimeHoleNumber: row.playable ? ++runtimeHoleNumber : null, displayLabel: row.displayLabel, sourceBaseHoleId: row.kind === "BASE" ? row.sourceBaseHoleId : null, sourceBaseHoleNumber: row.kind === "BASE" ? row.sourceBaseHoleNumber : null, kind: row.kind, playable: row.playable, parOverride: row.par, strokeIndexOverride: row.strokeIndex, notes: null, temporaryGreen: row.temporaryGreen === true, temporaryTee: row.temporaryTee === true, dropZoneNote: row.dropZoneNote || null, operationalNote: row.operationalNote || null })), teeHoles, ratings: ratingRows } });
  }
  async function prepare(item: Json) { setWorkflowStatus(""); try { const result = await request("/api/admin/control-center", { method: "POST", body: JSON.stringify({ operation: "previewCourseConfiguration", configurationId: item.id }) }); const hash = String(object(result.preview)?.previewHash || ""); if (!hash) throw new Error("Preview sin hash."); setPreviewHashes((current) => ({ ...current, [String(item.id)]: hash })); setWorkflowStatus("Preview/Diff generado. Confirma sólo si corresponde a la operación verificada."); } catch (error) { setWorkflowStatus(error instanceof Error ? error.message : "No fue posible generar el Preview."); } }
  async function publish(item: Json) { const id = String(item.id); const previewHash = previewHashes[id]; if (!previewHash) return; setWorkflowStatus(""); try { await request("/api/admin/control-center", { method: "POST", body: JSON.stringify({ operation: "publishCourseConfiguration", configurationId: id, previewHash, overlapResolution, reason: "Configuración temporal confirmada después del Preview administrativo." }) }); setWorkflowStatus("Configuración publicada para próximas rondas; rondas activas no cambian."); setPreviewHashes((current) => { const next = { ...current }; delete next[id]; return next; }); await refresh(); } catch (error) { setWorkflowStatus(error instanceof Error ? error.message : "No fue posible publicar."); } }

  return <>
    <section className={styles.card}>
      <div className={styles.sectionTitle}><div><h2>Configuración temporal</h2><p>Cierra, reordena o agrega hoyos sin alterar el campo oficial.</p></div><span className={styles.badge}>SNAPSHOT SAFE</span></div>
      <div className={styles.toolbar}><label>Course ID<input value={courseId} onChange={(event) => setCourseId(event.target.value)} /></label><button type="button" disabled={!courseId || loading} onClick={() => void loadCourse()}>Cargar campo</button><button type="button" disabled={!rows.length} onClick={addTemporary}>+ Hoyo temporal</button></div>
      {loadError && <div className={styles.error}>{loadError}</div>}
      {rows.length > 0 && <form className={styles.form} onSubmit={save}>
        <Field label="Nombre" name="name" required placeholder="Obras septiembre" /><label>Scope<select name="scopeType"><option>COURSE</option><option>COMPETITION</option></select></label><Field label="Competition ID (si aplica)" name="competitionId" /><Field label="Vigente desde" name="effectiveFrom" type="datetime-local" required /><Field label="Vigente hasta" name="effectiveUntil" type="datetime-local" /><Field label="Motivo" name="reason" required /><Field label="Fuente operativa" name="sourceDescription" required /><Field label="Fecha verificada para overrides" name="verifiedAt" type="datetime-local" /><label className={styles.wide}>Descripción<textarea name="description" /></label>
        <div className={`${styles.tableWrap} ${styles.wide}`}><table className={styles.table}><thead><tr><th>Orden</th><th>Jugar</th><th>Label</th><th>Tipo</th><th>Par</th><th>SI</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.clientKey}><td><button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</button></td><td><input type="checkbox" checked={row.playable} onChange={(event) => update(index, { playable: event.target.checked })} /></td><td><input value={row.displayLabel} onChange={(event) => update(index, { displayLabel: event.target.value })} /></td><td>{row.kind}</td><td><input type="number" min="3" max="6" value={row.par} onChange={(event) => update(index, { par: Number(event.target.value) })} /></td><td><input type="number" min="1" max="18" value={row.strokeIndex} onChange={(event) => update(index, { strokeIndex: Number(event.target.value) })} /></td></tr>)}</tbody></table></div>
        <div className={styles.wide}><h3>Detalle operativo y yardajes</h3>{rows.map((row, index) => <div className={styles.inlineEditor} key={`${row.clientKey}-details`}><b>{row.displayLabel}</b><label className={styles.checkbox}><input type="checkbox" checked={row.temporaryGreen === true} onChange={(event) => update(index, { temporaryGreen: event.target.checked })} /> Green provisional</label><label className={styles.checkbox}><input type="checkbox" checked={row.temporaryTee === true} onChange={(event) => update(index, { temporaryTee: event.target.checked })} /> Tee provisional</label><input aria-label={`Zona de dropeo ${row.displayLabel}`} placeholder="Área / zona de dropeo" value={row.dropZoneNote || ""} onChange={(event) => update(index, { dropZoneNote: event.target.value })} /><input aria-label={`Nota operativa ${row.displayLabel}`} placeholder="Nota operativa" value={row.operationalNote || ""} onChange={(event) => update(index, { operationalNote: event.target.value })} />{tees.map((tee) => <input key={tee.id} aria-label={`Yardas override ${row.displayLabel} ${tee.name}`} type="number" min="1" max="1000" placeholder={`${tee.name} · override yardas`} value={row.yardOverrides[tee.id] || ""} onChange={(event) => update(index, { yardOverrides: { ...row.yardOverrides, [tee.id]: event.target.value } })} />)}</div>)}</div>
        {tees.length > 0 && <div className={styles.wide}><h3>Rating / Slope temporal verificado</h3><p className={styles.subtle}>Déjalo vacío si no existe evidencia; no se recalcula.</p>{tees.map((tee) => <div className={styles.inlineEditor} key={`${tee.id}-rating`}><b>{tee.name}</b><input aria-label={`Rating ${tee.name}`} inputMode="decimal" placeholder="Rating" value={ratings[tee.id]?.rating || ""} onChange={(event) => setRatings((current) => ({ ...current, [tee.id]: { ...(current[tee.id] || { rating: "", slope: "", category: "" }), rating: event.target.value } }))} /><input aria-label={`Slope ${tee.name}`} inputMode="numeric" placeholder="Slope" value={ratings[tee.id]?.slope || ""} onChange={(event) => setRatings((current) => ({ ...current, [tee.id]: { ...(current[tee.id] || { rating: "", slope: "", category: "" }), slope: event.target.value } }))} /><input aria-label={`Categoría ${tee.name}`} placeholder="Categoría evidenciada" value={ratings[tee.id]?.category || ""} onChange={(event) => setRatings((current) => ({ ...current, [tee.id]: { ...(current[tee.id] || { rating: "", slope: "", category: "" }), category: event.target.value } }))} /></div>)}</div>}
        <button className={styles.primary} disabled={loading}>Guardar Draft temporal</button>
      </form>}
    </section>
    {items.length > 0 && <section className={styles.card}><h2>Configuraciones</h2>{workflowStatus && <div className={styles.notice}>{workflowStatus}</div>}<label>Si hay solapamiento<select value={overlapResolution} onChange={(event) => setOverlapResolution(event.target.value)}><option value="CANCEL">Cancelar publicación</option><option value="FINALIZE_PREVIOUS">Finalizar anterior</option><option value="SUPERSEDE_PREVIOUS">Superseder anterior</option></select></label><div className={styles.list}>{items.map((item) => <div className={styles.item} key={String(item.id)}><div><strong>{String(item.name)}</strong><span>{String(item.course_id)} · {String(item.status)} · v{String(item.version)}</span><QaBadge item={item} /></div>{String(item.status) === "DRAFT" && <div className={styles.actions}><button type="button" onClick={() => void prepare(item)}>Preview / Diff</button>{previewHashes[String(item.id)] && !isQaItem(item) && <button type="button" className={styles.primary} onClick={() => void publish(item)}>Confirmar Publish</button>}{previewHashes[String(item.id)] && isQaItem(item) && <span className={styles.subtle}>Publicación operativa bloqueada</span>}</div>}</div>)}</div></section>}
  </>;
}

function ImportEditor({ loading, request }: { loading: boolean; request: (path: string, options?: RequestInit) => Promise<Json> }) {
  const csvTemplate = "id,brand,model,generation,year,category,usage,sourceName,sourceUrl";
  const jsonTemplate = "[]";
  const [format, setFormat] = useState("CSV"); const [source, setSource] = useState(csvTemplate); const [preview, setPreview] = useState<Json | null>(null); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const kind = stringValue(form.get("kind")); setBusy(true); setStatus("");
    try {
      const result = await request("/api/admin/control-center", { method: "POST", body: JSON.stringify({ operation: "previewImport", format, kind, scopeType: kind === "COURSE" ? "GLOBAL" : "CATALOG", scopeId: kind === "COURSE" ? null : "equipment", source }) });
      setPreview(result); setStatus("Diff guardado. Ninguna fila fue publicada.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "No fue posible validar la importación."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    const job = object(preview?.job); if (!job || typeof job.id !== "string") return;
    setBusy(true); setStatus("");
    try {
      const result = await request("/api/admin/control-center", { method: "POST", body: JSON.stringify({ operation: "confirmImport", importId: job.id, reason: "Filas válidas aprobadas desde el Preview/Diff administrativo." }) });
      const created = object(result.result)?.draftsCreated;
      setStatus(`${String(created ?? 0)} Drafts creados. Aún requieren Review, Verify, Preview y Publish.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "No fue posible crear los Drafts."); }
    finally { setBusy(false); }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    const nextFormat = file.name.toLowerCase().endsWith(".json") ? "JSON" : "CSV";
    if (!/\.(csv|json)$/i.test(file.name)) { setStatus("Usa una plantilla CSV o un archivo JSON controlado. XLSX debe exportarse primero a CSV."); return; }
    if (file.size > 2_000_000) { setStatus("El archivo excede 2 MB."); return; }
    setFormat(nextFormat); setSource(await file.text()); setPreview(null); setStatus("Archivo cargado localmente. Valida el Diff antes de aprobar.");
  }
  const rows = list(preview?.rows); const summary = object(object(preview?.job)?.summary);
  return <section className={styles.card}><div className={styles.sectionTitle}><div><h2>Importación controlada</h2><p>Upload → Parse → Normalize → Deduplicate → Validate → Diff. Este paso no publica.</p></div><span className={styles.badge}>NO AUTO-PUBLISH</span></div>{status && <div className={styles.notice}>{status}</div>}<form className={styles.form} onSubmit={save}><label>Catálogo<select name="kind"><option>COURSE</option><option>CLUB_EQUIPMENT</option><option>BALL</option><option>SHAFT</option></select></label><label>Formato<select value={format} onChange={(event) => { const next = event.target.value; setFormat(next); setSource(next === "CSV" ? csvTemplate : jsonTemplate); setPreview(null); }}><option>CSV</option><option>JSON</option></select></label><label className={styles.wide}>Archivo CSV / JSON<input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => void upload(event.target.files?.[0])} /></label><label className={styles.wide}>{format} de plantilla<textarea name="source" required value={source} onChange={(event) => setSource(event.target.value)} /></label><p className={`${styles.subtle} ${styles.wide}`}>Para Course usa id, name, clubId, clubName, holes y sourceName. La plantilla CSV controlada puede abrirse en Excel; exporta XLSX a CSV antes de subir.</p><button className={styles.primary} disabled={loading || busy}>{busy ? "Validando…" : "Validar y mostrar Diff"}</button></form>{summary && <div className={styles.stats}>{Object.entries(summary).map(([key, value]) => <article className={styles.stat} key={key}><span>{key}</span><b>{String(value)}</b></article>)}</div>}{rows.length > 0 && <><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Fila</th><th>Estado</th><th>Registro existente</th><th>Issues</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.row_number)}><td>{String(row.row_number)}</td><td><b>{String(row.status)}</b></td><td>{String(row.existing_entity_id || "—")}</td><td>{Array.isArray(row.issues) ? row.issues.join(" · ") : "—"}</td></tr>)}</tbody></table></div><button type="button" className={styles.primary} disabled={loading || busy || !rows.some((row) => ["NEW", "UPDATE"].includes(String(row.status)))} onClick={() => void confirm()}>Aprobar filas válidas y crear Drafts</button></>}</section>;
}

function PublicationQueue({ items, loading, mutate, request }: { items: Revision[]; loading: boolean; mutate: (payload: Json, done: string, nextView?: View) => Promise<void>; request: (path: string, options?: RequestInit) => Promise<Json> }) {
  async function action(item: Revision) {
    if (item.status === "DRAFT") return mutate({ operation: "transitionRevision", revisionId: item.id, nextStatus: "REVIEWED", reason: "Revisión administrativa completada." }, "Revisión marcada como REVIEWED.");
    if (item.status === "REVIEWED") return mutate({ operation: "transitionRevision", revisionId: item.id, nextStatus: "VERIFIED", reason: "Evidencia y datos verificados." }, "Revisión marcada como VERIFIED.");
  }
  async function download(item: Revision) {
    const result = await request("/api/admin/control-center", { method: "POST", body: JSON.stringify({ operation: "export", entityType: item.entity_type, entityId: item.entity_id }) });
    const blob = new Blob([JSON.stringify(result.data ?? null, null, 2)], { type: "application/json" }); const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = `${stableId(`${item.entity_type}-${item.entity_id}`)}.json`; anchor.click(); URL.revokeObjectURL(href);
  }
  return <section className={styles.card}><div className={styles.sectionTitle}><div><h2>Publicaciones pendientes</h2><p>La publicación requiere estado VERIFIED y el hash del Preview más reciente.</p></div></div><Workflow />{items.length === 0 ? <div className={styles.empty}>No hay revisiones dentro de tu alcance.</div> : <div className={styles.list}>{items.map((item) => <article className={styles.item} key={item.id}><div><strong>{item.entity_type} · {item.entity_id}</strong><span>v{item.version} · procedencia {item.provenance_status}</span><em>{item.status}</em><QaBadge item={item} /></div><div className={styles.actions}>{item.status === "DRAFT" && <button disabled={loading} onClick={() => void action(item)}>Marcar Reviewed</button>}{item.status === "REVIEWED" && <button disabled={loading} onClick={() => void action(item)}>Verificar</button>}{item.status === "VERIFIED" && <button disabled={loading} onClick={() => void mutate({ operation: "previewRevision", revisionId: item.id }, "Preview generado. Actualiza la cola para confirmar.")}>Generar Preview</button>}{item.status === "VERIFIED" && item.preview_hash && !isQaItem(item) && <button className={styles.primary} disabled={loading} onClick={() => void mutate({ operation: "publishRevision", revisionId: item.id, previewHash: item.preview_hash, reason: "Publicación confirmada desde Admin Control Center." }, "Publicado. Player APIs usarán la nueva versión sin deployment.")}>Confirmar Publish</button>}{item.status === "VERIFIED" && item.preview_hash && isQaItem(item) && <span className={styles.subtle}>Publicación operativa bloqueada</span>}<button disabled={loading} onClick={() => void download(item)}>Exportar JSON</button>{item.status !== "ARCHIVED" && <button disabled={loading} className={styles.danger} onClick={() => void mutate({ operation: "transitionRevision", revisionId: item.id, nextStatus: "ARCHIVED", reason: "Archivado por operador." }, "Revisión archivada sin borrar datos.")}>Archivar</button>}</div></article>)}</div>}</section>;
}

function Requests({ items, loading, onConvert }: { items: Json[]; loading: boolean; onConvert: (id: string, type: string) => void }) {
  return <section className={styles.card}><div className={styles.sectionTitle}><div><h2>Solicitudes de usuarios</h2><p>REPORTed no significa VERIFIED. Convertir crea Draft, nunca publica.</p></div></div>{items.length === 0 ? <div className={styles.empty}>No hay solicitudes visibles.</div> : <div className={styles.list}>{items.map((item) => <RequestRow key={String(item.id)} item={item} loading={loading} onConvert={onConvert} />)}</div>}</section>;
}

function RequestRow({ item, loading, onConvert }: { item: Json; loading: boolean; onConvert: (id: string, type: string) => void }) {
  const suggested = ({ COURSE: "COURSE", CLUB: "CLUB_EQUIPMENT", BALL: "BALL", SHAFT: "SHAFT" } as Record<string, string>)[String(item.category)] || "REQUEST";
  const [type, setType] = useState(suggested);
  return <article className={styles.item}><div><strong>{String(item.title || item.category)}</strong><span>{String(item.description)} · {String(item.request_status)}</span><QaBadge item={item} /></div>{isQaItem(item) ? <span className={styles.subtle}>Evidencia interna; no puede convertirse en borrador operativo.</span> : <div className={styles.actions}><select aria-label={`Tipo de Draft para ${String(item.title || item.category)}`} value={type} onChange={(event) => setType(event.target.value)}><option value="COURSE">Campo</option><option value="CLUB_EQUIPMENT">Bastón</option><option value="BALL">Bola</option><option value="SHAFT">Varilla</option><option value="LOCAL_RULE_SET">Regla local</option><option value="COURSE_CONFIGURATION">Cambio temporal</option><option value="REQUEST">Otro / soporte</option></select><button disabled={loading} onClick={() => onConvert(String(item.id), type)}>Crear borrador</button></div>}</article>;
}

function Quality({ data }: { data: Json | null }) {
  const courses = object(data?.courses) || {}; const equipment = object(data?.equipment) || {}; const separation = object(data?.separation) || {};
  return <><section className={styles.card}><h2>Calidad · Courses</h2><div className={styles.stats}>{Object.entries(courses).map(([key, value]) => <article className={styles.stat} key={key}><span>{key}</span><b>{String(value)}</b></article>)}</div></section><section className={styles.card}><h2>Calidad · Equipment</h2><div className={styles.stats}>{Object.entries(equipment).map(([key, value]) => <article className={styles.stat} key={key}><span>{key}</span><b>{String(value)}</b></article>)}</div><p className={styles.subtle}>Los huecos se reportan; no se completan por inferencia.</p></section><section className={styles.card}><h2>Calidad · Separación QA</h2><div className={styles.stats}>{Object.entries(separation).map(([key, value]) => <QualityMetric key={key} label={key} value={value} />)}</div></section></>;
}

function QualityMetric({ label, value }: { label: string; value: unknown }) {
  const verification = object(value);
  if (!verification) return <article className={styles.stat}><span>{label}</span><b>{typeof value === "number" ? value : "No verificado"}</b></article>;
  const verified = verification.status === "VERIFIED" && typeof verification.value === "number";
  return <article className={styles.stat} title={typeof verification.reason === "string" ? verification.reason : undefined}><span>{label}</span><b>{verified ? String(verification.value) : "No verificado"}</b>{typeof verification.reason === "string" && <small className={styles.subtle}>{verification.reason}</small>}</article>;
}

function Audit({ items }: { items: Json[] }) {
  return <section className={styles.card}><div className={styles.sectionTitle}><div><h2>Auditoría append-only</h2><p>Actor, rol, acción, entidad, request ID y timestamp.</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Fecha</th><th>Actor / rol</th><th>Acción</th><th>Entidad</th><th>Motivo</th></tr></thead><tbody>{items.map((item) => <tr key={String(item.id)}><td>{new Date(String(item.created_at)).toLocaleString("es-MX")}</td><td>{String(item.actor_role || "—")}<br /><span className={styles.subtle}>{String(item.actor_id || "sistema")}</span></td><td>{String(item.action)}</td><td>{String(item.entity_type)}<br />{String(item.entity_id)}</td><td>{String(item.reason || "—")}</td></tr>)}</tbody></table></div></section>;
}

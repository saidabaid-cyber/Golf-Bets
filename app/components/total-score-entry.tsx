"use client";
import { useRef, useState } from "react";
import type { Course, Player, RoundSnapshot } from "../../lib/types";
import { createTotalScoreRound, completeTotalScoreHoles } from "../../lib/total-score-round";
import { RoundCoursePicker } from "./round-course-picker";
import { CatalogCoursePicker } from './catalog-course-picker';
import { CourseReviewNotice } from './course-review-notice';
import { requestFeedback } from './feedback-dialog';
import { useBackyardAccount } from './account-provider';
import styles from "./total-score-entry.module.css";
const localDateMexico = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export function TotalScoreEntry({ courses, initialCourse = null, player, accessToken, onSave, onBack }: { courses: Course[]; initialCourse?: Course | null; player: Player; accessToken?: string | null; onSave: (round: RoundSnapshot) => Promise<void>; onBack: () => void }) {
  const {identity}=useBackyardAccount();
  const [catalogCards,setCatalogCards]=useState<Course[]>([]);
  const [id] = useState(() => crypto.randomUUID());
  const [course, setCourse] = useState<Course | null>(initialCourse), [date, setDate] = useState(localDateMexico), [holes, setHoles] = useState<9 | 18>(18), [start, setStart] = useState<1 | 10>(1), [total, setTotal] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); const lock = useRef(false);
  const tees = course ? [...catalogCards,...courses.filter(c=>!catalogCards.some(t=>t.id===c.id))].filter(c => course.catalogCourseId ? c.catalogCourseId === course.catalogCourseId : c.name === course.name) : [];
  async function save() { if (lock.current) return; setError(""); if (!course || !total.trim()) { setError("Selecciona campo, tee y total de golpes."); return; } lock.current = true; setBusy(true); try { await onSave(createTotalScoreRound({ id, course, player, date, holes, start, total: Number(total), now: new Date().toISOString() })); } catch(e) { setError(e instanceof Error ? e.message : "No pudimos guardar; reintenta."); lock.current = false; setBusy(false); } }
  return <section className={`card ${styles.screen}`}><button type="button" className="textButton" disabled={busy} onClick={onBack}>← Jugar</button><h1>Subir score total</h1><p>Una ronda terminada. No se inventarán scores por hoyo ni estadísticas.</p><form onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy}>
    <CatalogCoursePicker token={identity.accessToken} selectedName={course?`${course.name} · ${course.teeName}`:''} onRequest={()=>requestFeedback('COURSE')} onSelect={(next,cards)=>{setCatalogCards(cards.filter(c=>c.holes.length===18));setCourse(next);setError('');}} />
    <details><summary>Campos guardados / proveedor anterior</summary><RoundCoursePicker permissionOwnerId={player.accountUserId || player.id} selectedName={course?.name || ""} selectedId={course?.catalogCourseId || course?.id || ""} accessToken={accessToken} invalid={false} onSelect={choice => { const found = courses.find(c => (c.catalogCourseId || c.id) === choice.courseId || c.id === choice.id); if (found) { setCourse(found); setError(""); } else setError("Este campo todavía no tiene tees disponibles en el catálogo. Elige uno con datos."); }} /></details>
    {course&&<CourseReviewNotice course={course} roundHoles={holes} startHole={start} />}
    {course && <label>Tee<select value={course.id} onChange={e => setCourse(tees.find(c => c.id === e.target.value) || course)}>{tees.map(c => <option key={c.id} value={c.id}>{c.teeName}</option>)}</select></label>}
    <label>Fecha<input required type="date" value={date} max={localDateMexico()} onChange={e => setDate(e.target.value)} /></label>
    <div className={styles.grid}><label>Hoyos<select value={holes} onChange={e => setHoles(Number(e.target.value) as 9 | 18)}><option value={18}>18 hoyos</option><option value={9}>9 hoyos</option></select></label><label>{holes === 9 ? "Vuelta" : "Salida"}<select value={start} onChange={e => setStart(Number(e.target.value) as 1 | 10)}><option value={1}>{holes === 9 ? "Hoyos 1–9" : "Hoyo 1"}</option><option value={10}>{holes === 9 ? "Hoyos 10–18" : "Hoyo 10"}</option></select></label></div>
    <label>Total de golpes<input required type="number" inputMode="numeric" min={holes} max={holes*30} value={total} onChange={e => setTotal(e.target.value)} /></label><p>{player.name} · No se envía a GHIN. El total solo no cumple la evidencia por hoyo que necesita Backyard Index.</p>
    <button type="submit" className="primary">{busy ? "Guardando…" : "Guardar ronda terminada"}</button></fieldset>{error && <p role="alert">{error}</p>}</form></section>;
}
export function TotalScoreHistory({ round, onSave, onBack }: { round: RoundSnapshot; onSave: (round: RoundSnapshot) => Promise<void>; onBack: () => void }) {
  const [editing, setEditing] = useState(false), [rows, setRows] = useState<Record<number,string>>(() => Object.fromEntries((round.order || []).map(h => [h, String(round.scores?.[h]?.[round.ownerId!] ?? "")])));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); const lock = useRef(false);
  async function save() { if (lock.current) return; lock.current = true; setBusy(true); setError(""); try { const numbers = Object.fromEntries(Object.entries(rows).map(([h,s]) => [h, s.trim() ? Number(s) : NaN])); await onSave(completeTotalScoreHoles(round,numbers,new Date().toISOString())); setEditing(false); } catch(e) { setError(e instanceof Error ? e.message : "No pudimos guardar."); } finally { lock.current=false;setBusy(false); } }
  return <section className={`card ${styles.screen}`}><button type="button" className="textButton" onClick={onBack}>← Histórico</button><span>RONDA GUARDADA · {round.totalScoreCapture?.holesCompletedAt ? "DETALLE COMPLETADO" : "SÓLO TOTAL"}</span><h1>{round.courseName}</h1><p>{round.date} · {round.teeName} · {round.roundHoles} hoyos · salida H{round.startHole}</p><h2>{round.totalScoreCapture?.grossTotal} golpes</h2><p>El total declarado se conserva. No se estiman putts, GIR ni penalidades.</p>
    {!editing && <>{round.totalScoreCapture?.holesCompletedAt && <ul>{round.order?.map(h => <li key={h}>Hoyo {h}: {round.scores?.[h]?.[round.ownerId!] ?? "—"}</li>)}</ul>}{!round.cloudReadOnly && <button type="button" className="primary" onClick={() => setEditing(true)}>{round.totalScoreCapture?.holesCompletedAt ? "Revisar scores por hoyo" : "Completar scores por hoyo"}</button>}</>}
    {editing && <form onSubmit={e => {e.preventDefault();void save();}}><fieldset disabled={busy}><legend>Los hoyos deben sumar {round.totalScoreCapture?.grossTotal}</legend><div className={styles.holes}>{round.order?.map(h => <label key={h}>Hoyo {h}<input required type="number" inputMode="numeric" min={1} max={30} value={rows[h] || ""} onChange={e=>setRows(v=>({...v,[h]:e.target.value}))}/></label>)}</div><p>Total capturado: {Object.values(rows).reduce((n,v)=>n+(Number(v)||0),0)}</p><button type="submit" className="primary">{busy?"Guardando…":"Guardar detalle en esta ronda"}</button><button type="button" className="secondary" onClick={()=>setEditing(false)}>Cancelar</button></fieldset></form>}{error&&<p role="alert">{error}</p>}</section>;
}

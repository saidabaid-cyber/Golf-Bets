"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { EMPTY_COMPLETION_CHOICES, type CompletionChoices, type CompletionSection, type ProfileCompletion } from "../../lib/profile-completion";
import { socialRequest, socialErrorMessage } from "../../lib/social-activity-client";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { ModalShell } from "./modal-shell";
import styles from "./profile-completion-ring.module.css";
type Result = { choices: CompletionChoices; progress: ProfileCompletion };
export function ProfileCompletionRing({ token, avatar, name, revision, onOpen }: { token?: string | null; avatar: string; name: string; revision: string; onOpen: (section: CompletionSection) => void }) {
 const [result, setResult] = useState<Result | null>(null);
 const [choices, setChoices] = useState<CompletionChoices>(EMPTY_COMPLETION_CHOICES);
 const [manual, setManual] = useState("");
 const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
 const writing = useRef(false);
 const apply = (value: Result) => { setResult(value); setChoices(value.choices); setManual(value.choices.manual_hcp === null ? "" : String(value.choices.manual_hcp)); };
 const refresh = useCallback(async (signal?: AbortSignal) => {
  if (!token) return;
  try { const value = await socialRequest<Result>("/api/account/completion", token, { signal }); if (!signal?.aborted) { apply(value); setError(""); } }
  catch (e) { if (!signal?.aborted) setError(socialErrorMessage(e)); }
 }, [token]);
 useEffect(() => { const c = new AbortController(); void refresh(c.signal); return () => c.abort(); }, [refresh, revision]);
 async function save() {
  if (!token || writing.current) return;
  if (choices.handicap_choice === "MANUAL" && (!manual.trim() || !Number.isFinite(Number(manual)) || Number(manual) < -10 || Number(manual) > 54)) { setError("Escribe un HCP manual entre -10 y 54. Vacío no significa cero."); return; }
  writing.current = true; setBusy(true);
  try { apply(await socialRequest<Result>("/api/account/completion", token, { method:"PUT", body: { ...choices, manual_hcp: choices.handicap_choice === "MANUAL" ? Number(manual) : null } })); setError(""); }
  catch(e) { setError(socialErrorMessage(e)); } finally { writing.current = false; setBusy(false); }
 }
 return <><button type="button" className={styles.ring} style={{ "--progress": `${result?.progress.percent ?? 0}%` } as CSSProperties} onClick={() => { setOpen(true); void refresh(); }} aria-label={`Perfil ${result ? result.progress.percent + "% completado" : "consultar progreso"}`}><span><ProfileAvatarMedia value={avatar} fallback={name[0] || "J"} /></span><b>{result ? `${result.progress.percent}%` : "—"}</b></button>
 {open && createPortal(<ModalShell open onClose={() => setOpen(false)} closeDisabled={busy} className={`confirmDialog ${styles.dialog}`} labelledBy="profile-completion-title"><h2 id="profile-completion-title">Tu perfil {result ? `${result.progress.percent}%` : ""}</h2><p>Siete secciones con el mismo peso. No necesitas GHIN, publicar tu perfil ni aceptar permisos opcionales. Esto no bloquea jugar.</p>
 {result?.progress.sections.map(section => <div className={styles.row} key={section.id}><button type="button" className="textButton" onClick={() => { setOpen(false); onOpen(section.id); }}>{section.complete ? "✓" : "○"} {section.label} ›</button>{["golf","equipment","ball","fitting"].includes(section.id) && <label><input type="checkbox" disabled={busy} checked={choices.not_applicable.includes(section.id)} onChange={e => setChoices(v => ({ ...v, not_applicable: e.target.checked ? [...v.not_applicable,section.id] : v.not_applicable.filter(k => k !== section.id) }))} />No aplica</label>}</div>)}
 <fieldset disabled={busy}><legend>Si no usas un índice vinculado</legend><label><input type="radio" name="completion-hcp" checked={choices.handicap_choice === null} onChange={() => setChoices(v => ({...v, handicap_choice:null, manual_hcp:null}))} />Usar fuente del perfil / dejar pendiente</label><label><input type="radio" name="completion-hcp" checked={choices.handicap_choice === "UNKNOWN"} onChange={() => setChoices(v => ({...v, handicap_choice:"UNKNOWN", manual_hcp:null}))} />No tengo hándicap</label><label><input type="radio" name="completion-hcp" checked={choices.handicap_choice === "MANUAL"} onChange={() => setChoices(v => ({...v, handicap_choice:"MANUAL"}))} />HCP manual · no oficial</label>{choices.handicap_choice === "MANUAL" && <label>HCP declarado<input inputMode="decimal" value={manual} onChange={e => setManual(e.target.value)} /></label>}<p>No sustituye un GHIN ni un Backyard Index guardado.</p></fieldset>
 {error && <p role="alert">{error}</p>}<button type="button" className="primary" disabled={busy || !result} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar respuestas"}</button>{!result && <button type="button" onClick={() => void refresh()}>Reintentar</button>}</ModalShell>, document.body)}</>;
}

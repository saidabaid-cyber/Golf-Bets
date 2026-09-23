"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { validateTeeFeedback } from "../../lib/feedback";
import { ModalShell } from "./modal-shell";
import styles from "./feedback-dialog.module.css";

type FeedbackEventDetail = "TEE" | { category?: string; courseName?: string };

export function FeedbackDialog({ token, email, screen = "" }: { token?: string | null; email?: string | null; screen?: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ courseName: "", teeName: "", description: "", replyEmail: email || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const requestId = useRef("");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<FeedbackEventDetail>).detail;
      const category = typeof detail === "string" ? detail : detail?.category;
      if (category !== "TEE") return;
      const courseName = typeof detail === "object" && typeof detail.courseName === "string" ? detail.courseName : "";
      requestId.current = crypto.randomUUID();
      setForm({ courseName, teeName: "", description: "", replyEmail: email || "" });
      setReference("");
      setError("");
      setOpen(true);
    };
    window.addEventListener("backyard:feedback", handler);
    return () => window.removeEventListener("backyard:feedback", handler);
  }, [email]);

  async function submit() {
    const checked = validateTeeFeedback({ category: "TEE", ...form });
    if (!checked.ok) { setError(checked.error); return; }
    if (!token) { setError("Inicia sesión para enviar esta solicitud al catálogo."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: requestId.current, input: checked.data, screen }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.received) throw new Error(typeof data.error === "string" ? data.error : "No pudimos guardar la solicitud.");
      setReference(requestId.current.slice(0, 8).toUpperCase());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos guardar la solicitud."); }
    finally { setBusy(false); }
  }

  if (!open) return null;
  return createPortal(<ModalShell open onClose={() => !busy && setOpen(false)} closeDisabled={busy} className={`confirmDialog ${styles.dialog}`} labelledBy="tee-feedback-title">
    {reference ? <div className={styles.success}><span aria-hidden="true">✓</span><h2 id="tee-feedback-title">Solicitud recibida</h2><p>Quedó como reporte pendiente de revisión. No se publicará automáticamente.</p><small>Referencia {reference}</small><button type="button" className="primary" onClick={() => setOpen(false)}>Cerrar</button></div> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <span className={styles.eyebrow}>CATÁLOGO · REVISIÓN</span><h2 id="tee-feedback-title">¿Falta un tee?</h2><p>Comparte lo que conoces. El equipo lo verificará antes de publicarlo.</p>
      <fieldset disabled={busy} className={styles.fields}>
        <label>Campo / recorrido<input value={form.courseName} maxLength={200} onChange={(event) => setForm((current) => ({ ...current, courseName: event.target.value }))} /></label>
        <label>Nombre o color del tee<input value={form.teeName} maxLength={200} onChange={(event) => setForm((current) => ({ ...current, teeName: event.target.value }))} /></label>
        <label>Información conocida / comentario<textarea rows={4} value={form.description} maxLength={2000} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
        <label>Correo de respuesta (opcional)<input type="email" value={form.replyEmail} maxLength={200} onChange={(event) => setForm((current) => ({ ...current, replyEmail: event.target.value }))} /></label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button type="submit" className="primary">{busy ? "Guardando…" : "Enviar solicitud"}</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</button>
      </fieldset>
    </form>}
  </ModalShell>, document.body);
}

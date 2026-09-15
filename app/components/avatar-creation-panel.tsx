"use client";

import { useEffect, useId, useRef, useState } from "react";
import { avatarGenerationAvailability, generateProfileAvatar, commitGeneratedProfileAvatar, type AvatarGenerationAvailability, type AvatarGenerationPreview, type AvatarStyle } from "../../lib/avatar-generation-client";
import { profileImageErrorMessage, profileImageFromFile } from "../../lib/profile-image";
import styles from "./avatar-creation-panel.module.css";

const STYLE_LABELS: [AvatarStyle, string][] = [["realistic", "Realista"], ["illustrated", "Ilustrado"], ["cartoon", "Caricatura"], ["minimalist", "Minimalista"]];

export function AvatarCreationPanel({ accessToken, userId, onUse, onBusyChange, onCancel }: {
  accessToken?: string | null;
  userId?: string;
  onUse: (avatarUrl: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [source, setSource] = useState<"description" | "photo">("description");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState<AvatarStyle>("illustrated");
  const [photo, setPhoto] = useState("");
  const [consent, setConsent] = useState(false);
  const [availability, setAvailability] = useState<AvatarGenerationAvailability | null>(null);
  const [preview, setPreview] = useState<AvatarGenerationPreview | null>(null);
  const [busy, setBusy] = useState<"photo" | "generate" | "save" | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyCallback = useRef(onBusyChange);
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);

  useEffect(() => {
    const abort = new AbortController();
    setAvailability(null); setPreview(null); setConsent(false); setBusy(null); setPhoto(""); setError("");
    void avatarGenerationAvailability(accessToken, abort.signal).then((value) => { if (!abort.signal.aborted) setAvailability(value); }).catch(() => {
      if (!abort.signal.aborted) setAvailability({ available: false, error: "No pudimos comprobar el servicio. Cierra y vuelve a intentar." });
    });
    return () => { abort.abort(); controller.current?.abort(); revision.current += 1; busyCallback.current?.(false); };
  }, [accessToken, userId]);

  function invalidate() {
    controller.current?.abort();
    revision.current += 1;
    setBusy(null); busyCallback.current?.(false);
  }
  function changeSource(next: "description" | "photo") {
    invalidate(); setSource(next); setConsent(false); setPreview(null); setError("");
    // A photo selected for a different attempt is never silently reused.
    setPhoto("");
  }
  async function choosePhoto(file?: File) {
    if (!file) return;
    invalidate(); const request = revision.current;
    setBusy("photo"); busyCallback.current?.(true); setError(""); setConsent(false); setPhoto("");
    try {
      const data = await profileImageFromFile(file);
      if (revision.current === request) setPhoto(data);
    } catch (reason) { if (revision.current === request) setError(profileImageErrorMessage(reason)); }
    finally {
      if (revision.current === request) { setBusy(null); busyCallback.current?.(false); }
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function generate() {
    if (busy || !availability?.available) return;
    invalidate(); const request = revision.current;
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 100_000);
    setBusy("generate"); busyCallback.current?.(true); setError("");
    try {
      const result = await generateProfileAvatar(accessToken, userId, { source, description, style, ...(source === "photo" ? { photoDataUrl: photo } : {}) }, consent, abort.signal);
      if (revision.current === request) { setPreview(result); setPhoto(""); }
    } catch (reason) {
      if (revision.current === request) setError(abort.signal.aborted ? "La generación tardó demasiado. Tu avatar actual no cambió." : reason instanceof Error ? reason.message : "No se pudo generar. Reintenta.");
    } finally {
      clearTimeout(timeout);
      if (revision.current === request) { setBusy(null); busyCallback.current?.(false); }
    }
  }
  async function applyGeneratedAvatar() {
    if (busy || !preview) return;
    invalidate(); const request = revision.current;
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 30_000);
    setBusy("save"); busyCallback.current?.(true); setError("");
    try {
      const url = await commitGeneratedProfileAvatar(accessToken, preview, abort.signal);
      if (revision.current === request) onUse(url);
    } catch (reason) {
      if (revision.current === request) setError(abort.signal.aborted ? "No se confirmó el guardado a tiempo. Puedes reintentar." : reason instanceof Error ? reason.message : "No se pudo guardar. Reintenta.");
    } finally {
      clearTimeout(timeout);
      if (revision.current === request) { setBusy(null); busyCallback.current?.(false); }
    }
  }
  return <section className={styles.panel} aria-labelledby={`${id}-title`}>
    <header><h3 id={`${id}-title`}>CREA TU AVATAR</h3><button type="button" aria-label="Cerrar creación de avatar" onClick={() => { invalidate(); onCancel(); }}>×</button></header>
    {!preview ? <>
      <div className={styles.sources} role="group" aria-label="Origen del avatar">
        <button type="button" aria-pressed={source === "description"} disabled={busy === "save"} onClick={() => changeSource("description")}>DESCRIBIR MI AVATAR</button>
        <button type="button" aria-pressed={source === "photo"} disabled={busy === "save"} onClick={() => changeSource("photo")}>CREAR DESDE MI FOTO</button>
      </div>
      {source === "photo" && <div className={styles.photo}>
        {photo && <img src={photo} alt="Foto elegida sólo para esta creación" />}
        <input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Foto voluntaria para crear avatar" onChange={(event) => void choosePhoto(event.target.files?.[0])} />
        <button type="button" className="secondary" disabled={busy !== null} onClick={() => fileRef.current?.click()}>{busy === "photo" ? "Preparando foto…" : "SUBIR FOTO"}</button>
        <small>Elige una foto para esta función. No usamos tu foto de perfil automáticamente. Hasta 20 MB; se optimiza antes de enviarla.</small>
      </div>}
      <label htmlFor={`${id}-description`}>{source === "description" ? "Describe cómo quieres verte" : "Detalles opcionales"}</label>
      <textarea id={`${id}-description`} value={description} maxLength={1000} rows={3} disabled={busy !== null} placeholder="Golfista con gorra verde, estilo ilustración." onChange={(event) => { setDescription(event.target.value); setConsent(false); }} />
      <fieldset className={styles.styles}><legend>Estilo</legend>{STYLE_LABELS.map(([value, label]) => <label key={value}><input type="radio" name={`${id}-style`} value={value} checked={style === value} disabled={busy !== null} onChange={() => { setStyle(value); setConsent(false); }} />{label}</label>)}</fieldset>
      <label className={styles.consent}><input type="checkbox" checked={consent} disabled={busy !== null} onChange={(event) => setConsent(event.target.checked)} /><span>Autorizo enviar esta descripción{source === "photo" ? " y la foto que elegí" : ""} a OpenAI para crear mi avatar.</span></label>
      {!availability ? <p role="status">Comprobando servicio…</p> : !availability.available ? <div className={styles.notice} role="status"><b>Servicio de generación no disponible</b><span>{availability.error || "Falta configurar el proveedor seguro de imágenes."}</span>{availability.code && <small>{availability.code}</small>}</div> : null}
      {!accessToken && <p className={styles.notice}>Inicia sesión para generar y guardar un avatar. Foto y Emoji siguen disponibles.</p>}
      <button type="button" className="primary" disabled={busy !== null || !availability?.available || !accessToken || !consent || (source === "description" ? !description.trim() : !photo)} onClick={() => void generate()}>{busy === "generate" ? "Generando avatar…" : "GENERAR AVATAR"}</button>
    </> : <div className={styles.result}>
      <img src={preview.imageDataUrl} alt="Vista previa del avatar generado; aún no guardado" />
      <small>El avatar actual no cambiará hasta que lo elijas y guardes tu perfil. La imagen elegida se guardará como avatar accesible mediante su enlace.</small>
      <button type="button" className="primary" disabled={busy !== null} onClick={() => void applyGeneratedAvatar()}>{busy === "save" ? "Guardando imagen…" : "USAR ESTE AVATAR"}</button>
      <button type="button" className="secondary" disabled={busy !== null} onClick={() => { invalidate(); setPreview(null); setConsent(false); setError(""); }}>GENERAR OTRO</button>
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button type="button" className="textButton" onClick={() => { invalidate(); onCancel(); }}>CANCELAR</button>
  </section>;
}

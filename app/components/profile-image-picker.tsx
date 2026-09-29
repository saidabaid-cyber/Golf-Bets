"use client";

import { useEffect, useId, useRef, useState } from "react";
import { profileImageErrorMessage, profileImageFromFile, type ProfileImageCrop } from "../../lib/profile-image";
import { isProfileEmojiAvatar, normalizeProfileEmojiAvatar, profileAvatarType } from "../../lib/profile-avatar";
import styles from "./profile-image-picker.module.css";
import { AvatarCreationPanel } from "./avatar-creation-panel";
import { parseManualAvatarUrl } from "../../lib/manual-avatar";
import { PHOTO_AVATAR_GENERATION_CAPABILITY } from "../../lib/photo-avatar-generation";

type AvatarMode = "photo" | "emoji" | "create" | "custom" | "none";
type PendingPhoto = { file: File; objectUrl: string };
const QUICK_EMOJIS = ["😎", "🏌️", "⛳", "🔥", "🤠", "🦁"];

function modeFromValue(value: string): AvatarMode {
  const type = profileAvatarType(value);
  return type === "custom_avatar" ? "custom" : type;
}

export function ProfileImagePicker({ value, onChange, kind = "profile", onBusyChange, providerPhotoUrl }: {
  value: string;
  onChange: (value: string) => void;
  kind?: "profile" | "group";
  onBusyChange?: (busy: boolean) => void;
  providerPhotoUrl?: string;
  accessToken?: string | null;
  userId?: string;
}) {
  const fieldId = useId();
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pendingPhotoRef = useRef<PendingPhoto | null>(null);
  const requestRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [crop, setCrop] = useState<Required<ProfileImageCrop>>({ zoom: 1, positionX: 0, positionY: 0 });
  const [emojiInput, setEmojiInput] = useState({ source: value, text: isProfileEmojiAvatar(value) ? value : "" });
  const emojiDraft = emojiInput.source === value ? emojiInput.text : isProfileEmojiAvatar(value) ? value : "";
  function setEmojiDraft(text: string) { setEmojiInput({ source: value, text }); }
  const [selection, setSelection] = useState<{ mode: AvatarMode; value: string }>({ mode: modeFromValue(value), value });
  const mode = selection.value === value ? selection.mode : modeFromValue(value);

  function releasePendingPhoto() {
    const current = pendingPhotoRef.current;
    if (current) URL.revokeObjectURL(current.objectUrl);
    pendingPhotoRef.current = null;
    setPendingPhoto(null);
  }

  useEffect(() => () => {
    requestRef.current += 1;
    const current = pendingPhotoRef.current;
    if (current) URL.revokeObjectURL(current.objectUrl);
    onBusyChange?.(false);
  }, [onBusyChange]);

  function selectMode(next: AvatarMode) {
    requestRef.current += 1;
    setBusy(false); onBusyChange?.(false);
    if (next !== "photo") releasePendingPhoto();
    setSelection({ mode: next, value });
    setMessage(""); setStatus("");
    if (next === "emoji") setEmojiDraft(isProfileEmojiAvatar(value) ? value : "");
    if (next === "none") { onChange(""); setStatus("Sin imagen. Guarda tu perfil para confirmar el cambio."); }
  }

  function applyEmoji() {
    const emoji = normalizeProfileEmojiAvatar(emojiDraft);
    if (!emoji) { setMessage("Elige un solo emoji desde el teclado."); return; }
    onChange(emoji);
    setSelection({ mode: "emoji", value: emoji });
    setEmojiDraft(emoji);
    setMessage("");
    setStatus("Emoji seleccionado. Guarda tu perfil para conservarlo.");
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    if (kind === "group") {
      const request = ++requestRef.current;
      setBusy(true); onBusyChange?.(true); setMessage(""); setStatus("Preparando imagen…");
      try {
        const image = await profileImageFromFile(file, 320);
        if (request !== requestRef.current) return;
        onChange(image);
        setStatus("Imagen lista.");
      } catch (error) {
        if (request === requestRef.current) setMessage(profileImageErrorMessage(error));
      } finally {
        if (request === requestRef.current) { setBusy(false); onBusyChange?.(false); }
        if (galleryInputRef.current) galleryInputRef.current.value = "";
      }
      return;
    }
    releasePendingPhoto();
    const objectUrl = URL.createObjectURL(file);
    const next = { file, objectUrl };
    pendingPhotoRef.current = next;
    setPendingPhoto(next);
    setCrop({ zoom: 1, positionX: 0, positionY: 0 });
    setMessage("");
    setStatus("Ajusta el encuadre antes de usar esta foto.");
    if (galleryInputRef.current) galleryInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  async function applyPendingPhoto() {
    if (!pendingPhoto || busy) return;
    const request = ++requestRef.current;
    setBusy(true); onBusyChange?.(true); setMessage(""); setStatus("Preparando imagen…");
    try {
      const image = await profileImageFromFile(pendingPhoto.file, kind === "profile" ? 512 : 320, crop);
      if (request !== requestRef.current) return;
      onChange(image);
      setSelection({ mode: "photo", value: image });
      setStatus("Listo. Guarda tu perfil para conservar la foto.");
      releasePendingPhoto();
    } catch (error) {
      if (request === requestRef.current) setMessage(profileImageErrorMessage(error));
    } finally {
      if (request === requestRef.current) { setBusy(false); onBusyChange?.(false); }
    }
  }

  const previewValue = pendingPhoto?.objectUrl || value;
  return <div className={styles.picker}>
    {kind === "profile" && <div className={styles.title}><span>AVATAR DE PERFIL</span><h3>ELIGE TU AVATAR</h3><p>Crea uno a tu estilo o usa una foto propia.</p></div>}
    <div className={`${styles.preview} ${kind === "profile" ? styles.profilePreview : ""}`}>{isProfileEmojiAvatar(previewValue) ? <span role="img" aria-label="Emoji seleccionado">{previewValue}</span> : previewValue ? <img src={previewValue} alt={kind === "profile" ? "Avatar seleccionado" : "Imagen del grupo"} referrerPolicy="no-referrer" /> : <span aria-hidden="true">{kind === "profile" ? "⛳" : "👥"}</span>}</div>
    {kind === "profile" && <div className={styles.primaryChoices} role="group" aria-label="Opciones principales de avatar">
      <button type="button" data-active={mode === "create" || mode === "custom"} onClick={() => selectMode("create")}><span aria-hidden="true">◉</span><b>CREAR MI AVATAR</b><small>Diseña rasgos y look de golf</small></button>
      <button type="button" data-active={mode === "photo"} onClick={() => selectMode("photo")}><span aria-hidden="true">＋</span><b>SUBIR UNA IMAGEN</b><small>Cámara o galería</small></button>
    </div>}
    {kind === "profile" && <div className={styles.secondaryChoices} role="group" aria-label="Otras opciones de avatar">
      <button type="button" aria-pressed={mode === "emoji"} onClick={() => selectMode("emoji")}>Emoji</button>
      <button type="button" aria-pressed={mode === "none"} onClick={() => selectMode("none")}>Sin imagen</button>
      {providerPhotoUrl && <button type="button" aria-pressed={value === providerPhotoUrl} onClick={() => { releasePendingPhoto(); onChange(providerPhotoUrl); setSelection({ mode: "photo", value: providerPhotoUrl }); setStatus("Foto de Google seleccionada. Puedes editarla o cambiarla."); }}>Conservar foto de Google</button>}
    </div>}
    {(kind === "group" || mode === "photo") && <div className={styles.controls}>
      <input ref={cameraInputRef} className={styles.file} type="file" aria-label="Tomar foto para el avatar" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" capture="user" onChange={(event) => void chooseFile(event.target.files?.[0])} />
      <input ref={galleryInputRef} className={styles.file} type="file" aria-label={kind === "profile" ? "Elegir foto de la galería" : "Seleccionar imagen del grupo"} accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" onChange={(event) => void chooseFile(event.target.files?.[0])} />
      {!pendingPhoto && <div className={styles.photoSources}>{kind === "profile" && <button type="button" className="secondary" disabled={busy} onClick={() => cameraInputRef.current?.click()}>TOMAR FOTO</button>}<button type="button" className="secondary" disabled={busy} onClick={() => galleryInputRef.current?.click()}>{kind === "profile" ? "ELEGIR DE GALERÍA" : "SUBIR IMAGEN"}</button></div>}
      {pendingPhoto && <section className={styles.cropEditor} aria-label="Recortar y encuadrar foto">
        <div className={styles.cropPreview}><img src={pendingPhoto.objectUrl} alt="Vista previa del encuadre" style={{ transform: `translate(${crop.positionX * -16}%, ${crop.positionY * -16}%) scale(${crop.zoom})` }} /></div>
        <label htmlFor={`${fieldId}-zoom`}>Zoom<input id={`${fieldId}-zoom`} type="range" min="1" max="3" step="0.05" value={crop.zoom} onChange={(event) => setCrop(current => ({ ...current, zoom: Number(event.target.value) }))} /></label>
        <label htmlFor={`${fieldId}-horizontal`}>Horizontal<input id={`${fieldId}-horizontal`} type="range" min="-1" max="1" step="0.05" value={crop.positionX} onChange={(event) => setCrop(current => ({ ...current, positionX: Number(event.target.value) }))} /></label>
        <label htmlFor={`${fieldId}-vertical`}>Vertical<input id={`${fieldId}-vertical`} type="range" min="-1" max="1" step="0.05" value={crop.positionY} onChange={(event) => setCrop(current => ({ ...current, positionY: Number(event.target.value) }))} /></label>
        <div className={styles.photoActions}><button type="button" className="primary" disabled={busy} onClick={() => void applyPendingPhoto()}>{busy ? "PREPARANDO IMAGEN…" : "USAR ESTA FOTO"}</button><button type="button" className="secondary" disabled={!PHOTO_AVATAR_GENERATION_CAPABILITY.available || busy} aria-describedby={`${fieldId}-generation-note`}>CREAR AVATAR DESDE MI FOTO</button><button type="button" className="textButton" disabled={busy} onClick={() => galleryInputRef.current?.click()}>ELEGIR OTRA</button></div>
        {!PHOTO_AVATAR_GENERATION_CAPABILITY.available && <small id={`${fieldId}-generation-note`}>La transformación desde foto requiere un proveedor de generación real y todavía no está disponible en este entorno.</small>}
      </section>}
      <small>JPEG, PNG, WebP o HEIC/HEIF compatible. Hasta 20 MB; se optimiza antes de guardar.</small>
    </div>}
    {kind === "profile" && mode === "emoji" && <div className={styles.emojiInput}><label htmlFor={`${fieldId}-emoji`}>Emoji de avatar</label><div><input id={`${fieldId}-emoji`} type="text" value={emojiDraft} maxLength={64} inputMode="text" autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" placeholder="Elige un emoji del teclado" aria-label="Emoji de avatar" onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); applyEmoji(); } }} onChange={(event) => { setEmojiDraft(event.target.value); setMessage(""); setStatus(""); }} /><button type="button" className="secondary" onClick={applyEmoji}>USAR EMOJI</button></div><div className={styles.quickEmojis} aria-label="Emojis sugeridos">{QUICK_EMOJIS.map((emoji) => <button key={emoji} type="button" aria-label={`Elegir ${emoji}`} aria-pressed={emojiDraft === emoji} onClick={() => { setEmojiDraft(emoji); setMessage(""); setStatus(""); }}>{emoji}</button>)}</div><small>Opción secundaria: también puedes usar el teclado de tu teléfono.</small></div>}
    {kind === "profile" && mode === "custom" && <div className={styles.manualSummary}><span>Avatar creado por ti</span><button type="button" className="secondary" onClick={() => selectMode("create")}>EDITAR RASGOS</button></div>}
    {kind === "profile" && mode === "create" && <AvatarCreationPanel initialValue={parseManualAvatarUrl(value) ? value : undefined} staged onBusyChange={onBusyChange} onCancel={() => selectMode(modeFromValue(value))} onUse={(url) => {
      onChange(url); setSelection({ mode: "custom", value: url }); setStatus("Avatar listo. Guarda tu perfil para conservarlo.");
    }} />}
    {message && <small className={styles.error} role="alert">{message}</small>}
    {status && <small className={styles.help} role="status">{status}</small>}
    <small className={styles.help}>Puedes cambiarlo o eliminarlo después.</small>
  </div>;
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { profileImageErrorMessage, profileImageFromFile } from "../../lib/profile-image";
import { isProfileEmojiAvatar, normalizeProfileEmojiAvatar, profileAvatarType } from "../../lib/profile-avatar";
import styles from "./profile-image-picker.module.css";
import { AvatarCreationPanel } from "./avatar-creation-panel";

type AvatarMode = "photo" | "emoji" | "create" | "none";
const QUICK_EMOJIS = ["😎", "🏌️", "⛳", "🔥", "🤠", "🦁"];
function modeFromValue(value: string): AvatarMode {
  const type = profileAvatarType(value);
  // A saved generated image is an existing avatar, not a new generation draft.
  // Only an explicit tap on CREAR AVATAR opens the provider flow.
  return type === "generated_avatar" ? "photo" : type;
}

export function ProfileImagePicker({ value, onChange, kind = "profile", onBusyChange, accessToken, userId }: { value: string; onChange: (value: string) => void; kind?: "profile" | "group"; onBusyChange?: (busy: boolean) => void; accessToken?: string | null; userId?: string }) {
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [emojiInput, setEmojiInput] = useState({ source: value, text: isProfileEmojiAvatar(value) ? value : "" });
  const emojiDraft = emojiInput.source === value ? emojiInput.text : isProfileEmojiAvatar(value) ? value : "";
  function setEmojiDraft(text: string) { setEmojiInput({ source: value, text }); }
  const [selection, setSelection] = useState<{ mode: AvatarMode; value: string }>({ mode: modeFromValue(value), value });
  const mode = selection.value === value ? selection.mode : modeFromValue(value);
  useEffect(() => () => { requestRef.current += 1; onBusyChange?.(false); }, [onBusyChange]);

  function selectMode(next: AvatarMode) {
    requestRef.current += 1;
    setBusy(false); onBusyChange?.(false);
    setSelection({ mode: next, value });
    setMessage(""); setStatus("");
    if (next === "emoji") setEmojiDraft(isProfileEmojiAvatar(value) ? value : "");
    if (next === "none") onChange("");
  }
  function applyEmoji() {
    const emoji = normalizeProfileEmojiAvatar(emojiDraft);
    if (!emoji) { setMessage("Elige un solo emoji desde el teclado."); return; }
    onChange(emoji);
    setEmojiDraft(emoji);
    setMessage("");
    setStatus("Emoji seleccionado. Guarda tu perfil para conservarlo.");
  }
  async function chooseFile(file: File | undefined) {
    if (!file) return;
    const request = ++requestRef.current;
    setBusy(true); onBusyChange?.(true); setMessage(""); setStatus("");
    try {
      const image = await profileImageFromFile(file, kind === "profile" ? 512 : 320);
      if (request !== requestRef.current) return;
      onChange(image);
      setStatus("Imagen optimizada. Revisa el recorte y guarda para conservarla.");
    } catch (error) { if (request === requestRef.current) setMessage(profileImageErrorMessage(error)); }
    finally {
      if (request === requestRef.current) { setBusy(false); onBusyChange?.(false); }
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  return <div className={styles.picker}>
    <div className={`${styles.preview} ${kind === "profile" ? styles.profilePreview : ""}`}>{isProfileEmojiAvatar(value) ? <span role="img" aria-label="Emoji seleccionado">{value}</span> : value ? <img src={value} alt={kind === "profile" ? "Avatar seleccionado" : "Imagen del grupo"} referrerPolicy="no-referrer" /> : <span aria-hidden="true">{kind === "profile" ? "⛳" : "👥"}</span>}</div>
    {kind === "profile" && <div className={styles.tabs} role="group" aria-label="Tipo de avatar">{([["photo", "FOTO"], ["emoji", "EMOJI"], ["create", "CREAR AVATAR"], ["none", "SIN IMAGEN"]] as const).map(([option, label]) => <button key={option} type="button" aria-pressed={mode === option} data-active={mode === option} onClick={() => selectMode(option)}>{label}</button>)}</div>}
    {(kind === "group" || mode === "photo") && <div className={styles.controls}>
      <input ref={inputRef} className={styles.file} type="file" aria-label={kind === "profile" ? "Seleccionar foto o imagen de avatar" : "Seleccionar imagen del grupo"} accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" onChange={(event) => void chooseFile(event.target.files?.[0])} />
      <button type="button" className="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Preparando…" : kind === "profile" ? "Subir foto" : "Subir imagen del grupo"}</button>
      <small>Fotos, stickers o imágenes de avatar. Hasta 20 MB de origen; se recortan al centro y se optimizan antes de guardar. HEIC/HEIF depende de la compatibilidad de tu navegador.</small>
    </div>}
    {kind === "profile" && mode === "emoji" && <div className={styles.emojiInput}><label htmlFor={`${fieldId}-emoji`}>Emoji de avatar</label><div><input id={`${fieldId}-emoji`} type="text" value={emojiDraft} maxLength={64} inputMode="text" autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" placeholder="Elige un emoji del teclado" aria-label="Emoji de avatar" onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); applyEmoji(); } }} onChange={(event) => { setEmojiDraft(event.target.value); setMessage(""); setStatus(""); }} /><button type="button" className="secondary" onClick={applyEmoji}>USAR EMOJI</button></div><div className={styles.quickEmojis} aria-label="Emojis sugeridos">{QUICK_EMOJIS.map((emoji) => <button key={emoji} type="button" aria-label={`Elegir ${emoji}`} aria-pressed={emojiDraft === emoji} onClick={() => { setEmojiDraft(emoji); setMessage(""); setStatus(""); }}>{emoji}</button>)}</div><small>También puedes usar el teclado de tu teléfono, incluidos tonos de piel y combinaciones Unicode.</small></div>}
    {kind === "profile" && mode === "create" && <AvatarCreationPanel key={userId || "guest"} accessToken={accessToken} userId={userId} onBusyChange={onBusyChange} onCancel={() => selectMode("photo")} onUse={(url) => {
      onChange(url); setSelection({ mode: "photo", value: url }); setStatus("Avatar generado guardado como imagen. Guarda tu perfil para usarlo en la app.");
    }} />}
    {message && <small className={styles.error} role="alert">{message}</small>}
    {status && <small className={styles.help} role="status">{status}</small>}
    <small className={styles.help}>Puedes cambiarla después. No necesitas pegar enlaces.</small>
  </div>;
}

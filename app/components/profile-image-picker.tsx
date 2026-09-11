"use client";

import { useRef, useState } from "react";
import { profileImageErrorMessage, profileImageFromFile } from "../../lib/profile-image";
import { isProfileEmojiAvatar, normalizeProfileEmojiAvatar } from "../../lib/profile-avatar";
import styles from "./profile-image-picker.module.css";

export function ProfileImagePicker({ value, onChange, kind = "profile" }: { value: string; onChange: (value: string) => void; kind?: "profile" | "group" }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [emojiDraft, setEmojiDraft] = useState(isProfileEmojiAvatar(value) ? value : "");
  const [mode, setMode] = useState<"photo" | "emoji">(isProfileEmojiAvatar(value) ? "emoji" : "photo");
  function applyEmoji() {
    const emoji = normalizeProfileEmojiAvatar(emojiDraft);
    if (!emoji) { setMessage("Elige un solo emoji desde el teclado."); return; }
    onChange(emoji);
    setEmojiDraft(emoji);
    setMessage("");
  }
  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMessage("");
    try { onChange(await profileImageFromFile(file, kind === "profile" ? 192 : 320)); }
    catch (error) { setMessage(profileImageErrorMessage(error)); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }
  return <div className={styles.picker}>
    <div className={styles.preview}>{isProfileEmojiAvatar(value) ? <span role="img" aria-label="Emoji seleccionado">{value}</span> : value ? <img src={value} alt={kind === "profile" ? "Avatar seleccionado" : "Imagen del grupo"} referrerPolicy="no-referrer" /> : <span aria-hidden="true">{kind === "profile" ? "⛳" : "👥"}</span>}</div>
    {kind === "profile" && <div className={styles.tabs} role="tablist" aria-label="Tipo de avatar"><button type="button" role="tab" aria-selected={mode === "photo"} data-active={mode === "photo"} onClick={() => setMode("photo")}>FOTO</button><button type="button" role="tab" aria-selected={mode === "emoji"} data-active={mode === "emoji"} onClick={() => setMode("emoji")}>EMOJI</button></div>}
    {(kind === "group" || mode === "photo") && <div className={styles.controls}>
      <input ref={inputRef} className={styles.file} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseFile(event.target.files?.[0])} />
      <button type="button" className="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Preparando…" : kind === "profile" ? "Subir foto" : "Subir imagen del grupo"}</button>
      {value && <button type="button" className="textButton" disabled={busy} onClick={() => { onChange(""); setMessage(""); }}>Dejar sin imagen</button>}
    </div>}
    {kind === "profile" && mode === "emoji" && <div className={styles.emojiInput}><label htmlFor="profile-avatar-emoji">Emoji de avatar</label><div><input id="profile-avatar-emoji" value={emojiDraft} inputMode="text" autoComplete="off" enterKeyHint="done" placeholder="Toca y elige desde tu teclado" aria-label="Emoji de avatar" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyEmoji(); } }} onChange={(event) => { setEmojiDraft(event.target.value.slice(0, 32)); setMessage(""); }} /><button type="button" className="secondary" onClick={applyEmoji}>Usar emoji</button></div><small>Usa el teclado normal de tu teléfono. Se admite un emoji completo, incluidos tonos y combinaciones.</small></div>}
    {message && <small className={styles.error} role="alert">{message}</small>}
    <small className={styles.help}>Puedes cambiarla después. No necesitas pegar enlaces.</small>
  </div>;
}

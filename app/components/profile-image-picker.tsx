"use client";

import { useRef, useState } from "react";
import { profileImageErrorMessage, profileImageFromFile } from "../../lib/profile-image";
import styles from "./profile-image-picker.module.css";

const AVATARS = [
  { src: "/avatars/golfer-green.svg", label: "Golf verde" },
  { src: "/avatars/golf-ball.svg", label: "Bola de golf" },
  { src: "/avatars/flag-sunset.svg", label: "Bandera al atardecer" },
] as const;

export function ProfileImagePicker({ value, onChange, kind = "profile" }: { value: string; onChange: (value: string) => void; kind?: "profile" | "group" }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMessage("");
    try { onChange(await profileImageFromFile(file, kind === "profile" ? 192 : 320)); }
    catch (error) { setMessage(profileImageErrorMessage(error)); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }
  return <div className={styles.picker}>
    <div className={styles.preview}>{value ? <img src={value} alt={kind === "profile" ? "Avatar seleccionado" : "Imagen del grupo"} referrerPolicy="no-referrer" /> : <span aria-hidden="true">{kind === "profile" ? "⛳" : "👥"}</span>}</div>
    <div className={styles.controls}>
      <input ref={inputRef} className={styles.file} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseFile(event.target.files?.[0])} />
      <button type="button" className="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Preparando…" : kind === "profile" ? "Subir foto" : "Subir imagen del grupo"}</button>
      {value && <button type="button" className="textButton" disabled={busy} onClick={() => { onChange(""); setMessage(""); }}>Dejar sin imagen</button>}
    </div>
    {kind === "profile" && <div className={styles.presets} aria-label="Avatares disponibles">{AVATARS.map((avatar) => <button type="button" key={avatar.src} data-active={value === avatar.src} aria-pressed={value === avatar.src} aria-label={`Elegir ${avatar.label}`} onClick={() => { onChange(avatar.src); setMessage(""); }}><img src={avatar.src} alt="" /></button>)}</div>}
    {message && <small className={styles.error} role="alert">{message}</small>}
    <small className={styles.help}>Puedes cambiarla después. No necesitas pegar enlaces.</small>
  </div>;
}

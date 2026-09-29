"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { normalizeProfileImageCrop, profileImageCropAfterPan, profileImageErrorMessage, profileImageFromDataUrl, profileImageFromFile, profileImagePreviewGeometry, type ProfileImageCrop } from "../../lib/profile-image";
import { isProfileEmojiAvatar, normalizeProfileEmojiAvatar, profileAvatarType } from "../../lib/profile-avatar";
import { parseManualAvatarUrl } from "../../lib/manual-avatar";
import { resolveAuthoritativeAiProcessingConsent } from "../../lib/backyard-ai/consent-client";
import { browserAiProcessingConsentStorage } from "../../lib/backyard-ai/processing-consent";
import { AI_IMAGE_PROCESSING_CONSENT } from "../../lib/backyard-ai/privacy";
import { MAX_PHOTO_AVATAR_VARIANTS, PhotoAvatarGenerationError, readPhotoAvatarGenerationCapability, requestPhotoAvatarGeneration } from "../../lib/photo-avatar-generation";
import { AvatarCreationPanel } from "./avatar-creation-panel";
import { AiProcessingConsentPrompt } from "./backyard-ai/ai-processing-consent";
import styles from "./profile-image-picker.module.css";

type AvatarMode = "none" | "emoji" | "avatar" | "photo";
type PendingPhoto = { file: File; objectUrl: string };
type Point = { x: number; y: number };
type Gesture = { pointers: Map<number, Point>; startCrop: Required<ProfileImageCrop>; startCenter: Point; startDistance: number };
type PhotoDimensions = { width: number; height: number };

const EMPTY_CROP = normalizeProfileImageCrop();
const QUICK_EMOJIS = ["😎", "🏌️", "⛳", "🔥", "🤠", "🦁"];
const AVATAR_CHOICES: ReadonlyArray<{ mode: AvatarMode; label: string; description: string }> = [
  { mode: "none", label: "SIN FOTO", description: "Sin imagen personalizada" },
  { mode: "emoji", label: "EMOJI", description: "Elige un emoji" },
  { mode: "avatar", label: "AVATAR", description: "Crea tu personaje" },
  { mode: "photo", label: "FOTO", description: "Sube tu foto" },
];

function modeFromValue(value: string): AvatarMode {
  const type = profileAvatarType(value);
  return type === "custom_avatar" ? "avatar" : type;
}
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
function midpoint(a: Point, b: Point): Point { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function ModeVisual({ mode, value }: { mode: AvatarMode; value: string }) {
  if (mode === "avatar" && parseManualAvatarUrl(value)) return <img src={value} alt="" />;
  if (mode === "photo" && value && !isProfileEmojiAvatar(value) && !parseManualAvatarUrl(value)) return <img src={value} alt="" referrerPolicy="no-referrer" />;
  if (mode === "emoji") return <span className={styles.modeEmoji} aria-hidden="true">{normalizeProfileEmojiAvatar(value) || "☺"}</span>;
  if (mode === "photo") return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 16h7l3-5h10l3 5h7v23H9zM24 34a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" /></svg>;
  if (mode === "avatar") return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="18" r="9"/><path d="M9 42c1-10 7-15 15-15s14 5 15 15"/><path d="M13 13c3-8 19-9 23 1-7-2-15-2-23-1Z"/></svg>;
  return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="8"/><path d="M10 41c1-10 6-15 14-15s13 5 14 15"/></svg>;
}

export function ProfileImagePicker({ value, onChange, kind = "profile", onBusyChange, providerPhotoUrl, accessToken, userId }: {
  value: string; onChange: (value: string) => void; kind?: "profile" | "group"; onBusyChange?: (busy: boolean) => void;
  providerPhotoUrl?: string; accessToken?: string | null; userId?: string;
}) {
  const fieldId = useId();
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pendingPhotoRef = useRef<PendingPhoto | null>(null);
  const requestRef = useRef(0);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationInFlightRef = useRef(false);
  const generationOriginalRef = useRef("");
  const generationCountRef = useRef(0);
  const cropRef = useRef<Required<ProfileImageCrop>>(EMPTY_CROP);
  const gestureRef = useRef<Gesture>({ pointers: new Map(), startCrop: EMPTY_CROP, startCenter: { x: 0, y: 0 }, startDistance: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [photoDimensions, setPhotoDimensions] = useState<PhotoDimensions | null>(null);
  const [crop, setCrop] = useState<Required<ProfileImageCrop>>(EMPTY_CROP);
  const [generationOriginal, setGenerationOriginal] = useState("");
  const [generatedAvatar, setGeneratedAvatar] = useState("");
  const [generationCount, setGenerationCount] = useState(0);
  const [showGenerationConsent, setShowGenerationConsent] = useState(false);
  const [emojiInput, setEmojiInput] = useState({ source: value, text: isProfileEmojiAvatar(value) ? value : "" });
  const emojiDraft = emojiInput.source === value ? emojiInput.text : isProfileEmojiAvatar(value) ? value : "";
  const [selection, setSelection] = useState<{ mode: AvatarMode; value: string }>({ mode: modeFromValue(value), value });
  const mode = selection.value === value ? selection.mode : modeFromValue(value);

  function setCropState(next: Required<ProfileImageCrop>) { cropRef.current = next; setCrop(next); }
  function resetPhotoGeneration() {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    generationInFlightRef.current = false;
    generationOriginalRef.current = "";
    generationCountRef.current = 0;
    setGenerationOriginal("");
    setGeneratedAvatar("");
    setGenerationCount(0);
    setShowGenerationConsent(false);
  }
  function releasePendingPhoto() {
    resetPhotoGeneration();
    const current = pendingPhotoRef.current;
    if (current) URL.revokeObjectURL(current.objectUrl);
    pendingPhotoRef.current = null;
    gestureRef.current.pointers.clear();
    setPendingPhoto(null);
    setPhotoDimensions(null);
  }
  useEffect(() => () => {
    requestRef.current += 1;
    generationAbortRef.current?.abort();
    generationInFlightRef.current = false;
    const current = pendingPhotoRef.current;
    if (current) URL.revokeObjectURL(current.objectUrl);
    onBusyChange?.(false);
  }, [onBusyChange]);

  function selectMode(next: AvatarMode) {
    requestRef.current += 1; setBusy(false); onBusyChange?.(false);
    if (next !== "photo") releasePendingPhoto();
    setSelection({ mode: next, value }); setMessage(""); setStatus("");
    if (next === "emoji") setEmojiInput({ source: value, text: isProfileEmojiAvatar(value) ? value : "" });
    if (next === "none") {
      onChange(""); setSelection({ mode: "none", value: "" });
      setStatus("Sin foto seleccionado. Guarda tu perfil para confirmar el cambio.");
    }
  }
  function applyEmoji() {
    const emoji = normalizeProfileEmojiAvatar(emojiDraft);
    if (!emoji) { setMessage("Elige un solo emoji desde el teclado."); return; }
    onChange(emoji); setSelection({ mode: "emoji", value: emoji }); setEmojiInput({ source: emoji, text: emoji });
    setMessage(""); setStatus("Emoji listo. Guarda tu perfil para conservarlo.");
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    if (kind === "group") {
      const request = ++requestRef.current;
      setBusy(true); onBusyChange?.(true); setMessage(""); setStatus("Preparando imagen…");
      try {
        const image = await profileImageFromFile(file, 320);
        if (request !== requestRef.current) return;
        onChange(image); setStatus("Imagen lista.");
      } catch (error) { if (request === requestRef.current) setMessage(profileImageErrorMessage(error)); }
      finally {
        if (request === requestRef.current) { setBusy(false); onBusyChange?.(false); }
        if (galleryInputRef.current) galleryInputRef.current.value = "";
      }
      return;
    }
    releasePendingPhoto();
    const objectUrl = URL.createObjectURL(file);
    const next = { file, objectUrl };
    pendingPhotoRef.current = next; setPendingPhoto(next); setCropState(EMPTY_CROP); setMessage("");
    setPhotoDimensions(null);
    setStatus("Mueve o pellizca la foto para ajustar el encuadre.");
    if (galleryInputRef.current) galleryInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }
  async function applyPendingPhoto() {
    if (!pendingPhoto || busy) return;
    const request = ++requestRef.current;
    setBusy(true); onBusyChange?.(true); setMessage(""); setStatus("Preparando imagen…");
    try {
      const image = await profileImageFromFile(pendingPhoto.file, kind === "profile" ? 512 : 320, cropRef.current);
      if (request !== requestRef.current) return;
      onChange(image); setSelection({ mode: "photo", value: image }); setStatus("Listo. Guarda tu perfil para conservar la foto."); releasePendingPhoto();
    } catch (error) { if (request === requestRef.current) setMessage(profileImageErrorMessage(error)); }
    finally { if (request === requestRef.current) { setBusy(false); onBusyChange?.(false); } }
  }

  async function createPhotoAvatarVariant(consentAlreadyConfirmed = false) {
    if (!pendingPhoto || generationInFlightRef.current) return;
    if (!accessToken || !userId) {
      setMessage("Tu sesión no está disponible. Vuelve a iniciar sesión antes de enviar la foto.");
      return;
    }
    if (generationCountRef.current >= MAX_PHOTO_AVATAR_VARIANTS) {
      setMessage("Ya creaste el máximo de variantes para esta foto.");
      return;
    }
    generationInFlightRef.current = true;
    const request = ++requestRef.current;
    const controller = new AbortController();
    generationAbortRef.current?.abort();
    generationAbortRef.current = controller;
    setBusy(true); onBusyChange?.(true); setMessage(""); setStatus("Verificando generación de avatar…");
    try {
      const capability = await readPhotoAvatarGenerationCapability();
      if (controller.signal.aborted || request !== requestRef.current) return;
      if (!capability.available) {
        setMessage("La generación de avatar todavía no está configurada en DEV. No se envió tu foto.");
        setStatus("");
        return;
      }
      if (!consentAlreadyConfirmed) {
        setStatus("Verificando tu autorización de imágenes…");
        const authority = await resolveAuthoritativeAiProcessingConsent({
          accessToken,
          storage: browserAiProcessingConsentStorage(),
          userId,
          scope: AI_IMAGE_PROCESSING_CONSENT,
          signal: controller.signal,
        });
        if (controller.signal.aborted || request !== requestRef.current || authority.discarded) return;
        if (!authority.active || authority.pendingLocalRevocation) {
          setStatus("");
          setShowGenerationConsent(true);
          return;
        }
      }
      setStatus(generationOriginalRef.current ? "Creando otra variante…" : "Preparando imagen…");
      const original = generationOriginalRef.current || await profileImageFromFile(pendingPhoto.file, 512, cropRef.current);
      if (controller.signal.aborted || request !== requestRef.current) return;
      if (!generationOriginalRef.current) {
        generationOriginalRef.current = original;
        setGenerationOriginal(original);
      }
      const variant = generationCountRef.current + 1;
      setStatus("Creando avatar…");
      const result = await requestPhotoAvatarGeneration({
        sourceImageDataUrl: original,
        variant,
        accessToken,
        signal: controller.signal,
      });
      if (controller.signal.aborted || request !== requestRef.current) return;
      setStatus("Preparando avatar…");
      const optimized = await profileImageFromDataUrl(result.avatarDataUrl, 512);
      if (controller.signal.aborted || request !== requestRef.current) return;
      generationCountRef.current = variant;
      setGenerationCount(variant);
      setGeneratedAvatar(optimized);
      setStatus("Avatar creado. Elige cuál quieres usar.");
    } catch (error) {
      if (controller.signal.aborted || request !== requestRef.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setStatus("");
      setMessage(error instanceof PhotoAvatarGenerationError && error.code === "rate_limit"
        ? error.message
        : "No pudimos crear el avatar. Intenta nuevamente.");
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      if (request === requestRef.current) {
        generationInFlightRef.current = false;
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }

  function useGeneratedAvatar() {
    if (!generatedAvatar || busy) return;
    onChange(generatedAvatar);
    setSelection({ mode: "photo", value: generatedAvatar });
    setMessage("");
    setStatus("Avatar listo. Guarda tu perfil para conservarlo.");
  }

  function returnToPhotoCrop() {
    resetPhotoGeneration();
    setMessage("");
    setStatus("Mueve o pellizca la foto para ajustar el encuadre.");
  }

  function resetGesture(points: Point[]) {
    const first = points[0] || { x: 0, y: 0 }, second = points[1] || first;
    gestureRef.current.startCrop = cropRef.current;
    gestureRef.current.startCenter = midpoint(first, second);
    gestureRef.current.startDistance = points.length > 1 ? Math.max(1, distance(first, second)) : 0;
  }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault?.();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gestureRef.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    resetGesture([...gestureRef.current.pointers.values()]);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture.pointers.has(event.pointerId)) return;
    event.preventDefault?.();
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...gesture.pointers.values()];
    const center = points.length > 1 ? midpoint(points[0], points[1]) : points[0];
    const rect = event.currentTarget.getBoundingClientRect();
    const stageSize = Math.max(80, Math.min(rect.width, rect.height));
    const nextZoom = points.length > 1 ? clamp(gesture.startCrop.zoom * (distance(points[0], points[1]) / gesture.startDistance), 1, 3) : gesture.startCrop.zoom;
    const zoomedCrop = normalizeProfileImageCrop({ ...gesture.startCrop, zoom: nextZoom });
    setCropState(photoDimensions
      ? profileImageCropAfterPan(photoDimensions.width, photoDimensions.height, stageSize, zoomedCrop, center.x - gesture.startCenter.x, center.y - gesture.startCenter.y)
      : normalizeProfileImageCrop({ ...zoomedCrop,
          positionX: gesture.startCrop.positionX - ((center.x - gesture.startCenter.x) / (stageSize * .48)),
          positionY: gesture.startCrop.positionY - ((center.y - gesture.startCenter.y) / (stageSize * .48)),
        }));
  }
  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    gestureRef.current.pointers.delete(event.pointerId);
    resetGesture([...gestureRef.current.pointers.values()]);
  }
  function onCropWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setCropState({ ...cropRef.current, zoom: clamp(cropRef.current.zoom + (event.deltaY < 0 ? .1 : -.1), 1, 3) });
  }

  const previewValue = pendingPhoto?.objectUrl || value;
  const photoGeometry = pendingPhoto && photoDimensions ? profileImagePreviewGeometry(photoDimensions.width, photoDimensions.height, crop) : null;
  const emojiValue = normalizeProfileEmojiAvatar(value);
  const emojiDraftValue = normalizeProfileEmojiAvatar(emojiDraft);
  const emojiApplied = Boolean(emojiValue && emojiDraftValue === emojiValue);
  const hiddenInputs = <>
    <input ref={cameraInputRef} className={styles.file} type="file" aria-label="Tomar foto para el avatar" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" capture="user" onChange={(event) => void chooseFile(event.target.files?.[0])} />
    <input ref={galleryInputRef} className={styles.file} type="file" aria-label={kind === "profile" ? "Elegir foto de la galería" : "Seleccionar imagen del grupo"} accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" onChange={(event) => void chooseFile(event.target.files?.[0])} />
  </>;

  if (kind === "group") return <div className={styles.groupPicker}>
    <div className={styles.preview}>{previewValue ? <img src={previewValue} alt="Imagen del grupo" /> : <span aria-hidden="true">👥</span>}</div>
    {hiddenInputs}<button type="button" className="secondary" disabled={busy} onClick={() => galleryInputRef.current?.click()}>{busy ? "PREPARANDO…" : "SUBIR IMAGEN"}</button>
    {message && <small className={styles.error} role="alert">{message}</small>}{status && <small className={styles.help} role="status">{status}</small>}
  </div>;

  return <div className={styles.picker}>
    <div className={styles.title}><h3>FOTO / AVATAR</h3><p>Elige cómo quieres mostrarte en tu perfil.</p></div>
    <div className={styles.modeChoices} role="group" aria-label="Foto o avatar">
      {AVATAR_CHOICES.map((choice) => <button key={choice.mode} type="button" aria-pressed={mode === choice.mode} data-active={mode === choice.mode} onClick={() => selectMode(choice.mode)}>
        <span className={styles.modeVisual}><ModeVisual mode={choice.mode} value={choice.mode === mode ? value : ""} /></span><b>{choice.label}</b><small>{choice.description}</small>
        {mode === choice.mode && <span className={styles.check} aria-hidden="true">✓</span>}
      </button>)}
    </div>

    {mode === "photo" && <section className={styles.photoPanel} aria-labelledby={`${fieldId}-photo-title`}>
      <div className={styles.photoHeader}><div><h4 id={`${fieldId}-photo-title`}>Tu foto de perfil</h4><p>Sube una foto, ajústala y úsala en tu perfil. También puedes crear una caricatura desde esta foto.</p></div>{value && profileAvatarType(value) === "photo" && <div className={styles.currentPhoto}><img src={value} alt="Foto actual" referrerPolicy="no-referrer" /></div>}</div>
      {hiddenInputs}
      {!pendingPhoto && <div className={styles.photoSources}>
        <button type="button" className="secondary" disabled={busy} onClick={() => cameraInputRef.current?.click()}>TOMAR FOTO</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => galleryInputRef.current?.click()}>ELEGIR DE GALERÍA</button>
        {providerPhotoUrl && value !== providerPhotoUrl && <button type="button" className={styles.providerPhoto} onClick={() => { onChange(providerPhotoUrl); setSelection({ mode: "photo", value: providerPhotoUrl }); setStatus("Foto de Google seleccionada. Cambiarla aquí no modifica tu cuenta Google."); }}>USAR FOTO DE GOOGLE</button>}
      </div>}
      {pendingPhoto && <div className={styles.cropEditor}>
        <div className={styles.cropStage} aria-label="Editor de recorte. Arrastra para mover y pellizca para ampliar." onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd} onWheel={onCropWheel}>
          <div className={styles.cropImageLayer} style={{ transform: `rotate(${crop.rotation}deg)` }}>
            <img src={pendingPhoto.objectUrl} alt="Foto que estás ajustando" draggable={false} onLoad={(event) => setPhotoDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={photoGeometry ? { width: `${photoGeometry.imageWidthPercent}%`, height: `${photoGeometry.imageHeightPercent}%`, left: `${photoGeometry.imageLeftPercent}%`, top: `${photoGeometry.imageTopPercent}%` } : undefined} />
          </div>
          <div className={styles.cropShade} aria-hidden="true" /><div className={styles.moveHint} aria-hidden="true"><span>↕</span>MOVER</div>
          <div className={styles.zoomControls}><button type="button" aria-label="Acercar foto" onPointerDown={(event) => event.stopPropagation()} onClick={() => setCropState({ ...cropRef.current, zoom: clamp(cropRef.current.zoom + .2, 1, 3) })}>＋</button><button type="button" aria-label="Alejar foto" onPointerDown={(event) => event.stopPropagation()} onClick={() => setCropState({ ...cropRef.current, zoom: clamp(cropRef.current.zoom - .2, 1, 3) })}>−</button></div>
          <button type="button" className={styles.rotateButton} onPointerDown={(event) => event.stopPropagation()} onClick={() => setCropState({ ...cropRef.current, rotation: (cropRef.current.rotation + 90) % 360 })}>↻ ROTAR</button>
        </div>
        {!generatedAvatar ? <div className={styles.photoActions}>
          <button type="button" className="primary" disabled={busy} onClick={() => void applyPendingPhoto()}>{busy ? "PREPARANDO IMAGEN…" : "USAR ESTA FOTO"}</button>
          <button type="button" className={styles.caricatureAction} disabled={busy} onClick={() => void createPhotoAvatarVariant()}><span aria-hidden="true">✦</span><span><b>{busy ? "CREANDO AVATAR…" : "CREAR CARICATURA DESDE MI FOTO"}</b><small>Avatar ilustrado premium desde esta imagen</small></span><span aria-hidden="true">›</span></button>
          <button type="button" className="textButton" disabled={busy} onClick={() => galleryInputRef.current?.click()}>ELEGIR OTRA</button>
        </div> : <section className={styles.generationResult} aria-labelledby={`${fieldId}-generation-title`}>
          <h4 id={`${fieldId}-generation-title`}>Compara el resultado</h4>
          <div className={styles.generationComparison}>
            <figure><div><img src={generationOriginal} alt="Foto original recortada" /></div><figcaption>FOTO ORIGINAL</figcaption></figure>
            <figure data-selected={value === generatedAvatar}><div><img src={generatedAvatar} alt="Avatar ilustrado creado" /></div><figcaption>AVATAR CREADO</figcaption></figure>
          </div>
          <div className={styles.generationActions}>
            <button type="button" className="primary" disabled={busy} onClick={useGeneratedAvatar}>USAR AVATAR</button>
            <button type="button" className="secondary" disabled={busy || generationCount >= MAX_PHOTO_AVATAR_VARIANTS} onClick={() => void createPhotoAvatarVariant()}>GENERAR OTRA</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void applyPendingPhoto()}>USAR FOTO ORIGINAL</button>
            <button type="button" className="textButton" disabled={busy} onClick={returnToPhotoCrop}>VOLVER A FOTO</button>
          </div>
          {generationCount >= MAX_PHOTO_AVATAR_VARIANTS && <small>Máximo de {MAX_PHOTO_AVATAR_VARIANTS} variantes por foto.</small>}
        </section>}
      </div>}
      <small className={styles.formatNote}>JPEG, PNG, WebP o HEIC/HEIF compatible. Hasta 20 MB; se optimiza sólo al confirmar.</small>
    </section>}

    {mode === "emoji" && <section className={styles.emojiInput} aria-labelledby={`${fieldId}-emoji-title`}><div className={styles.emojiHeading}><div><h4 id={`${fieldId}-emoji-title`}>Elige un emoji</h4><p>Selecciona uno o usa el teclado de tu teléfono.</p></div><div className={styles.emojiPreview} aria-label={emojiDraftValue ? `Vista previa ${emojiDraftValue}` : "Vista previa de emoji"}>{emojiDraftValue || "☺"}</div></div><label htmlFor={`${fieldId}-emoji`}>Emoji de avatar</label><div><input id={`${fieldId}-emoji`} type="text" value={emojiDraft} maxLength={64} inputMode="text" autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" placeholder="Usa el teclado" onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); applyEmoji(); } }} onChange={(event) => { setEmojiInput({ source: value, text: event.target.value }); setMessage(""); setStatus(""); }} /><button type="button" className="secondary" disabled={!emojiDraftValue || emojiApplied} onClick={applyEmoji}>{emojiApplied ? "EMOJI LISTO ✓" : "USAR EMOJI"}</button></div><div className={styles.quickEmojis} aria-label="Emojis sugeridos">{QUICK_EMOJIS.map((emoji) => <button key={emoji} type="button" aria-label={`Elegir ${emoji}`} aria-pressed={emojiDraft === emoji} onClick={() => { setEmojiInput({ source: value, text: emoji }); setMessage(""); setStatus(""); }}>{emoji}</button>)}</div></section>}
    {mode === "avatar" && <AvatarCreationPanel initialValue={parseManualAvatarUrl(value) ? value : undefined} staged onBusyChange={onBusyChange} onCancel={() => selectMode(modeFromValue(value))} onUse={(url) => { onChange(url); setSelection({ mode: "avatar", value: url }); setStatus("Avatar listo. Guarda tu perfil para conservarlo."); }} />}
    {mode === "none" && <section className={styles.noneState}><span aria-hidden="true"><ModeVisual mode="none" value="" /></span><div><b>Sin foto</b><p>Se usará el avatar genérico de The Backyard. Tu foto o avatar anterior no volverá a mostrarse después de guardar.</p></div></section>}
    {message && <small className={styles.error} role="alert">{message}</small>}{status && <small className={styles.help} role="status">{status}</small>}
    {showGenerationConsent && userId && <AiProcessingConsentPrompt
      userId={userId}
      accessToken={accessToken}
      requiresRemoteConsent
      scope={AI_IMAGE_PROCESSING_CONSENT}
      onCancel={() => setShowGenerationConsent(false)}
      onAccepted={(_consent, persistence) => {
        setShowGenerationConsent(false);
        if (!persistence.accountPersisted) {
          setMessage("No pudimos guardar tu autorización. No se envió ninguna foto.");
          return;
        }
        void createPhotoAvatarVariant(true);
      }}
    />}
  </div>;
}

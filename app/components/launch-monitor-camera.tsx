"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { requestBackyardAi } from "../../lib/backyard-ai/client-api";
import { resolveAuthoritativeAiProcessingConsent } from "../../lib/backyard-ai/consent-client";
import { prepareLaunchMonitorPhotos, MAX_LAUNCH_MONITOR_PHOTOS } from "../../lib/backyard-ai/launch-monitor/client";
import { browserAiProcessingConsentStorage, hasActiveAiProcessingConsent } from "../../lib/backyard-ai/processing-consent";
import { AI_LAUNCH_MONITOR_PROCESSING_CONSENT, backyardAiProviderConsent } from "../../lib/backyard-ai/privacy";
import { LAUNCH_MONITOR_VISION_CONFIDENCE, launchMonitorVisionShotToDraft, normalizeLaunchMonitorVisionExtraction, type LaunchMonitorVisionExtraction } from "../../lib/backyard-ai/schemas/launch-monitor";
import { LAUNCH_MONITOR_METRICS, type LaunchMonitorClub, type LaunchMonitorMetric, type LaunchMonitorShot } from "../../lib/golf-equipment";
import { AiProcessingConsentPrompt, AiProcessingConsentRequired } from "./backyard-ai/ai-processing-consent";
import styles from "./equipment.module.css";

type LocalPhoto = { id: string; file: File; previewUrl: string };
export type LaunchMonitorAnalysisState = "idle" | "analyzing" | "review" | "applied" | "error";

const CLUB_LABELS: Record<LaunchMonitorClub, string> = {
  DRIVER: "Driver",
  IRON_7: "Hierro 7",
  PITCHING_WEDGE: "Pitching Wedge",
  HALF_WEDGE: "Half Wedge / Approach",
};

const METRIC_LABELS: Record<LaunchMonitorMetric, { label: string; unit: string }> = {
  clubSpeedMph: { label: "Club speed", unit: "mph" },
  ballSpeedMph: { label: "Ball speed", unit: "mph" },
  launchAngleDegrees: { label: "Launch", unit: "°" },
  spinRpm: { label: "Spin", unit: "rpm" },
  carryYards: { label: "Carry", unit: "yd" },
  totalYards: { label: "Total", unit: "yd" },
  peakHeightYards: { label: "Altura", unit: "yd" },
  landingAngleDegrees: { label: "Caída", unit: "°" },
};

const CRITICAL_METRICS: Record<LaunchMonitorClub, LaunchMonitorMetric[]> = {
  DRIVER: ["ballSpeedMph", "carryYards"],
  IRON_7: ["carryYards", "spinRpm"],
  PITCHING_WEDGE: ["carryYards", "spinRpm"],
  HALF_WEDGE: ["carryYards"],
};

function id() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "No pude leer las pantallas. Revisa las fotos e intenta de nuevo.";
}

function metricNeedsReview(shot: LaunchMonitorVisionExtraction["shots"][number], metric: LaunchMonitorMetric) {
  const reading = shot.metrics[metric];
  if (reading.value !== null && reading.confidence < LAUNCH_MONITOR_VISION_CONFIDENCE) return true;
  return Boolean(shot.club && CRITICAL_METRICS[shot.club].includes(metric) && reading.value === null);
}

export function LaunchMonitorCamera({ userId, accessToken, requiresRemoteConsent, onConfirm, onOpenPrivacy, onAnalysisStateChange, targetClub, capturedCount }: {
  userId: string;
  accessToken?: string | null;
  requiresRemoteConsent: boolean;
  onConfirm: (source: string | null, shots: LaunchMonitorShot[]) => void;
  onOpenPrivacy?: () => void;
  onAnalysisStateChange?: (state: LaunchMonitorAnalysisState) => void;
  targetClub: LaunchMonitorClub;
  capturedCount: number;
}) {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [extraction, setExtraction] = useState<LaunchMonitorVisionExtraction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showConsent, setShowConsent] = useState(false);
  const [accountConsentRequired, setAccountConsentRequired] = useState(false);
  const [editingShots, setEditingShots] = useState<string[]>([]);
  const [appliedPhotoIds, setAppliedPhotoIds] = useState<string[]>([]);
  const [reviewPhotoIds, setReviewPhotoIds] = useState<string[]>([]);
  const [resultMessage, setResultMessage] = useState("");
  const urls = useRef(new Set<string>());
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    const allocated = urls.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      allocated.forEach((url) => URL.revokeObjectURL(url));
      allocated.clear();
    };
  }, []);

  const ambiguousCount = useMemo(() => extraction?.shots.reduce((total, shot) => total
    + LAUNCH_MONITOR_METRICS.filter((metric) => metricNeedsReview(shot, metric)).length, 0) || 0, [extraction]);
  const pendingPhotos = useMemo(() => photos.filter((photo) => !appliedPhotoIds.includes(photo.id)), [appliedPhotoIds, photos]);

  function addPhotos(files: FileList | null) {
    if (!files || busy) return;
    const next = [...files]
      .filter((file) => /^image\/(jpeg|png|webp)$/i.test(file.type))
      .slice(0, MAX_LAUNCH_MONITOR_PHOTOS - photos.length)
      .map((file) => {
        const previewUrl = URL.createObjectURL(file);
        urls.current.add(previewUrl);
        return { id: `launch-${id()}`, file, previewUrl };
      });
    setPhotos((current) => [...current, ...next]);
    setExtraction(null);
    setResultMessage("");
    setError(next.length ? "" : "Selecciona fotos JPEG, PNG o WebP.");
    onAnalysisStateChange?.("idle");
  }

  function removePhoto(photoId: string) {
    setPhotos((current) => {
      const photo = current.find((candidate) => candidate.id === photoId);
      if (photo) {
        URL.revokeObjectURL(photo.previewUrl);
        urls.current.delete(photo.previewUrl);
      }
      return current.filter((candidate) => candidate.id !== photoId);
    });
    setAppliedPhotoIds((currentIds) => currentIds.filter((id) => id !== photoId));
    setReviewPhotoIds((currentIds) => currentIds.filter((id) => id !== photoId));
    setExtraction(null);
    setResultMessage("");
    onAnalysisStateChange?.("idle");
  }

  function hasLocalConsent() {
    try {
      return hasActiveAiProcessingConsent(browserAiProcessingConsentStorage(), userId, AI_LAUNCH_MONITOR_PROCESSING_CONSENT);
    } catch {
      return false;
    }
  }

  async function analyze() {
    if (inFlight.current) return;
    if (pendingPhotos.length < 1 || busy) {
      setError("Selecciona de 1 a 4 fotos de la pantalla del launch monitor.");
      return;
    }
    setAccountConsentRequired(false);
    let allowed = false;
    if (accessToken) {
      inFlight.current = true;
      setBusy(true);
      try {
        const result = await resolveAuthoritativeAiProcessingConsent({ accessToken, storage: browserAiProcessingConsentStorage(), userId, scope: AI_LAUNCH_MONITOR_PROCESSING_CONSENT });
        allowed = !result.discarded && result.active && !result.pendingLocalRevocation;
      } catch {
        if (mounted.current) setError("No pude verificar tu autorización de lectura de datos de práctica. No se envió ninguna foto.");
        return;
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    } else if (requiresRemoteConsent) {
      setError("Recupera tu sesión antes de enviar imágenes.");
      return;
    } else {
      allowed = hasLocalConsent();
    }
    if (!mounted.current) return;
    if (!allowed) {
      if (requiresRemoteConsent || accessToken) { setAccountConsentRequired(true); return; }
      setShowConsent(true);
      return;
    }
    await analyzeWithConsent();
  }

  async function analyzeWithConsent() {
    if (!mounted.current || inFlight.current) return;
    inFlight.current = true;
    setShowConsent(false);
    setBusy(true);
    setError("");
    onAnalysisStateChange?.("analyzing");
    try {
      const prepared = await prepareLaunchMonitorPhotos(pendingPhotos);
      if (!mounted.current) return;
      const response = await requestBackyardAi<{ extraction?: unknown }>("/api/backyard-ai/launch-monitor", {
        photos: prepared,
        consent: backyardAiProviderConsent(AI_LAUNCH_MONITOR_PROCESSING_CONSENT),
      }, 60_000, accessToken);
      const normalized = normalizeLaunchMonitorVisionExtraction(response.extraction, prepared.map((photo) => photo.id));
      if (!normalized || !normalized.shots.length) throw new Error("No encontré mediciones legibles en estas fotos.");
      const assigned = { ...normalized, shots: normalized.shots.map((shot) => ({ ...shot, club: targetClub, clubConfidence: 1 })) };
      const needsReview = assigned.shots.some((shot) => LAUNCH_MONITOR_METRICS.some((metric) => metricNeedsReview(shot, metric)));
      const detected = assigned.shots.map((shot) => launchMonitorVisionShotToDraft(shot));
      if (!needsReview && detected.every((shot): shot is LaunchMonitorShot => Boolean(shot))) {
        onConfirm(assigned.source, detected);
        setAppliedPhotoIds((current) => [...new Set([...current, ...prepared.map((photo) => photo.id)])]);
        setReviewPhotoIds([]);
        if (mounted.current) setResultMessage(`${detected.length} golpe${detected.length === 1 ? "" : "s"} detectado${detected.length === 1 ? "" : "s"} y agregado${detected.length === 1 ? "" : "s"} automáticamente.`);
        onAnalysisStateChange?.("applied");
      } else if (mounted.current) {
        setExtraction(assigned);
        setReviewPhotoIds(prepared.map((photo) => photo.id));
        onAnalysisStateChange?.("review");
      }
    } catch (caught) {
      if (mounted.current) {
        setError(errorMessage(caught));
        onAnalysisStateChange?.("error");
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function setMetric(shotId: string, metric: LaunchMonitorMetric, value: string) {
    const parsed = value.trim() === "" ? null : Number(value);
    setExtraction((current) => current ? {
      ...current,
      shots: current.shots.map((shot) => shot.id === shotId ? {
        ...shot,
        metrics: { ...shot.metrics, [metric]: { value: parsed !== null && Number.isFinite(parsed) ? parsed : null, confidence: 1 } },
      } : shot),
    } : current);
  }

  function confirm() {
    if (!extraction) return;
    const validated = normalizeLaunchMonitorVisionExtraction(extraction, photos.map((photo) => photo.id));
    if (!validated) {
      setError("Una medición quedó fuera del rango válido. Corrígela antes de guardar.");
      return;
    }
    const shots = validated.shots.map((shot) => launchMonitorVisionShotToDraft(shot));
    if (shots.some((shot) => !shot)) {
      setError("Corrige las mediciones marcadas antes de guardar.");
      return;
    }
    onConfirm(validated.source, shots as LaunchMonitorShot[]);
    setExtraction(null);
    setEditingShots([]);
    setAppliedPhotoIds((current) => [...new Set([...current, ...reviewPhotoIds])]);
    setReviewPhotoIds([]);
    setResultMessage(`${shots.length} golpe${shots.length === 1 ? "" : "s"} actualizado${shots.length === 1 ? "" : "s"} y agregado${shots.length === 1 ? "" : "s"}.`);
    onAnalysisStateChange?.("applied");
  }

  const cameraTitleId = `launch-camera-title-${targetClub.toLocaleLowerCase("en-US")}`;

  return <section className={styles.cameraCapture} aria-labelledby={cameraTitleId}>
    <div className={styles.captureClubStatus}><div><small>CAPTURA ACTUAL</small><h3 id={cameraTitleId}>{CLUB_LABELS[targetClub]}</h3></div><span>{Math.min(capturedCount, 3)}/3 golpes válidos</span></div>
    <p className={styles.subtle}>TrackMan, FlightScope, Garmin, GCQuad, Rapsodo u otra pantalla compatible. Sube de 1 a 4 fotos; sólo te pediremos corregir lecturas dudosas.</p>
    <div className={styles.photoPicker}>
      <span className={styles.photoPickerIcon} aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M5 10.5h5l2-3h8l2 3h5v14H5z"/><circle cx="16" cy="17.5" r="5"/></svg></span>
      <div><b>Tomar fotos</b><small>o seleccionar de tu galería</small></div>
      <div className={styles.photoPickerActions}>
        <label className={styles.photoButton}>Tomar fotos<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple onChange={(event) => { addPhotos(event.target.files); event.currentTarget.value = ""; }} /></label>
        <label className={styles.photoButton}>Elegir de galería<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { addPhotos(event.target.files); event.currentTarget.value = ""; }} /></label>
      </div>
    </div>
    {photos.length > 0 && <div className={styles.launchPhotoGrid}>{photos.map((photo) => <figure key={photo.id}><img src={photo.previewUrl} alt="Pantalla de launch monitor seleccionada" /><button type="button" className="secondary" onClick={() => removePhoto(photo.id)} disabled={busy}>Quitar</button></figure>)}</div>}
    <button type="button" className="primary" onClick={() => void analyze()} disabled={busy || pendingPhotos.length < 1}>{busy ? "Leyendo mediciones…" : pendingPhotos.length < 1 && photos.length > 0 ? "Fotos analizadas" : "Analizar fotos"}</button>
    {resultMessage && <p className={styles.autoApplied} role="status">✓ {resultMessage}</p>}
    {error && <p className={styles.formMessage} role="alert">{error}</p>}
    {accountConsentRequired && <AiProcessingConsentRequired scope={AI_LAUNCH_MONITOR_PROCESSING_CONSENT} onOpenPrivacy={onOpenPrivacy} />}
    {showConsent && !requiresRemoteConsent && !accessToken && <AiProcessingConsentPrompt userId={userId} accessToken={accessToken} requiresRemoteConsent={requiresRemoteConsent} scope={AI_LAUNCH_MONITOR_PROCESSING_CONSENT} onAccepted={() => void analyzeWithConsent()} onCancel={() => setShowConsent(false)} />}
    {extraction && <div className={styles.launchReview}>
      <div className={styles.statusRow}><div><h3>Corrige sólo lo necesario</h3><p>{extraction.shots.length} golpe(s) detectados · {ambiguousCount} dato(s) requieren atención. El resto ya está aplicado.</p></div></div>
      {extraction.shots.map((shot, index) => { const editing = editingShots.includes(shot.id); const knownMetrics = LAUNCH_MONITOR_METRICS.filter((metric) => shot.metrics[metric].value !== null && !metricNeedsReview(shot, metric)); const reviewMetrics = LAUNCH_MONITOR_METRICS.filter((metric) => editing || metricNeedsReview(shot, metric)); return <article className={styles.reviewShot} key={shot.id}>
        <div className={styles.reviewShotHeader}><div><b>Golpe {index + 1}</b><small>{shot.club ? CLUB_LABELS[shot.club] : "Palo pendiente"}</small></div><button type="button" className="textButton" onClick={() => setEditingShots((current) => current.includes(shot.id) ? current.filter((id) => id !== shot.id) : [...current, shot.id])}>{editing ? "Cerrar edición" : "Editar datos detectados"}</button></div>
        {knownMetrics.length > 0 && !editing && <div className={styles.detectedMetrics}>{knownMetrics.map((metric) => <span key={metric}><small>{METRIC_LABELS[metric].label}</small><b>{shot.metrics[metric].value} {METRIC_LABELS[metric].unit}</b></span>)}</div>}
        {reviewMetrics.length > 0 && <div className={styles.formGrid}>{reviewMetrics.map((metric) => <label key={metric} className={metricNeedsReview(shot, metric) ? styles.needsReview : ""}>{METRIC_LABELS[metric].label} ({METRIC_LABELS[metric].unit})<input type="number" inputMode="decimal" value={shot.metrics[metric].value ?? ""} onChange={(event) => setMetric(shot.id, metric, event.target.value)} /></label>)}</div>}
      </article>; })}
      <div className={styles.wizardActions}><button type="button" className="secondary" onClick={() => { setExtraction(null); setReviewPhotoIds([]); onAnalysisStateChange?.("idle"); }}>Usar otras fotos</button><button type="button" className="primary" onClick={confirm}>Aplicar correcciones y continuar</button></div>
    </div>}
  </section>;
}

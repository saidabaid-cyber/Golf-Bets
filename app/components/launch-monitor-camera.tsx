"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { requestBackyardAi } from "../../lib/backyard-ai/client-api";
import { resolveAuthoritativeAiProcessingConsent } from "../../lib/backyard-ai/consent-client";
import { prepareLaunchMonitorPhotos, MAX_LAUNCH_MONITOR_PHOTOS } from "../../lib/backyard-ai/launch-monitor/client";
import { browserAiProcessingConsentStorage, hasActiveAiProcessingConsent } from "../../lib/backyard-ai/processing-consent";
import { AI_IMAGE_PROCESSING_CONSENT, backyardAiProviderConsent } from "../../lib/backyard-ai/privacy";
import { LAUNCH_MONITOR_VISION_CONFIDENCE, launchMonitorVisionShotToDraft, normalizeLaunchMonitorVisionExtraction, type LaunchMonitorVisionExtraction } from "../../lib/backyard-ai/schemas/launch-monitor";
import { LAUNCH_MONITOR_CLUBS, LAUNCH_MONITOR_METRICS, type LaunchMonitorClub, type LaunchMonitorMetric, type LaunchMonitorShot } from "../../lib/golf-equipment";
import { AiProcessingConsentPrompt } from "./backyard-ai/ai-processing-consent";
import styles from "./equipment.module.css";

type LocalPhoto = { id: string; file: File; previewUrl: string };

const CLUB_LABELS: Record<LaunchMonitorClub, string> = {
  DRIVER: "Driver",
  IRON_7: "Hierro 7",
  PITCHING_WEDGE: "Pitching wedge",
  HALF_WEDGE: "Half wedge",
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

function id() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "No pude leer las pantallas. Revisa las fotos e intenta de nuevo.";
}

export function LaunchMonitorCamera({ userId, accessToken, requiresRemoteConsent, onConfirm }: {
  userId: string;
  accessToken?: string | null;
  requiresRemoteConsent: boolean;
  onConfirm: (source: string | null, shots: LaunchMonitorShot[]) => void;
}) {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [extraction, setExtraction] = useState<LaunchMonitorVisionExtraction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showConsent, setShowConsent] = useState(false);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const allocated = urls.current;
    return () => {
      allocated.forEach((url) => URL.revokeObjectURL(url));
      allocated.clear();
    };
  }, []);

  const ambiguousCount = useMemo(() => extraction?.shots.reduce((total, shot) => total
    + (shot.club === null || shot.clubConfidence < LAUNCH_MONITOR_VISION_CONFIDENCE ? 1 : 0)
    + LAUNCH_MONITOR_METRICS.filter((metric) => shot.metrics[metric].value !== null && shot.metrics[metric].confidence < LAUNCH_MONITOR_VISION_CONFIDENCE).length, 0) || 0, [extraction]);

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
    setError(next.length ? "" : "Selecciona fotos JPEG, PNG o WebP.");
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
    setExtraction(null);
  }

  function hasLocalConsent() {
    try {
      return hasActiveAiProcessingConsent(browserAiProcessingConsentStorage(), userId, AI_IMAGE_PROCESSING_CONSENT);
    } catch {
      return false;
    }
  }

  async function analyze() {
    if (photos.length < 2 || busy) {
      setError("Selecciona de 2 a 4 fotos de la pantalla del launch monitor.");
      return;
    }
    let allowed = hasLocalConsent();
    if (accessToken) {
      setBusy(true);
      try {
        const result = await resolveAuthoritativeAiProcessingConsent({ accessToken, storage: browserAiProcessingConsentStorage(), userId, scope: AI_IMAGE_PROCESSING_CONSENT });
        allowed = !result.discarded && result.active && !result.pendingLocalRevocation;
      } catch {
        setError("No pude verificar tu autorización de procesamiento de imágenes.");
      } finally {
        setBusy(false);
      }
    } else if (requiresRemoteConsent) {
      setError("Recupera tu sesión antes de enviar imágenes.");
      return;
    }
    if (!allowed) {
      setShowConsent(true);
      return;
    }
    await analyzeWithConsent();
  }

  async function analyzeWithConsent() {
    setShowConsent(false);
    setBusy(true);
    setError("");
    try {
      const prepared = await prepareLaunchMonitorPhotos(photos);
      const response = await requestBackyardAi<{ extraction?: unknown }>("/api/backyard-ai/launch-monitor", {
        photos: prepared,
        consent: backyardAiProviderConsent(AI_IMAGE_PROCESSING_CONSENT),
      }, 60_000, accessToken);
      const normalized = normalizeLaunchMonitorVisionExtraction(response.extraction, prepared.map((photo) => photo.id));
      if (!normalized || !normalized.shots.length) throw new Error("No encontré mediciones legibles en estas fotos.");
      setExtraction(normalized);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function setClub(shotId: string, club: LaunchMonitorClub) {
    setExtraction((current) => current ? { ...current, shots: current.shots.map((shot) => shot.id === shotId ? { ...shot, club, clubConfidence: 1 } : shot) } : current);
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
      setError("Confirma el palo de cada golpe detectado antes de guardar.");
      return;
    }
    onConfirm(validated.source, shots as LaunchMonitorShot[]);
    setExtraction(null);
    setPhotos([]);
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
  }

  return <section className={styles.cameraCapture} aria-labelledby="launch-camera-title">
    <div className={styles.itemHeader}><div><h3 id="launch-camera-title">Capturar con cámara</h3><p>Sube 2–4 fotos de TrackMan, FlightScope, GCQuad, Garmin, Rapsodo u otra pantalla. Revisas todo antes de guardar.</p></div></div>
    <label className={styles.photoButton}>📷 Elegir 2–4 fotos<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple onChange={(event) => { addPhotos(event.target.files); event.currentTarget.value = ""; }} /></label>
    {photos.length > 0 && <div className={styles.launchPhotoGrid}>{photos.map((photo) => <figure key={photo.id}><img src={photo.previewUrl} alt="Pantalla de launch monitor seleccionada" /><button type="button" className="secondary" onClick={() => removePhoto(photo.id)} disabled={busy}>Quitar</button></figure>)}</div>}
    <button type="button" className="primary" onClick={() => void analyze()} disabled={busy || photos.length < 2}>{busy ? "Leyendo mediciones…" : "Analizar fotos"}</button>
    {error && <p className={styles.formMessage} role="alert">{error}</p>}
    {showConsent && <AiProcessingConsentPrompt userId={userId} accessToken={accessToken} requiresRemoteConsent={requiresRemoteConsent} scope={AI_IMAGE_PROCESSING_CONSENT} onAccepted={() => void analyzeWithConsent()} onCancel={() => setShowConsent(false)} />}
    {extraction && <div className={styles.launchReview}>
      <div className={styles.statusRow}><div><h3>Revisa antes de guardar</h3><p>{extraction.shots.length} golpe(s) detectados · {ambiguousCount ? `${ambiguousCount} dato(s) requieren atención` : "lectura clara"}</p></div></div>
      {extraction.shots.map((shot, index) => <article className={styles.equipmentItem} key={shot.id}>
        <label>Golpe {index + 1} · Palo<select value={shot.club || ""} className={shot.club === null || shot.clubConfidence < LAUNCH_MONITOR_VISION_CONFIDENCE ? styles.needsReview : ""} onChange={(event) => setClub(shot.id, event.target.value as LaunchMonitorClub)}><option value="">Confirma el palo</option>{LAUNCH_MONITOR_CLUBS.map((club) => <option value={club} key={club}>{CLUB_LABELS[club]}</option>)}</select></label>
        <div className={styles.formGrid}>{LAUNCH_MONITOR_METRICS.map((metric) => <label key={metric} className={shot.metrics[metric].value !== null && shot.metrics[metric].confidence < LAUNCH_MONITOR_VISION_CONFIDENCE ? styles.needsReview : ""}>{METRIC_LABELS[metric].label} ({METRIC_LABELS[metric].unit})<input type="number" inputMode="decimal" value={shot.metrics[metric].value ?? ""} onChange={(event) => setMetric(shot.id, metric, event.target.value)} /></label>)}</div>
      </article>)}
      <div className={styles.wizardActions}><button type="button" className="secondary" onClick={() => setExtraction(null)}>Volver a analizar</button><button type="button" className="primary" onClick={confirm}>Confirmar y guardar sesión</button></div>
    </div>}
  </section>;
}

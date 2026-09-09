"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { requestBackyardAi } from "../../../lib/backyard-ai/client-api";
import { resolveAuthoritativeAiProcessingConsent } from "../../../lib/backyard-ai/consent-client";
import {
  browserAiProcessingConsentStorage,
  hasActiveAiProcessingConsent,
} from "../../../lib/backyard-ai/processing-consent";
import {
  AI_IMAGE_PROCESSING_CONSENT,
  backyardAiProviderConsent,
} from "../../../lib/backyard-ai/privacy";
import {
  runScorecardPhotoAnalysis,
  ScorecardClientPipelineError,
  scorecardLocalPersistenceWarning,
  scorecardScanErrorMessage,
} from "../../../lib/backyard-ai/scorecard/client-pipeline";
import { normalizeScorecardExtraction } from "../../../lib/backyard-ai/scorecard/extractor";
import { MAX_SCORECARD_PHOTOS } from "../../../lib/backyard-ai/scorecard/limits";
import { validateScorecardExtraction } from "../../../lib/backyard-ai/scorecard/validator";
import { scorecardCorrectionEvidenceForCell, type ScorecardCorrectionEvidence } from "../../../lib/backyard-ai/observability/scorecard-telemetry";
import type {
  ActiveScorecardRound,
  ScorecardExtraction,
  ScorecardValidationOverrides,
  ScorecardValidationResult,
} from "../../../lib/backyard-ai/schemas/scorecard";
import { runBettingDataActionWithConsent } from "../../../lib/backyard-ai/runtime/betting-consent-boundary";
import { deleteScorecardPhoto, deleteStaleTemporaryScorecardPhotos, markScorecardPhotosCommitted } from "../../../lib/scorecard-photo";
import { AiProcessingConsentPrompt } from "./ai-processing-consent";
import { ScorecardCorrection } from "./scorecard-correction";
import styles from "./backyard-ai.module.css";

type LocalPhoto = { id: string; file: File; previewUrl: string };

export type ScorecardScannerProps = {
  round: ActiveScorecardRound;
  storageOwnerId: string;
  accessToken?: string | null;
  requiresRemoteConsent: boolean;
  hasActiveBettingData: boolean;
  requestBettingConsent: () => Promise<boolean>;
  protectedPhotoIds?: readonly string[];
  /** Returns true only after the parent persisted scores and photo references. */
  onApply: (result: ScorecardValidationResult, photoIds: string[], overrides: ScorecardValidationOverrides, corrections: ScorecardCorrectionEvidence[]) => boolean;
  onManualFallback: () => void;
  onCancel: () => void;
};

function makePhotoId(roundId: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${roundId}-${suffix}`;
}

function playedHoleOrder(round: ActiveScorecardRound) {
  if (round.roundHoles === 9) {
    return Array.from({ length: 9 }, (_, index) => round.startHole === 10 ? index + 10 : index + 1);
  }
  return Array.from({ length: 18 }, (_, index) => round.startHole === 10 ? (index + 9) % 18 + 1 : index + 1);
}

export function ScorecardScanner({ round, storageOwnerId, accessToken, requiresRemoteConsent, hasActiveBettingData, requestBettingConsent, protectedPhotoIds = [], onApply, onManualFallback, onCancel }: ScorecardScannerProps) {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [showConsentPrompt, setShowConsentPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [photoWarning, setPhotoWarning] = useState("");
  const [applyNotice, setApplyNotice] = useState("");
  const [extraction, setExtraction] = useState<ScorecardExtraction | null>(null);
  const [overrides, setOverrides] = useState<ScorecardValidationOverrides>({});
  const [correctionEvidence, setCorrectionEvidence] = useState<Record<string, ScorecardCorrectionEvidence>>({});
  const previewUrls = useRef(new Set<string>());
  const locallySavedPhotoIds = useRef(new Set<string>());
  const selectedPhotoIds = useRef(new Set<string>());
  const committedPhotoIds = useRef(new Set<string>());
  const protectedPhotoIdsRef = useRef<readonly string[]>(protectedPhotoIds);
  const scanButtonRef = useRef<HTMLButtonElement>(null);
  const scanGeneration = useRef(0);
  const scanInFlight = useRef(false);
  const consentCheckInFlight = useRef(false);
  const applyInFlight = useRef(false);
  const mounted = useRef(true);
  const validation = useMemo(() => extraction ? validateScorecardExtraction(extraction, round, overrides) : null, [extraction, overrides, round]);
  const reviewHoles = useMemo(() => playedHoleOrder(round), [round]);
  const expectedScoreCount = round.players.length * reviewHoles.length;
  const acceptedScoreMap = useMemo(() => new Map(
    (validation?.acceptedCells || []).map((cell) => [`${cell.playerId}:${cell.hole}`, cell.value]),
  ), [validation]);

  useEffect(() => {
    protectedPhotoIdsRef.current = protectedPhotoIds;
    void deleteStaleTemporaryScorecardPhotos(storageOwnerId, Date.now(), protectedPhotoIds).catch(() => undefined);
  }, [protectedPhotoIds, storageOwnerId]);

  useEffect(() => {
    if (!photos.length) return;
    const frame = window.requestAnimationFrame(() => {
      scanButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      scanButtonRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [photos.length]);

  useEffect(() => {
    mounted.current = true;
    const urls = previewUrls.current;
    const savedPhotoIds = locallySavedPhotoIds.current;
    const confirmedPhotoIds = committedPhotoIds.current;
    return () => {
      mounted.current = false;
      scanGeneration.current += 1;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
      savedPhotoIds.forEach((photoId) => {
        if (!confirmedPhotoIds.has(photoId) && !protectedPhotoIdsRef.current.includes(photoId)) {
          void deleteScorecardPhoto(photoId).catch(() => undefined);
        }
      });
    };
  }, [storageOwnerId]);

  function addPhotos(files: FileList | null) {
    if (!files || busy || applying) return;
    const available = Math.max(0, MAX_SCORECARD_PHOTOS - photos.length);
    const next = [...files].filter((file) => /^image\/(jpeg|png|webp)$/i.test(file.type)).slice(0, available).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      const photo = { id: makePhotoId(round.roundId), file, previewUrl };
      selectedPhotoIds.current.add(photo.id);
      return photo;
    });
    setPhotos((current) => [...current, ...next]);
    setExtraction(null);
    setOverrides({});
    setCorrectionEvidence({});
    setStorageWarning("");
    setPhotoWarning("");
    setError(next.length ? "" : available === 0 ? "Ya agregaste el máximo de cuatro fotos." : "Selecciona una foto JPEG, PNG o WebP.");
  }

  function removePhoto(id: string) {
    if (busy || applying) return;
    selectedPhotoIds.current.delete(id);
    setPhotos((current) => {
      const removed = current.find((photo) => photo.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.current.delete(removed.previewUrl);
      }
      return current.filter((photo) => photo.id !== id);
    });
    if (locallySavedPhotoIds.current.delete(id)) void deleteScorecardPhoto(id).catch(() => undefined);
    setExtraction(null);
    setOverrides({});
    setCorrectionEvidence({});
    setStorageWarning("");
    setPhotoWarning("");
  }

  function hasImageProcessingConsent() {
    try {
      return hasActiveAiProcessingConsent(browserAiProcessingConsentStorage(), storageOwnerId, AI_IMAGE_PROCESSING_CONSENT);
    } catch {
      return false;
    }
  }

  async function scan() {
    if (!photos.length || busy || applying || scanInFlight.current || consentCheckInFlight.current) return;
    let allowed = false;
    if (accessToken) {
      consentCheckInFlight.current = true;
      setBusy(true);
      setProgressMessage("Verificando tu autorización de fotos…");
      setError("");
      try {
        const authority = await resolveAuthoritativeAiProcessingConsent({
          accessToken,
          storage: browserAiProcessingConsentStorage(),
          userId: storageOwnerId,
          scope: AI_IMAGE_PROCESSING_CONSENT,
        });
        allowed = !authority.discarded && authority.active && !authority.pendingLocalRevocation;
        if (mounted.current && authority.active && !authority.cachePersisted) {
          setStorageWarning("La autorización está guardada en tu cuenta, pero este navegador no permitió guardar una copia local. Puedes continuar.");
        }
      } catch {
        if (mounted.current) setError("No pude verificar la autorización de Card AI en tu cuenta. No se envió ninguna foto.");
      } finally {
        consentCheckInFlight.current = false;
        if (mounted.current) {
          setBusy(false);
          setProgressMessage("");
        }
      }
    } else if (requiresRemoteConsent) {
      if (mounted.current) setError("Tu cuenta necesita recuperar la sesión para verificar la autorización de Card AI. No se envió ninguna foto.");
      return;
    } else {
      allowed = hasImageProcessingConsent();
    }
    if (!mounted.current) return;
    if (!allowed) {
      setShowConsentPrompt(true);
      return;
    }
    await scanWithConsent();
  }

  async function scanWithConsent() {
    if (!mounted.current || !photos.length || busy || applying || scanInFlight.current) return;
    if (requiresRemoteConsent && !accessToken) {
      setShowConsentPrompt(false);
      setError("Tu cuenta necesita recuperar la sesión para usar Card AI. No se envió ninguna foto.");
      return;
    }
    scanInFlight.current = true;
    const generation = ++scanGeneration.current;
    const photosForScan = [...photos];
    setBusy(true);
    setProgressMessage("Preparando las fotos en este dispositivo…");
    setError("");
    setStorageWarning("");
    setPhotoWarning("");
    try {
      const pipeline = await runScorecardPhotoAnalysis(photosForScan, storageOwnerId, {
        analyze: async (transport) => {
          if (mounted.current && generation === scanGeneration.current) {
            setProgressMessage("Backyard está leyendo nombres, hoyos y totales…");
          }
          return requestBackyardAi<{ extraction?: unknown; partial?: { failedPhotoCount?: unknown } }>("/api/backyard-ai/scorecard", {
            photos: transport,
            round: { courseName: round.course.name, playerNames: round.players.map((player) => player.name), roundHoles: round.roundHoles },
            consent: backyardAiProviderConsent(AI_IMAGE_PROCESSING_CONSENT),
          }, 60_000, accessToken);
        },
        onPhotoPersisted: (photoId) => {
          if (!mounted.current || !selectedPhotoIds.current.has(photoId)) {
            void deleteScorecardPhoto(photoId).catch(() => undefined);
            return;
          }
          locallySavedPhotoIds.current.add(photoId);
        },
        onPhotoPersistenceFailed: () => {
          if (mounted.current && generation === scanGeneration.current) {
            setStorageWarning(scorecardLocalPersistenceWarning(1));
          }
        },
      });
      void pipeline.persistence.then((result) => {
        if (mounted.current && generation === scanGeneration.current && result.failedPhotoIds.length) {
          setStorageWarning(scorecardLocalPersistenceWarning(result.failedPhotoIds.length));
        }
      });
      if (pipeline.preparationFailures.length && mounted.current && generation === scanGeneration.current) {
        const count = pipeline.preparationFailures.length;
        setPhotoWarning(`No pude preparar ${count === 1 ? "una foto" : `${count} fotos`}; analicé ${pipeline.preparedPhotoIds.length === 1 ? "la que sí pude abrir" : `las ${pipeline.preparedPhotoIds.length} restantes`}.`);
      }
      if (!mounted.current || generation !== scanGeneration.current) return;
      const failedProviderPhotos = pipeline.response.partial?.failedPhotoCount;
      if (typeof failedProviderPhotos === "number" && Number.isSafeInteger(failedProviderPhotos) && failedProviderPhotos > 0) {
        setPhotoWarning((current) => `${current ? `${current} ` : ""}${failedProviderPhotos === 1 ? "Una foto no pudo leerse" : `${failedProviderPhotos} fotos no pudieron leerse`}; analicé las demás.`);
      }
      setProgressMessage("Validando la lectura contra la ronda activa…");
      const normalized = normalizeScorecardExtraction(pipeline.response.extraction);
      if (!normalized.ok) throw new ScorecardClientPipelineError("invalid_extraction", "La respuesta no pasó validación.");
      const submittedIds = new Set(pipeline.preparedPhotoIds);
      if (normalized.extraction.sourceIds.some((photoId) => !submittedIds.has(photoId))) {
        throw new ScorecardClientPipelineError("photo_source_mismatch", "La lectura no corresponde a las fotos enviadas.");
      }
      setExtraction(normalized.extraction);
      setOverrides({});
      setCorrectionEvidence({});
    } catch (caught) {
      if (mounted.current && generation === scanGeneration.current) setError(scorecardScanErrorMessage(caught));
    } finally {
      scanInFlight.current = false;
      if (mounted.current && generation === scanGeneration.current) {
        setBusy(false);
        setProgressMessage("");
      }
    }
  }

  function leave(action: () => void) {
    scanGeneration.current += 1;
    action();
  }

  async function applyValidatedScores(result: ScorecardValidationResult) {
    if (applying || applyInFlight.current) return;
    applyInFlight.current = true;
    setApplying(true);
    setError("");
    setApplyNotice("");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!mounted.current) {
      applyInFlight.current = false;
      return;
    }
    const photoIds = photos.map((photo) => photo.id).filter((photoId) => locallySavedPhotoIds.current.has(photoId));
    try {
      const outcome = await runBettingDataActionWithConsent(
        hasActiveBettingData,
        () => {
          if (!mounted.current) return false;
          const persisted = onApply(result, photoIds, overrides, Object.values(correctionEvidence));
          if (persisted) {
            photoIds.forEach((photoId) => committedPhotoIds.current.add(photoId));
            void markScorecardPhotosCommitted(photoIds, storageOwnerId).catch(() => undefined);
          }
          return persisted;
        },
        requestBettingConsent,
      );
      if (outcome.status === "CONSENT_CANCELLED") {
        if (mounted.current) setApplyNotice("La tarjeta sigue lista para confirmar. No se guardó ni cambió ningún score.");
        return;
      }
      if (!outcome.value && mounted.current) setError("No pude guardar los scores. Revisa la ronda e inténtalo nuevamente.");
    } catch {
      if (mounted.current) setError("No pude guardar los scores. Revisa la ronda e inténtalo nuevamente.");
    } finally {
      applyInFlight.current = false;
      if (mounted.current) setApplying(false);
    }
  }

  function changeOverrides(next: ScorecardValidationOverrides) {
    const previousCells = new Map((overrides.cells || []).map((cell) => [`${cell.playerId}:${cell.hole}`, cell.value]));
    const changed = (next.cells || []).filter((cell) => previousCells.get(`${cell.playerId}:${cell.hole}`) !== cell.value);
    if (changed.length && validation) {
      setCorrectionEvidence((current) => {
        const updated = { ...current };
        for (const cell of changed) {
          const issue = validation.issues.find((candidate) => candidate.playerId === cell.playerId && candidate.hole === cell.hole && candidate.resolution === "cell_value");
          const evidence = scorecardCorrectionEvidenceForCell(issue, cell);
          const key = `${cell.playerId}:${cell.hole}`;
          if (evidence) updated[key] = evidence;
          else delete updated[key];
        }
        return updated;
      });
    }
    setOverrides(next);
  }

  return <section className={styles.screen} aria-labelledby="scorecard-ai-title" aria-busy={busy || applying}>
    <section className={styles.hero}>
      <span className="eyebrow">BACKYARD CARD AI</span>
      <h1 id="scorecard-ai-title">Foto. Dudas mínimas. Resultado.</h1>
      <p>Toma una foto clara de la tarjeta. Backyard leerá cada celda y sólo te mostrará lo que realmente necesite confirmación.</p>
    </section>

    <section className="card">
      <div className="sectionTitle"><div><h2>Tarjeta original</h2><p>Puedes agregar hasta cuatro fotos para cubrir frente, vuelta o grupos grandes.</p></div><span className={styles.confidence} aria-live="polite">{photos.length}/{MAX_SCORECARD_PHOTOS}</span></div>
      {photos.length > 0 && <div className={styles.photoGrid}>{photos.map((photo, index) => <div className={styles.photo} key={photo.id}><img src={photo.previewUrl} alt={`Vista previa ${index + 1} de la tarjeta`} /><button type="button" aria-label={`Quitar foto ${index + 1}`} disabled={busy || applying} onClick={() => removePhoto(photo.id)}>×</button></div>)}</div>}
      <div className={styles.photoActions}>
        <label className="uploadButton" aria-disabled={busy || applying || photos.length >= MAX_SCORECARD_PHOTOS}>📸 Tomar fotografía<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy || applying || photos.length >= MAX_SCORECARD_PHOTOS} onChange={(event) => { addPhotos(event.target.files); event.target.value = ""; }} /></label>
        <label className="uploadButton" aria-disabled={busy || applying || photos.length >= MAX_SCORECARD_PHOTOS}>Elegir fotografía<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || applying || photos.length >= MAX_SCORECARD_PHOTOS} onChange={(event) => { addPhotos(event.target.files); event.target.value = ""; }} /></label>
      </div>
      <p className={styles.privacyNote}>Las fotos se comprimen en memoria para el análisis. Guardar una copia local es opcional y nunca bloquea Card AI. No se usan automáticamente para training global.</p>
      <button ref={scanButtonRef} type="button" className="primary big" disabled={!photos.length || busy || applying} onClick={() => { void scan(); }}>{busy ? progressMessage || "Leyendo tarjeta…" : "ESCANEAR TARJETA"}</button>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {storageWarning && <div className="notice" role="status">{storageWarning}</div>}
      {photoWarning && <div className="notice" role="status">{photoWarning}</div>}
      {busy && <div className={styles.progress} role="status"><b>{progressMessage || "Backyard está leyendo la tarjeta…"}</b></div>}
    </section>

    {!busy && validation?.issues.length ? <ScorecardCorrection
      round={round}
      issues={validation.issues}
      overrides={overrides}
      recognizedScoreCount={validation.acceptedCells.length}
      expectedScoreCount={expectedScoreCount}
      onChange={changeOverrides}
    /> : null}

    {!busy && validation?.ready && <section className="card">
      <div className="sectionTitle"><div><h2>{validation.acceptedCells.length}/{expectedScoreCount} scores reconocidos</h2><p>Todos los scores esperados pasaron la validación contra la ronda activa.</p></div><span className={styles.confidence}>✓ SIN DUDAS PENDIENTES</span></div>
      <div className={styles.scoreReviewTableWrap} role="region" aria-label="Scores leídos de la tarjeta" tabIndex={0}>
        <table className={styles.scoreReviewTable}>
          <thead><tr><th scope="col">Jugador</th>{reviewHoles.map((hole) => <th scope="col" key={hole}>H{hole}</th>)}<th scope="col">Total</th></tr></thead>
          <tbody>{round.players.map((player) => {
            const values = reviewHoles.map((hole) => acceptedScoreMap.get(`${player.id}:${hole}`));
            const total = values.every((value) => typeof value === "number") ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
            return <tr key={player.id}><th scope="row">{player.name}</th>{reviewHoles.map((hole, index) => <td key={hole}>{values[index] ?? "—"}</td>)}<td><b>{total ?? "—"}</b></td></tr>;
          })}</tbody>
        </table>
      </div>
      <p className={styles.privacyNote}>Revisa estos valores contra la foto. No son resultados de dinero: al confirmar, el motor determinista existente hará los cálculos.</p>
      <button type="button" className="primary big" disabled={applying} aria-busy={applying} onClick={() => { void applyValidatedScores(validation); }}>{applying ? "Confirmando scores…" : "CONFIRMAR SCORES"}</button>
      {applyNotice && <div className="notice" role="status">{applyNotice}</div>}
    </section>}

    <div className={styles.reviewActions}><button type="button" className="secondary" disabled={busy || applying} onClick={() => leave(onCancel)}>Volver a la ronda</button><button type="button" className="textButton" disabled={busy || applying} onClick={() => leave(onManualFallback)}>CAPTURAR MANUALMENTE</button></div>
    {showConsentPrompt && <AiProcessingConsentPrompt
      userId={storageOwnerId}
      accessToken={accessToken}
      requiresRemoteConsent={requiresRemoteConsent}
      scope={AI_IMAGE_PROCESSING_CONSENT}
      onCancel={() => setShowConsentPrompt(false)}
      onAccepted={(_consent, persistence) => {
        setShowConsentPrompt(false);
        if (!persistence.localPersisted) {
          setStorageWarning(persistence.accountPersisted
            ? "La autorización está guardada en tu cuenta, pero este navegador no permitió guardar una copia local. Puedes continuar."
            : "Este navegador no permitió guardar la autorización; estará vigente sólo durante esta sesión.");
        }
        void scanWithConsent();
      }}
    />}
  </section>;
}

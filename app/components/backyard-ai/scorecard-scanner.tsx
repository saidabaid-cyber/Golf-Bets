"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { blobToDataUrl, requestBackyardAi } from "../../../lib/backyard-ai/client-api";
import { backyardAiProviderConsent } from "../../../lib/backyard-ai/privacy";
import { normalizeScorecardExtraction } from "../../../lib/backyard-ai/scorecard/extractor";
import { validateScorecardExtraction } from "../../../lib/backyard-ai/scorecard/validator";
import { scorecardCorrectionEvidenceForCell, type ScorecardCorrectionEvidence } from "../../../lib/backyard-ai/observability/scorecard-telemetry";
import type {
  ActiveScorecardRound,
  ScorecardExtraction,
  ScorecardValidationOverrides,
  ScorecardValidationResult,
} from "../../../lib/backyard-ai/schemas/scorecard";
import { deleteScorecardPhoto, deleteStaleTemporaryScorecardPhotos, markScorecardPhotosCommitted, readScorecardPhoto, saveScorecardPhoto } from "../../../lib/scorecard-photo";
import { ScorecardCorrection } from "./scorecard-correction";
import styles from "./backyard-ai.module.css";

type LocalPhoto = { id: string; file: File; previewUrl: string };

export type ScorecardScannerProps = {
  round: ActiveScorecardRound;
  storageOwnerId: string;
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

export function ScorecardScanner({ round, storageOwnerId, protectedPhotoIds = [], onApply, onManualFallback, onCancel }: ScorecardScannerProps) {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extraction, setExtraction] = useState<ScorecardExtraction | null>(null);
  const [overrides, setOverrides] = useState<ScorecardValidationOverrides>({});
  const [correctionEvidence, setCorrectionEvidence] = useState<Record<string, ScorecardCorrectionEvidence>>({});
  const previewUrls = useRef(new Set<string>());
  const locallySavedPhotoIds = useRef(new Set<string>());
  const committedPhotoIds = useRef(new Set<string>());
  const protectedPhotoIdsRef = useRef<readonly string[]>(protectedPhotoIds);
  const scanGeneration = useRef(0);
  const mounted = useRef(true);
  const validation = useMemo(() => extraction ? validateScorecardExtraction(extraction, round, overrides) : null, [extraction, overrides, round]);
  const reviewHoles = useMemo(() => playedHoleOrder(round), [round]);
  const acceptedScoreMap = useMemo(() => new Map(
    (validation?.acceptedCells || []).map((cell) => [`${cell.playerId}:${cell.hole}`, cell.value]),
  ), [validation]);

  useEffect(() => {
    protectedPhotoIdsRef.current = protectedPhotoIds;
    void deleteStaleTemporaryScorecardPhotos(storageOwnerId, Date.now(), protectedPhotoIds).catch(() => undefined);
  }, [protectedPhotoIds, storageOwnerId]);

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
    if (!files || busy) return;
    const available = Math.max(0, 4 - photos.length);
    const next = [...files].filter((file) => /^image\/(jpeg|png|webp)$/i.test(file.type)).slice(0, available).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      return { id: makePhotoId(round.roundId), file, previewUrl };
    });
    setPhotos((current) => [...current, ...next]);
    setConsent(false);
    setExtraction(null);
    setOverrides({});
    setCorrectionEvidence({});
    setError(next.length ? "" : available === 0 ? "Ya agregaste el máximo de cuatro fotos." : "Selecciona una foto JPEG, PNG o WebP.");
  }

  function removePhoto(id: string) {
    if (busy) return;
    setPhotos((current) => {
      const removed = current.find((photo) => photo.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.current.delete(removed.previewUrl);
      }
      return current.filter((photo) => photo.id !== id);
    });
    if (locallySavedPhotoIds.current.delete(id)) void deleteScorecardPhoto(id).catch(() => undefined);
    setConsent(false);
    setExtraction(null);
    setOverrides({});
    setCorrectionEvidence({});
  }

  async function scan() {
    if (!photos.length || !consent || busy) return;
    const generation = ++scanGeneration.current;
    const photosForScan = [...photos];
    setConsent(false);
    setBusy(true);
    setError("");
    try {
      const transport = await Promise.all(photosForScan.map(async (photo) => {
        await saveScorecardPhoto(photo.id, photo.file, storageOwnerId);
        locallySavedPhotoIds.current.add(photo.id);
        if (!mounted.current || generation !== scanGeneration.current) {
          locallySavedPhotoIds.current.delete(photo.id);
          await deleteScorecardPhoto(photo.id).catch(() => undefined);
          throw new Error("Escaneo cancelado.");
        }
        const blob = await readScorecardPhoto(photo.id, storageOwnerId);
        if (!blob) throw new Error("No se pudo comprobar la foto guardada.");
        return { id: photo.id, dataUrl: await blobToDataUrl(blob) };
      }));
      const response = await requestBackyardAi<{ extraction?: unknown }>("/api/backyard-ai/scorecard", {
        photos: transport,
        round: { courseName: round.course.name, playerNames: round.players.map((player) => player.name), roundHoles: round.roundHoles },
        consent: backyardAiProviderConsent(),
      }, 60_000);
      if (!mounted.current || generation !== scanGeneration.current) return;
      const normalized = normalizeScorecardExtraction(response.extraction);
      if (!normalized.ok) throw new Error("La lectura recibida no es válida.");
      const submittedIds = new Set(photosForScan.map((photo) => photo.id));
      if (normalized.extraction.sourceIds.some((photoId) => !submittedIds.has(photoId))) throw new Error("La lectura no corresponde a las fotos enviadas.");
      setExtraction(normalized.extraction);
      setOverrides({});
      setCorrectionEvidence({});
    } catch (caught) {
      if (mounted.current && generation === scanGeneration.current) setError(caught instanceof Error ? caught.message : "No pudimos leer la tarjeta.");
    } finally {
      if (mounted.current && generation === scanGeneration.current) setBusy(false);
    }
  }

  function leave(action: () => void) {
    scanGeneration.current += 1;
    action();
  }

  function applyValidatedScores(result: ScorecardValidationResult) {
    const photoIds = photos.map((photo) => photo.id);
    const persisted = onApply(result, photoIds, overrides, Object.values(correctionEvidence));
    if (persisted) {
      photoIds.forEach((photoId) => committedPhotoIds.current.add(photoId));
      void markScorecardPhotosCommitted(photoIds, storageOwnerId).catch(() => undefined);
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

  return <section className={styles.screen} aria-labelledby="scorecard-ai-title" aria-busy={busy}>
    <section className={styles.hero}>
      <span className="eyebrow">BACKYARD CARD AI</span>
      <h1 id="scorecard-ai-title">Foto. Dudas mínimas. Resultado.</h1>
      <p>Toma una foto clara de la tarjeta. Backyard leerá cada celda y sólo te mostrará lo que realmente necesite confirmación.</p>
    </section>

    <section className="card">
      <div className="sectionTitle"><div><h2>Tarjeta original</h2><p>Puedes agregar hasta cuatro fotos para cubrir frente, vuelta o grupos grandes.</p></div><span className={styles.confidence} aria-live="polite">{photos.length}/4</span></div>
      {photos.length > 0 && <div className={styles.photoGrid}>{photos.map((photo, index) => <div className={styles.photo} key={photo.id}><img src={photo.previewUrl} alt={`Vista previa ${index + 1} de la tarjeta`} /><button type="button" aria-label={`Quitar foto ${index + 1}`} disabled={busy} onClick={() => removePhoto(photo.id)}>×</button></div>)}</div>}
      <div className={styles.photoActions}>
        <label className="uploadButton" aria-disabled={busy || photos.length >= 4}>📸 Tomar fotografía<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy || photos.length >= 4} onChange={(event) => { addPhotos(event.target.files); event.target.value = ""; }} /></label>
        <label className="uploadButton" aria-disabled={busy || photos.length >= 4}>Elegir fotografía<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || photos.length >= 4} onChange={(event) => { addPhotos(event.target.files); event.target.value = ""; }} /></label>
      </div>
      <label className={styles.consent}><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /><span>Autorizo enviar estas fotos a OpenAI junto con el nombre del campo y los nombres de los jugadores de esta ronda, únicamente para leer y relacionar la tarjeta.</span></label>
      <p className={styles.privacyNote}>Las copias comprimidas se guardan primero en este dispositivo. La solicitud de IA no se conserva como conversación ni se usa automáticamente para training global.</p>
      <button type="button" className="primary big" disabled={!photos.length || !consent || busy} onClick={scan}>{busy ? "Leyendo tarjeta…" : "ESCANEAR TARJETA"}</button>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {busy && <div className={styles.progress} role="status"><b>Backyard está leyendo nombres, hoyos y totales…</b></div>}
    </section>

    {!busy && validation?.issues.length ? <ScorecardCorrection round={round} issues={validation.issues} overrides={overrides} onChange={changeOverrides} /> : null}

    {!busy && validation?.ready && <section className="card">
      <div className="sectionTitle"><div><h2>Confirma la lectura completa</h2><p>{validation.evidence.detectedCellCount} celdas leídas; {validation.acceptedCells.length} scores pasaron la validación contra la ronda activa.</p></div><span className={styles.confidence}>✓ SIN DUDAS PENDIENTES</span></div>
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
      <button type="button" className="primary big" onClick={() => applyValidatedScores(validation)}>CONFIRMAR SCORES Y CALCULAR</button>
    </section>}

    <div className={styles.reviewActions}><button type="button" className="secondary" onClick={() => leave(onCancel)}>Volver a la ronda</button><button type="button" className="textButton" onClick={() => leave(onManualFallback)}>Capturar scores manualmente</button></div>
  </section>;
}

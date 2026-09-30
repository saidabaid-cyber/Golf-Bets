"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LAUNCH_MONITOR_CLUBS,
  MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB,
  getLaunchMonitorProtocolProgress,
  summarizeLaunchMonitorSession,
  type LaunchMonitorClub,
  type ClubCategory,
  type LaunchMonitorMetric,
  type LaunchMonitorSession,
  type LaunchMonitorShot,
} from "../../lib/golf-equipment";
import styles from "./equipment.module.css";
import { LaunchMonitorCamera, type LaunchMonitorAnalysisState } from "./launch-monitor-camera";
import { EQUIPMENT_CATEGORY_ASSETS } from "./equipment-category-assets";

type LaunchMonitorCaptureProps = {
  userId: string;
  accessToken?: string | null;
  requiresRemoteConsent?: boolean;
  value: LaunchMonitorSession | null;
  onChange: (session: LaunchMonitorSession | null) => void;
  onOpenPrivacy?: () => void;
  onDone?: () => void;
};

type MetricField = {
  metric: LaunchMonitorMetric;
  label: string;
  shortLabel: string;
  unit: string;
  minimum: number;
  maximum: number;
  step: number;
};

type ShotDraft = Partial<Record<LaunchMonitorMetric, string>> & { note: string };

const CLUB_LABELS: Record<LaunchMonitorClub, string> = {
  DRIVER: "Driver",
  IRON_7: "Hierro 7",
  PITCHING_WEDGE: "Pitching Wedge",
  HALF_WEDGE: "Half Wedge / Approach",
};

const CLUB_VISUALS: Record<LaunchMonitorClub, ClubCategory> = {
  DRIVER: "DRIVER",
  IRON_7: "IRON_SET",
  PITCHING_WEDGE: "WEDGE",
  HALF_WEDGE: "WEDGE",
};

const METRIC_FIELDS: Record<LaunchMonitorMetric, MetricField> = {
  clubSpeedMph: { metric: "clubSpeedMph", label: "Velocidad del palo", shortLabel: "Palo", unit: "mph", minimum: 0, maximum: 250, step: 0.1 },
  ballSpeedMph: { metric: "ballSpeedMph", label: "Velocidad de bola", shortLabel: "Ball Speed", unit: "mph", minimum: 0, maximum: 300, step: 0.1 },
  launchAngleDegrees: { metric: "launchAngleDegrees", label: "Ángulo de lanzamiento", shortLabel: "Launch", unit: "°", minimum: -30, maximum: 90, step: 0.1 },
  spinRpm: { metric: "spinRpm", label: "Spin", shortLabel: "Spin", unit: "rpm", minimum: 0, maximum: 25_000, step: 1 },
  carryYards: { metric: "carryYards", label: "Carry", shortLabel: "Carry", unit: "yd", minimum: 0, maximum: 700, step: 0.1 },
  totalYards: { metric: "totalYards", label: "Distancia total", shortLabel: "Total", unit: "yd", minimum: 0, maximum: 800, step: 0.1 },
  peakHeightYards: { metric: "peakHeightYards", label: "Altura máxima", shortLabel: "Altura", unit: "yd", minimum: 0, maximum: 250, step: 0.1 },
  landingAngleDegrees: { metric: "landingAngleDegrees", label: "Ángulo de caída", shortLabel: "Caída", unit: "°", minimum: -30, maximum: 90, step: 0.1 },
};

const CLUB_METRICS: Record<LaunchMonitorClub, LaunchMonitorMetric[]> = {
  DRIVER: ["clubSpeedMph", "ballSpeedMph", "launchAngleDegrees", "spinRpm", "carryYards", "totalYards", "peakHeightYards"],
  IRON_7: ["ballSpeedMph", "launchAngleDegrees", "spinRpm", "carryYards", "peakHeightYards", "landingAngleDegrees"],
  PITCHING_WEDGE: ["ballSpeedMph", "launchAngleDegrees", "spinRpm", "carryYards", "peakHeightYards", "landingAngleDegrees"],
  HALF_WEDGE: ["carryYards", "spinRpm", "launchAngleDegrees", "landingAngleDegrees"],
};

const SHOT_SUMMARY_METRICS: Record<LaunchMonitorClub, LaunchMonitorMetric[]> = {
  DRIVER: ["ballSpeedMph", "spinRpm", "carryYards"],
  IRON_7: ["ballSpeedMph", "spinRpm", "carryYards"],
  PITCHING_WEDGE: ["launchAngleDegrees", "spinRpm", "carryYards"],
  HALF_WEDGE: ["launchAngleDegrees", "spinRpm", "carryYards"],
};

function emptyDraft(): ShotDraft {
  return { note: "" };
}

function initialDrafts(): Record<LaunchMonitorClub, ShotDraft> {
  return {
    DRIVER: emptyDraft(),
    IRON_7: emptyDraft(),
    PITCHING_WEDGE: emptyDraft(),
    HALF_WEDGE: emptyDraft(),
  };
}

function createId(prefix: string) {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function emptyMetrics(): Record<LaunchMonitorMetric, number | null> {
  return {
    clubSpeedMph: null,
    ballSpeedMph: null,
    launchAngleDegrees: null,
    spinRpm: null,
    carryYards: null,
    totalYards: null,
    peakHeightYards: null,
    landingAngleDegrees: null,
  };
}

function displayMetric(value: number | null, metric: LaunchMonitorMetric) {
  if (value === null) return "—";
  const field = METRIC_FIELDS[metric];
  const decimals = field.step < 1 ? 1 : 0;
  return `${value.toLocaleString("es-MX", { maximumFractionDigits: decimals })} ${field.unit}`;
}

function summaryMetric(value: number, metric: LaunchMonitorMetric) {
  const field = METRIC_FIELDS[metric];
  const decimals = field.step < 1 ? 1 : 0;
  return `${value.toLocaleString("es-MX", { maximumFractionDigits: decimals })} ${field.unit}`;
}

function initialAnalysisStates(): Record<LaunchMonitorClub, LaunchMonitorAnalysisState> {
  return {
    DRIVER: "idle",
    IRON_7: "idle",
    PITCHING_WEDGE: "idle",
    HALF_WEDGE: "idle",
  };
}

function clubVisual(club: LaunchMonitorClub) {
  const asset = EQUIPMENT_CATEGORY_ASSETS[CLUB_VISUALS[club]];
  return <Image src={asset.src} width={asset.width} height={asset.height} sizes="(max-width: 540px) 42vw, 150px" alt="" aria-hidden="true" />;
}

function sessionCompletedAt(shots: LaunchMonitorShot[]) {
  const complete = LAUNCH_MONITOR_CLUBS.every(
    (club) => shots.filter((shot) => shot.club === club && !shot.excluded).length >= 3,
  );
  return complete ? new Date().toISOString() : null;
}

export function LaunchMonitorCapture({ userId, accessToken, requiresRemoteConsent = false, value, onChange, onOpenPrivacy, onDone }: LaunchMonitorCaptureProps) {
  const session = useMemo(
    () => value?.userId === userId.trim() ? value : null,
    [userId, value],
  );
  const latestSession = useRef<LaunchMonitorSession | null>(session);
  useEffect(() => {
    latestSession.current = session;
  }, [session]);
  const progress = useMemo(() => session ? getLaunchMonitorProtocolProgress(session) : null, [session]);
  const summary = useMemo(() => session ? summarizeLaunchMonitorSession(session) : null, [session]);
  const [activeClub, setActiveClub] = useState<LaunchMonitorClub>("DRIVER");
  const [clubSelected, setClubSelected] = useState(false);
  const [visitedClubs, setVisitedClubs] = useState<LaunchMonitorClub[]>([]);
  const [cameraVersions, setCameraVersions] = useState<Record<LaunchMonitorClub, number>>({ DRIVER: 0, IRON_7: 0, PITCHING_WEDGE: 0, HALF_WEDGE: 0 });
  const [lastSavedClub, setLastSavedClub] = useState<LaunchMonitorClub | null>(null);
  const [analysisStates, setAnalysisStates] = useState<Record<LaunchMonitorClub, LaunchMonitorAnalysisState>>(initialAnalysisStates);
  const [drafts, setDrafts] = useState<Record<LaunchMonitorClub, ShotDraft>>(initialDrafts);
  const [errors, setErrors] = useState<Partial<Record<LaunchMonitorClub, string>>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [shotDetailsOpen, setShotDetailsOpen] = useState(false);
  const [editingShotId, setEditingShotId] = useState<string | null>(null);

  function commitSession(next: LaunchMonitorSession | null) {
    latestSession.current = next;
    onChange(next);
  }

  function updateSession(update: (current: LaunchMonitorSession) => LaunchMonitorSession) {
    const current = latestSession.current;
    if (!current) return;
    commitSession(update(current));
  }

  function updateDraft(club: LaunchMonitorClub, field: LaunchMonitorMetric | "note", nextValue: string) {
    setDrafts((current) => ({
      ...current,
      [club]: { ...current[club], [field]: nextValue },
    }));
    setErrors((current) => ({ ...current, [club]: undefined }));
  }

  function addShot(club: LaunchMonitorClub) {
    const cleanUserId = userId.trim();
    if (!cleanUserId) return;
    const now = new Date().toISOString();
    const currentSession = latestSession.current || { id: createId("launch-session"), userId: cleanUserId, source: null, startedAt: now, completedAt: null, shots: [] };
    if (currentSession.shots.filter((shot) => shot.club === club).length >= MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB) {
      setErrors((current) => ({ ...current, [club]: `Máximo ${MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB} golpes por palo. Excluye golpes malos o inicia una captura nueva.` }));
      return;
    }
    const draft = drafts[club];
    const metrics = emptyMetrics();
    let hasMetric = false;

    for (const metric of CLUB_METRICS[club]) {
      const rawValue = draft[metric]?.trim() ?? "";
      if (!rawValue) continue;
      const field = METRIC_FIELDS[metric];
      const parsed = Number(rawValue.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < field.minimum || parsed > field.maximum) {
        setErrors((current) => ({ ...current, [club]: `Revisa ${field.label.toLocaleLowerCase("es-MX")}: admite valores de ${field.minimum} a ${field.maximum} ${field.unit}.` }));
        return;
      }
      metrics[metric] = parsed;
      hasMetric = true;
    }

    if (!hasMetric) {
      setErrors((current) => ({ ...current, [club]: "Agrega al menos una medición para guardar este golpe." }));
      return;
    }

    const shot: LaunchMonitorShot = {
      id: createId("launch-shot"),
      club,
      excluded: false,
      capturedAt: now,
      note: draft.note.trim() || null,
      ...metrics,
    };
    const nextShots = [...currentSession.shots, shot];
    commitSession({ ...currentSession, completedAt: sessionCompletedAt(nextShots), shots: nextShots });
    setDrafts((current) => ({ ...current, [club]: emptyDraft() }));
    setErrors((current) => ({ ...current, [club]: undefined }));
    setManualOpen(false);
    setAnalysisStates((current) => ({ ...current, [club]: "applied" }));
  }

  function toggleShot(shotId: string) {
    updateSession((current) => {
      const nextShots = current.shots.map((shot) => shot.id === shotId ? { ...shot, excluded: !shot.excluded } : shot);
      return { ...current, completedAt: sessionCompletedAt(nextShots), shots: nextShots };
    });
  }

  function updateShotMetric(shotId: string, metric: LaunchMonitorMetric, rawValue: string) {
    const field = METRIC_FIELDS[metric];
    const parsed = rawValue.trim() === "" ? null : Number(rawValue.replace(",", "."));
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < field.minimum || parsed > field.maximum)) return;
    updateSession((current) => ({
      ...current,
      completedAt: current.completedAt,
      shots: current.shots.map((shot) => shot.id === shotId ? { ...shot, [metric]: parsed } : shot),
    }));
  }

  const includedShots = session?.shots.filter((shot) => !shot.excluded).length ?? 0;
  const activeClubSummary = summary?.byClub.find((clubSummary) => clubSummary.club === activeClub) ?? null;
  const activeClubCount = progress?.counts[activeClub] ?? 0;
  const activeClubShots = session?.shots.filter((shot) => shot.club === activeClub) ?? [];
  const availableSummaryMetrics = (["ballSpeedMph", "carryYards", "totalYards", "launchAngleDegrees", "spinRpm"] as LaunchMonitorMetric[])
    .filter((metric) => Boolean(activeClubSummary?.metrics[metric]));
  const analysisState = analysisStates[activeClub];
  const analysisMessage = analysisState === "analyzing"
    ? "Estamos leyendo y validando las mediciones de tus fotos."
    : analysisState === "review"
      ? "Encontramos una lectura dudosa. Corrige sólo los datos marcados."
      : analysisState === "applied"
        ? "Las mediciones válidas ya se aplicaron al resumen."
        : analysisState === "error"
          ? "No pudimos completar el análisis. Revisa el mensaje anterior e intenta de nuevo."
          : "Al elegir Analizar fotos, leeremos las mediciones y aplicaremos automáticamente los datos claros.";

  function selectClub(club: LaunchMonitorClub) {
    setActiveClub(club);
    setClubSelected(true);
    setVisitedClubs((current) => current.includes(club) ? current : [...current, club]);
    setAnalysisStates((current) => current[club] === "idle" && (progress?.counts[club] ?? 0) > 0
      ? { ...current, [club]: "applied" }
      : current);
    setManualOpen(false);
    setShotDetailsOpen(false);
    setEditingShotId(null);
    setConfirmClear(false);
  }

  function saveCurrentClub() {
    if (activeClubCount < 1) return;
    setLastSavedClub(activeClub);
    setClubSelected(false);
    setManualOpen(false);
    setShotDetailsOpen(false);
    setEditingShotId(null);
    setConfirmClear(false);
  }

  function clearCurrentClub() {
    const current = latestSession.current;
    if (!current) return;
    const nextShots = current.shots.filter((shot) => shot.club !== activeClub);
    commitSession(nextShots.length ? { ...current, completedAt: sessionCompletedAt(nextShots), shots: nextShots } : null);
    setCameraVersions((current) => ({ ...current, [activeClub]: current[activeClub] + 1 }));
    setVisitedClubs((current) => current.filter((club) => club !== activeClub));
    setConfirmClear(false);
    setShotDetailsOpen(false);
    setEditingShotId(null);
    setAnalysisStates((states) => ({ ...states, [activeClub]: "idle" }));
    setLastSavedClub(null);
    setClubSelected(false);
  }

  return (
    <section className={styles.launchSection}>
      <section className={styles.clubCaptureSelector} data-capture-order="1" aria-labelledby="club-capture-title">
        <div className={styles.launchStepHeading}><span>1</span><div><h3 id="club-capture-title">Selecciona tu palo</h3><p>Elige el palo de los golpes que vas a subir.</p></div></div>
        {lastSavedClub && <p className={styles.clubSavedNotice} role="status">✓ {CLUB_LABELS[lastSavedClub]} guardado. Puedes elegir otro palo o continuar con Ball Fit.</p>}
        <div className={styles.clubChoiceGrid} aria-label="Selecciona el palo de las mediciones">
          {LAUNCH_MONITOR_CLUBS.map((club) => {
            const count = progress?.counts[club] ?? 0;
            const excluded = session?.shots.filter((shot) => shot.club === club && shot.excluded).length ?? 0;
            const selected = clubSelected && activeClub === club;
            const complete = count > 0;
            return <button type="button" key={club} className={`${selected ? styles.clubChoiceSelected : styles.clubChoice} ${complete ? styles.clubChoiceComplete : ""}`} aria-pressed={selected} onClick={() => selectClub(club)}>
              <span className={styles.clubChoiceVisual}>{clubVisual(club)}</span>
              <span><b>{CLUB_LABELS[club]}</b><small>{Math.min(count, 3)}/3 golpes válidos{excluded ? ` · ${excluded} excluido${excluded === 1 ? "" : "s"}` : ""}</small></span>
              <strong aria-hidden="true">{selected || complete ? "✓" : "›"}</strong>
            </button>;
          })}
        </div>
      </section>

      {visitedClubs.map((club) => <section key={club} className={styles.captureStage} data-capture-order="2" hidden={!clubSelected || activeClub !== club} aria-labelledby={`launch-photos-${club}`}>
        <div className={styles.launchStepHeading}>
          <span>2</span>
          <div><h3 id={`launch-photos-${club}`}>Agrega las fotos</h3><p>Sube una o varias fotos de tu monitor de lanzamiento. Analizaremos los datos automáticamente.</p></div>
          <button type="button" className={styles.changeClubButton} onClick={() => setClubSelected(false)}>Cambiar palo</button>
        </div>
        <LaunchMonitorCamera
          key={`launch-camera-${club}-${cameraVersions[club]}`}
          userId={userId}
          accessToken={accessToken}
          requiresRemoteConsent={requiresRemoteConsent}
          onOpenPrivacy={onOpenPrivacy}
          targetClub={club}
          capturedCount={progress?.counts[club] ?? 0}
          onAnalysisStateChange={(state) => setAnalysisStates((current) => ({ ...current, [club]: state }))}
          onConfirm={(source, shots) => {
            const now = new Date().toISOString();
            const current = latestSession.current || { id: createId("launch-session"), userId: userId.trim(), source: null, startedAt: now, completedAt: null, shots: [] };
            const existingForClub = current.shots.filter((shot) => shot.club === club).length;
            const remainingForClub = Math.max(0, MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB - existingForClub);
            const assignedShots = shots.slice(0, remainingForClub).map((shot) => ({ ...shot, club }));
            const nextShots = [...current.shots, ...assignedShots];
            commitSession({ ...current, source: source || current.source, completedAt: sessionCompletedAt(nextShots), shots: nextShots });
            setActiveClub(club);
            setClubSelected(true);
            setAnalysisStates((states) => ({ ...states, [club]: "applied" }));
          }}
        />

        <p className={styles.analysisStatus} aria-live="polite">{analysisMessage}</p>

        <button type="button" className={styles.manualCaptureToggle} aria-expanded={manualOpen} onClick={() => setManualOpen((current) => !current)}>
          <span><b>Capturar datos manualmente</b><small>Sólo si no quieres usar fotos</small></span><strong aria-hidden="true">{manualOpen ? "−" : "+"}</strong>
        </button>

        {manualOpen && club === activeClub && <section className={styles.manualCapturePanel} aria-labelledby={`capture-${activeClub}`}>
            <div className={styles.itemHeader}>
              <div>
                <h3 id={`capture-${activeClub}`}>Datos disponibles · {CLUB_LABELS[activeClub]}</h3>
                <p>Captura solo los datos que tengas. Ningún campo individual es obligatorio.</p>
              </div>
            </div>
            <div className={styles.formGrid}>
              {CLUB_METRICS[activeClub].map((metric) => {
                const field = METRIC_FIELDS[metric];
                return (
                  <label key={metric}>
                    {field.label} ({field.unit})
                    <input
                      type="number"
                      inputMode="decimal"
                      min={field.minimum}
                      max={field.maximum}
                      step={field.step}
                      value={drafts[activeClub][metric] ?? ""}
                      onChange={(event) => updateDraft(activeClub, metric, event.target.value)}
                    />
                  </label>
                );
              })}
              <label className={styles.fullField}>
                Nota del golpe (opcional)
                <input
                  type="text"
                  maxLength={500}
                  value={drafts[activeClub].note}
                  placeholder="Ej. viento en contra"
                  onChange={(event) => updateDraft(activeClub, "note", event.target.value)}
                />
              </label>
              {errors[activeClub] && <p className={styles.formMessage} role="alert">{errors[activeClub]}</p>}
              <div className={styles.inlineActions}>
                <button type="button" className="primary" onClick={() => addShot(activeClub)}>Agregar al resumen</button>
              </div>
            </div>
          </section>}
      </section>)}

          {clubSelected && activeClubSummary && activeClubCount > 0 && (
            <section className={styles.captureSummary} data-capture-order="3" aria-labelledby="launch-summary-title">
              <div className={styles.launchStepHeading}><span>3</span><div><h3 id="launch-summary-title">Revisa el resumen</h3><p>Hemos detectado {activeClubSummary.includedShots} golpe{activeClubSummary.includedShots === 1 ? "" : "s"} de {CLUB_LABELS[activeClub]}. Revisa los datos y guarda.</p></div></div>
              <article className={styles.launchCard}>
                <div className={styles.launchCardTitle}><span className={styles.clubChoiceVisual}>{clubVisual(activeClub)}</span><span><h4>{CLUB_LABELS[activeClub]}</h4><p>{activeClubSummary.includedShots} golpe{activeClubSummary.includedShots === 1 ? "" : "s"} válido{activeClubSummary.includedShots === 1 ? "" : "s"}</p></span></div>
                <div className={styles.launchMetricGrid}>
                  {availableSummaryMetrics.map((metric) => {
                    const metricSummary = activeClubSummary.metrics[metric]!;
                    return <span key={metric}><small>{METRIC_FIELDS[metric].shortLabel}</small><b>{summaryMetric(metricSummary.median, metric)}</b></span>;
                  })}
                </div>
              </article>
              <button type="button" className={styles.detailsToggle} aria-expanded={shotDetailsOpen} onClick={() => setShotDetailsOpen((current) => !current)}>{shotDetailsOpen ? "Ocultar detalles" : "Ver detalles"}</button>
            </section>
          )}

          {shotDetailsOpen && session && <div className={styles.shotDetails}>
            <div className={styles.statusRow}><div><b>{activeClubCount} golpe{activeClubCount === 1 ? "" : "s"} válido{activeClubCount === 1 ? "" : "s"} de {CLUB_LABELS[activeClub]}</b><p className={styles.subtle}>Puedes guardar con la información disponible; tres golpes son una recomendación, no un requisito.</p></div></div>
            <label className={styles.fullField}>Launch monitor o fuente (opcional)<input type="text" value={session.source ?? ""} maxLength={180} placeholder="Ej. TrackMan" onChange={(event) => updateSession((current) => ({ ...current, completedAt: null, source: event.target.value.trimStart() || null }))} /></label>
            <section aria-labelledby={`shot-details-${activeClub}`}>
                <h3 id={`shot-details-${activeClub}`}>{CLUB_LABELS[activeClub]}</h3>
                <div className={styles.shotList} aria-label={`Golpes de ${CLUB_LABELS[activeClub]}`}>
                {activeClubShots.map((shot, index) => {
                  const editing = editingShotId === shot.id;
                  return (
                    <article className={styles.shotEntry} key={shot.id}>
                      <div className={`${styles.shotRow} ${shot.excluded ? styles.archived : ""}`}>
                        <div>
                          <b>Golpe {index + 1}</b>
                          <p className={styles.subtle}>{shot.excluded ? "Excluido del cálculo" : "Incluido automáticamente"}</p>
                        </div>
                        {SHOT_SUMMARY_METRICS[activeClub].map((metric) => (
                          <div key={metric}>
                            <small>{METRIC_FIELDS[metric].shortLabel}</small>
                            <b>{displayMetric(shot[metric], metric)}</b>
                          </div>
                        ))}
                        <div className={styles.shotActions}>
                          <button type="button" className="secondary" aria-expanded={editing} onClick={() => setEditingShotId(editing ? null : shot.id)}>
                            {editing ? "Listo" : "Editar"}
                          </button>
                          <button
                            type="button"
                            className={styles.excludeButton}
                            aria-pressed={shot.excluded}
                            onClick={() => toggleShot(shot.id)}
                          >
                            {shot.excluded ? "Reactivar" : "Excluir"}
                          </button>
                        </div>
                      </div>
                      {editing && (
                        <div className={styles.shotEditGrid} aria-label={`Editar golpe ${index + 1}`}>
                          {CLUB_METRICS[activeClub].map((metric) => {
                            const field = METRIC_FIELDS[metric];
                            return (
                              <label key={metric}>
                                {field.shortLabel} ({field.unit})
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min={field.minimum}
                                  max={field.maximum}
                                  step={field.step}
                                  value={shot[metric] ?? ""}
                                  onChange={(event) => updateShotMetric(shot.id, metric, event.target.value)}
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </article>
                  );
                })}
                </div>
              </section>
          </div>}

          {clubSelected && activeClubCount > 0 && <section className={styles.captureSave} aria-label={`Guardar mediciones de ${CLUB_LABELS[activeClub]}`}>
            <button type="button" className="primary" onClick={saveCurrentClub}>Guardar mediciones</button>
            {!confirmClear ? (
              <button type="button" className={styles.dangerButton} onClick={() => setConfirmClear(true)}>Quitar mediciones de {CLUB_LABELS[activeClub]}</button>
            ) : (
              <div className={styles.inlineActions} role="group" aria-label={`Confirmar eliminación de ${CLUB_LABELS[activeClub]}`}>
                <button type="button" className="secondary" onClick={() => setConfirmClear(false)}>Conservar</button>
                <button type="button" className={styles.dangerButton} onClick={clearCurrentClub}>Sí, quitar</button>
              </div>
            )}
          </section>}

          {!clubSelected && <section className={styles.launchContinue} aria-label="Terminar Launch Monitor">
            <div><b>¿Listo con tus mediciones?</b><p>{includedShots > 0 ? `${includedShots} golpe${includedShots === 1 ? "" : "s"} válido${includedShots === 1 ? "" : "s"} guardado${includedShots === 1 ? "" : "s"}.` : "Este paso es opcional; puedes continuar sin agregar mediciones."}</p></div>
            <button type="button" className="primary" onClick={onDone} disabled={!onDone}>Continuar con Ball Fit <span aria-hidden="true">→</span></button>
          </section>}

          <p className={styles.disclaimer}>Estos datos complementan The Backyard Ball Fit. No constituyen un fitting oficial de ninguna marca ni sustituyen una sesión profesional.</p>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
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
import { ClubCategoryVisual } from "./equipment-visuals";

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

function nextProtocolClub(shots: LaunchMonitorShot[], currentClub: LaunchMonitorClub) {
  const currentIndex = LAUNCH_MONITOR_CLUBS.indexOf(currentClub);
  const orderedClubs = [
    ...LAUNCH_MONITOR_CLUBS.slice(currentIndex + 1),
    ...LAUNCH_MONITOR_CLUBS.slice(0, currentIndex + 1),
  ];
  return orderedClubs.find((club) => shots.filter((shot) => shot.club === club && !shot.excluded).length < 3) ?? currentClub;
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
  const progress = useMemo(() => session ? getLaunchMonitorProtocolProgress(session) : null, [session]);
  const summary = useMemo(() => session ? summarizeLaunchMonitorSession(session) : null, [session]);
  const [activeClub, setActiveClub] = useState<LaunchMonitorClub>("DRIVER");
  const [clubSelected, setClubSelected] = useState(false);
  const [analysisState, setAnalysisState] = useState<LaunchMonitorAnalysisState>("idle");
  const [drafts, setDrafts] = useState<Record<LaunchMonitorClub, ShotDraft>>(initialDrafts);
  const [errors, setErrors] = useState<Partial<Record<LaunchMonitorClub, string>>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [shotDetailsOpen, setShotDetailsOpen] = useState(false);
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [currentFlowStep, setCurrentFlowStep] = useState<1 | 2 | 3 | 4 | 5>(summary && summary.includedShots > 0 ? 4 : 1);

  function updateSession(update: (current: LaunchMonitorSession) => LaunchMonitorSession) {
    if (!session) return;
    onChange(update(session));
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
    const currentSession = session || { id: createId("launch-session"), userId: cleanUserId, source: null, startedAt: now, completedAt: null, shots: [] };
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
    onChange({ ...currentSession, completedAt: sessionCompletedAt(nextShots), shots: nextShots });
    setDrafts((current) => ({ ...current, [club]: emptyDraft() }));
    setErrors((current) => ({ ...current, [club]: undefined }));
    setManualOpen(false);
    setAnalysisState("applied");
    setCurrentFlowStep(4);
    if (nextShots.filter((candidate) => candidate.club === club && !candidate.excluded).length >= 3) {
      setActiveClub(nextProtocolClub(nextShots, club));
    }
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
  const missingShots = progress
    ? LAUNCH_MONITOR_CLUBS.reduce((total, club) => total + progress.missing[club], 0)
    : 12;
  const analysisMessage = analysisState === "analyzing"
    ? "Estamos leyendo y validando las mediciones de tus fotos."
    : analysisState === "review"
      ? "Encontramos una lectura dudosa. Corrige sólo los datos marcados."
      : analysisState === "applied"
        ? "Las mediciones válidas ya se aplicaron al resumen."
        : analysisState === "error"
          ? "No pudimos completar el análisis. Revisa el mensaje anterior e intenta de nuevo."
          : "Al elegir Analizar fotos, leeremos las mediciones y aplicaremos automáticamente los datos claros.";

  return (
    <section className={styles.launchSection}>
      <p className={styles.subtle} id="launch-monitor-help">
        TrackMan, FlightScope, Garmin, GCQuad, Rapsodo u otro. Los datos claros se agregan automáticamente; sólo te pediremos corregir una lectura dudosa.
      </p>

      <div className={styles.captureFlow} aria-label="Flujo de mediciones">
        {["Palo", "Fotos", "Análisis", "Resumen", "Guardar"].map((label, index) => <span key={label} className={currentFlowStep === index + 1 ? styles.captureFlowActive : ""}><b>{index + 1}</b>{label}</span>)}
      </div>

      <section className={styles.clubCaptureSelector} data-capture-order="1" aria-labelledby="club-capture-title">
        <div><span>PASO 1</span><h3 id="club-capture-title">Selecciona tu palo</h3><p>Elige primero. Todas las lecturas de este bloque se asignarán a ese palo.</p></div>
        <div className={styles.clubChoiceGrid} aria-label="Selecciona el palo de las mediciones">
          {LAUNCH_MONITOR_CLUBS.map((club) => {
            const count = progress?.counts[club] ?? 0;
            const excluded = session?.shots.filter((shot) => shot.club === club && shot.excluded).length ?? 0;
            const selected = clubSelected && activeClub === club;
            return <button type="button" key={club} className={selected ? styles.clubChoiceSelected : styles.clubChoice} aria-pressed={selected} onClick={() => { setActiveClub(club); setClubSelected(true); setAnalysisState("idle"); setCurrentFlowStep(2); }}>
              <span className={styles.clubChoiceVisual}><ClubCategoryVisual category={CLUB_VISUALS[club]} showBranding={false} /></span>
              <span><b>{CLUB_LABELS[club]}</b><small>{Math.min(count, 3)}/3 golpes válidos{excluded ? ` · ${excluded} excluido${excluded === 1 ? "" : "s"}` : ""}</small></span>
              <strong aria-hidden="true">{selected ? "✓" : "›"}</strong>
            </button>;
          })}
        </div>
      </section>

      {clubSelected && <><div className={styles.captureStage} data-capture-order="2"><div className={styles.captureStageHeading}><span>PASO 2</span><h3>Fotos de {CLUB_LABELS[activeClub]}</h3></div><LaunchMonitorCamera
        key={`launch-camera-${activeClub}`}
        userId={userId}
        accessToken={accessToken}
        requiresRemoteConsent={requiresRemoteConsent}
        onOpenPrivacy={onOpenPrivacy}
        targetClub={activeClub}
        capturedCount={progress?.counts[activeClub] ?? 0}
        nextClubLabel={CLUB_LABELS[nextProtocolClub(session?.shots ?? [], activeClub)]}
        onAnalysisStateChange={(state) => { setAnalysisState(state); setCurrentFlowStep(state === "idle" ? 2 : state === "applied" ? 4 : 3); }}
        onConfirm={(source, shots) => {
          const now = new Date().toISOString();
          const current = session || { id: createId("launch-session"), userId: userId.trim(), source: null, startedAt: now, completedAt: null, shots: [] };
          const nextShots = [...current.shots, ...shots].slice(0, MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB * LAUNCH_MONITOR_CLUBS.length);
          onChange({ ...current, source: source || current.source, completedAt: sessionCompletedAt(nextShots), shots: nextShots });
          setActiveClub(nextProtocolClub(nextShots, activeClub));
          setClubSelected(true);
          setCurrentFlowStep(4);
        }}
      /></div>

      <section className={styles.captureAnalysis} data-capture-order="3" aria-live="polite">
        <div className={styles.captureStageHeading}><span>PASO 3</span><h3>Análisis automático</h3></div>
        <p>{analysisMessage}</p>
      </section>

      <button type="button" className={styles.manualCaptureToggle} aria-expanded={manualOpen} onClick={() => setManualOpen((current) => !current)}>
        <span><b>Capturar datos manualmente</b><small>Sólo si no quieres usar fotos</small></span><strong aria-hidden="true">{manualOpen ? "−" : "+"}</strong>
      </button>

      {manualOpen && <section className={styles.manualCapturePanel} aria-labelledby={`capture-${activeClub}`}>
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
          </section>}</>}

          {summary && summary.includedShots > 0 && (
            <section className={styles.captureSummary} data-capture-order="4" aria-labelledby="launch-summary-title">
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.captureSummaryStep}>PASO 4</span><h2 id="launch-summary-title">Mediciones aplicadas</h2>
                  <p>{summary.includedShots} golpe{summary.includedShots === 1 ? "" : "s"} válido{summary.includedShots === 1 ? "" : "s"} detectado{summary.includedShots === 1 ? "" : "s"}. El detalle permanece cerrado.</p>
                </div>
              </div>
              <div className={styles.launchGrid}>
                {summary.byClub.filter((clubSummary) => clubSummary.includedShots > 0).map((clubSummary) => (
                  <article className={styles.launchCard} key={clubSummary.club}>
                    <div className={styles.launchCardTitle}><span className={styles.clubChoiceVisual}><ClubCategoryVisual category={CLUB_VISUALS[clubSummary.club]} showBranding={false} /></span><span><h4>{CLUB_LABELS[clubSummary.club]}</h4><p>{clubSummary.includedShots} golpe{clubSummary.includedShots === 1 ? "" : "s"} válido{clubSummary.includedShots === 1 ? "" : "s"}</p></span></div>
                    <div className={styles.launchMetricGrid}>
                      {(["carryYards", "ballSpeedMph", "launchAngleDegrees", "spinRpm"] as LaunchMonitorMetric[]).map((metric) => {
                        const metricSummary = clubSummary.metrics[metric];
                        return <span key={metric}><small>{METRIC_FIELDS[metric].shortLabel}</small><b>{metricSummary ? summaryMetric(metricSummary.median, metric) : "—"}</b></span>;
                      })}
                    </div>
                  </article>
                ))}
              </div>
              <button type="button" className={styles.detailsToggle} aria-expanded={shotDetailsOpen} onClick={() => setShotDetailsOpen((current) => !current)}>{shotDetailsOpen ? "Ocultar detalles" : "Ver detalles"}</button>
            </section>
          )}

          {shotDetailsOpen && session && <div className={styles.shotDetails}>
            <div className={styles.statusRow}><div><b>{progress?.complete ? "Protocolo completo" : `${includedShots} de 12 golpes recomendados`}</b><p className={styles.subtle}>{progress?.complete ? "Ya tienes 3 golpes válidos por palo." : `Faltan ${missingShots}; puedes guardar una captura parcial.`}</p></div></div>
            <label className={styles.fullField}>Launch monitor o fuente (opcional)<input type="text" value={session.source ?? ""} maxLength={180} placeholder="Ej. TrackMan" onChange={(event) => updateSession((current) => ({ ...current, completedAt: null, source: event.target.value.trimStart() || null }))} /></label>
            {LAUNCH_MONITOR_CLUBS.map((club) => {
              const clubShots = session.shots.filter((shot) => shot.club === club);
              if (clubShots.length === 0) return null;
              return <section key={club} aria-labelledby={`shot-details-${club}`}>
                <h3 id={`shot-details-${club}`}>{CLUB_LABELS[club]}</h3>
                <div className={styles.shotList} aria-label={`Golpes de ${CLUB_LABELS[club]}`}>
                {clubShots.map((shot, index) => {
                  const editing = editingShotId === shot.id;
                  return (
                    <article className={styles.shotEntry} key={shot.id}>
                      <div className={`${styles.shotRow} ${shot.excluded ? styles.archived : ""}`}>
                        <div>
                          <b>Golpe {index + 1}</b>
                          <p className={styles.subtle}>{shot.excluded ? "Excluido del cálculo" : "Incluido automáticamente"}</p>
                        </div>
                        {SHOT_SUMMARY_METRICS[club].map((metric) => (
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
                          {CLUB_METRICS[club].map((metric) => {
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
              </section>;
            })}
          </div>}

          <section className={styles.captureSave} data-capture-order="5" aria-labelledby="launch-save-title" onFocusCapture={() => { if (includedShots > 0) setCurrentFlowStep(5); }}>
            <div className={styles.captureStageHeading}><span>PASO 5</span><h3 id="launch-save-title">Guardar y continuar</h3></div>
            <div className={styles.wizardActions}>
            <button type="button" className="primary" onClick={onDone} disabled={!onDone || includedShots === 0}>Guardar y continuar</button>
            {!confirmClear ? (
              session && <button type="button" className={styles.dangerButton} onClick={() => setConfirmClear(true)}>Quitar captura</button>
            ) : (
              <div className={styles.inlineActions} role="group" aria-label="Confirmar eliminación de la captura">
                <button type="button" className="secondary" onClick={() => setConfirmClear(false)}>Conservar</button>
                <button type="button" className={styles.dangerButton} onClick={() => { setConfirmClear(false); setAnalysisState("idle"); setCurrentFlowStep(1); setShotDetailsOpen(false); onChange(null); }}>Sí, quitar</button>
              </div>
            )}
          </div>
          </section>
          <p className={styles.disclaimer}>Estos datos complementan The Backyard Ball Fit. No constituyen un fitting oficial de ninguna marca ni sustituyen una sesión profesional.</p>
    </section>
  );
}

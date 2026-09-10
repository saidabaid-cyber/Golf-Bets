"use client";

import { useMemo, useState } from "react";
import {
  LAUNCH_MONITOR_CLUBS,
  MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB,
  getLaunchMonitorProtocolProgress,
  summarizeLaunchMonitorSession,
  type LaunchMonitorClub,
  type LaunchMonitorMetric,
  type LaunchMonitorSession,
  type LaunchMonitorShot,
} from "../../lib/golf-equipment";
import styles from "./equipment.module.css";
import { LaunchMonitorCamera } from "./launch-monitor-camera";

type LaunchMonitorCaptureProps = {
  userId: string;
  accessToken?: string | null;
  requiresRemoteConsent?: boolean;
  value: LaunchMonitorSession | null;
  onChange: (session: LaunchMonitorSession | null) => void;
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
  PITCHING_WEDGE: "Pitching wedge",
  HALF_WEDGE: "Half wedge / approach",
};

const METRIC_FIELDS: Record<LaunchMonitorMetric, MetricField> = {
  clubSpeedMph: { metric: "clubSpeedMph", label: "Velocidad del palo", shortLabel: "Palo", unit: "mph", minimum: 0, maximum: 250, step: 0.1 },
  ballSpeedMph: { metric: "ballSpeedMph", label: "Velocidad de bola", shortLabel: "Bola", unit: "mph", minimum: 0, maximum: 300, step: 0.1 },
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

export function LaunchMonitorCapture({ userId, accessToken, requiresRemoteConsent = false, value, onChange }: LaunchMonitorCaptureProps) {
  const session = useMemo(
    () => value?.userId === userId.trim() ? value : null,
    [userId, value],
  );
  const progress = useMemo(() => session ? getLaunchMonitorProtocolProgress(session) : null, [session]);
  const summary = useMemo(() => session ? summarizeLaunchMonitorSession(session) : null, [session]);
  const [activeClub, setActiveClub] = useState<LaunchMonitorClub>("DRIVER");
  const [drafts, setDrafts] = useState<Record<LaunchMonitorClub, ShotDraft>>(initialDrafts);
  const [errors, setErrors] = useState<Partial<Record<LaunchMonitorClub, string>>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(Boolean(session));

  function startCapture() {
    const cleanUserId = userId.trim();
    if (!cleanUserId) return;
    const now = new Date().toISOString();
    onChange({
      id: createId("launch-session"),
      userId: cleanUserId,
      source: null,
      startedAt: now,
      completedAt: null,
      shots: [],
    });
  }

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
    if (!session) return;
    if (session.shots.filter((shot) => shot.club === club).length >= MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB) {
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

    const now = new Date().toISOString();
    const shot: LaunchMonitorShot = {
      id: createId("launch-shot"),
      club,
      excluded: false,
      capturedAt: now,
      note: draft.note.trim() || null,
      ...metrics,
    };
    onChange({ ...session, completedAt: null, shots: [...session.shots, shot] });
    setDrafts((current) => ({ ...current, [club]: emptyDraft() }));
    setErrors((current) => ({ ...current, [club]: undefined }));
  }

  function toggleShot(shotId: string) {
    updateSession((current) => ({
      ...current,
      completedAt: null,
      shots: current.shots.map((shot) => shot.id === shotId ? { ...shot, excluded: !shot.excluded } : shot),
    }));
  }

  const activeShots = session?.shots.filter((shot) => shot.club === activeClub) ?? [];
  const includedShots = session?.shots.filter((shot) => !shot.excluded).length ?? 0;
  const missingShots = progress
    ? LAUNCH_MONITOR_CLUBS.reduce((total, club) => total + progress.missing[club], 0)
    : 12;

  return (
    <details
      className={styles.launchSection}
      open={detailsOpen}
      onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
    >
      <summary>Fitting con launch monitor</summary>
      <p className={styles.subtle} id="launch-monitor-help">
        Si ya tienes datos de TrackMan, FlightScope, Garmin u otro launch monitor, usa cámara o captura manual. Nada se guarda hasta que revises y confirmes.
      </p>

      <LaunchMonitorCamera
        userId={userId}
        accessToken={accessToken}
        requiresRemoteConsent={requiresRemoteConsent}
        onConfirm={(source, shots) => {
          const now = new Date().toISOString();
          const current = session || { id: createId("launch-session"), userId: userId.trim(), source: null, startedAt: now, completedAt: null, shots: [] };
          onChange({ ...current, source: source || current.source, completedAt: null, shots: [...current.shots, ...shots].slice(0, MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB * LAUNCH_MONITOR_CLUBS.length) });
        }}
      />

      <div className={styles.manualDivider}><span>o captura manualmente</span></div>

      {!session ? (
        <div className={styles.fitIntro}>
          <h3>Agrega tus mediciones</h3>
          <p>Protocolo orientativo: 3 golpes válidos de half wedge, pitching wedge, hierro 7 y driver. Puedes guardar una captura parcial.</p>
          <div className={styles.inlineActions}>
            <button type="button" className="secondary" onClick={startCapture} disabled={!userId.trim()}>
              Iniciar captura
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.stack} aria-describedby="launch-monitor-help">
          <div className={styles.statusRow}>
            <div>
              <b>{progress?.complete ? "Protocolo completo" : `${includedShots} de 12 golpes recomendados`}</b>
              <p className={styles.subtle} role="status">
                {progress?.complete ? "Ya tienes 3 golpes válidos por palo." : `Faltan ${missingShots}; puedes terminar y guardar antes si lo prefieres.`}
              </p>
            </div>
            {session.completedAt && <span className={styles.currentBadge}>Captura terminada</span>}
          </div>

          <label className={styles.fullField}>
            Launch monitor o fuente (opcional)
            <input
              type="text"
              value={session.source ?? ""}
              maxLength={180}
              placeholder="Ej. TrackMan, FlightScope, Garmin u otro"
              onChange={(event) => updateSession((current) => ({ ...current, completedAt: null, source: event.target.value.trimStart() || null }))}
            />
          </label>

          <div className={styles.launchGrid} aria-label="Progreso por palo">
            {LAUNCH_MONITOR_CLUBS.map((club) => {
              const count = progress?.counts[club] ?? 0;
              const excluded = session.shots.filter((shot) => shot.club === club && shot.excluded).length;
              const selected = activeClub === club;
              return (
                <button
                  type="button"
                  key={club}
                  className={`${styles.launchCard} ${styles.optionButton} ${selected ? styles.selected : ""}`}
                  aria-pressed={selected}
                  onClick={() => setActiveClub(club)}
                >
                  <h4>{CLUB_LABELS[club]}</h4>
                  <p>{Math.min(count, 3)}/3 válidos{count > 3 ? ` · ${count} totales` : ""}</p>
                  {excluded > 0 && <p>{excluded} excluido{excluded === 1 ? "" : "s"}</p>}
                </button>
              );
            })}
          </div>

          <section className={styles.equipmentItem} aria-labelledby={`capture-${activeClub}`}>
            <div className={styles.itemHeader}>
              <div>
                <h3 id={`capture-${activeClub}`}>Nuevo golpe · {CLUB_LABELS[activeClub]}</h3>
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
                <button type="button" className="primary" onClick={() => addShot(activeClub)}>Guardar golpe</button>
              </div>
            </div>

            {activeShots.length === 0 ? (
              <div className={styles.emptyState}>
                <b>Aún no hay golpes de {CLUB_LABELS[activeClub].toLocaleLowerCase("es-MX")}</b>
                <p>Agrega uno o más. Si un golpe fue claramente malo, podrás excluirlo sin borrarlo.</p>
              </div>
            ) : (
              <div className={styles.shotList} aria-label={`Golpes de ${CLUB_LABELS[activeClub]}`}>
                {activeShots.map((shot, index) => (
                  <div className={`${styles.shotRow} ${shot.excluded ? styles.archived : ""}`} key={shot.id}>
                    <div>
                      <b>Golpe {index + 1}</b>
                      <p className={styles.subtle}>{shot.excluded ? "Excluido del cálculo" : "Incluido"}</p>
                    </div>
                    {SHOT_SUMMARY_METRICS[activeClub].map((metric) => (
                      <div key={metric}>
                        <small>{METRIC_FIELDS[metric].shortLabel}</small>
                        <b>{displayMetric(shot[metric], metric)}</b>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="secondary"
                      aria-pressed={shot.excluded}
                      onClick={() => toggleShot(shot.id)}
                    >
                      {shot.excluded ? "Reactivar" : "Excluir"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {summary && summary.includedShots > 0 && (
            <section aria-labelledby="launch-summary-title">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 id="launch-summary-title">Resumen de mediciones</h2>
                  <p>La mediana y el promedio resistente reducen el efecto de valores extremos. Los golpes excluidos no participan.</p>
                </div>
              </div>
              <div className={styles.launchGrid}>
                {summary.byClub.filter((clubSummary) => clubSummary.includedShots > 0).map((clubSummary) => (
                  <article className={styles.launchCard} key={clubSummary.club}>
                    <h4>{CLUB_LABELS[clubSummary.club]}</h4>
                    <p>{clubSummary.includedShots} golpe{clubSummary.includedShots === 1 ? "" : "s"} válido{clubSummary.includedShots === 1 ? "" : "s"}</p>
                    <div className={styles.verifiedFacts}>
                      {CLUB_METRICS[clubSummary.club].flatMap((metric) => {
                        const metricSummary = clubSummary.metrics[metric];
                        if (!metricSummary) return [];
                        return [
                          <span key={metric}>
                            {METRIC_FIELDS[metric].shortLabel}
                            <b>Med. {summaryMetric(metricSummary.median, metric)}</b>
                            <small>Res. {summaryMetric(metricSummary.resistantAverage, metric)}</small>
                          </span>,
                        ];
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className={styles.wizardActions}>
            <button
              type="button"
              className="secondary"
              disabled={includedShots === 0}
              onClick={() => updateSession((current) => ({ ...current, completedAt: new Date().toISOString() }))}
            >
              {progress?.complete ? "Terminar captura" : "Guardar captura parcial"}
            </button>
            {!confirmClear ? (
              <button type="button" className={styles.dangerButton} onClick={() => setConfirmClear(true)}>Quitar captura</button>
            ) : (
              <div className={styles.inlineActions} role="group" aria-label="Confirmar eliminación de la captura">
                <button type="button" className="secondary" onClick={() => setConfirmClear(false)}>Conservar</button>
                <button type="button" className={styles.dangerButton} onClick={() => { setConfirmClear(false); onChange(null); }}>Sí, quitar</button>
              </div>
            )}
          </div>
          <p className={styles.disclaimer}>Estos datos complementan The Backyard Ball Fit. No constituyen un fitting oficial de ninguna marca ni sustituyen una sesión profesional.</p>
        </div>
      )}
    </details>
  );
}

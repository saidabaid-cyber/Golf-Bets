"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Course } from "../../lib/types";
import { roundTeeSelectionId, teeCategoryLabel, scorecardProfileLabel, scorecardProfilesForCards } from "../../lib/course-scorecard-profiles";
import styles from "./round-tee-picker.module.css";

function fact(value: number | undefined, suffix = "") {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString("es-MX")}${suffix}` : null;
}

export function RoundTeePicker({
  courseName,
  tees,
  selectedTeeId,
  onSelect,
  onBack,
  onMissingTee,
}: {
  courseName: string;
  tees: readonly Course[];
  selectedTeeId: string;
  onSelect: (tee: Course) => void;
  onBack: () => void;
  onMissingTee: () => void;
}) {
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const profiles = useMemo(() => scorecardProfilesForCards(tees), [tees]);
  const selectedProfile = tees.find((tee) => roundTeeSelectionId(tee) === selectedTeeId)?.scorecardProfileId;
  const [profileId, setProfileId] = useState(selectedProfile || profiles[0]?.id || "");
  useEffect(() => { setProfileId(selectedProfile || profiles[0]?.id || ""); }, [courseName, profiles, selectedProfile]);
  const visibleTees = profiles.length > 1 ? profiles.find((profile) => profile.id === profileId)?.cards ?? [] : tees;
  const releaseTimer = useRef<number | null>(null);
  useEffect(() => () => { if (releaseTimer.current !== null) window.clearTimeout(releaseTimer.current); }, []);
  function selectOnce(tee: Course) {
    if (transitioningId) return;
    const id = roundTeeSelectionId(tee);
    setTransitioningId(id);
    onSelect(tee);
    releaseTimer.current = window.setTimeout(() => setTransitioningId(null), 600);
  }
  return <section className={styles.panel} aria-labelledby="round-tee-title">
    <button type="button" className={styles.back} onClick={onBack}>← Recorridos del campo</button>
    <span className={styles.eyebrow}>CAMPO SELECCIONADO</span>
    <h3 id="round-tee-title">{profiles.length > 1 ? "Configuración y tee" : "Tee de salida"}</h3>
    <p>{courseName}</p>
    {profiles.length > 1 && <div className={styles.profiles} role="group" aria-label="Configuración de scorecard">
      <span>Configuración</span>
      {profiles.map((profile) => <button type="button" key={profile.id} className={profile.id === profileId ? styles.profileSelected : ""} aria-pressed={profile.id === profileId} onClick={() => setProfileId(profile.id)}>
        <b>{scorecardProfileLabel(profile)}</b>
        <small>{profile.id === profiles.find(row => row.defaultForPlay)?.id ? "Predeterminada para jugar" : "Alternativa disponible"}</small>
      </button>)}
    </div>}
    <div className={styles.grid}>
      {visibleTees.map((tee) => {
        const id = roundTeeSelectionId(tee);
        const selected = id === selectedTeeId;
        const facts = [
          fact(tee.totalYards, " yd"),
          fact(tee.rating) ? `Rating ${fact(tee.rating)}` : null,
          fact(tee.slope) ? `Slope ${fact(tee.slope)}` : null,
        ].filter(Boolean);
        return <button type="button" disabled={transitioningId !== null} className={selected ? styles.selected : ""} aria-pressed={selected} key={id} onClick={() => selectOnce(tee)}>
          <span>{tee.teeName || "Tee"} · {teeCategoryLabel(tee)}</span>
          <b>{facts.length ? facts.join(" · ") : "Datos de salida no publicados"}</b>
          {tee.ghinPostEligible === false && <small>No disponible para publicación GHIN</small>}
          <strong>{transitioningId === id ? "Abriendo…" : selected ? "Seleccionado ✓" : "Elegir"}</strong>
        </button>;
      })}
    </div>
    {!visibleTees.length && <p className={styles.empty} role="status">Esta configuración todavía no tiene tees publicados.</p>}
    <button type="button" className={styles.missing} onClick={onMissingTee}>¿Falta un tee? Solicitar tee</button>
  </section>;
}

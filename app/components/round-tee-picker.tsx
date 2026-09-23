"use client";

import type { Course } from "../../lib/types";
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
  return <section className={styles.panel} aria-labelledby="round-tee-title">
    <button type="button" className={styles.back} onClick={onBack}>← Cambiar campo</button>
    <span className={styles.eyebrow}>CAMPO SELECCIONADO</span>
    <h3 id="round-tee-title">Tee de salida</h3>
    <p>{courseName}</p>
    <div className={styles.grid}>
      {tees.map((tee) => {
        const id = tee.catalogTeeId || tee.id;
        const selected = id === selectedTeeId;
        const facts = [
          fact(tee.totalYards, " yd"),
          fact(tee.rating) ? `Rating ${fact(tee.rating)}` : null,
          fact(tee.slope) ? `Slope ${fact(tee.slope)}` : null,
        ].filter(Boolean);
        return <button type="button" className={selected ? styles.selected : ""} aria-pressed={selected} key={id} onClick={() => onSelect(tee)}>
          <span>{tee.teeName || "Tee"}</span>
          <b>{facts.length ? facts.join(" · ") : "Datos de salida no publicados"}</b>
          <strong>{selected ? "Seleccionado ✓" : "Elegir"}</strong>
        </button>;
      })}
    </div>
    {!tees.length && <p className={styles.empty} role="status">Este campo todavía no tiene tees publicados.</p>}
    <button type="button" className={styles.missing} onClick={onMissingTee}>¿Falta un tee? Solicitar tee</button>
  </section>;
}

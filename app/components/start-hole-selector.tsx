"use client";

import styles from "./start-hole-selector.module.css";

const DEFAULT_HOLES = Array.from({ length: 18 }, (_, index) => index + 1);

export function StartHoleSelector({
  value,
  onChange,
  holes = DEFAULT_HOLES,
  disabled = false,
  label = "Hoyo inicial",
}: {
  value: number;
  onChange: (hole: number) => void;
  holes?: readonly number[];
  disabled?: boolean;
  label?: string;
}) {
  const availableHoles = [...new Set(holes.filter((hole) => Number.isInteger(hole) && hole > 0 && hole <= 18))].sort((left, right) => left - right);
  const choices = availableHoles.length ? availableHoles : DEFAULT_HOLES;
  return <fieldset className={styles.fieldset} disabled={disabled}>
    <legend>{label}</legend>
    <div className={styles.rail} role="radiogroup" aria-label={label}>
      {choices.map((hole) => <button
        type="button"
        role="radio"
        aria-checked={value === hole}
        className={value === hole ? styles.selected : ""}
        key={hole}
        onClick={() => onChange(hole)}
      >{hole}</button>)}
    </div>
    <small>La tarjeta seguirá el orden desde H{value} y hará una sola vuelta después del 18.</small>
  </fieldset>;
}

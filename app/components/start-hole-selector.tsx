"use client";

import styles from "./start-hole-selector.module.css";

const HOLES = Array.from({ length: 18 }, (_, index) => index + 1);

export function StartHoleSelector({
  value,
  onChange,
  disabled = false,
  label = "Hoyo inicial",
}: {
  value: number;
  onChange: (hole: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  return <fieldset className={styles.fieldset} disabled={disabled}>
    <legend>{label}</legend>
    <div className={styles.rail} role="radiogroup" aria-label={label}>
      {HOLES.map((hole) => <button
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

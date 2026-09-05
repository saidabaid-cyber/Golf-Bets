"use client";

import type { RoundHandicapBasis } from "../../lib/types";

const explanations: Record<RoundHandicapBasis, string> = {
  course: "Cada jugador recibe los golpes de su HCP según la ventaja de cada hoyo. No se resta un jugador base.",
  relative: "Se toma como base el menor HCP de los participantes de cada apuesta y se calculan las diferencias.",
};

export function RoundHandicapBasisControl({ value, onChange }: {
  value: RoundHandicapBasis;
  onChange: (value: RoundHandicapBasis) => void;
}) {
  return <div className="roundHandicapBasisControl">
    <span className="miniLabel" id="round-handicap-basis-label">Aplicación del HCP</span>
    <div className="handicapBaseChoices" role="group" aria-labelledby="round-handicap-basis-label">
      <button type="button" aria-pressed={value === "course"} onClick={() => onChange("course")}>Ventajas sobre el campo</button>
      <button type="button" aria-pressed={value === "relative"} onClick={() => onChange("relative")}>Ventajas entre jugadores</button>
    </div>
    <p aria-live="polite">{explanations[value]}</p>
    <small>Cambiar esta opción recalcula las apuestas de la ronda que usan HCP.</small>
  </div>;
}

"use client";

import type { RoundHandicapBasis } from "../../lib/types";

const explanations: Record<RoundHandicapBasis, string> = {
  course: "Cada jugador recibe los golpes que le corresponden según su HCP de juego, campo y tee.",
  relative: "Los golpes se reparten según la diferencia entre los HCP de juego de los jugadores.",
};

export function RoundHandicapBasisControl({ value, onChange, disabled = false }: {
  value: RoundHandicapBasis;
  onChange: (value: RoundHandicapBasis) => void;
  disabled?: boolean;
}) {
  return <div className="roundHandicapBasisControl">
    <h3>¿Cómo aplicamos el HCP?</h3>
    <div className="groupHcpBasisChoices" role="group" aria-label="¿Cómo aplicamos el HCP?">
      {(["relative", "course"] as const).map((basis) => <button type="button" key={basis} disabled={disabled} aria-pressed={value === basis} onClick={() => onChange(basis)}>
        <span aria-hidden="true">{value === basis ? "✓" : "○"}</span><span><b>{basis === "relative" ? "DIFERENCIAL" : "COMPLETO"}</b><small>{basis === "relative" ? "Entre jugadores" : "Contra el campo"}</small><small>{explanations[basis]}</small></span>
      </button>)}
    </div>
    <details className="handicapBasisHelp"><summary>Ayuda sobre HCP</summary><p>En Diferencial, el jugador con menor HCP es la referencia. Los demás reciben únicamente la diferencia. Por ejemplo, HCP de juego 5 y 15: el segundo recibe 10 golpes.</p><p>En Completo, cada jugador recibe su HCP de juego completo. Esta elección es independiente de Base fija / móvil, del redondeo y del porcentaje aplicado a cada apuesta.</p></details>
  </div>;
}

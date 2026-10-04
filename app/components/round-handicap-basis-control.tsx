"use client";

import type { RoundHandicapBasis } from "../../lib/types";
import { HANDICAP_BASIS_LABELS } from "../../lib/group-template-editor";

const explanations: Record<RoundHandicapBasis, string> = {
  course: "Cada jugador utiliza su HCP de juego completo según el campo y tee.",
  relative: "Los golpes se calculan por diferencia respecto al HCP de juego más bajo del grupo.",
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
        <span aria-hidden="true">{value === basis ? "✓" : "○"}</span><span><b>{HANDICAP_BASIS_LABELS[basis]}</b><small>{explanations[basis]}</small><small>{basis === "relative" ? "HCP 5 vs HCP 15 → recibe 10 golpes." : "HCP de juego 15 → recibe sus 15 golpes."}</small></span>
      </button>)}
    </div>
  </div>;
}

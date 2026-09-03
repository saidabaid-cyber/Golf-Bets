"use client";

import type { HandicapBaseConfig } from "../../lib/types";

export function HandicapBaseControl({ name, config, fallback, onChange }: {
  name: string;
  config: HandicapBaseConfig;
  fallback: "fixed" | "moving";
  onChange: (mode: "fixed" | "moving") => void;
}) {
  const mode = config.baseMode ?? fallback;
  return <div className="handicapBaseControl">
    <span className="miniLabel">Base de HCP</span>
    <div className="handicapBaseRow">
      <div className="handicapBaseChoices" role="group" aria-label={`${name}: base de HCP`}>
        <button type="button" aria-pressed={mode === "fixed"} onClick={() => { if (config.baseMode !== "fixed") onChange("fixed"); }}>Base fija</button>
        <button type="button" aria-pressed={mode === "moving"} onClick={() => { if (config.baseMode !== "moving") onChange("moving"); }}>Base movible</button>
      </div>
      <details className="handicapBaseHelp">
        <summary aria-label={`Ayuda de base de HCP · ${name}`}>?</summary>
        <div><b>Base fija</b><p>Las ventajas usan la base de menor HCP al confirmar la configuración. Esa referencia se mantiene durante la ronda, aunque cambien las parejas o alguien descanse.</p>
          <b>Base movible</b><p>Se recalcula con el menor HCP entre quienes participan en ese hoyo o match. El jugador que descansa no interviene.</p>
          <p>Si descansa Daniel (0), Said (8), Tamayo (9), Juan (13) y Flavio (14) quedan con 0, 1, 5 y 6. En SI 6, al 100% de HCP, solo Flavio recibe un golpe.</p></div>
      </details>
    </div>
    {mode === "fixed" && config.fixedBaseHandicap !== undefined && <small>Referencia conservada: HCP {config.fixedBaseHandicap}</small>}
  </div>;
}

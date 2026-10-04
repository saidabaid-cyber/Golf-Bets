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
    <span className="miniLabel">Base del juego</span>
    <div className="handicapBaseRow">
      <div className="handicapBaseChoices" role="group" aria-label={`${name}: base del juego`}>
        <button type="button" aria-pressed={mode === "fixed"} onClick={() => { if (config.baseMode !== "fixed") onChange("fixed"); }}>Base fija</button>
        <button type="button" aria-pressed={mode === "moving"} onClick={() => { if (config.baseMode !== "moving") onChange("moving"); }}>Base móvil</button>
      </div>
      <details className="handicapBaseHelp">
        <summary aria-label={`Ayuda de base del juego · ${name}`}>?</summary>
        <div><b>Base fija</b><p>La referencia de HCP se mantiene durante toda la ronda.</p>
          <b>Base móvil</b><p>La referencia se recalcula usando el HCP más bajo de quienes participan en ese hoyo. Quien descansa no cuenta.</p></div>
      </details>
    </div>
    {mode === "fixed" && config.fixedBaseHandicap !== undefined && <small>Referencia conservada: HCP {config.fixedBaseHandicap}</small>}
  </div>;
}

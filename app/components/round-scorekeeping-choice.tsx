"use client";
export function RoundScorekeepingChoice({ mode = "owner", onChange }: { mode?: "owner" | "self"; onChange?: (mode: "owner" | "self") => void }) {
  return <fieldset className="card"><legend>¿Quién llevará los scores?</legend>
    <label><input type="radio" name="shared-scorekeeping" value="self" checked={mode === "self"} onChange={() => onChange?.("self")} /> CADA JUGADOR EN SU TELÉFONO</label>
    <p className="hint">Cada cuenta vinculada guarda su propia tarjeta en la misma ronda. El organizador lleva a los invitados sin cuenta.</p>
    <label><input type="radio" name="shared-scorekeeping" value="owner" checked={mode === "owner"} onChange={() => onChange?.("owner")} /> YO LLEVO TODOS LOS SCORES</label>
    <p className="hint">Registraré los resultados de todos desde este dispositivo. Cada cuenta vinculada revisará su tarjeta al terminar.</p>
  </fieldset>;
}

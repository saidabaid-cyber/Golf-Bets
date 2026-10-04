"use client";
export function RoundScorekeepingChoice() {
  return <fieldset className="card"><legend>¿Quién llevará los scores?</legend>
    <label><input type="radio" name="shared-scorekeeping" value="self" disabled /> CADA JUGADOR EN SU TELÉFONO</label>
    <p className="hint">La captura compartida desde varios dispositivos todavía no está disponible.</p>
    <label><input type="radio" name="shared-scorekeeping" value="owner" checked readOnly /> YO LLEVO TODOS LOS SCORES</label>
    <p className="hint">Registraré los resultados de todos desde este dispositivo. Cada cuenta vinculada revisará su tarjeta al terminar.</p>
  </fieldset>;
}

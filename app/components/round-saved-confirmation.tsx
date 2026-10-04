"use client";
import type { RoundSnapshot } from "../../lib/types";
import { RoundParticipationCard } from "./round-participation-card";

export function RoundSavedConfirmation({ round, accessToken, onView, onPlay, onGroups }: {
  round: RoundSnapshot; accessToken?: string; onView: () => void; onPlay: () => void; onGroups: () => void;
}) {
  return <div className="historicalDetail"><section className="card" aria-labelledby="round-saved-title">
    <span className="eyebrow">RONDA COMPLETADA</span><h1 id="round-saved-title">¡Ronda guardada!</h1><p>{round.courseName}{round.groupOrigin && ` · ${round.groupOrigin.groupName}`}</p>
    <ul><li>Tu ronda quedó guardada en este dispositivo.</li><li>Las apuestas quedaron calculadas.</li><li>Los jugadores vinculados recibirán su tarjeta al confirmarse la sincronización.</li><li>Los participantes pendientes podrán revisarla antes de incorporarla a sus estadísticas.</li></ul>
    <div className="dialogActions"><button type="button" className="primary" onClick={onView}>VER RONDA</button><button type="button" className="secondary" onClick={onPlay}>VOLVER A JUGAR</button><button type="button" className="secondary" onClick={onGroups}>IR A MIS GRUPOS</button></div>
  </section>{accessToken && <RoundParticipationCard accessToken={accessToken} localRoundId={round.id} />}</div>;
}

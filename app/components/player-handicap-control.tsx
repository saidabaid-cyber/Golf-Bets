"use client";

import type { Player } from "../../lib/types";
import { canEditGuestHandicap, playerHandicapSourceLabel } from "../../lib/player-handicap-edit";
import { NumericCaptureInput } from "./numeric-capture-input";

export function PlayerHandicapControl({ player, onChange, onResolve }: {
  player: Pick<Player, "name" | "handicap" | "accountUserId" | "handicapIndex" | "handicapIndexSource">;
  onChange: (handicap: number | null) => void;
  onResolve?: () => void;
}) {
  if (!canEditGuestHandicap(player)) return <div className="accountHandicapLocked" aria-label={`HCP de ${player.name} bloqueado`}>
    <span>🔒 {playerHandicapSourceLabel(player)}</span>
    {player.handicap === null && player.handicapIndex === undefined && (onResolve
      ? <button type="button" className="textButton" onClick={onResolve}>Revisar Información de golf</button>
      : <small>Este jugador debe activar o revisar su Index en Perfil → Información de golf.</small>)}
  </div>;
  return <label className="guestHandicapControl"><span>HCP manual · Invitado</span><NumericCaptureInput aria-label={`HCP de ${player.name || "invitado"}`} inputMode="decimal" step={0.1} min={-15} max={36} placeholder="—" value={player.handicap} emptyWhenZero={false} onValueChange={onChange} /></label>;
}

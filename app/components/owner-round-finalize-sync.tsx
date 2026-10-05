"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { finalizeOwnerRound } from "../../lib/owner-round-finalize";
import type { RoundSnapshot } from "../../lib/types";

export function OwnerRoundFinalizeSync({ round, userId, accessToken }: { round: RoundSnapshot; userId: string; accessToken: string }) {
  const [message, setMessage] = useState("Comprobando cierre de la ronda canónica…");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await finalizeOwnerRound(round, userId, accessToken, localStorage);
      setPending(false);
      setMessage(result.delivery?.notifications === "BLOCKED_EXTERNAL_NOTIFICATION_PERMISSIONS"
        ? "Ronda cerrada en nube. Los jugadores pueden revisar la tarjeta; la entrega de notificaciones sigue pendiente."
        : "Tarjeta canónica cerrada en nube. Puedes actualizar la tarjeta de participantes.");
    } catch (error) {
      setPending(true); setMessage(error instanceof Error ? error.message : "Cierre pendiente; tu tarjeta local se conserva.");
    } finally { busy.current = false; }
  }, [round, userId, accessToken]);
  useEffect(() => { void sync(); }, [sync]);
  return <section className="notice" aria-label="Cierre de nube"><p role="status">{message}</p>{pending && <button type="button" className="secondary" onClick={() => void sync()}>REINTENTAR CIERRE EN NUBE</button>}</section>;
}

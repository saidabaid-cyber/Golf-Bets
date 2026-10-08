"use client";

import { useEffect, useState } from "react";
import { readMissingHistoricalRound } from "../../lib/cloud-history-read";
import type { RoundSnapshot } from "../../lib/types";
import { HistoricalRoundDetail } from "./historical-round-detail";

/** Read-only fallback for a server-listed card absent from local history. */
export function CloudHistoricalRound({ roundId, accountUserId, accessToken, onPhoto }: {
  roundId: string | null; accountUserId: string; accessToken?: string;
  onPhoto: (round: RoundSnapshot) => void;
}) {
  const [retry, setRetry] = useState(0);
  const scope = `${accountUserId}:${roundId}:${retry}`;
  const [state, setState] = useState<{ scope: string; round?: RoundSnapshot | null; error?: string }>();
  useEffect(() => {
    if (!roundId || !accountUserId || !accessToken) return;
    const controller = new AbortController();
    let cancelled = false;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void readMissingHistoricalRound(roundId, accountUserId, accessToken, controller.signal)
      .then(round => { if (!cancelled) setState({ scope, round }); })
      .catch(error => { if (!cancelled) setState({ scope, error: controller.signal.aborted ? "La consulta tardó demasiado. Intenta de nuevo." : error instanceof Error && ["Inicia sesión de nuevo para consultar esta tarjeta.", "No pudimos consultar esta tarjeta. Intenta de nuevo."].includes(error.message) ? error.message : "No pudimos consultar esta tarjeta. Intenta de nuevo." }); })
      .finally(() => clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [roundId, accountUserId, accessToken, scope]);
  if (!roundId) return <div className="empty">No se indicó una tarjeta para consultar.</div>;
  if (!accountUserId || !accessToken) return <div className="empty">Inicia sesión para consultar esta tarjeta.</div>;
  const current = state?.scope === scope ? state : undefined;
  if (!current) return <section className="card" role="status">Consultando tu tarjeta guardada…</section>;
  if (current.error) return <section className="card" role="status"><p>{current.error}</p><button type="button" className="secondary" onClick={() => setRetry(value => value + 1)}>Reintentar</button></section>;
  if (!current.round) return <section className="card" role="status"><p>Esta tarjeta no está disponible para tu cuenta.</p><p>Puede que ya no exista o que no tengas permiso para consultarla.</p></section>;
  // No accessToken or editor is supplied: even an owned cloud card is viewed
  // without a finalize/sync operation or a write to unresolved local history.
  return <HistoricalRoundDetail key={`${accountUserId}:${current.round.id}`} round={current.round} accountUserId={accountUserId}
    onEdit={() => undefined} onPhoto={() => onPhoto(current.round!)} />;
}

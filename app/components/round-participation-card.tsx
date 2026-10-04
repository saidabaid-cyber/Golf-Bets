"use client";
import { useCallback, useEffect, useState } from "react";
import type { SharedRoundCard } from "../../lib/shared-round-participants";
import { socialRequest, socialErrorMessage } from "../../lib/social-activity-client";
import styles from "./round-participation-card.module.css";

/** Private canonical card; independent of feed publication and friendship. */
export function RoundParticipationCard({ accessToken, roundId, localRoundId, onConfirmed }: {
  accessToken: string; roundId?: string; localRoundId?: string; onConfirmed?: () => Promise<void> | void;
}) {
  const [card, setCard] = useState<SharedRoundCard | null>(null);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const path = `/api/social/rounds/card?${roundId ? `roundId=${encodeURIComponent(roundId)}` : `localRoundId=${encodeURIComponent(localRoundId || "")}`}`;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await socialRequest<{ data: SharedRoundCard }>(path, accessToken, { signal });
    if (!signal?.aborted) { setCard(result.data); setMessage(""); }
  }, [path, accessToken]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => { if (!controller.signal.aborted) setMessage("La tarjeta aún no está disponible en nube. Tu copia local se conserva."); });
    return () => controller.abort();
  }, [refresh]);
  async function confirm() {
    if (!card || busy) return;
    setBusy(true); setMessage("");
    try {
      await socialRequest(`/api/social/rounds/${encodeURIComponent(card.roundId)}/links`, accessToken, { method: "POST",
        body: { playerKey: card.myPlayerKey, expectedVersion: card.version, expectedHash: card.materialHash } });
      await refresh(); await onConfirmed?.(); setMessage("Participación confirmada. La tarjeta ya puede formar parte de tu historial personal.");
    } catch (error) { setMessage(socialErrorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className={`card ${styles.card}`} aria-label="Participación en la ronda">
    <span className="eyebrow">{card?.completed ? "REVISAR TARJETA" : "RONDA COMPARTIDA"}</span>
    <h2>{card?.courseName || "Tarjeta de participantes"}</h2>
    {card?.groupName && <p>{card.groupName}</p>}
    {card && <><p>{card.completed ? "Cada jugador vinculado confirma su propia participación antes de incorporar esta tarjeta a sus estadísticas." : "El organizador registra los scores en esta ronda. La captura desde otros teléfonos todavía no está disponible."}</p>
      <ul className={styles.players}>{card.players.map(player => <li key={player.playerKey}><span><b>{player.name}</b><small>{player.status === "GUEST" ? "Sin app" : player.status === "CONFIRMED" ? "Confirmado" : "Pendiente de revisión"}</small></span><strong>{player.score ?? "—"}</strong></li>)}</ul>
      {card.myPlayerKey && <details><summary>Mi tarjeta hoyo por hoyo</summary><div className={styles.holes}>{card.players.find(player => player.playerKey === card.myPlayerKey)?.scorecard.map(hole => <span key={hole.hole}>H{hole.hole}<b>{hole.score ?? "—"}</b></span>)}</div></details>}
      {card.myBalance !== null && <p>Mi balance · {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(card.myBalance)}</p>}
      {card.canConfirm && <button type="button" className="primary" disabled={busy} onClick={() => { if (window.confirm("Confirmo que jugué esta ronda y revisé mi tarjeta.")) void confirm(); }}>{busy ? "Confirmando…" : "CONFIRMAR MI PARTICIPACIÓN"}</button>}
      <p className={styles.note}>Guardado en Backyard. La publicación en GHIN no está disponible aquí; cada jugador debe contar con su propia autorización.</p>
    </>}
    {message && <p role="status">{message}</p>}
    <button type="button" className="secondary" disabled={busy} onClick={() => void refresh().catch(error => setMessage(socialErrorMessage(error)))}>Actualizar tarjeta</button>
  </section>;
}

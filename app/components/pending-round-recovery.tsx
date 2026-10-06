"use client";
import { useEffect, useRef, useState } from "react";
import type { PendingRoundRecovery } from "../../lib/pending-round-recovery";
import { CareerPanel } from "./career-shared";
import styles from "./career-hub.module.css";

export function PendingRoundRecoveryPanel({ userId, accessToken, activeRoundId, onResume }: {
  userId: string; accessToken?: string | null; activeRoundId?: string; onResume: (row: PendingRoundRecovery) => void;
}) {
  const [rows, setRows] = useState<PendingRoundRecovery[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const flight = useRef<AbortController | null>(null);
  useEffect(() => () => flight.current?.abort(), []);
  async function load() {
    if (!accessToken || flight.current || nextOffset === null) return;
    const controller = new AbortController(); flight.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/cloud/rounds?pending=1&offset=${nextOffset}`, {
        headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: controller.signal,
      });
      const data = await response.json() as { rows: PendingRoundRecovery[]; nextOffset: number | null; error?: string };
      if (!response.ok) throw new Error(data.error || "No pudimos recuperar tus rondas.");
      if (controller.signal.aborted) return;
      setRows(previous => [...new Map([...(previous || []), ...data.rows].map(row => [row.snapshot.id, row])).values()]);
      setNextOffset(data.nextOffset);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos recuperar tus rondas.");
    } finally {
      if (!controller.signal.aborted) { flight.current = null; setBusy(false); }
    }
  }
  if (!userId || !accessToken) return null;
  const pending = rows?.filter(row => row.snapshot.id !== activeRoundId);
  return <CareerPanel title="Rondas sin terminar">
    <p className={styles.caption}>Recupera una tarjeta guardada en la nube. La ronda actual se conserva antes de cambiar.</p>
    {pending?.map(row => <button key={row.snapshot.id} type="button" className={styles.roundRow} onClick={() => onResume(row)}
      aria-label={`Reanudar ${row.snapshot.id}`}><span className={styles.rowMain}><strong>{row.snapshot.courseName}</strong>
      <small>{row.snapshot.date} · {row.snapshot.teeName} · {Object.keys(row.snapshot.scores || {}).length} hoyos capturados</small>
      <small>{row.snapshot.startedAt ? new Date(row.snapshot.startedAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "Sin iniciar"}</small>
      </span><span>Reanudar ›</span></button>)}
    {pending?.length === 0 && <p className={styles.caption}>No hay otras rondas pendientes en esta página.</p>}
    {error && <p role="alert">{error}</p>}
    {nextOffset !== null && <button type="button" className={styles.goldButton} disabled={busy} onClick={() => void load()}>
      {busy ? "Consultando…" : rows ? "Cargar más pendientes" : "Recuperar rondas sin terminar"}</button>}
  </CareerPanel>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { ownerRoundSyncFingerprint, ownerRoundTransportPayload, syncOwnerRound } from "../../lib/owner-round-sync";
import { ownsLocalWorkspace } from "../../lib/account-workspace";
import type { RoundSnapshot } from "../../lib/types";

/** The existing local draft is the offline outbox. Only committed scores enter
 * this owner transport. Participant multiwriter remains explicitly unavailable. */
export function OwnerRoundSync({ snapshot, pausedBase, accessToken, userId }: { snapshot: RoundSnapshot; pausedBase?: RoundSnapshot; accessToken?: string; userId: string }) {
  const [message, setMessage] = useState("Tu captura se conserva primero en este dispositivo.");
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const fingerprint = ownerRoundSyncFingerprint(ownerRoundTransportPayload(snapshot));
  const latest = useRef(snapshot);
  const knownPausedBase = useRef(pausedBase);
  const forceRetry = useRef(false);
  useEffect(() => { latest.current = snapshot; }, [snapshot]);
  useEffect(() => { knownPausedBase.current = pausedBase; }, [pausedBase]);
  useEffect(() => {
    if (!accessToken || !snapshot.startedAt || snapshot.cloudReadOnly) return;
    let active = true;
    const current = () => active && ownsLocalWorkspace(localStorage, userId) && navigator.onLine;
    async function sync() {
      if (!current()) return;
      const manual = forceRetry.current; forceRetry.current = false;
      const result = await syncOwnerRound(ownerRoundTransportPayload(latest.current), userId, accessToken!, localStorage, current, fetch, manual, knownPausedBase.current);
      if (!active || !result) return;
      setPending(false);
      setMessage(result.delivery?.notifications === "BLOCKED_EXTERNAL_NOTIFICATION_PERMISSIONS"
        ? "Scores sincronizados en una sola ronda. La notificación a participantes sigue pendiente."
        : "Scores sincronizados en una sola ronda. El organizador lleva la captura.");
    }
    const timer = setTimeout(() => { void sync().catch(error => { if (active) { setPending(true); setMessage(error.message || "Nube pendiente; tu captura local se conserva."); } }); }, 1_500);
    return () => { active = false; clearTimeout(timer); };
  }, [fingerprint, accessToken, userId, snapshot.startedAt, snapshot.cloudReadOnly, retry]);
  useEffect(() => {
    const online = () => setRetry(value => value + 1);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  return <div className="notice"><p role="status">{message}</p>{pending && <button type="button" className="secondary" onClick={() => { forceRetry.current = true; setRetry(value => value + 1); }}>REINTENTAR CAPTURA EN NUBE</button>}</div>;
}

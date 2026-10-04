"use client";
import { useEffect, useRef, useState } from "react";
import type { RoundSnapshot } from "../../lib/types";

/** The existing local draft is the offline outbox. Only committed scores enter
 * this owner transport. Participant multiwriter remains explicitly unavailable. */
export function OwnerRoundSync({ snapshot, accessToken, userId }: { snapshot: RoundSnapshot; accessToken?: string; userId: string }) {
  const [message, setMessage] = useState("Tu captura se conserva primero en este dispositivo.");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const { completedAt: ignoredCompleted, updatedAt: ignoredUpdated, ...stable } = snapshot;
  void [ignoredCompleted, ignoredUpdated];
  const serialized = JSON.stringify({ ...stable, lifecycleState: "live" });
  useEffect(() => {
    if (!accessToken || !snapshot.startedAt || snapshot.cloudReadOnly) return;
    let active = true;
    const cacheKey = `backyard-owner-round-revision:${userId}:${snapshot.id}`;
    async function sync() {
      const round = { ...JSON.parse(serialized), updatedAt: new Date().toISOString() };
      const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
      const read = await fetch(`/api/cloud/rounds?localRoundId=${encodeURIComponent(round.id)}`, { headers, cache: "no-store" });
      const existing = await read.json(); if (!read.ok) throw new Error(existing.error);
      const remembered = Number(localStorage.getItem(cacheKey));
      if (existing.data && remembered !== Number(existing.data.version))
        throw new Error("La versión de nube cambió. Tu borrador sigue seguro; revisa la tarjeta antes de volver a sincronizar.");
      const response = await fetch("/api/cloud/rounds", { method: existing.data ? "PUT" : "POST", headers,
        body: JSON.stringify({ round, ...(existing.data ? { expectedVersion: remembered } : {}) }) });
      const result = await response.json();
      // An uncertain notification/audit result can still acknowledge the saved
      // canonical revision. Preserve it for a safe retry, never assume success.
      if (result.version) localStorage.setItem(cacheKey, String(result.version));
      if (!response.ok) throw new Error(result.error || "Sincronización pendiente.");
      if (active) setMessage("Scores sincronizados en una sola ronda. El organizador lleva la captura.");
    }
    const timer = setTimeout(() => { queue.current = queue.current.catch(() => {}).then(sync).catch(error => { if (active) setMessage(error.message || "Nube pendiente; tu captura local se conserva."); }); }, 750);
    return () => { active = false; clearTimeout(timer); };
  }, [serialized, accessToken, userId, snapshot.id, snapshot.startedAt, snapshot.cloudReadOnly]);
  return <p className="notice" role="status">{message}</p>;
}

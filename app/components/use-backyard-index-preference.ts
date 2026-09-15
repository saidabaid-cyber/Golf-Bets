"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chooseIndexPreference, persistIndexPreference, readCloudIndexPreference, readIndexPreference, saveCloudIndexPreference, type BackyardIndexPreference, type IndexPreferenceCache } from "../../lib/backyard-index-preferences";
import { getSupabaseBrowser } from "../../lib/supabase/client";

export type BackyardIndexPreferenceController = {
  preference: BackyardIndexPreference | null;
  ready: boolean;
  saving: boolean;
  error: string;
  change: (enabled: boolean) => Promise<void>;
  declareLocalZero: () => Promise<void>;
  retry: () => Promise<void>;
};

/** One controller at app root: Profile, Stats and round close share the same state. */
export function useBackyardIndexPreference(userId: string, authenticated: boolean): BackyardIndexPreferenceController {
  const [state, setState] = useState<{ owner: string; cache: IndexPreferenceCache | null; ready: boolean; saving: boolean; error: string }>({ owner: "", cache: null, ready: false, saving: false, error: "" });
  const owner = useRef(userId);
  const flight = useRef(false);
  const operation = useRef(0);
  useEffect(() => { owner.current = userId; operation.current += 1; flight.current = false; }, [userId]);

  const retry = useCallback(async () => {
    if (!authenticated || flight.current) return;
    flight.current = true;
    const token = ++operation.current;
    const current = () => owner.current === userId && operation.current === token;
    try {
      const local = readIndexPreference(localStorage, userId);
      if (current()) setState({ owner: userId, cache: local, ready: true, saving: true, error: "" });
      const client = getSupabaseBrowser();
      if (!client) throw new Error("La sincronización del Índice no está configurada.");
      const remote = await readCloudIndexPreference(client, userId);
      if (!current()) return;
      let chosen = chooseIndexPreference(local, remote);
      if (chosen?.pending) {
        const preference = await saveCloudIndexPreference(client, chosen.preference);
        if (!current()) return;
        chosen = { preference, pending: false };
      }
      if (chosen) persistIndexPreference(localStorage, chosen);
      setState({ owner: userId, cache: chosen, ready: true, saving: false, error: "" });
    } catch (error) {
      if (current()) setState((previous) => ({ ...previous, owner: userId, cache: previous.owner === userId ? previous.cache : null, ready: true, saving: false, error: `${error instanceof Error ? error.message : "No se pudo sincronizar el Índice."} La preferencia local se conserva; reintenta.` }));
    } finally { if (current()) flight.current = false; }
  }, [userId, authenticated]);

  useEffect(() => {
    void retry();
    const online = () => void retry();
    const storage = (event: StorageEvent) => { if (event.key?.startsWith("backyard-index-preference-v1:")) void retry(); };
    window.addEventListener("online", online);
    window.addEventListener("storage", storage);
    return () => { operation.current += 1; flight.current = false; window.removeEventListener("online", online); window.removeEventListener("storage", storage); };
  }, [retry]);

  const change = useCallback(async (enabled: boolean) => {
    if (!authenticated || flight.current) return;
    try {
      const previous = readIndexPreference(localStorage, userId)?.preference;
      const now = new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt || "") + 1 || 0)).toISOString();
      const preference: BackyardIndexPreference = { version: 1, userId, enabled, updatedAt: now,
        // The activation/reconfirmation UI explicitly explains this local assumption.
        localPccZeroDeclaredAt: enabled ? previous?.localPccZeroDeclaredAt || now : previous?.localPccZeroDeclaredAt || null };
      persistIndexPreference(localStorage, { preference, pending: true });
      setState({ owner: userId, cache: { preference, pending: true }, ready: true, saving: false, error: "" });
      await retry();
    } catch (error) {
      setState((previous) => ({ ...previous, owner: userId, error: error instanceof Error ? error.message : "No se pudo guardar el Índice." }));
    }
  }, [userId, authenticated, retry]);

  const visible = state.owner === userId && authenticated;
  return { preference: visible ? state.cache?.preference || null : null,
    ready: !authenticated || (visible && state.ready), saving: visible && state.saving,
    error: visible ? state.error : "", change, declareLocalZero: () => change(true), retry };
}

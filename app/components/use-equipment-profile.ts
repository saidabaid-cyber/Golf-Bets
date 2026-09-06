"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEmptyEquipmentProfile,
  equipmentProfileStorageKey,
  equipmentProfileRecoveryStorageKey,
  loadEquipmentProfile,
  normalizeEquipmentProfile,
  saveEquipmentProfile,
  type EquipmentProfile,
} from "../../lib/golf-equipment";
import {
  EquipmentSyncError,
  chooseEquipmentProfile,
  downloadEquipmentProfile,
  uploadEquipmentProfile,
  type EquipmentCloudRecord,
} from "../../lib/equipment-sync";

export type EquipmentPersistenceStatus = "loading" | "local" | "saving" | "synced" | "pending" | "offline" | "conflict" | "error";
export type EquipmentConflictChoice = "local" | "remote";

const DEVICE_KEY = "the-backyard:equipment-device:v1";

function mutationId() {
  return globalThis.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12)}`;
}

function deviceId() {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved?.length && saved.length >= 8 && saved.length <= 120) return saved;
    const next = `device-${mutationId()}`;
    localStorage.setItem(DEVICE_KEY, next);
    return next;
  } catch {
    return "device-local-only";
  }
}

function syncMessage(error: unknown) {
  if (error instanceof EquipmentSyncError && error.status === 401) return "Tu sesión terminó. El equipo sigue guardado en este dispositivo.";
  if (error instanceof EquipmentSyncError && error.status === 409) return "Otro dispositivo cambió tu equipo. Tu versión local se conservó para que puedas decidir después.";
  if (!navigator.onLine) return "Sin conexión. Tu equipo está guardado y se sincronizará al reconectar.";
  return "No se completó la réplica de equipo. Tu copia local se conserva.";
}

export function useEquipmentProfile(userId: string, accessToken: string | null) {
  const [profile, setProfile] = useState<EquipmentProfile | null>(null);
  const [status, setStatus] = useState<EquipmentPersistenceStatus>("loading");
  const [message, setMessage] = useState("");
  const profileRef = useRef<EquipmentProfile | null>(null);
  const cloudRef = useRef<EquipmentCloudRecord | null>(null);
  const cloudEnabledRef = useRef(false);
  const conflictRef = useRef(false);
  const mountedRef = useRef(true);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  const applyProfile = useCallback((next: EquipmentProfile) => {
    profileRef.current = next;
    setProfile(next);
  }, []);

  const syncProfile = useCallback(async (candidate?: EquipmentProfile | null) => {
    const local = candidate || profileRef.current;
    if (!local || !accessToken || !cloudEnabledRef.current || conflictRef.current) return;
    if (!navigator.onLine) { if (mountedRef.current) setStatus("offline"); return; }
    if (mountedRef.current) { setStatus("saving"); setMessage(""); }
    try {
      const uploaded = await uploadEquipmentProfile(local, accessToken, {
        expectedVersion: cloudRef.current?.version ?? null,
        mutationId: mutationId(),
        deviceId: deviceId(),
      });
      cloudRef.current = uploaded;
      conflictRef.current = false;
      if (mountedRef.current) setStatus("synced");
    } catch (error) {
      if (error instanceof EquipmentSyncError && error.status === 409) {
        conflictRef.current = true;
        if (error.remote) cloudRef.current = error.remote;
      }
      if (!mountedRef.current) return;
      setStatus(error instanceof EquipmentSyncError && error.status === 409 ? "conflict" : navigator.onLine ? "pending" : "offline");
      setMessage(syncMessage(error));
    }
  }, [accessToken]);

  const enqueueSync = useCallback((candidate?: EquipmentProfile | null) => {
    syncQueueRef.current = syncQueueRef.current.then(() => syncProfile(candidate)).catch(() => undefined);
  }, [syncProfile]);

  const reconcileCloud = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await fetch("/api/features", { cache: "no-store" });
      if (!response.ok) throw new EquipmentSyncError("No se pudo confirmar la capacidad de sincronización.", response.status, "FEATURE_DISCOVERY_FAILED");
      const features = await response.json() as { equipmentCloudEnabled?: boolean };
      if (!mountedRef.current || profileRef.current?.userId !== userId) return;
      if (!features?.equipmentCloudEnabled) {
        cloudEnabledRef.current = false;
        conflictRef.current = false;
        setStatus("local");
        return;
      }
      cloudEnabledRef.current = true;
      if (!navigator.onLine) { setStatus("offline"); return; }
      setStatus("saving");
      setMessage("");
      const remote = await downloadEquipmentProfile(accessToken, userId);
      if (!mountedRef.current || profileRef.current?.userId !== userId) return;
      cloudRef.current = remote;
      // Re-read after the network request. This includes a save made while
      // capability discovery/download was in flight.
      const localRead = loadEquipmentProfile(localStorage, userId);
      if (!localRead.ok) throw new Error("equipment_local_read_failed");
      const latestLocal = localRead.profile || profileRef.current;
      const decision = chooseEquipmentProfile(localRead.profile ? latestLocal : null, remote);
      if (decision === "remote" && remote) {
        const saved = saveEquipmentProfile(localStorage, remote.profile);
        if (!saved.ok || !saved.profile) throw new Error("equipment_local_write_failed");
        applyProfile(saved.profile);
        conflictRef.current = false;
        setStatus("synced");
      } else if (decision === "local" && latestLocal) {
        conflictRef.current = false;
        enqueueSync(latestLocal);
      } else if (decision === "conflict") {
        conflictRef.current = true;
        setStatus("conflict");
        setMessage("Este dispositivo y la nube tienen cambios distintos. Conservamos ambas versiones hasta que elijas cuál usar.");
      } else {
        conflictRef.current = false;
        setStatus("synced");
      }
    } catch (error) {
      if (!mountedRef.current || profileRef.current?.userId !== userId) return;
      setStatus(navigator.onLine ? "pending" : "offline");
      setMessage(syncMessage(error));
    }
  }, [accessToken, applyProfile, enqueueSync, userId]);

  useEffect(() => {
    mountedRef.current = true;
    cloudRef.current = null;
    cloudEnabledRef.current = false;
    conflictRef.current = false;
    const empty = createEmptyEquipmentProfile(userId);
    const localRead = loadEquipmentProfile(localStorage, userId);
    if (!empty) {
      setStatus("error");
      setMessage("No se pudo identificar este perfil de equipo.");
      return () => { mountedRef.current = false; };
    }
    if (!localRead.ok) {
      setStatus("error");
      setMessage(`${localRead.message} No se sobrescribió la copia existente.`);
      return () => { mountedRef.current = false; };
    }
    applyProfile(localRead.profile || empty);
    setStatus("local");
    setMessage("");
    void reconcileCloud();

    const key = equipmentProfileStorageKey(userId);
    const onStorage = (event: StorageEvent) => {
      if (!key || event.key !== key || !event.newValue) return;
      const read = loadEquipmentProfile(localStorage, userId);
      if (read.ok && read.profile) applyProfile(read.profile);
    };
    const onOnline = () => { void reconcileCloud(); };
    const onOffline = () => setStatus("offline");
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [applyProfile, reconcileCloud, userId]);

  const save = useCallback((value: EquipmentProfile) => {
    const normalized = normalizeEquipmentProfile(value, userId);
    if (!normalized) { setStatus("error"); setMessage("No se guardó el cambio porque el perfil de equipo no es válido."); return false; }
    const result = saveEquipmentProfile(localStorage, normalized);
    if (!result.ok) { setStatus("error"); setMessage(result.message); return false; }
    if (!result.profile) { setStatus("error"); setMessage("No se confirmó la copia local del perfil de equipo."); return false; }
    applyProfile(result.profile);
    if (conflictRef.current) {
      setStatus("conflict");
      setMessage("Tu cambio quedó guardado aquí. La nube no se sobrescribirá hasta que elijas qué versión conservar.");
    } else {
      setStatus(cloudEnabledRef.current ? navigator.onLine ? "pending" : "offline" : "local");
      setMessage("");
      enqueueSync(result.profile);
    }
    return true;
  }, [applyProfile, enqueueSync, userId]);

  const update = useCallback((updater: (current: EquipmentProfile) => EquipmentProfile | null) => {
    const current = profileRef.current;
    if (!current) return false;
    const next = updater(current);
    return next ? save(next) : false;
  }, [save]);

  const recoverLocalProfile = useCallback(() => {
    const empty = createEmptyEquipmentProfile(userId);
    const key = equipmentProfileStorageKey(userId);
    const recoveryKey = equipmentProfileRecoveryStorageKey(userId);
    if (!empty || !key || !recoveryKey) return false;
    try {
      const unreadable = localStorage.getItem(key);
      if (unreadable) localStorage.setItem(recoveryKey, unreadable);
      const saved = saveEquipmentProfile(localStorage, empty);
      if (!saved.ok || !saved.profile) return false;
      cloudRef.current = null;
      conflictRef.current = false;
      applyProfile(saved.profile);
      setStatus("local");
      setMessage("Se creó un perfil opcional nuevo. La copia anterior quedó guardada localmente para recuperación técnica.");
      return true;
    } catch {
      setStatus("error");
      setMessage("No pudimos crear una copia nueva; no se sobrescribió tu información anterior.");
      return false;
    }
  }, [applyProfile, userId]);

  const resolveConflict = useCallback(async (choice: EquipmentConflictChoice) => {
    const local = profileRef.current;
    if (!local || !accessToken || !cloudEnabledRef.current) return false;
    if (!navigator.onLine) {
      setStatus("offline");
      setMessage("Sin conexión. Ambas versiones se conservan hasta que puedas resolver el conflicto.");
      return false;
    }
    setStatus("saving");
    setMessage("");
    try {
      // Re-read immediately before resolving so a stale CAS version can never
      // overwrite a third device that changed the profile in the meantime.
      const remote = await downloadEquipmentProfile(accessToken, userId);
      cloudRef.current = remote;
      if (choice === "remote") {
        if (!remote) {
          setStatus("conflict");
          setMessage("La copia de nube ya no existe. Conservamos tu perfil de este dispositivo.");
          return false;
        }
        const saved = saveEquipmentProfile(localStorage, remote.profile);
        if (!saved.ok || !saved.profile) throw new Error("equipment_local_write_failed");
        applyProfile(saved.profile);
        conflictRef.current = false;
        setStatus("synced");
        return true;
      }
      const uploaded = await uploadEquipmentProfile(local, accessToken, {
        expectedVersion: remote?.version ?? null,
        mutationId: mutationId(),
        deviceId: deviceId(),
      });
      cloudRef.current = uploaded;
      conflictRef.current = false;
      setStatus("synced");
      return true;
    } catch (error) {
      if (error instanceof EquipmentSyncError && error.status === 409) {
        conflictRef.current = true;
        if (error.remote) cloudRef.current = error.remote;
      }
      setStatus(error instanceof EquipmentSyncError && error.status === 409 ? "conflict" : navigator.onLine ? "pending" : "offline");
      setMessage(syncMessage(error));
      return false;
    }
  }, [accessToken, applyProfile, userId]);

  return { profile, status, message, save, update, retry: reconcileCloud, resolveConflict, recoverLocalProfile };
}

export function equipmentStatusLabel(status: EquipmentPersistenceStatus) {
  if (status === "loading") return "Cargando equipo…";
  if (status === "saving") return "Guardando y sincronizando…";
  if (status === "synced") return "Sincronizado";
  if (status === "offline") return "Guardado · pendiente de sincronizar";
  if (status === "pending") return "Guardado · sincronización pendiente";
  if (status === "conflict") return "Guardado local · conflicto pendiente";
  if (status === "error") return "No se confirmó el guardado";
  return "Guardado en este dispositivo";
}

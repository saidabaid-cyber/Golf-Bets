"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEmptyEquipmentProfile,
  equipmentProfileFingerprint,
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
  isEquipmentSyncScopeCurrent,
  shouldQueueEquipmentFingerprint,
  uploadEquipmentProfile,
  type EquipmentCloudRecord,
  type EquipmentSyncScope,
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
  const activeScopeRef = useRef<EquipmentSyncScope | null>(null);
  const scopeGenerationRef = useRef(0);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSyncedFingerprintRef = useRef<string | null>(null);
  const lastQueuedFingerprintRef = useRef<{ fingerprint: string; sequence: number; generation: number } | null>(null);
  const queueSequenceRef = useRef(0);

  const applyProfile = useCallback((next: EquipmentProfile) => {
    profileRef.current = next;
    setProfile(next);
  }, []);

  const syncProfile = useCallback(async (scope: EquipmentSyncScope, candidate?: EquipmentProfile | null) => {
    if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return;
    const local = candidate || profileRef.current;
    if (!local || !scope.accessToken || !cloudEnabledRef.current || conflictRef.current) return;
    const fingerprint = equipmentProfileFingerprint(local, scope.userId);
    if (!fingerprint || (cloudRef.current && lastSyncedFingerprintRef.current === fingerprint)) return;
    if (!navigator.onLine) {
      if (isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) setStatus("offline");
      return;
    }
    if (isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) { setStatus("saving"); setMessage(""); }
    try {
      const uploaded = await uploadEquipmentProfile(local, scope.accessToken, {
        expectedVersion: cloudRef.current?.version ?? null,
        mutationId: mutationId(),
        deviceId: deviceId(),
      });
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return;
      cloudRef.current = uploaded;
      lastSyncedFingerprintRef.current = equipmentProfileFingerprint(uploaded.profile, scope.userId);
      conflictRef.current = false;
      setStatus("synced");
    } catch (error) {
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return;
      if (error instanceof EquipmentSyncError && error.status === 409) {
        conflictRef.current = true;
        if (error.remote) cloudRef.current = error.remote;
      }
      setStatus(error instanceof EquipmentSyncError && error.status === 409 ? "conflict" : navigator.onLine ? "pending" : "offline");
      setMessage(syncMessage(error));
    }
  }, []);

  const enqueueSync = useCallback((candidate?: EquipmentProfile | null, requestedScope?: EquipmentSyncScope | null) => {
    const scope = requestedScope || activeScopeRef.current;
    if (!scope || !isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return;
    const local = candidate || profileRef.current;
    const fingerprint = local ? equipmentProfileFingerprint(local, scope.userId) : null;
    if (!local || !fingerprint || !shouldQueueEquipmentFingerprint(
      fingerprint,
      lastSyncedFingerprintRef.current,
      lastQueuedFingerprintRef.current?.fingerprint ?? null,
    )) return;
    const sequence = queueSequenceRef.current + 1;
    queueSequenceRef.current = sequence;
    lastQueuedFingerprintRef.current = { fingerprint, sequence, generation: scope.generation };
    syncQueueRef.current = syncQueueRef.current
      .then(() => syncProfile(scope, local))
      .catch(() => undefined)
      .finally(() => {
        if (isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)
          && lastQueuedFingerprintRef.current?.generation === scope.generation
          && lastQueuedFingerprintRef.current.sequence === sequence) lastQueuedFingerprintRef.current = null;
      });
  }, [syncProfile]);

  const reconcileCloud = useCallback(async (requestedScope?: EquipmentSyncScope | null) => {
    const scope = requestedScope || activeScopeRef.current;
    if (!scope?.accessToken || !isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return;
    try {
      const response = await fetch("/api/features", { cache: "no-store" });
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return;
      if (!response.ok) throw new EquipmentSyncError("No se pudo confirmar la capacidad de sincronización.", response.status, "FEATURE_DISCOVERY_FAILED");
      const features = await response.json() as { equipmentCloudEnabled?: boolean };
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current) || profileRef.current?.userId !== scope.userId) return;
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
      const remote = await downloadEquipmentProfile(scope.accessToken, scope.userId);
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current) || profileRef.current?.userId !== scope.userId) return;
      cloudRef.current = remote;
      // Re-read after the network request. This includes a save made while
      // capability discovery/download was in flight.
      const localRead = loadEquipmentProfile(localStorage, scope.userId);
      if (!localRead.ok) throw new Error("equipment_local_read_failed");
      const latestLocal = localRead.profile || profileRef.current;
      const decision = chooseEquipmentProfile(localRead.profile ? latestLocal : null, remote);
      if (decision === "remote" && remote) {
        const saved = saveEquipmentProfile(localStorage, remote.profile);
        if (!saved.ok || !saved.profile) throw new Error("equipment_local_write_failed");
        applyProfile(saved.profile);
        lastSyncedFingerprintRef.current = equipmentProfileFingerprint(saved.profile, scope.userId);
        conflictRef.current = false;
        setStatus("synced");
      } else if (decision === "local" && latestLocal) {
        conflictRef.current = false;
        enqueueSync(latestLocal, scope);
      } else if (decision === "conflict") {
        conflictRef.current = true;
        setStatus("conflict");
        setMessage("Este dispositivo y la nube tienen cambios distintos. Conservamos ambas versiones hasta que elijas cuál usar.");
      } else {
        lastSyncedFingerprintRef.current = remote
          ? equipmentProfileFingerprint(remote.profile, scope.userId)
          : latestLocal ? equipmentProfileFingerprint(latestLocal, scope.userId) : null;
        conflictRef.current = false;
        setStatus("synced");
      }
    } catch (error) {
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current) || profileRef.current?.userId !== scope.userId) return;
      setStatus(navigator.onLine ? "pending" : "offline");
      setMessage(syncMessage(error));
    }
  }, [applyProfile, enqueueSync]);

  useEffect(() => {
    const scope: EquipmentSyncScope = {
      generation: scopeGenerationRef.current + 1,
      userId,
      accessToken,
    };
    scopeGenerationRef.current = scope.generation;
    activeScopeRef.current = scope;
    // A replacement token/account gets its own queue immediately. Work still
    // running in the detached queue is scope-guarded and cannot touch refs/UI.
    syncQueueRef.current = Promise.resolve();
    cloudRef.current = null;
    cloudEnabledRef.current = false;
    conflictRef.current = false;
    lastSyncedFingerprintRef.current = null;
    lastQueuedFingerprintRef.current = null;
    const empty = createEmptyEquipmentProfile(userId);
    const localRead = loadEquipmentProfile(localStorage, userId);
    if (!empty) {
      setStatus("error");
      setMessage("No se pudo identificar este perfil de equipo.");
      return () => {
        if (isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) activeScopeRef.current = null;
      };
    }
    if (!localRead.ok) {
      setStatus("error");
      setMessage(`${localRead.message} No se sobrescribió la copia existente.`);
      return () => {
        if (isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) activeScopeRef.current = null;
      };
    }
    applyProfile(localRead.profile || empty);
    setStatus("local");
    setMessage("");
    void reconcileCloud(scope);

    const key = equipmentProfileStorageKey(userId);
    const onStorage = (event: StorageEvent) => {
      if (!key || event.key !== key || !event.newValue) return;
      const read = loadEquipmentProfile(localStorage, userId);
      if (read.ok && read.profile) applyProfile(read.profile);
    };
    const onOnline = () => { void reconcileCloud(scope); };
    const onOffline = () => {
      if (isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) setStatus("offline");
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      if (isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) {
        activeScopeRef.current = null;
        syncQueueRef.current = Promise.resolve();
        lastQueuedFingerprintRef.current = null;
      }
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [accessToken, applyProfile, reconcileCloud, userId]);

  const save = useCallback((value: EquipmentProfile) => {
    const normalized = normalizeEquipmentProfile(value, userId);
    if (!normalized) { setStatus("error"); setMessage("No se guardó el cambio porque el perfil de equipo no es válido."); return false; }
    if (profileRef.current
      && equipmentProfileFingerprint(profileRef.current, userId) === equipmentProfileFingerprint(normalized, userId)) return true;
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
      enqueueSync(result.profile, activeScopeRef.current);
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
    const scope = activeScopeRef.current;
    const local = profileRef.current;
    if (!scope?.accessToken || !isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)
      || !local || !cloudEnabledRef.current) return false;
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
      const remote = await downloadEquipmentProfile(scope.accessToken, scope.userId);
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return false;
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
        lastSyncedFingerprintRef.current = equipmentProfileFingerprint(saved.profile, scope.userId);
        conflictRef.current = false;
        setStatus("synced");
        return true;
      }
      const uploaded = await uploadEquipmentProfile(local, scope.accessToken, {
        expectedVersion: remote?.version ?? null,
        mutationId: mutationId(),
        deviceId: deviceId(),
      });
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return false;
      cloudRef.current = uploaded;
      lastSyncedFingerprintRef.current = equipmentProfileFingerprint(uploaded.profile, scope.userId);
      conflictRef.current = false;
      setStatus("synced");
      return true;
    } catch (error) {
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return false;
      if (error instanceof EquipmentSyncError && error.status === 409) {
        conflictRef.current = true;
        if (error.remote) cloudRef.current = error.remote;
      }
      setStatus(error instanceof EquipmentSyncError && error.status === 409 ? "conflict" : navigator.onLine ? "pending" : "offline");
      setMessage(syncMessage(error));
      return false;
    }
  }, [applyProfile]);

  const retry = useCallback(() => reconcileCloud(activeScopeRef.current), [reconcileCloud]);

  return { profile, status, message, save, update, retry, resolveConflict, recoverLocalProfile };
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

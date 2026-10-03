"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEmptyEquipmentProfile,
  equipmentProfileFingerprint,
  equipmentProfileRecoveryStorageKey,
  equipmentProfileStorageKey,
  loadEquipmentProfile,
  normalizeEquipmentProfile,
  saveEquipmentProfile,
  type EquipmentProfile,
} from "../../lib/golf-equipment";
import {
  acknowledgeEquipmentSyncOutbox,
  clearEquipmentSyncOutbox,
  equipmentSyncStateStorageKey,
  queueEquipmentSyncOutbox,
  readEquipmentSyncState,
  recordEquipmentSyncBase,
} from "../../lib/equipment-offline-store";
import {
  EquipmentSyncError,
  downloadEquipmentProfile,
  equipmentProfilesSemanticallyEqual,
  isEquipmentSyncScopeCurrent,
  reconcileEquipmentProfiles,
  resolveEquipmentProfileConflicts,
  uploadEquipmentProfile,
  type EquipmentCloudRecord,
  type EquipmentSyncScope,
} from "../../lib/equipment-sync";
import { publishEquipmentProfileUpdated } from "../../lib/equipment-profile-events";

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
  if (error instanceof EquipmentSyncError && error.status === 409) return "Otro dispositivo cambió el mismo dato. Conservamos ambas versiones para que decidas.";
  if (!navigator.onLine) return "Sin conexión. Tu equipo está guardado y se sincronizará al reconectar.";
  return "No se completó la réplica de equipo. Tu copia local se conserva.";
}

function cloudBase(record: EquipmentCloudRecord) {
  return {
    profile: record.profile,
    version: record.version,
    lastMutationId: record.lastMutationId,
    updatedAt: record.updatedAt,
  };
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
  const syncQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const applyProfile = useCallback((next: EquipmentProfile) => {
    profileRef.current = next;
    setProfile(next);
  }, []);

  const saveLocal = useCallback((next: EquipmentProfile) => {
    const saved = saveEquipmentProfile(localStorage, next);
    if (!saved.ok || !saved.profile) throw new Error("equipment_local_write_failed");
    applyProfile(saved.profile);
    publishEquipmentProfileUpdated(saved.profile);
    return saved.profile;
  }, [applyProfile]);

  const syncProfile = useCallback(async (scope: EquipmentSyncScope): Promise<boolean> => {
    if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current) || !scope.accessToken
      || !cloudEnabledRef.current || conflictRef.current) return false;
    if (!navigator.onLine) {
      if (isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) setStatus("offline");
      return false;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return false;
      const state = readEquipmentSyncState(localStorage, scope.userId);
      const pending = state.outbox;
      if (!pending) {
        setStatus("synced");
        setMessage("");
        return true;
      }
      setStatus("saving");
      setMessage("");
      try {
        const uploaded = await uploadEquipmentProfile(pending.profile, scope.accessToken, {
          expectedVersion: state.base?.version ?? cloudRef.current?.version ?? null,
          mutationId: pending.mutationId,
          deviceId: deviceId(),
        });
        if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return false;
        cloudRef.current = uploaded;
        recordEquipmentSyncBase(localStorage, scope.userId, cloudBase(uploaded));
        const acknowledged = acknowledgeEquipmentSyncOutbox(
          localStorage,
          scope.userId,
          pending.fingerprint,
          pending.mutationId,
        );
        const current = readEquipmentSyncState(localStorage, scope.userId);
        if (!acknowledged || current.outbox) continue;
        const latestLocal = loadEquipmentProfile(localStorage, scope.userId);
        if (latestLocal.ok && latestLocal.profile
          && equipmentProfileFingerprint(latestLocal.profile, scope.userId) === pending.fingerprint) {
          saveLocal(uploaded.profile);
        }
        conflictRef.current = false;
        setStatus("synced");
        setMessage("");
        return true;
      } catch (error) {
        if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return false;
        if (!(error instanceof EquipmentSyncError) || error.status !== 409 || !error.remote) {
          setStatus(navigator.onLine ? "pending" : "offline");
          setMessage(syncMessage(error));
          return false;
        }

        const remote = error.remote;
        cloudRef.current = remote;
        const localRead = loadEquipmentProfile(localStorage, scope.userId);
        if (!localRead.ok || !localRead.profile) {
          setStatus("error");
          setMessage("No pudimos leer la copia local; la nube no fue sobrescrita.");
          return false;
        }
        const latestState = readEquipmentSyncState(localStorage, scope.userId);
        const localFingerprint = equipmentProfileFingerprint(localRead.profile, scope.userId);
        const reconciliation = reconcileEquipmentProfiles(
          latestState.base?.profile ?? null,
          localRead.profile,
          remote.profile,
          { protectPendingLocalCurrent: Boolean(!latestState.base && latestState.outbox?.fingerprint === localFingerprint) },
        );
        if (reconciliation.conflicts.length) {
          conflictRef.current = true;
          setStatus("conflict");
          setMessage("Este dispositivo y la nube cambiaron el mismo dato. Los demás cambios compatibles ya se conservaron.");
          return false;
        }
        if (!reconciliation.profile) return false;
        const merged = saveLocal(reconciliation.profile);
        recordEquipmentSyncBase(localStorage, scope.userId, cloudBase(remote));
        if (!reconciliation.needsUpload) {
          clearEquipmentSyncOutbox(localStorage, scope.userId);
          conflictRef.current = false;
          setStatus("synced");
          setMessage("");
          return true;
        }
        queueEquipmentSyncOutbox(localStorage, scope.userId, merged, mutationId());
      }
    }
    setStatus("pending");
    setMessage("Tus cambios siguen guardados y se reintentará la sincronización.");
    return false;
  }, [saveLocal]);

  const enqueueSync = useCallback((requestedScope?: EquipmentSyncScope | null) => {
    const scope = requestedScope || activeScopeRef.current;
    if (!scope || !isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return;
    syncQueueRef.current = syncQueueRef.current
      .then(() => syncProfile(scope))
      .catch(() => false);
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
      const localRead = loadEquipmentProfile(localStorage, scope.userId);
      if (!localRead.ok) throw new Error("equipment_local_read_failed");
      // The in-memory empty profile is only a rendering fallback for a fresh
      // device. It is not a local edit and must never outrank a real cloud
      // profile merely because its creation timestamp is newer.
      const latestLocal = localRead.profile;
      const state = readEquipmentSyncState(localStorage, scope.userId);
      const localFingerprint = latestLocal ? equipmentProfileFingerprint(latestLocal, scope.userId) : null;
      const reconciliation = reconcileEquipmentProfiles(
        state.base?.profile ?? null,
        latestLocal,
        remote?.profile ?? null,
        { protectPendingLocalCurrent: Boolean(!state.base && state.outbox?.fingerprint === localFingerprint) },
      );
      if (reconciliation.conflicts.length) {
        conflictRef.current = true;
        setStatus("conflict");
        setMessage("Este dispositivo y la nube cambiaron el mismo dato. Los cambios compatibles se conservarán al resolverlo.");
        return;
      }
      if (!reconciliation.profile) {
        conflictRef.current = false;
        clearEquipmentSyncOutbox(localStorage, scope.userId);
        setStatus("synced");
        return;
      }

      // An unchanged cloud read must not rewrite the local envelope: its new
      // savedAt would notify another tab, which would read and write it again.
      const merged = reconciliation.needsLocalWrite
        ? saveLocal(reconciliation.profile)
        : reconciliation.profile;
      recordEquipmentSyncBase(localStorage, scope.userId, remote ? cloudBase(remote) : null);
      if (remote && !reconciliation.needsUpload) {
        clearEquipmentSyncOutbox(localStorage, scope.userId);
        if (!equipmentProfilesSemanticallyEqual(merged, remote.profile)) saveLocal(remote.profile);
        conflictRef.current = false;
        setStatus("synced");
        setMessage("");
        return;
      }

      queueEquipmentSyncOutbox(localStorage, scope.userId, merged, state.outbox?.mutationId || mutationId());
      conflictRef.current = false;
      setStatus("pending");
      enqueueSync(scope);
    } catch (error) {
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current) || profileRef.current?.userId !== scope.userId) return;
      setStatus(navigator.onLine ? "pending" : "offline");
      setMessage(syncMessage(error));
    }
  }, [enqueueSync, saveLocal]);

  useEffect(() => {
    const scope: EquipmentSyncScope = {
      generation: scopeGenerationRef.current + 1,
      userId,
      accessToken,
    };
    scopeGenerationRef.current = scope.generation;
    activeScopeRef.current = scope;
    syncQueueRef.current = Promise.resolve();
    cloudRef.current = null;
    cloudEnabledRef.current = false;
    conflictRef.current = false;
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

    const profileKey = equipmentProfileStorageKey(userId);
    const syncKey = equipmentSyncStateStorageKey(userId);
    const onStorage = (event: StorageEvent) => {
      if (event.key === profileKey && event.newValue) {
        const read = loadEquipmentProfile(localStorage, userId);
        if (read.ok && read.profile) applyProfile(read.profile);
      }
      if (event.key === profileKey || event.key === syncKey) void reconcileCloud(scope);
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
      }
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [accessToken, applyProfile, reconcileCloud, userId]);

  const save = useCallback((value: EquipmentProfile) => {
    const normalized = normalizeEquipmentProfile(value, userId);
    if (!normalized) { setStatus("error"); setMessage("No se guardó el cambio porque el perfil de equipo no es válido."); return false; }
    if (profileRef.current && equipmentProfilesSemanticallyEqual(profileRef.current, normalized)) return true;
    const result = saveEquipmentProfile(localStorage, normalized);
    if (!result.ok) { setStatus("error"); setMessage(result.message); return false; }
    if (!result.profile) { setStatus("error"); setMessage("No se confirmó la copia local del perfil de equipo."); return false; }
    applyProfile(result.profile);
    if (accessToken) {
      try {
        queueEquipmentSyncOutbox(localStorage, userId, result.profile, mutationId());
      } catch {
        setStatus("error");
        setMessage("El cambio quedó guardado, pero no pudimos preparar su sincronización.");
        publishEquipmentProfileUpdated(result.profile);
        return true;
      }
    }
    if (conflictRef.current) {
      setStatus("conflict");
      setMessage("Tu cambio quedó guardado aquí. Sólo falta resolver los datos editados en ambos lados.");
    } else {
      setStatus(cloudEnabledRef.current ? navigator.onLine ? "pending" : "offline" : "local");
      setMessage("");
      if (cloudEnabledRef.current) enqueueSync(activeScopeRef.current);
    }
    publishEquipmentProfileUpdated(result.profile);
    return true;
  }, [accessToken, applyProfile, enqueueSync, userId]);

  const update = useCallback((updater: (current: EquipmentProfile) => EquipmentProfile | null) => {
    const current = profileRef.current;
    if (!current) return false;
    const next = updater(current);
    return next ? save(next) : false;
  }, [save]);

  const updateConfirmed = useCallback((updater: (current: EquipmentProfile) => EquipmentProfile | null) => {
    const current = profileRef.current;
    if (!current) return null;
    const next = updater(current);
    if (!next || !save(next)) return null;
    return profileRef.current;
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
      if (accessToken) queueEquipmentSyncOutbox(localStorage, userId, saved.profile, mutationId());
      conflictRef.current = false;
      applyProfile(saved.profile);
      publishEquipmentProfileUpdated(saved.profile);
      setStatus(cloudEnabledRef.current ? navigator.onLine ? "pending" : "offline" : "local");
      setMessage("Se creó un perfil opcional nuevo. La copia anterior quedó guardada localmente para recuperación técnica.");
      if (cloudEnabledRef.current) enqueueSync(activeScopeRef.current);
      return true;
    } catch {
      setStatus("error");
      setMessage("No pudimos crear una copia nueva; no se sobrescribió tu información anterior.");
      return false;
    }
  }, [accessToken, applyProfile, enqueueSync, userId]);

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
      const remote = await downloadEquipmentProfile(scope.accessToken, scope.userId);
      if (!isEquipmentSyncScopeCurrent(scope, activeScopeRef.current)) return false;
      if (!remote) {
        recordEquipmentSyncBase(localStorage, scope.userId, null);
        queueEquipmentSyncOutbox(localStorage, scope.userId, local, mutationId());
        conflictRef.current = false;
        return syncProfile(scope);
      }
      cloudRef.current = remote;
      const state = readEquipmentSyncState(localStorage, scope.userId);
      if (!state.base) {
        setStatus("pending");
        setMessage("Falta una base común verificable. Volveremos a comparar ambas copias sin sobrescribirlas.");
        return false;
      }
      const resolved = resolveEquipmentProfileConflicts(state.base.profile, local, remote.profile, choice);
      const saved = saveLocal(resolved);
      recordEquipmentSyncBase(localStorage, scope.userId, cloudBase(remote));
      conflictRef.current = false;
      if (equipmentProfilesSemanticallyEqual(saved, remote.profile)) {
        clearEquipmentSyncOutbox(localStorage, scope.userId);
        saveLocal(remote.profile);
        setStatus("synced");
        return true;
      }
      queueEquipmentSyncOutbox(localStorage, scope.userId, saved, mutationId());
      setStatus("pending");
      return syncProfile(scope);
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
  }, [saveLocal, syncProfile]);

  const retry = useCallback(() => reconcileCloud(activeScopeRef.current), [reconcileCloud]);

  return { profile, status, message, save, update, updateConfirmed, retry, resolveConflict, recoverLocalProfile };
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

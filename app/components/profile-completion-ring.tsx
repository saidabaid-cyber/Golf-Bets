"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { profileCompletionWithEquipment, type CompletionChoices, type CompletionSection, type ProfileCompletion } from "../../lib/profile-completion";
import { completionEquipmentOverride, type CompletionEquipmentRevision } from "../../lib/profile-completion-client";
import { EQUIPMENT_PROFILE_UPDATED_EVENT, type EquipmentProfileUpdatedDetail } from "../../lib/equipment-profile-events";
import { equipmentProfileStorageKey } from "../../lib/golf-equipment";
import { equipmentSyncStateStorageKey } from "../../lib/equipment-offline-store";
import { socialErrorMessage, socialRequest } from "../../lib/social-activity-client";
import { ModalShell } from "./modal-shell";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import styles from "./profile-completion-ring.module.css";

type Result = { choices: CompletionChoices; progress: ProfileCompletion; equipmentRevision: CompletionEquipmentRevision };

export function ProfileCompletionRing({ token, userId, avatar, name, revision, onOpen }: {
  token?: string | null;
  userId: string;
  avatar: string;
  name: string;
  revision: string;
  onOpen: (section: CompletionSection) => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const requestGeneration = useRef(0);

  const applyLocalEquipment = useCallback(() => {
    setResult((current) => {
      if (!current) return current;
      const local = completionEquipmentOverride(localStorage, userId, current.equipmentRevision);
      return local ? {
        ...current,
        progress: profileCompletionWithEquipment(current.progress, local),
      } : current;
    });
  }, [userId]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    try {
      const value = await socialRequest<Result>("/api/account/completion", token, { signal });
      if (!signal?.aborted && requestGeneration.current === generation) {
        const localEquipment = completionEquipmentOverride(localStorage, userId, value.equipmentRevision);
        setResult(localEquipment ? { ...value, progress: profileCompletionWithEquipment(value.progress, localEquipment) } : value);
        setError("");
      }
    } catch (caught) {
      if (!signal?.aborted && requestGeneration.current === generation) setError(socialErrorMessage(caught));
    }
  }, [token, userId]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, revision]);

  useEffect(() => {
    const profileKey = equipmentProfileStorageKey(userId);
    const syncKey = equipmentSyncStateStorageKey(userId);
    const onEquipmentUpdated = (event: Event) => {
      const detail = (event as CustomEvent<EquipmentProfileUpdatedDetail>).detail;
      if (detail?.userId !== userId) return;
      applyLocalEquipment();
      void refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== profileKey && event.key !== syncKey) return;
      applyLocalEquipment();
      void refresh();
    };
    window.addEventListener(EQUIPMENT_PROFILE_UPDATED_EVENT, onEquipmentUpdated);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EQUIPMENT_PROFILE_UPDATED_EVENT, onEquipmentUpdated);
      window.removeEventListener("storage", onStorage);
    };
  }, [applyLocalEquipment, refresh, userId]);

  const percent = result?.progress.percent ?? 0;
  return <>
    <button
      type="button"
      className={styles.ring}
      style={{ "--progress": `${percent}%`, ...(percent === 100 ? { background: "transparent" } : {}) } as CSSProperties}
      onClick={() => { setOpen(true); void refresh(); }}
      aria-label={`Perfil ${result ? `${percent}% completado` : "consultar progreso"}`}
    >
      <span><ProfileAvatarMedia value={avatar} fallback={name[0] || "J"} /></span>
      {percent !== 100 && <b>{result ? `${percent}%` : "—"}</b>}
    </button>

    {open && createPortal(<ModalShell open onClose={() => setOpen(false)} className={`confirmDialog ${styles.dialog}`} labelledBy="profile-completion-title">
      <div className={styles.heading}>
        <span>MI PERFIL</span>
        <h2 id="profile-completion-title">Completa tu perfil</h2>
        <b>{result ? `${percent}% completo` : "Calculando…"}</b>
      </div>
      {result && <div className={styles.progress} role="progressbar" aria-label="Progreso del perfil" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>}
      <div className={styles.list}>
        {result?.progress.sections.map((section) => <button type="button" className={styles.row} key={section.id} onClick={() => { setOpen(false); onOpen(section.id); }}>
          <span className={section.complete ? styles.complete : section.optional ? styles.optional : styles.pending} aria-hidden="true">{section.complete ? "✓" : section.optional ? "+" : "○"}</span>
          <span><b>{section.label}</b><small>{section.status}</small></span>
          <strong aria-hidden="true">›</strong>
        </button>)}
      </div>
      {error && <p role="alert">{error}</p>}
      {!result && <button type="button" className="secondary" onClick={() => void refresh()}>Reintentar</button>}
    </ModalShell>, document.body)}
  </>;
}

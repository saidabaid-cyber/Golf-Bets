"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { CompletionChoices, CompletionSection, ProfileCompletion } from "../../lib/profile-completion";
import { socialErrorMessage, socialRequest } from "../../lib/social-activity-client";
import { ModalShell } from "./modal-shell";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import styles from "./profile-completion-ring.module.css";

type Result = { choices: CompletionChoices; progress: ProfileCompletion };

export function ProfileCompletionRing({ token, avatar, name, revision, onOpen }: {
  token?: string | null;
  avatar: string;
  name: string;
  revision: string;
  onOpen: (section: CompletionSection) => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    try {
      const value = await socialRequest<Result>("/api/account/completion", token, { signal });
      if (!signal?.aborted) {
        setResult(value);
        setError("");
      }
    } catch (caught) {
      if (!signal?.aborted) setError(socialErrorMessage(caught));
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, revision]);

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

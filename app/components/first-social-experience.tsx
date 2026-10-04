"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { socialRequest, socialErrorMessage } from "../../lib/social-activity-client";
import { firstExperiencePrompt, scheduleFirstExperienceNudge, firstRoundGroupCopy, type FirstExperienceField, type FirstExperiencePrompt, type FirstExperienceState } from "../../lib/round-first-experience";
import { ModalShell } from "./modal-shell";
import styles from "./first-social-experience.module.css";

type Page = { eligible: boolean; hasGroup: boolean; state: FirstExperienceState };
export function useFirstSocialExperience({ userId, token, home, setup, hasGroup }: { userId: string; token: string | null; home: boolean; setup: boolean; hasGroup: boolean }) {
  const [page, setPage] = useState<Page | null>(null), [prompt, setPrompt] = useState<FirstExperiencePrompt | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const current = useRef({ userId, token });
  useEffect(() => { current.current = { userId, token }; }, [userId, token]);
  const lock = useRef(false);
  useEffect(() => {
    setPage(null); setPrompt(null); setError("");
    if (!token || (!home && !setup)) return;
    const controller = new AbortController();
    void socialRequest<Page>("/api/social/first-experience", token, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setPage(data); }).catch(e => { if (!controller.signal.aborted) setError(socialErrorMessage(e)); });
    return () => controller.abort();
  }, [userId, token, home, setup]);
  useEffect(() => {
    if ((!home && !setup) || !page?.eligible) { setPrompt(null); return; }
    if (prompt) return;
    const candidate = firstExperiencePrompt(page.state, { home, setup, hasGroup: hasGroup || page.hasGroup });
    if (!candidate) return;
    let cancel: (() => void) | undefined;
    const eligible = () => document.visibilityState === "visible" && !document.querySelector('[role="dialog"][aria-modal="true"]');
    const schedule = () => {
      if (!eligible()) { cancel?.(); cancel = undefined; }
      else if (!cancel) cancel = scheduleFirstExperienceNudge(candidate, eligible, () => setPrompt(candidate));
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => { cancel?.(); observer.disconnect(); document.removeEventListener("visibilitychange", schedule); };
  }, [home, setup, page, prompt, hasGroup]);
  const resolve = useCallback(async (field: FirstExperienceField, value: string) => {
    if (!token || lock.current) return false;
    lock.current = true; setBusy(true); setError("");
    try {
      const saved = await socialRequest<Page>("/api/social/first-experience", token, { method: "PUT", body: { field, value } });
      if (current.current.userId !== userId || current.current.token !== token) return false;
      setPage(saved); setPrompt(null); return true;
    } catch (e) { if (current.current.userId === userId) setError(socialErrorMessage(e)); return false; }
    finally { lock.current = false; setBusy(false); }
  }, [token, userId]);
  return { prompt, resolve, busy, error, dismiss: () => setPrompt(null) };
}

export function FirstSocialExperience({ prompt, busy, error, scoreOnly, canBet, onFriends, onCreateGroup, onSkip }: {
  prompt: FirstExperiencePrompt | null; busy: boolean; error: string; scoreOnly: boolean; canBet: boolean;
  onFriends: () => void; onCreateGroup: () => void; onSkip: () => void;
}) {
  const friends = prompt === "friends", round = prompt === "roundGroup";
  return <ModalShell open={Boolean(prompt)} onClose={onSkip} closeDisabled={busy} labelledBy="first-social-title" describedBy="first-social-copy" className={`confirmDialog ${styles.dialog}`}>
    <span className="eyebrow">{friends ? "TU COMUNIDAD" : "TU GRUPO"}</span>
    <h2 id="first-social-title">{friends ? "¿Quieres agregar amigos?" : "¿Quieres crear tu primer grupo?"}</h2>
    <p id="first-social-copy">{friends ? "Encuentra a las personas con las que juegas. Puedes buscarlas por nombre o @usuario, escanear su QR o descubrir golfistas de tu zona." : round ? firstRoundGroupCopy(scoreOnly) : "Guarda a las personas con las que juegas normalmente para cargarlas en futuras rondas en segundos."}</p>
    {!friends && !round && canBet && <p>También puedes guardar tus apuestas habituales.</p>}
    {friends && <div className={styles.options}><span>Cerca de ti</span><span>Buscar por nombre</span><span>Escanear QR</span></div>}
    {error && <p role="alert">{error}</p>}
    <div className={styles.actions}><button type="button" className="primary" disabled={busy} onClick={friends ? onFriends : onCreateGroup}>{busy ? "Guardando…" : friends ? "BUSCAR AMIGOS" : round ? "CREAR GRUPO" : "CREAR MI PRIMER GRUPO"}</button><button type="button" className="textButton" disabled={busy} onClick={onSkip}>{friends ? "AHORA NO" : round ? "CONTINUAR SIN GRUPO" : "DESPUÉS"}</button></div>
  </ModalShell>;
}

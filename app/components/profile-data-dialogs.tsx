"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ModalCloseButton } from "./modal-shell";
import styles from "./profile-data-dialogs.module.css";

export type AccountDataPolicy = "delete_golf_data" | "retain_history";
type Common = { confirmation: string; onConfirmation: (value: string) => void; busy: boolean; error: string; onClose: () => void; onConfirm: () => void };

function Dialog({ titleId, busy, onClose, children }: { titleId: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    element?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !element) return;
      const targets = [...element.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),[tabindex='0']")];
      const first = targets[0]; const last = targets.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus(); }
    };
    element?.addEventListener("keydown", trap);
    return () => { element?.removeEventListener("keydown", trap); previous?.focus(); };
  }, []);
  return createPortal(<div className="modalBackdrop"><section ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}>
    <ModalCloseButton onClose={onClose} disabled={busy} />{children}
  </section></div>, document.body);
}

export function StatisticsResetDialog(props: Common) {
  return <Dialog titleId="delete-stats-title" busy={props.busy} onClose={props.onClose}>
    <span className="destructiveEyebrow">ESTADÍSTICAS</span><h2 id="delete-stats-title">¿Eliminar tus estadísticas?</h2>
    <p>Esto eliminará permanentemente tus estadísticas deportivas y datos derivados de rendimiento. Tu cuenta seguirá existiendo. Esta acción no se puede deshacer.</p>
    <ul><li>Promedios, putts, fairways y GIR</li><li>Bunkers, penalties y tendencias</li><li>Estadísticas agregadas y derivadas de rondas</li></ul>
    <div className={styles.note}><b>Tu histórico se conserva</b><span>Las rondas anteriores dejan de alimentar Stats. Las nuevas rondas empezarán a contar desde este reset.</span></div>
    <label>Escribe ELIMINAR para confirmar<input aria-label="Confirmación para eliminar estadísticas" value={props.confirmation} disabled={props.busy} onChange={(event) => props.onConfirmation(event.target.value)} placeholder="ELIMINAR" autoComplete="off" /></label>
    {props.error && <p role="alert" className={styles.error}>{props.error}</p>}
    <div className={styles.actions}><button type="button" className="secondary" disabled={props.busy} onClick={props.onClose}>Cancelar</button><button type="button" className="dangerButton" disabled={props.confirmation !== "ELIMINAR" || props.busy} onClick={props.onConfirm}>{props.busy ? "Reiniciando…" : "Eliminar estadísticas"}</button></div>
  </Dialog>;
}

export function AccountDataDialog(props: Common & { policy: AccountDataPolicy | null; onPolicy: (value: AccountDataPolicy) => void; syncBusy?: boolean }) {
  return <Dialog titleId="delete-account-title" busy={props.busy} onClose={props.onClose}>
    <span className="destructiveEyebrow">CUENTA Y DATOS</span><h2 id="delete-account-title">¿Qué quieres hacer con tus datos de golf?</h2>
    <fieldset className={styles.choices} disabled={props.busy}><legend className="sr-only">Política de datos</legend>
      <button type="button" aria-pressed={props.policy === "delete_golf_data"} onClick={() => props.onPolicy("delete_golf_data")}><b>ELIMINAR TAMBIÉN MIS DATOS</b><span>Eliminar tus rondas, estadísticas y datos personales asociados a tu cuenta, sujeto a las obligaciones legales de conservación que correspondan.</span></button>
      <button type="button" aria-pressed={props.policy === "retain_history"} onClick={() => props.onPolicy("retain_history")}><b>CONSERVAR MI HISTORIAL PARA RECUPERARLO SI REGRESO</b><span>Solicitar la desactivación y conservar los datos permitidos para recuperar el historial según la política de retención y recuperación aprobada.</span></button>
    </fieldset>
    <p className={styles.legal}>LEGAL_REVIEW_REQUIRED · Los plazos de conservación y el procedimiento de recuperación requieren aprobación. No prometemos conservación indefinida ni borrado absoluto.</p>
    {props.policy && <label>Escribe ELIMINAR para confirmar<input aria-label="Confirmación de eliminación de cuenta" value={props.confirmation} disabled={props.busy} onChange={(event) => props.onConfirmation(event.target.value)} placeholder="ELIMINAR" autoComplete="off" /></label>}
    {props.error && <p role="alert" className={styles.error}>{props.error}</p>}
    {props.syncBusy && <p role="status">Espera a que termine la sincronización antes de continuar.</p>}
    <div className={styles.actions}><button type="button" className="secondary" disabled={props.busy} onClick={props.onClose}>Cancelar</button><button type="button" className="dangerButton" disabled={!props.policy || props.confirmation !== "ELIMINAR" || props.busy || props.syncBusy} onClick={props.onConfirm}>{props.busy ? props.policy === "delete_golf_data" ? "Estamos eliminando tu cuenta…" : "Estamos desactivando tu cuenta…" : props.policy === "retain_history" ? "Desactivar y conservar" : "Eliminar cuenta"}</button></div>
  </Dialog>;
}

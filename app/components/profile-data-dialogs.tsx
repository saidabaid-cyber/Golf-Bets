"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ModalCloseButton } from "./modal-shell";
import styles from "./profile-data-dialogs.module.css";

export type AccountDataPolicy = "delete_golf_data" | "retain_history";
type Common = { confirmation: string; onConfirmation: (value: string) => void; busy: boolean; error: string; onClose: () => void; onConfirm: () => void };

function Dialog({ titleId, busy, onClose, children, account = false }: { titleId: string; busy: boolean; onClose: () => void; children: ReactNode; account?: boolean }) {
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
  return createPortal(<div className={`modalBackdrop ${account ? styles.accountBackdrop : ""}`}><section ref={ref} className={`${styles.dialog} ${account ? styles.accountDialog : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}>
    <ModalCloseButton onClose={onClose} disabled={busy} />{children}
  </section></div>, document.body);
}

export function StatisticsResetDialog(props: Common) {
  return <Dialog account titleId="delete-stats-title" busy={props.busy} onClose={props.onClose}>
    <header className={styles.accountHeader}><span className="destructiveEyebrow">ESTADÍSTICAS</span><h2 id="delete-stats-title">¿Eliminar tus estadísticas?</h2></header>
    <div className={styles.accountContent}>
    <p>Esto eliminará permanentemente tus estadísticas deportivas y datos derivados de rendimiento. Tu cuenta seguirá existiendo. Esta acción no se puede deshacer.</p>
    <ul><li>Promedios, putts, fairways y GIR</li><li>Bunkers, penalties y tendencias</li><li>Estadísticas agregadas y derivadas de rondas</li></ul>
    <div className={styles.note}><b>Tu histórico se conserva</b><span>Las rondas anteriores dejan de alimentar Stats. Las nuevas rondas empezarán a contar desde este reset.</span></div>
    <label>Escribe ELIMINAR para confirmar<input aria-label="Confirmación para eliminar estadísticas" value={props.confirmation} disabled={props.busy} onChange={(event) => props.onConfirmation(event.target.value)} placeholder="ELIMINAR" autoComplete="off" /></label>
    {props.error && <p role="alert" className={styles.error}>{props.error}</p>}
    </div><footer className={styles.accountActions}><button type="button" className="secondary" disabled={props.busy} onClick={props.onClose}>Cancelar</button><button type="button" className={styles.deleteAccountButton} disabled={props.confirmation !== "ELIMINAR" || props.busy} onClick={props.onConfirm}>{props.busy ? "Reiniciando…" : "Eliminar estadísticas"}</button></footer>
  </Dialog>;
}

export function AccountDataDialog(props: Common & { policy: AccountDataPolicy | null; onPolicy: (value: AccountDataPolicy) => void; syncBusy?: boolean; onDeactivate?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (confirming) titleRef.current?.focus(); }, [confirming]);
  function chooseDeletion() {
    if (props.busy || props.syncBusy) return;
    props.onPolicy("delete_golf_data");
    props.onConfirmation("");
    setConfirming(true);
  }
  return <Dialog account titleId="delete-account-title" busy={props.busy} onClose={props.onClose}>
    <header className={styles.accountHeader}><span className="destructiveEyebrow">CUENTA</span><h2 ref={titleRef} tabIndex={-1} id="delete-account-title">{deactivating ? "¿Desactivar tu cuenta?" : confirming ? "¿Eliminar definitivamente tu cuenta?" : "¿Qué quieres hacer?"}</h2></header>
    <div className={styles.accountContent}>
      {deactivating ? <p>Cerraremos tus sesiones. Tu cuenta y tu historial permitido se conservan conforme a la política de retención. Podrás reactivar tu cuenta al iniciar sesión mientras esos datos sigan disponibles.</p> : confirming ? <><p>Esta acción no se puede deshacer. Eliminaremos o anonimizaremos los datos que puedan eliminarse y conservaremos únicamente la información que deba mantenerse por obligaciones legales.</p><label>Escribe ELIMINAR para confirmar<input aria-label="Confirmación para eliminar cuenta" value={props.confirmation} disabled={props.busy} onChange={event => props.onConfirmation(event.target.value)} placeholder="ELIMINAR" autoComplete="off" autoCapitalize="off" spellCheck={false} /></label></> : <fieldset className={styles.choices} disabled={props.busy}><legend className="sr-only">Opciones para tu cuenta</legend>
        <button type="button" disabled={props.syncBusy} onClick={chooseDeletion}><b>Eliminar mi cuenta y mis datos</b><span>Eliminar o anonimizar los datos asociados a tu cuenta que puedan eliminarse, conservando únicamente la información que deba mantenerse por obligaciones legales.</span></button>
        {props.onDeactivate ? <button type="button" disabled={props.syncBusy} onClick={() => { if (!props.busy && !props.syncBusy) setDeactivating(true); }}><b>Desactivar mi cuenta y conservar mi historial</b><span>Cierra tus sesiones sin borrar tu cuenta. Puedes reactivarla al iniciar sesión, conforme a la política de retención.</span></button> : <p>La desactivación requiere habilitar el control de cuenta en este entorno. No se ejecutará una eliminación en su lugar.</p>}
      </fieldset>}
      {props.error && <p role="alert" className={styles.error}>{props.error}</p>}
      {props.syncBusy && <p role="status">Espera a que termine la sincronización antes de continuar.</p>}
      {props.busy && <p role="status">{deactivating ? "Estamos desactivando tu cuenta…" : "Estamos eliminando tu cuenta. Espera un momento."}</p>}
    </div>
    <footer className={styles.accountActions}><button type="button" className="secondary" disabled={props.busy} onClick={props.onClose}>Cancelar</button>{deactivating ? <button type="button" className="primary" disabled={props.busy || props.syncBusy} onClick={props.onDeactivate}>{props.busy ? "Desactivando…" : "Desactivar cuenta"}</button> : confirming && <button type="button" className={styles.deleteAccountButton} disabled={props.policy !== "delete_golf_data" || props.confirmation !== "ELIMINAR" || props.busy || props.syncBusy} onClick={props.onConfirm}>{props.busy ? "Eliminando…" : "Eliminar definitivamente"}</button>}</footer>
  </Dialog>;
}

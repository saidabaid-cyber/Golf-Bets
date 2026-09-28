"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { GhinReadOnlyProfileController } from "./use-ghin-read-only-profile";
import { ModalShell } from "./modal-shell";
import styles from "./ghin-read-only-panel.module.css";

function value(value: string | number | null) {
  return value === null || value === "" ? "No disponible" : String(value);
}

export function GhinReadOnlyPanel({
  control,
  sourceActive,
  onUseGhin,
}: {
  control: GhinReadOnlyProfileController;
  sourceActive: boolean;
  onUseGhin: () => Promise<void>;
}) {
  const profile = control.profile;
  const [authMode, setAuthMode] = useState<"link" | "reauthorize" | null>(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  useEffect(() => {
    if (profile && control.reauthorizationRequired) setAuthMode("reauthorize");
  }, [control.reauthorizationRequired, profile]);

  async function closeAuth() {
    if (control.authorizing) return;
    await control.cancelAuthorization();
    setPassword("");
    setLogin("");
    setAuthMode(null);
  }

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    const secret = password;
    setPassword("");
    if (authMode === "reauthorize") {
      const refreshed = await control.reauthorize(login, secret);
      if (refreshed) {
        setLogin("");
        setAuthMode(null);
      }
      return;
    }
    await control.authorize(login, secret);
  }

  async function confirmLink() {
    const linked = await control.confirm();
    if (!linked) return;
    await onUseGhin();
    setLogin("");
    setPassword("");
    setAuthMode(null);
  }

  async function unlink() {
    const removed = await control.unlink();
    if (removed) setConfirmUnlink(false);
  }

  if (!control.ready && !profile) return <p role="status">Consultando vínculo GHIN…</p>;
  return <div className={styles.root}>
    {!profile ? <>
      <p className={styles.note}>Autentícate con tu propia cuenta GHIN. The Backyard no guardará tu contraseña.</p>
      <button type="button" className="secondary" disabled={control.authorizing} onClick={() => setAuthMode("link")}>
        VINCULAR GHIN
      </button>
    </> : <>
      <p className={styles.badge}>{profile.associationStatus === "VERIFIED" ? "✓ GHIN VINCULADO" : "DATOS CONSULTADOS DESDE GHIN"}</p>
      <dl className={styles.details}>
        <div><dt>Nombre</dt><dd>{profile.playerName}</dd></div>
        <div><dt>GHIN</dt><dd>{profile.ghinNumber}</dd></div>
        <div><dt>Home Club</dt><dd>{value(profile.homeClubName ?? profile.clubName)}</dd></div>
        <div><dt>Handicap Index</dt><dd>{value(profile.handicapIndex)}</dd></div>
        <div><dt>Estado</dt><dd>{value(profile.status)}</dd></div>
        <div><dt>Revisión GHIN</dt><dd>{profile.revisionDate ? new Date(profile.revisionDate).toLocaleDateString("es-MX") : "No disponible"}</dd></div>
        <div><dt>Última actualización</dt><dd>{new Date(profile.lastSyncedAt).toLocaleString("es-MX")}</dd></div>
      </dl>
      {profile.syncStatus !== "SUCCESS" && <p role="status" className={styles.warning}>La última actualización falló. Se conserva el último Handicap Index válido.</p>}
      {control.reauthorizationRequired && <p role="status" className={styles.warning}>Tu sesión GHIN terminó. Reautoriza para consultar datos nuevos.</p>}
      <div className={styles.actions}>
        {!sourceActive && <button type="button" className="primary" disabled={control.refreshing} onClick={() => void onUseGhin()}>USAR GHIN</button>}
        <button type="button" className="secondary" disabled={control.refreshing} onClick={() => void control.refresh()}>{control.refreshing ? "ACTUALIZANDO…" : "ACTUALIZAR GHIN"}</button>
        <button type="button" className="textButton" disabled={control.scoresLoading} onClick={() => void control.loadScores()}>{control.scoresLoading ? "CONSULTANDO SCORES…" : "VER SCORING RECORD"}</button>
        <button type="button" className="textButton" onClick={() => setConfirmUnlink(true)}>DESVINCULAR GHIN</button>
      </div>
      {control.scores && <section className={styles.scores} aria-label="Scoring record GHIN read-only">
        <p><b>{control.scores.count}</b> scores recuperados · sólo lectura</p>
        <div className={styles.scoreList}>{control.scores.items.map((score, index) => <article key={score.id ?? `${score.playedOn ?? "score"}-${index}`}>
          <b>{value(score.playedOn)}</b><span>{value(score.courseName)}</span>
          <small>{[
            score.teeName,
            score.grossScore !== null ? `Score ${score.grossScore}` : null,
            score.adjustedGrossScore !== null ? `Ajustado ${score.adjustedGrossScore}` : null,
            score.differential !== null ? `Diff ${score.differential}` : null,
            score.courseRating !== null ? `CR ${score.courseRating}` : null,
            score.slopeRating !== null ? `Slope ${score.slopeRating}` : null,
            score.holes !== null ? `${score.holes} hoyos` : null,
          ].filter((item) => item !== null).join(" · ")}</small>
        </article>)}</div>
      </section>}
    </>}
    {control.error && authMode === null && !confirmUnlink ? <p role="alert" className={styles.warning}>{control.error}</p> : null}

    <ModalShell open={authMode !== null} onClose={() => void closeAuth()} closeDisabled={control.authorizing} label={authMode === "reauthorize" ? "Reautorizar GHIN" : "Vincular GHIN"}>
      {!control.candidate || authMode === "reauthorize" ? <form className={styles.authForm} onSubmit={(event) => void submitCredentials(event)}>
        <h2>{authMode === "reauthorize" ? "Reautorizar GHIN" : "Vincular GHIN"}</h2>
        <p>Usaremos estos datos únicamente para autenticarte con GHIN y {authMode === "reauthorize" ? "actualizar" : "vincular"} tu cuenta. The Backyard no guardará tu contraseña.</p>
        <label>Email o número GHIN<input name="ghin-login" type="text" inputMode="email" autoComplete="username" maxLength={254} required value={login} onChange={(event) => setLogin(event.target.value)} /></label>
        <label>Contraseña GHIN<input name="ghin-password" type="password" autoComplete="current-password" maxLength={254} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {control.error ? <p role="alert" className={styles.warning}>{control.error}</p> : null}
        <div className="dialogActions"><button type="button" className="secondary" disabled={control.authorizing} onClick={() => void closeAuth()}>Cancelar</button><button type="submit" className="primary" disabled={control.authorizing || !login.trim() || !password}>{control.authorizing ? "AUTENTICANDO…" : "CONTINUAR"}</button></div>
      </form> : <section className={styles.confirmIdentity}>
        <h2>Encontramos tu cuenta GHIN</h2>
        <dl className={styles.details}>
          <div><dt>Nombre</dt><dd>{control.candidate.playerName}</dd></div>
          <div><dt>GHIN</dt><dd>{control.candidate.ghinNumber}</dd></div>
          <div><dt>Home Club</dt><dd>{value(control.candidate.homeClubName)}</dd></div>
          <div><dt>Handicap Index</dt><dd>{value(control.candidate.handicapIndex)}</dd></div>
          <div><dt>Estado</dt><dd>{value(control.candidate.status)}</dd></div>
        </dl>
        <p><b>¿Este eres tú?</b></p>
        {control.error ? <p role="alert" className={styles.warning}>{control.error}</p> : null}
        <div className="dialogActions"><button type="button" className="secondary" disabled={control.authorizing} onClick={() => void closeAuth()}>Cancelar</button><button type="button" className="primary" disabled={control.authorizing} onClick={() => void confirmLink()}>{control.authorizing ? "VINCULANDO…" : "SÍ, VINCULAR ESTA CUENTA"}</button></div>
      </section>}
    </ModalShell>

    <ModalShell open={confirmUnlink} onClose={() => setConfirmUnlink(false)} closeDisabled={control.unlinking} label="Desvincular GHIN">
      <h2>¿Desvincular GHIN?</h2>
      <p>Se quitará el vínculo activo. Tus rondas, scores y snapshots históricos de handicap no se borrarán.</p>
      {control.error ? <p role="alert" className={styles.warning}>{control.error}</p> : null}
      <div className="dialogActions"><button type="button" className="secondary" disabled={control.unlinking} onClick={() => setConfirmUnlink(false)}>Cancelar</button><button type="button" className="primary" disabled={control.unlinking} onClick={() => void unlink()}>{control.unlinking ? "DESVINCULANDO…" : "DESVINCULAR GHIN"}</button></div>
    </ModalShell>
  </div>;
}

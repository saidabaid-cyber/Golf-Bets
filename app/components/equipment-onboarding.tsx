"use client";

import { useEffect, useMemo, useState } from "react";
import { toEquipmentBallFitSummary, type BallFitInput, type BallFitResult } from "../../lib/ball-fitting";
import { golfBallCatalog, golfClubCatalog, golfShaftCatalog } from "../../lib/golf-equipment-catalog";
import {
  setBallOnboardingStatus,
  setBallPreference,
  setEquipmentOnboardingStatus,
  setLastBallFit,
  upsertPlayerBall,
  upsertPlayerClub,
  type PlayerBall,
  type PlayerClub,
} from "../../lib/golf-equipment";
import { BallFitWizard } from "./ball-fit-wizard";
import { BallEditor, CLUB_CATEGORY_ICONS, CLUB_CATEGORY_LABELS, ClubEditor } from "./equipment-editors";
import { BrandLockup } from "./brand-lockup";
import { equipmentStatusLabel, useEquipmentProfile } from "./use-equipment-profile";
import styles from "./equipment.module.css";

type Step = "clubs-prompt" | "clubs-build" | "ball-prompt" | "ball-select" | "fit-prompt" | "fit";

type EquipmentOnboardingProps = {
  userId: string;
  accessToken: string | null;
  defaultHandicap: number | null;
  onComplete: () => void;
};

function fitId() {
  return globalThis.crypto?.randomUUID?.() || `fit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function initialStep(profile: ReturnType<typeof useEquipmentProfile>["profile"]): Step {
  if (!profile || profile.equipmentOnboarding === "NOT_ASKED") return "clubs-prompt";
  if (profile.equipmentOnboarding === "IN_PROGRESS") return "clubs-build";
  if (profile.ballOnboarding === "NOT_ASKED") return "ball-prompt";
  if (profile.ballOnboarding === "IN_PROGRESS") return "ball-select";
  return "fit-prompt";
}

export function EquipmentOnboarding({ userId, accessToken, defaultHandicap, onComplete }: EquipmentOnboardingProps) {
  const { profile, status, message, update } = useEquipmentProfile(userId, accessToken);
  const [step, setStep] = useState<Step>("clubs-prompt");
  const [initialized, setInitialized] = useState(false);
  const [clubEditorOpen, setClubEditorOpen] = useState(false);
  const [ballEditorOpen, setBallEditorOpen] = useState(false);
  const currentClubs = useMemo(() => profile?.clubs.filter((club) => club.isCurrent) || [], [profile]);
  const currentBall = profile?.balls.find((ball) => ball.isCurrent) || null;

  useEffect(() => {
    if (!profile || initialized) return;
    setStep(initialStep(profile));
    setInitialized(true);
  }, [initialized, profile]);

  function skipEverything() {
    if (profile) update((current) => {
      const equipment = setEquipmentOnboardingStatus(current, current.clubs.length ? "COMPLETED" : "SKIPPED");
      if (!equipment) return null;
      const ballState = equipment.balls.some((ball) => ball.isCurrent)
        ? setBallOnboardingStatus(equipment, "COMPLETED")
        : setBallOnboardingStatus(setBallPreference(equipment, "SKIPPED") || equipment, "SKIPPED");
      return ballState;
    });
    onComplete();
  }

  function saveClub(club: PlayerClub) {
    const saved = update((current) => {
      const inProgress = setEquipmentOnboardingStatus(current, "IN_PROGRESS");
      return inProgress ? upsertPlayerClub(inProgress, club) : null;
    });
    if (saved) setClubEditorOpen(false);
  }

  function finishClubs(statusValue: "COMPLETED" | "SKIPPED") {
    update((current) => setEquipmentOnboardingStatus(current, current.clubs.length ? "COMPLETED" : statusValue));
    setStep("ball-prompt");
  }

  function saveBall(ball: PlayerBall) {
    const saved = update((current) => {
      const withBall = upsertPlayerBall(current, ball);
      return withBall ? setBallOnboardingStatus(withBall, "COMPLETED") : null;
    });
    if (saved) { setBallEditorOpen(false); setStep("fit-prompt"); }
  }

  function chooseNoFixedBall() {
    update((current) => {
      const noFixed = setBallPreference(current, "NO_FIXED_BALL");
      return noFixed ? setBallOnboardingStatus(noFixed, "COMPLETED") : null;
    });
    setStep("fit-prompt");
  }

  function skipBall() {
    update((current) => {
      const skipped = setBallPreference(current, "SKIPPED");
      return skipped ? setBallOnboardingStatus(skipped, "SKIPPED") : null;
    });
    setStep("fit-prompt");
  }

  function completeFit(result: BallFitResult, input: BallFitInput) {
    const now = new Date().toISOString();
    const summary = toEquipmentBallFitSummary(result, fitId(), now, input);
    if (!summary) return false;
    const saved = update((current) => setLastBallFit(current, summary, now));
    if (saved) onComplete();
    return saved;
  }

  if (!profile) return <main className={styles.onboardingScreen}><section className={styles.onboardingCard}><BrandLockup compact /><div className={styles.loadingState}>{status === "loading" ? "Preparando tu equipo…" : "No pudimos abrir el perfil opcional de equipo."}</div>{message && <div className={styles.errorState} role="alert">{message}</div>}<div className={styles.onboardingActions}><button type="button" className="primary" onClick={onComplete}>Continuar sin agregar equipo</button></div></section></main>;

  return <main className={styles.onboardingScreen}><section className={styles.onboardingCard}>
    <BrandLockup compact />
    {step === "clubs-prompt" && <>
      <div className="eyebrow">TUS BASTONES</div><h1>¿Quieres agregar los bastones que juegas actualmente?</h1><p>Esto nos ayudará a personalizar tu perfil y futuras estadísticas.</p>
      <div className={styles.onboardingActions}><button type="button" className="primary" onClick={() => { update((current) => setEquipmentOnboardingStatus(current, "IN_PROGRESS")); setStep("clubs-build"); }}>Agregar mis bastones</button><button type="button" className="secondary" onClick={() => finishClubs("SKIPPED")}>Omitir por ahora</button></div>
    </>}

    {step === "clubs-build" && <>
      <div className="eyebrow">TUS BASTONES</div><h1>Construye tu bolsa</h1><p>Agrega sólo lo que quieras. Marca + modelo es suficiente y puedes regresar después desde Perfil.</p>
      <div className={styles.onboardingBuilder}>
        {!currentClubs.length ? <div className={styles.emptyState}><b>Tu bolsa está lista para empezar</b><p>Driver, maderas, híbridos, utility, hierros, wedges y putter.</p></div> : <div className={styles.equipmentList}>{currentClubs.map((club) => { const catalog = club.catalogClubId ? golfClubCatalog.find((item) => item.id === club.catalogClubId) : null; return <div className={styles.equipmentItem} key={club.id}><div className={styles.itemIdentity}><span className={styles.categoryIcon}>{CLUB_CATEGORY_ICONS[club.category]}</span><div><h3>{catalog ? `${catalog.brand} ${catalog.model}` : `${club.customBrand} ${club.customModel}`}</h3><p>{CLUB_CATEGORY_LABELS[club.category]}{club.loft === null ? "" : ` · ${club.loft}°`}</p></div></div></div>; })}</div>}
        <div className={styles.onboardingActions}><button type="button" className="secondary" onClick={() => setClubEditorOpen(true)}>+ Agregar bastón</button><button type="button" className="primary" onClick={() => finishClubs(currentClubs.length ? "COMPLETED" : "SKIPPED")}>{currentClubs.length ? "Continuar con mi bolsa" : "Continuar sin bastones"}</button></div>
      </div>
    </>}

    {step === "ball-prompt" && <>
      <div className="eyebrow">TU BOLA</div><h1>¿Qué bola juegas normalmente?</h1><p>Elegirla es opcional. Sirve para guardar tu perfil y comparar recomendaciones verificables.</p>
      <div className={styles.onboardingActions}><button type="button" className="primary" onClick={() => { update((current) => setBallOnboardingStatus(current, "IN_PROGRESS")); setStep("ball-select"); }}>Elegir bola</button><button type="button" className="secondary" onClick={chooseNoFixedBall}>No tengo una bola fija</button><button type="button" className={styles.onboardingSkip} onClick={skipBall}>Omitir</button></div>
    </>}

    {step === "ball-select" && <>
      <div className="eyebrow">TU BOLA</div><h1>Elige marca y modelo</h1><p>La generación y el color son opcionales. Si no aparece, puedes capturarla manualmente.</p>
      {currentBall && <div className={styles.ballHero}><span className={styles.ballGlyph}>●</span><div><h3>{currentBall.ballBrand} {currentBall.ballModel}</h3><p>Guardada como tu bola actual</p></div></div>}
      <div className={styles.onboardingActions}><button type="button" className="primary" onClick={() => setBallEditorOpen(true)}>{currentBall ? "Cambiar bola" : "Abrir selector"}</button>{currentBall && <button type="button" className="secondary" onClick={() => setStep("fit-prompt")}>Continuar</button>}<button type="button" className={styles.onboardingSkip} onClick={skipBall}>Saltar por ahora</button></div>
    </>}

    {step === "fit-prompt" && <>
      <div className="eyebrow">THE BACKYARD BALL FIT</div><h1>¿Quieres descubrir qué tipo de bola puede ajustarse mejor a tu juego?</h1><p>Es un recomendador orientativo de 2–4 minutos. No es un fitting oficial de Titleist, Callaway, Bridgestone ni de otro fabricante.</p>
      <div className={styles.fitIntro}><h3>Tu mejor grupo, no una verdad absoluta</h3><p>Recibirás tres coincidencias con Match Score, motivos, atributos confirmados y una comparación clara. Lo no verificado aparecerá como “sin dato verificado”.</p></div>
      <div className={styles.onboardingActions}><button type="button" className="primary" onClick={() => setStep("fit")}>Hacer fitting de bola</button><button type="button" className="secondary" onClick={onComplete}>Ahora no</button></div>
    </>}

    {step === "fit" && <BallFitWizard userId={userId} defaultHandicap={defaultHandicap} currentBall={currentBall} catalog={golfBallCatalog} onCancel={onComplete} onComplete={completeFit} />}

    {step !== "fit" && <button type="button" className={styles.onboardingSkip} onClick={skipEverything}>Saltar por ahora y entrar a The Backyard</button>}
    <p className={styles.syncStatus} data-state={status} role="status">{equipmentStatusLabel(status)}{message ? ` · ${message}` : ""}</p>
    {clubEditorOpen && <ClubEditor userId={userId} catalog={golfClubCatalog} shafts={golfShaftCatalog} onCancel={() => setClubEditorOpen(false)} onSave={saveClub} />}
    {ballEditorOpen && <BallEditor userId={userId} catalog={golfBallCatalog} existing={null} onCancel={() => setBallEditorOpen(false)} onSave={saveBall} />}
  </section></main>;
}

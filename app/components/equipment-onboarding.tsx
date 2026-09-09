"use client";

import { useEffect, useMemo, useState } from "react";
import { toEquipmentBallFitSummary, type BallFitInput, type BallFitProfileDefaults, type BallFitResult } from "../../lib/ball-fitting";
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
import { useEquipmentCatalogSearch } from "./use-equipment-catalog-search";
import styles from "./equipment.module.css";

type Step = "clubs-prompt" | "clubs-build" | "ball-prompt" | "ball-select" | "fit-prompt" | "fit";

type EquipmentOnboardingProps = {
  userId: string;
  accessToken: string | null;
  defaultHandicap: number | null;
  ballFitDefaults?: BallFitProfileDefaults;
  onComplete: () => void;
  onBack: () => void;
  onSaveAndExit: () => void;
};

function fitId() {
  return globalThis.crypto?.randomUUID?.() || `fit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function initialStep(profile: ReturnType<typeof useEquipmentProfile>["profile"]): Step {
  if (!profile || profile.equipmentOnboarding === "NOT_ASKED") return "clubs-prompt";
  if (profile.equipmentOnboarding === "IN_PROGRESS") return "clubs-build";
  if (profile.ballOnboarding === "NOT_ASKED") return "fit-prompt";
  if (profile.ballOnboarding === "IN_PROGRESS") return "ball-select";
  return "fit-prompt";
}

export function EquipmentOnboarding({ userId, accessToken, defaultHandicap, ballFitDefaults, onComplete, onBack, onSaveAndExit }: EquipmentOnboardingProps) {
  const { profile, status, message, update } = useEquipmentProfile(userId, accessToken);
  const [step, setStep] = useState<Step>("clubs-prompt");
  const [initialized, setInitialized] = useState(false);
  const [clubEditorOpen, setClubEditorOpen] = useState(false);
  const [ballEditorOpen, setBallEditorOpen] = useState(false);
  const currentClubs = useMemo(() => profile?.clubs.filter((club) => club.isCurrent) || [], [profile]);
  const currentBall = profile?.balls.find((ball) => ball.isCurrent) || null;
  const pinnedClubIds = useMemo(() => profile?.clubs.flatMap((club) => club.catalogClubId ? [club.catalogClubId] : []) || [], [profile]);
  const pinnedShaftIds = useMemo(() => profile?.clubs.flatMap((club) => club.shaftId ? [club.shaftId] : []) || [], [profile]);
  const pinnedBallIds = useMemo(() => profile?.balls.flatMap((ball) => ball.catalogBallId ? [ball.catalogBallId] : []) || [], [profile]);
  const clubCatalog = useEquipmentCatalogSearch({ kind: "CLUB", query: "", pinnedIds: pinnedClubIds });
  const shaftCatalog = useEquipmentCatalogSearch({ kind: "SHAFT", query: "", pinnedIds: pinnedShaftIds });
  const ballCatalog = useEquipmentCatalogSearch({ kind: "BALL", query: "", pinnedIds: pinnedBallIds });

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
    setStep("fit-prompt");
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

  function previous() {
    if (step === "clubs-prompt") { onBack(); return; }
    if (step === "clubs-build") { setStep("clubs-prompt"); return; }
    if (step === "ball-prompt") { setStep("fit-prompt"); return; }
    if (step === "ball-select") { setStep("fit-prompt"); return; }
    if (step === "fit") { setStep("fit-prompt"); return; }
    setStep("clubs-build");
  }

  if (!profile) return <main className={styles.onboardingScreen}><section className={styles.onboardingCard}><BrandLockup compact /><div className={styles.loadingState}>{status === "loading" ? "Preparando tu equipo…" : "No pudimos abrir el perfil opcional de equipo."}</div>{message && <div className={styles.errorState} role="alert">{message}</div>}<div className={styles.onboardingActions}><button type="button" className="primary" onClick={onComplete}>Continuar sin agregar equipo</button></div></section></main>;

  return <main className={styles.onboardingScreen}><section className={styles.onboardingCard}>
    <div className={styles.onboardingTop}><BrandLockup compact /><button type="button" className="textButton" onClick={onSaveAndExit}>Guardar y continuar después</button></div>
    {step === "clubs-prompt" && <>
      <div className="eyebrow">TUS BASTONES</div><h1>¿Quieres agregar los bastones que juegas actualmente?</h1><p>Esto nos ayudará a personalizar tu perfil y futuras estadísticas.</p>
      <div className={styles.onboardingActions}><button type="button" className="primary" onClick={() => { update((current) => setEquipmentOnboardingStatus(current, "IN_PROGRESS")); setStep("clubs-build"); }}>Agregar mis bastones</button><button type="button" className="secondary" onClick={() => finishClubs("SKIPPED")}>Omitir por ahora</button></div>
    </>}

    {step === "clubs-build" && <>
      <div className="eyebrow">TUS BASTONES</div><h1>Construye tu bolsa</h1><p>Agrega sólo lo que quieras. Marca + modelo es suficiente y puedes regresar después desde Perfil.</p>
      <div className={styles.onboardingBuilder}>
        {!currentClubs.length ? <div className={styles.emptyState}><b>Tu bolsa está lista para empezar</b><p>Driver, maderas, híbridos, utility, hierros, wedges y putter.</p></div> : <div className={styles.equipmentList}>{currentClubs.map((club) => { const catalog = club.catalogClubId ? clubCatalog.items.find((item) => item.id === club.catalogClubId) : null; const savedName = [club.customBrand, club.customModel].filter(Boolean).join(" ") || "Bastón guardado"; return <div className={styles.equipmentItem} key={club.id}><div className={styles.itemIdentity}><span className={styles.categoryIcon}>{CLUB_CATEGORY_ICONS[club.category]}</span><div><h3>{catalog ? `${catalog.brand} ${catalog.model}` : savedName}</h3><p>{CLUB_CATEGORY_LABELS[club.category]}{club.loft === null ? "" : ` · ${club.loft}°`}</p></div></div></div>; })}</div>}
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
      <div className="eyebrow">THE BACKYARD BALL FIT</div><h1>Encuentra bolas que se ajusten a tu juego</h1><p>El fitting usa tu HCP, velocidad, vuelo, spin, control y sensación para sugerir un Top 3. Registrar tu bola actual es opcional.</p>
      <div className={styles.fitIntro}><h3>Tu mejor grupo, no una verdad absoluta</h3><p>Recibirás tres coincidencias con Match Score, motivos, atributos confirmados y una comparación clara. Lo no verificado aparecerá como “sin dato verificado”.</p></div>
      <div className={styles.onboardingActions}><button type="button" className="primary" onClick={() => setStep("fit")}>Hacer Ball Fit</button><button type="button" className="secondary" onClick={() => { update((current) => setBallOnboardingStatus(current, "IN_PROGRESS")); setStep("ball-select"); }}>Registrar mi bola actual</button><button type="button" className={styles.onboardingSkip} onClick={onComplete}>Ahora no</button></div>
    </>}

    {step === "fit" && (ballCatalog.items.length ? <BallFitWizard userId={userId} defaultHandicap={defaultHandicap} profileDefaults={ballFitDefaults} currentBall={currentBall} catalog={ballCatalog.items} onCancel={() => setStep("fit-prompt")} onComplete={completeFit} /> : <div className={ballCatalog.status === "loading" ? styles.loadingState : styles.errorState} role="status">{ballCatalog.status === "loading" ? "Cargando catálogo de bolas…" : <>No pudimos cargar el catálogo. Puedes continuar y hacer el fitting después. <button type="button" className="textButton" onClick={ballCatalog.retry}>Reintentar</button><button type="button" className="secondary" onClick={onComplete}>Después</button></>}</div>)}

    {step !== "fit" && <div className={styles.onboardingFooter}><button type="button" className="textButton" onClick={previous}>← Anterior</button><button type="button" className={styles.onboardingSkip} onClick={skipEverything}>Saltar por ahora y entrar a The Backyard</button></div>}
    <p className={styles.syncStatus} data-state={status} role="status">{equipmentStatusLabel(status)}{message ? ` · ${message}` : ""}</p>
    {clubEditorOpen && <ClubEditor userId={userId} catalog={clubCatalog.items} shafts={shaftCatalog.items} onCancel={() => setClubEditorOpen(false)} onSave={saveClub} />}
    {ballEditorOpen && <BallEditor userId={userId} catalog={ballCatalog.items} existing={null} onCancel={() => setBallEditorOpen(false)} onSave={saveBall} />}
  </section></main>;
}
